# Legends Blog Autopilot

Production-ready Shopify blogging application for **Legends DTF Prints**. It generates, edits, validates, schedules, and publishes blog articles with Autopilot safety controls.

## Current architecture

| Layer | Responsibility |
| --- | --- |
| `src/server.ts` | Express app, dashboard routes, health, auth, APIs |
| `src/auth.ts` | Standalone login/session cookies + Shopify session-token verification |
| `src/content.ts` | Central normalize/validate pipeline (meta ≤160, HTML sanitize, limits) |
| `src/writer.ts` | OpenAI structured generation, repair-once, diagnostics |
| `src/shopify.ts` | Client-credentials token, blogs/products/publish, retries, diagnostics |
| `src/scheduler.ts` | UTC scheduling, `FOR UPDATE SKIP LOCKED` claims, pause/draft-only safety |
| `src/db.ts` | Postgres schema/migrations, articles, jobs, audit, settings |
| `src/research/` | Search-demand topic research, pillars, scoring, briefs, quality gates |
| `src/views.ts` + `public/assets` | Responsive merchant dashboard |

**Autopilot defaults to paused + draft-only** so deploys cannot publish until release checks pass.

Topic research covers six content pillars (DTF education, garment knowledge, design/branding, apparel-business education, honest entrepreneurship, Legends story), rotates audiences/formats, and keeps generated articles draft-only pending merchant review. Missing keyword providers are reported instead of inventing metrics.

## Required environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (only var required for migrations) |
| `OPENAI_API_KEY` | OpenAI project key |
| `OPENAI_MODEL` | Default model id |
| `SHOPIFY_SHOP` | Permanent domain, e.g. `294ac0-57.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | App client id |
| `SHOPIFY_CLIENT_SECRET` | App client secret (also used to verify session tokens) |
| `ADMIN_PASSWORD` | Standalone admin password (min 12 chars) |
| `APP_URL` | Public Railway URL |

## Optional environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Standalone username |
| `SESSION_SECRET` | derived | Cookie/CSRF signing secret |
| `SHOPIFY_API_VERSION` | `2026-07` | Admin API version |
| `STOREFRONT_URL` | `https://legendsdtf.com` | Public storefront for product links |
| `PORT` | `3000` | HTTP port |
| `NODE_ENV` | `development` | Runtime mode |
| `TRUST_PROXY` | `true` | Trust Railway proxy for rate limits / secure cookies |

## Local setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:3000/login` (username `admin`).

## Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm start
npm run db:migrate
```

Health:

- `GET /health` — process alive
- `GET /ready` — database reachable

## Shopify Dev Dashboard configuration

1. App URL: `https://<your-railway-domain>`
2. Allowed redirection URLs:
   - `https://<your-railway-domain>/`
   - `https://<your-railway-domain>/login`
   - `https://<your-railway-domain>/api/auth/session-token`
3. Embedded app: **Enabled**
4. Scopes: `read_products`, `read_content`, `write_content`
5. Shop: `294ac0-57.myshopify.com` (Legends DTF Prints)
6. Prefer blog handle `news` (selectable in Settings)

Session tokens are verified server-side (JWT HS256 with client secret). The browser-supplied shop is never trusted alone.

## Railway configuration

1. Link Postgres (`DATABASE_URL` injected).
2. Set all required env vars above.
3. `railway.json` runs `node dist/src/migrate.js` pre-deploy, then `npm start`, healthcheck `/health`.
4. Keep Autopilot paused until Diagnostics pass.

## Deployment steps

1. Merge/deploy this branch.
2. Confirm pre-deploy migration succeeds.
3. Hit `/health` and `/ready`.
4. Sign in via `/login` (standalone) or open the app from Shopify Admin (embedded).
5. Run Diagnostics → Shopify + OpenAI.
6. Create a manual draft, generate an AI draft, edit SEO fields, save.
7. Publish **one** controlled article manually.
8. Only then disable draft-only and enable Autopilot.

## Rollback steps

1. Redeploy the previous Railway deployment/image.
2. Do **not** run destructive DB resets. Migrations are forward-only and additive.
3. Emergency stop: Settings → uncheck Automatic publishing, or Overview → Emergency pause.

## Safety notes

- Secrets stay in Railway env vars; Settings only shows configured/not configured.
- Logs redact tokens/keys.
- Scheduler never auto-publishes while paused.
- Duplicate Shopify publishes are blocked via stored `shopify_article_id` / idempotency keys.
- Oversized meta descriptions are auto-shortened before save/publish.
