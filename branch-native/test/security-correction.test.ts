import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Response } from "express";
import {
  createOwnerAuthorization,
  csrfRequestAuthorized,
  csrfTokenFromSession,
  type AuthedRequest
} from "../src/auth.js";
import type { AppConfig } from "../src/config.js";

const secret = "test-session-secret-long-enough";

function config(owner?: string): AppConfig {
  return {
    DATABASE_URL: "postgresql://unused",
    OPENAI_API_KEY: "unused",
    OPENAI_MODEL: "unused",
    SHOPIFY_SHOP: "example.myshopify.com",
    SHOPIFY_CLIENT_ID: "unused",
    SHOPIFY_CLIENT_SECRET: "unused",
    SHOPIFY_API_VERSION: "2026-07",
    STOREFRONT_URL: "https://example.com",
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "unused-password",
    OWNER_USERNAME: owner,
    SESSION_SECRET: secret,
    APP_URL: "http://localhost:3000",
    PORT: 3000,
    NODE_ENV: "test",
    TRUST_PROXY: false
  };
}

function ownerResult(auth: AuthedRequest["auth"], owner?: string) {
  let status: number | undefined;
  let body: string | undefined;
  let nextCalled = false;
  const req = { auth } as AuthedRequest;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    send(value: string) {
      body = value;
      return this;
    }
  } as unknown as Response;
  const next = (() => {
    nextCalled = true;
  }) as NextFunction;
  createOwnerAuthorization(config(owner))(req, res, next);
  return { status, body, nextCalled };
}

test("owner authorization permits only the configured standalone cookie-session identity", () => {
  assert.equal(ownerResult({ mode: "session", user: "admin" }, "admin").nextCalled, true);
  for (const auth of [
    { mode: "basic", user: "admin" },
    { mode: "shopify_session_token", user: "admin", shop: "example.myshopify.com" },
    { mode: "session", user: "other" }
  ] as AuthedRequest["auth"][]) {
    assert.deepEqual(ownerResult(auth, "admin"), {
      status: 403,
      body: "Owner authorization required",
      nextCalled: false
    });
  }
});

test("owner authorization fails closed when owner identity or authentication is missing", () => {
  assert.deepEqual(ownerResult({ mode: "session", user: "admin" }, undefined), {
    status: 403,
    body: "Owner authorization required",
    nextCalled: false
  });
  assert.equal(ownerResult({ mode: "session", user: "admin" }, "").status, 403);
  assert.equal(ownerResult(undefined, "admin").status, 403);
});

test("CSRF exception applies only to a Bearer token verified for the current request", () => {
  const key = "shopify-cookie-session";
  assert.equal(
    csrfRequestAuthorized(
      { auth: { mode: "shopify_session_token", user: "staff", verifiedBearerForRequest: true } } as AuthedRequest,
      undefined,
      undefined,
      secret
    ),
    true
  );
  assert.equal(
    csrfRequestAuthorized(
      {
        headers: { authorization: "Bearer invalid" },
        auth: { mode: "session", user: "admin" }
      } as AuthedRequest,
      key,
      undefined,
      secret
    ),
    false
  );
});

test("cookie and Basic writes require the correct CSRF token, including Shopify-derived cookies", () => {
  const cases: AuthedRequest["auth"][] = [
    { mode: "session", user: "admin" },
    { mode: "shopify_session_token", user: "staff", shop: "example.myshopify.com" },
    { mode: "basic", user: "admin" }
  ];
  for (const [index, auth] of cases.entries()) {
    const key = `csrf-key-${index}`;
    const req = { auth } as AuthedRequest;
    assert.equal(csrfRequestAuthorized(req, key, undefined, secret), false);
    assert.equal(csrfRequestAuthorized(req, key, "wrong", secret), false);
    assert.equal(
      csrfRequestAuthorized(req, key, csrfTokenFromSession(key, secret), secret),
      true
    );
  }
});