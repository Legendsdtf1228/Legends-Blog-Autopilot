# Deployment-readiness checklist — accepted M5 owner console

**Source of truth:** accepted commit `33995a82c48114c064285cdc9329a8ebe4ff9d45` on `replit/owner-console`. This is a planning checklist only. It does not authorize a deployment, a merge to `main`, a production migration, or automatic publishing. The branch README explicitly says not to deploy it as a publishing rollout; keep `enabled=false`, `draftOnlyMode=true`, and `rolloutMode=draft_only`.

## 1. Release scope and environment

- [ ] Obtain explicit approval for an **owner-console-only** release from this exact commit; confirm the target service, deployment mechanism, previous known-good image/commit, maintenance window, and person authorized to release. The standalone repository contains `railway.json`; the current Replit workspace's artifacts are a different runtime. Do not assume publishing the workspace deploys this branch.
- [ ] Reconcile older `README.md` / `RELEASE.md` deployment instructions that describe merging, a controlled manual publish, or later enabling Autopilot. Those are **not** steps in this restricted owner-console release; the branch-specific no-publishing rule takes precedence.
- [ ] Confirm the actual production URL and set `APP_URL` to its HTTPS origin; do not use a development domain. Set `NODE_ENV=production`, the service-assigned `PORT`, and `TRUST_PROXY` only when the trusted ingress actually terminates TLS and forwards proxy headers. Verify secure cookie behavior behind that ingress.
- [ ] Provision a dedicated production `DATABASE_URL` with appropriate connectivity and migration rights. Never point staging or local validation at it. Store credentials only in the target platform's secret manager, not in source, logs, or this checklist.
- [ ] Provide and validate `ADMIN_USERNAME`, a unique strong `ADMIN_PASSWORD` (minimum 12 characters), and a unique strong `SESSION_SECRET` (minimum 16 characters; do not rely on its derived fallback). Establish rotation and recovery ownership.
- [ ] Confirm the correct `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION`, `STOREFRONT_URL`, `OPENAI_API_KEY`, and supported `OPENAI_MODEL`; align Shopify app URL, redirect URLs, and scopes with the intended shop. `loadConfig()` requires Shopify/OpenAI values even for a restricted owner-console deployment. Omit optional research providers if unavailable rather than fabricating metrics.
- [ ] Confirm domain/TLS, backup retention, log redaction, access to deployment logs, and an alert/contact for service failure. Do not copy development fixtures to production.

## 2. Migration and rollback gate

- [ ] Have an authorized operator inspect the **actual** production schema and `schema_migrations` state, then review the delta from the existing deployed version. The local fresh-database result (11 records) does not establish production compatibility.
- [ ] Take and verify a production backup/snapshot **before** any migration, and rehearse recovery on a non-production clone. Confirm retention, restore time, and whether the previous application image tolerates the additive schema.
- [ ] Review the exact pre-deploy command for the chosen target: `railway.json` uses `node dist/src/migrate.js` before `npm start`. Ensure the build includes `dist`, migration failure blocks release, and no destructive reset/drop is run. Do not use the local disposable test credentials in production.
- [ ] Before a release attempt, confirm publishing is paused/disabled and draft-only. Do not enable scheduling, manual publishing, or auto-publishing as part of this owner-console rollout.
- [ ] Agree in advance on the rollback trigger (failed migration/readiness, unauthorized access, unintended publish capability, errors). Roll back application code to the pinned previous image/commit; preserve the forward-only database schema unless a separately approved restore is required. Never run an ad hoc down migration or destructive reset. Recheck pause/draft-only controls and audit logs after rollback.

## 3. Owner-console access gate

- [ ] Decide whether **all users accepted by M5 authentication** may use `/owner/`. The route is behind shared M5 auth (standalone session, validated Shopify session token, or legacy Basic); there is no additional owner-specific role gate in this checkpoint. If that is too broad, block external access at ingress or authorize a separate access-control change **after** this checkpoint, with its own review and verification.
- [ ] Confirm who can hold standalone admin credentials, who can access the target shop, and who can inspect interview answers/knowledge. Review revocation, session expiry, audit retention, and incident response.
- [ ] Verify unauthenticated access to `/owner/` is denied, invalid credentials fail, secure cookie settings behave correctly over HTTPS, and a cookie-authenticated write without a valid CSRF token returns 403. Verify the authorized owner can navigate only the intended safe paths. Do not expose admin credentials in smoke-test commands.
- [ ] Confirm that public-use permission is only a request: owner answers remain `PENDING_APPROVAL` and `publicUsageAllowed=false` until an independent M5 approval decision. Do not interpret the checkbox as approval.

## 4. Post-deployment smoke tests (only after separately authorized release)

- [ ] Confirm the deployed revision is the approved commit, migration completed once, `/health` reports a live process, and `/ready` reports database connectivity. Check deployment logs for errors without logging credentials.
- [ ] Test login, logout, denied unauthenticated `/owner/` access, and CSRF rejection. Open `/owner/`, pipeline, evidence/knowledge views, and interview questions as an authorized owner. Confirm no publishing controls are available and production settings remain disabled/paused/`draft_only`.
- [ ] Compare the displayed unanswered-question count with read-only database counts. Use **existing, authorized real interview work only** for any write-path smoke test; if none exists, defer it. Never seed production with development fixtures.
- [ ] If the owner explicitly authorizes a real answer, check that another unanswered question stays visible, the count decreases by one, the resulting entry is pending, and public use remains false. Rely on the automated regression test for duplicate-POST behavior rather than risking an unnecessary production mutation.
- [ ] Verify audit events and error monitoring; check that no scheduler, manual publish, or Shopify publication happened. Record results, owner sign-off, and the rollback decision. Do not enable auto-publishing as a final smoke-test step.

## Outstanding release prerequisites at acceptance

Production target and configuration, reconciliation of older publishing instructions, secret presence/validity, backup and restore rehearsal, production schema compatibility, owner-access policy, and live smoke-test results are **not yet verified**. The accepted checkpoint is code-verified locally, not production-release-approved.