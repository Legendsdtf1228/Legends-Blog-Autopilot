import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import * as jose from "jose";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";

export type AuthMode = "basic" | "session" | "shopify_session_token";

export interface AuthedRequest extends Request {
  auth?: {
    mode: AuthMode;
    user: string;
    shop?: string;
  };
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

export function createSessionId(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function createDbSession(
  db: Db,
  opts: { user: string; mode: AuthMode; shop?: string; ttlHours?: number }
): Promise<string> {
  const id = createSessionId();
  const hours = opts.ttlHours ?? 12;
  await db.query(
    `INSERT INTO sessions(id, shop, user_label, auth_mode, expires_at)
     VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)`,
    [id, opts.shop ?? null, opts.user, opts.mode, String(hours)]
  );
  return id;
}

export async function getDbSession(db: Db, id: string) {
  const { rows } = await db.query<{
    id: string;
    shop: string | null;
    user_label: string;
    auth_mode: AuthMode;
    expires_at: Date;
  }>("SELECT * FROM sessions WHERE id=$1 AND expires_at > now()", [id]);
  return rows[0] ?? null;
}

export async function destroyDbSession(db: Db, id: string): Promise<void> {
  await db.query("DELETE FROM sessions WHERE id=$1", [id]);
}

export async function verifyShopifySessionToken(
  token: string,
  config: AppConfig
): Promise<{ shop: string; sub?: string; dest: string }> {
  const secret = new TextEncoder().encode(config.SHOPIFY_CLIENT_SECRET);
  const { payload } = await jose.jwtVerify(token, secret, {
    algorithms: ["HS256"],
    audience: config.SHOPIFY_CLIENT_ID
  });

  const dest = String(payload.dest || "");
  const iss = String(payload.iss || "");
  const destHost = dest.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const issHost = iss.replace(/^https?:\/\//, "").split("/")[0] || "";

  if (!destHost || !issHost || destHost !== issHost) {
    throw new Error("Shopify session token dest/iss mismatch");
  }
  if (!destHost.endsWith(".myshopify.com")) {
    throw new Error("Shopify session token shop is invalid");
  }
  if (config.SHOPIFY_SHOP && destHost !== config.SHOPIFY_SHOP) {
    throw new Error(`Shopify session token shop ${destHost} does not match configured shop`);
  }

  return { shop: destHost, sub: payload.sub ? String(payload.sub) : undefined, dest: destHost };
}

export function setSessionCookie(res: Response, config: AppConfig, sessionId: string, embedded = false) {
  const secure = config.APP_URL.startsWith("https") || config.NODE_ENV === "production";
  // Embedded iframes need SameSite=None; Secure
  const sameSite = embedded ? "None" : "Lax";
  res.setHeader(
    "Set-Cookie",
    [
      `lba_session=${encodeURIComponent(sessionId)}`,
      "Path=/",
      "HttpOnly",
      `SameSite=${sameSite}`,
      secure ? "Secure" : "",
      "Max-Age=43200"
    ].filter(Boolean).join("; ")
  );
}

export function clearSessionCookie(res: Response, config: AppConfig) {
  const secure = config.APP_URL.startsWith("https") || config.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `lba_session=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

export function createAuthMiddleware(config: AppConfig, db: Db) {
  return async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    // Health endpoints bypass this middleware at router level.

    // 1) Shopify session token (Authorization: Bearer)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      try {
        const verified = await verifyShopifySessionToken(token, config);
        req.auth = { mode: "shopify_session_token", user: verified.sub || "shopify-user", shop: verified.shop };
        return next();
      } catch {
        // Fall through to other auth methods for standalone use
        if (req.path.startsWith("/api/") && req.headers["x-shopify-authorization"] === "required") {
          res.setHeader("X-Shopify-Retry-Invalid-Session-Request", "1");
          return res.status(401).json({ ok: false, error: "Invalid Shopify session token" });
        }
      }
    }

    // 2) Cookie session (standalone login)
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.lba_session) {
      const session = await getDbSession(db, cookies.lba_session);
      if (session) {
        req.auth = { mode: session.auth_mode, user: session.user_label, shop: session.shop ?? undefined };
        return next();
      }
    }

    // 3) HTTP Basic (legacy standalone)
    if (authHeader?.startsWith("Basic ")) {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
      const sep = decoded.indexOf(":");
      const username = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const password = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (safeEqual(password, config.ADMIN_PASSWORD) && safeEqual(username, config.ADMIN_USERNAME)) {
        req.auth = { mode: "basic", user: username };
        return next();
      }
    }

    // Embedded Shopify browser navigations often cannot complete Basic Auth prompts.
    const isEmbedded = Boolean(req.query.embedded || req.query.shop || req.headers["sec-fetch-dest"] === "iframe");
    if (isEmbedded && (req.headers.accept || "").includes("text/html")) {
      return res.status(401).send(embeddedAuthHelp(config));
    }

    if ((req.headers.accept || "").includes("application/json") || req.path.startsWith("/api/")) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }

    // Standalone login page instead of Basic prompt when possible
    if (req.method === "GET" && !req.path.startsWith("/api/")) {
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="Legends Blog Autopilot"');
    return res.status(401).send("Authentication required");
  };
}

function embeddedAuthHelp(config: AppConfig) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="shopify-api-key" content="${config.SHOPIFY_CLIENT_ID}">
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <title>Connecting…</title></head><body>
  <p>Authenticating with Shopify…</p>
  <script>
    (async function () {
      try {
        if (!window.shopify?.idToken) throw new Error('App Bridge idToken unavailable');
        const token = await window.shopify.idToken();
        const res = await fetch('/api/auth/session-token', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        if (!res.ok) throw new Error('Session exchange failed');
        location.replace('/');
      } catch (e) {
        document.body.innerHTML = '<p>Could not authenticate inside Shopify Admin.</p><p>Open the app from Shopify Admin, or use standalone login at <a href="/login">/login</a>.</p>';
      }
    })();
  </script></body></html>`;
}

export function csrfTokenFromSession(sessionId: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(sessionId).digest("hex");
}

export function verifyCsrf(sessionId: string | undefined, token: string | undefined, secret: string): boolean {
  if (!sessionId || !token) return false;
  const expected = csrfTokenFromSession(sessionId, secret);
  return safeEqual(expected, token);
}
