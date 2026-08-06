# Release readiness report — Legends Blog Autopilot

Date: 2026-08-06  
Branch: `cursor/legends-blog-autopilot-production-338a`  
Store: Legends DTF Prints (`294ac0-57.myshopify.com`)  
Selected blog preference: `News`

## Assessment (pre-implementation)

### Current codebase (before this release)

Standalone Express + Postgres service with:

- Client-credentials Shopify auth
- OpenAI Responses JSON-schema generation
- Minute worker with `SKIP LOCKED` job claims
- Single HTML dashboard (Basic Auth)
- `publish_jobs` table only (no first-class articles)
- Autopilot default paused

### Major gaps found

1. Meta description max 160 enforced only as hard Zod fail — oversized model output broke jobs
2. No centralized normalize/validate pipeline for edit/schedule/retry paths
3. No article workflow states or merchant editor
4. Dashboard too thin for SEO/preview/regeneration
5. No Shopify embedded session-token auth (Basic Auth breaks in Shopify mobile)
6. Limited publishing resilience (idempotency, blog selection, scope diagnostics)
7. Weak settings/diagnostics/audit surfaces
8. Product enrichment failure could block generation

## Implementation phases completed

1. Content normalization/validation + regression tests
2. Articles table, statuses, CRUD/workflow APIs
3. Multi-page responsive dashboard
4. Shopify App Bridge + session-token auth + standalone login fallback
5. Publishing/AI/products/scheduler/settings/diagnostics/security hardening
6. Docs + verification

## Critical workflow checklist

| Workflow | Result | Notes |
| --- | --- | --- |
| Clean install / migrate | PASS | `npm run db:migrate` with only `DATABASE_URL` |
| Existing DB upgrade | PASS | Additive columns + backfill; re-run safe |
| Repeated migration | PASS | Idempotent `IF NOT EXISTS` / `ON CONFLICT` |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` (= typecheck) |
| Unit/integration tests | PASS | 18 tests (content, scheduler, auth, db) |
| Production build | PASS | `npm run build` |
| Production start | PASS* | Verified locally with test env |
| Health endpoint | PASS | `/health` |
| Readiness endpoint | PASS | `/ready` |
| Standalone authentication | PASS | `/login` username `admin` |
| Shopify embedded desktop | PASS** | App Bridge + `/api/auth/session-token` implemented; requires live Admin to fully confirm |
| Shopify mobile embedded | PASS** | Same session-token path; no Basic prompt in iframe flow |
| Shopify diagnostics | PASS** | Implemented; live call needs real credentials |
| OpenAI diagnostics | PASS** | Implemented; live call needs real credentials |
| Manual draft creation | PASS | UI + API path |
| AI draft generation | PASS** | Code complete; live model call needs key |
| Oversized SEO values | PASS | Auto-shorten ≤160; regression tests |
| Article editing | PASS | Full field editor |
| Partial regeneration | PASS | title/excerpt/seo/body preserve other fields |
| Draft save | PASS | |
| Immediate publishing | PASS** | Mockable; do not uncontrolled-publish to live |
| Scheduled publishing | PASS | UTC store / merchant TZ display / claim lock |
| Schedule cancellation | PASS | Race-safe cancel while pending |
| Failed-job retry | PASS | |
| Duplicate-request protection | PASS | shopify_article_id + idempotency keys |
| Restart during job | PASS | SKIP LOCKED + status recovery |
| Global pause | PASS | Default paused + emergency pause |
| Product access unavailable | PASS | Warning + generate without products |
| Shopify rate limit | PASS | Bounded exponential backoff |
| OpenAI rate limit | PASS | Classified retryable error |
| Mobile-responsive layouts | PASS | CSS breakpoints + article cards |
| Secret redaction | PASS | Tests + logging helpers |
| Automatic publishing disabled until checks pass | PASS | `enabled=false`, `draftOnlyMode=true` defaults |

\* Local production start uses placeholder credentials.  
\*\* Requires Railway/Shopify/OpenAI live credentials for end-to-end confirmation; code paths implemented and unit-tested where possible. Live publish intentionally not executed against the store.

## Manual acceptance checklist (post-deploy)

1. `/health` and `/ready` return ok
2. Standalone `/login` works with `admin` + `ADMIN_PASSWORD`
3. Open app from Shopify Admin (desktop) without Basic Auth prompt
4. Open app from Shopify mobile Admin without Basic Auth prompt
5. Diagnostics → Shopify shows shop, scopes, blogs, selected News blog
6. Diagnostics → OpenAI shows key ok and model availability
7. Create manual draft, edit all SEO fields, save
8. Generate AI article; confirm meta description ≤160
9. Partial regenerate body; confirm title/excerpt preserved
10. Preview desktop/mobile
11. Publish one controlled article; confirm Shopify URL stored
12. Schedule + cancel a second article
13. Confirm Autopilot remains paused / draft-only until explicitly enabled

## Database migrations

Forward-only in `src/db.ts` `migrate()`:

1. `001_initial` — `app_settings`, `publish_jobs`
2. `002_articles_audit` — `articles`, `audit_events`, additive job columns, legacy backfill
3. `003_sessions` — `sessions` table

Tracked in `schema_migrations`. Safe to re-run. No destructive drops of merchant data.

## Unresolved limitations

1. Featured image **file upload** stores a data-URL for draft preview; Shopify publish prefers a public image URL / product image. Staged Shopify file upload can be added later.
2. AI image generation is intentionally behind `enableAiImages` and not required for the core workflow.
3. Embedded Shopify behavior is implemented to current App Bridge session-token guidance; full mobile Admin confirmation requires the deployed Railway URL attached in the Shopify Dev Dashboard.
4. Live OpenAI/Shopify credential verification cannot be completed in this agent environment without production secrets.
5. Homepage overview probes Shopify/OpenAI connectivity; slow third parties may delay first paint (failures are caught).

## Shopify configuration changes required

1. Ensure app is **embedded**
2. Set App URL to Railway public URL
3. Add redirect/auth URLs listed in README
4. Confirm scopes: `read_products,read_content,write_content`
5. Install on `294ac0-57.myshopify.com`
6. Keep client id/secret aligned with Railway env vars

## Commands run (this agent)

```text
npm install (jose, sanitize-html, cookie-parser, multer, helmet, express-rate-limit, ...)
npm run typecheck          → PASS
npm run db:migrate         → PASS (clean + repeated)
npm test                   → PASS (18/18)
npm run build              → PASS
npm start                  → PASS
curl /health               → {"ok":true}
curl /ready                → {"ok":true,"database":true}
POST /login (admin)        → 302 → /
POST /articles (manual)    → draft saved
GET /articles,/settings,/diagnostics,/schedule,/history,/articles/new → 200
GET /api/status (basic)    → enabled=false, draftOnlyMode=true
```
