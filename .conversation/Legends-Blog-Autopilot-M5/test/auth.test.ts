import test from "node:test";
import assert from "node:assert/strict";
import * as jose from "jose";
import { verifyShopifySessionToken } from "../src/auth.js";
import { redactSecrets } from "../src/config.js";
import type { AppConfig } from "../src/config.js";

test("redactSecrets removes api keys and bearer tokens", () => {
  const redacted = redactSecrets({
    authorization: "Bearer abc.def.ghi",
    message: "using sk-abcdefghijklmnopqrstuvwxyz and shpat_abc123"
  }) as Record<string, unknown>;
  assert.equal(redacted.authorization, "[REDACTED]");
  assert.match(String(redacted.message), /REDACTED/);
  assert.equal(String(redacted.message).includes("sk-abcdefghijklmnopqrstuvwxyz"), false);
});

test("verifyShopifySessionToken validates aud/dest/iss and shop", async () => {
  const secret = "test-client-secret-at-least-16";
  const clientId = "test-client-id";
  const shop = "294ac0-57.myshopify.com";
  const key = new TextEncoder().encode(secret);
  const token = await new jose.SignJWT({
    dest: `https://${shop}`,
    iss: `https://${shop}/admin`,
    sub: "user-1"
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(clientId)
    .setExpirationTime("2m")
    .sign(key);

  const config = {
    SHOPIFY_CLIENT_ID: clientId,
    SHOPIFY_CLIENT_SECRET: secret,
    SHOPIFY_SHOP: shop
  } as AppConfig;

  const verified = await verifyShopifySessionToken(token, config);
  assert.equal(verified.shop, shop);
  assert.equal(verified.sub, "user-1");
});

test("verifyShopifySessionToken rejects mismatched shop", async () => {
  const secret = "test-client-secret-at-least-16";
  const clientId = "test-client-id";
  const key = new TextEncoder().encode(secret);
  const token = await new jose.SignJWT({
    dest: "https://other-shop.myshopify.com",
    iss: "https://other-shop.myshopify.com/admin"
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(clientId)
    .setExpirationTime("2m")
    .sign(key);

  await assert.rejects(
    () => verifyShopifySessionToken(token, {
      SHOPIFY_CLIENT_ID: clientId,
      SHOPIFY_CLIENT_SECRET: secret,
      SHOPIFY_SHOP: "294ac0-57.myshopify.com"
    } as AppConfig),
    /does not match/
  );
});
