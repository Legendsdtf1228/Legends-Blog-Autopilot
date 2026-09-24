# Deployment-readiness checklist — M5 owner-console hardening candidate

**Baseline:** accepted commit `33995a82c48114c064285cdc9329a8ebe4ff9d45`. **Candidate parent:** `5913bbbf150c5d7a5ca6de2db4413081e441e2b1`. This is a planning and read-only verification checklist only. It does not authorize a deployment, a merge to `main`, a production migration, a production connection from this workspace, a Railway configuration change, or automatic publishing. Keep `enabled=false`, `draftOnlyMode=true`, and `rolloutMode=draft_only`.

## 1. Release scope and environment

- [ ] Obtain explicit approval for an **owner-console-only** release from this exact commit; confirm the target service, deployment mechanism, previous known-good image/commit, maintenance window, and person authorized to release. The standalone repository contains `railway.json`; the current Replit workspace's artifacts are a different runtime. Do not assume publishing the workspace deploys this branch.
- [ ] Reconcile older `README.md` / `RELEASE.md` deployment instructions that describe merging, a controlled manual publish, or later enabling Autopilot. Those are **not** steps in this restricted owner-console release; the branch-specific no-publishing rule takes precedence.
- [ ] Confirm the actual production URL and set `APP_URL` to its HTTPS origin; do not use a development domain. Require `NODE_ENV=production`, use the service-assigned `PORT`, and set `TRUST_PROXY` only when the trusted ingress actually terminates TLS and forwards proxy headers. Verify secure cookie behavior behind that ingress.
- [ ] Provision a dedicated production `DATABASE_URL` with appropriate connectivity and migration rights. Never point staging or local validation at it. Store credentials only in the target platform's secret manager, not in source, logs, or this checklist.
- [ ] Require an explicit `ADMIN_USERNAME`, a unique strong `ADMIN_PASSWORD` (minimum 12 characters), and a dedicated, independently generated random `SESSION_SECRET` (minimum 16 characters). Do not rely on the username default or the derived session-secret fallback. Establish rotation and recovery ownership.
- [ ] Require `OWNER_USERNAME` to exactly match the standalone cookie-session identity authorized for `/owner/`. If `OWNER_USERNAME` is absent, blank, or does not match, owner authorization fails closed with 403; Basic and Shopify session-token identities are not accepted by the owner-only gate.
- [ ] Confirm the correct `SHOPIFY_SHOP`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION`, `STOREFRONT_URL`, `OPENAI_API_KEY`, and supported `OPENAI_MODEL`; align Shopify app URL, redirect URLs, and scopes with the intended shop. `loadConfig()` requires Shopify/OpenAI values even for a restricted owner-console deployment. Omit optional research providers if unavailable rather than fabricating metrics.
- [ ] Confirm domain/TLS, backup retention, log redaction, access to deployment logs, and an alert/contact for service failure. Do not copy development fixtures to production.

## 2. Read-only production schema compatibility gate

- [ ] Have an authorized operator run the procedure below from an approved environment against the **actual** production database. Do not supply production credentials to this workspace. The procedure starts a read-only transaction, reads migration IDs only from application tables, and reads schema structure only from PostgreSQL catalogs. It does not read customer/application rows and makes no changes.

```bash
# Run only in an authorized operator environment. PGDATABASE may be a secret-manager
# reference or platform-provided connection; do not paste it into tickets or logs.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN TRANSACTION READ ONLY;

-- Confirm this session cannot write.
SHOW transaction_read_only;

-- Migration IDs only: actual state.
SELECT id
FROM schema_migrations
ORDER BY id;

-- Missing candidate migrations. Expected result: zero rows.
WITH expected(id) AS (
  VALUES
    ('001_initial'),
    ('002_articles_audit'),
    ('003_sessions'),
    ('004_topic_research'),
    ('005_research_cycle_runs'),
    ('006_research_cycle_atomic_claim'),
    ('007_rollout_draft_counted_unique'),
    ('008_source_evidence_reader_tasks'),
    ('009_evidence_approval_authority'),
    ('010_opportunity_clusters'),
    ('011_knowledge_registry')
)
SELECT expected.id AS missing_migration
FROM expected
LEFT JOIN schema_migrations actual USING (id)
WHERE actual.id IS NULL
ORDER BY expected.id;

-- Unexpected production migrations. Expected result: zero rows; any result
-- requires review rather than deletion or an attempted down migration.
WITH expected(id) AS (
  VALUES
    ('001_initial'),
    ('002_articles_audit'),
    ('003_sessions'),
    ('004_topic_research'),
    ('005_research_cycle_runs'),
    ('006_research_cycle_atomic_claim'),
    ('007_rollout_draft_counted_unique'),
    ('008_source_evidence_reader_tasks'),
    ('009_evidence_approval_authority'),
    ('010_opportunity_clusters'),
    ('011_knowledge_registry')
)
SELECT actual.id AS unexpected_migration
FROM schema_migrations actual
LEFT JOIN expected USING (id)
WHERE expected.id IS NULL
ORDER BY actual.id;

-- Structure only: tables, columns, types, nullability, and defaults.
SELECT table_name, ordinal_position, column_name, data_type, udt_name,
       is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;

-- Structure only: constraints and indexes, without application-row access.
SELECT conrelid::regclass::text AS table_name, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY table_name, conname;

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

ROLLBACK;
SQL
```

- [ ] Save the query output in the approved release evidence location, compare the structural output with a fresh local database created from this candidate, and have a reviewer investigate every missing/unexpected migration or structural difference. The local fresh-database result of 11 migration IDs does not establish production compatibility.
- [ ] Take and verify a production backup/snapshot **before** any migration, and rehearse recovery on a non-production clone. Confirm retention, restore time, and whether the previous application image tolerates the additive schema.
- [ ] Preserve the Railway commands exactly: build `npm run build`, pre-deploy `node dist/src/migrate.js`, and start `npm start`. Ensure the build includes `dist`, migration failure blocks release, and no destructive reset/drop is run. Do not use local disposable test credentials in production.
- [ ] Before a release attempt, confirm publishing is paused/disabled and draft-only. Do not enable scheduling, manual publishing, or auto-publishing as part of this owner-console rollout.
- [ ] Agree in advance on the rollback trigger (failed migration/readiness, unauthorized access, unintended publish capability, errors). Roll back application code to the pinned previous image/commit; preserve the forward-only database schema unless a separately approved restore is required. Never run an ad hoc down migration or destructive reset. Recheck pause/draft-only controls and audit logs after rollback.

## 3. Owner-console access gate

- [ ] Decide whether **all users accepted by M5 authentication** may use `/owner/`. The route is behind shared M5 auth (standalone session, validated Shopify session token, or legacy Basic); there is no additional owner-specific role gate in this checkpoint. If that is too broad, block external access at ingress or authorize a separate access-control change **after** this checkpoint, with its own review and verification.
- [ ] Confirm who can hold standalone admin credentials, who can access the target shop, and who can inspect interview answers/knowledge. Review revocation, session expiry, audit retention, and incident response.
- [ ] Verify unauthenticated access to `/owner/` is denied, invalid credentials fail, secure cookie settings behave correctly over HTTPS, and a cookie-authenticated write without a valid CSRF token returns 403. Verify the authorized owner can navigate only the intended safe paths. Do not expose admin credentials in smoke-test commands.
- [ ] Confirm that public-use permission is only a request: owner answers remain `PENDING_APPROVAL` and `publicUsageAllowed=false` until an independent M5 approval decision. Do not interpret the checkbox as approval.

## 4. Post-deployment smoke tests (only after separately authorized release)

- [ ] Before a separately authorized release, change the Railway health gate from `/health` to `/ready` through the normal reviewed configuration process. `/health` proves only that the process is live; `/ready` also verifies database connectivity and is the safer release gate. This candidate intentionally does **not** modify `railway.json` or Railway configuration.
- [ ] Confirm the deployed revision is the approved commit, migration completed once, `/health` reports a live process, and the recommended `/ready` release gate reports database connectivity. Check deployment logs for errors without logging credentials.
- [ ] Test login, logout, denied unauthenticated `/owner/` access, and CSRF rejection. Open `/owner/`, pipeline, evidence/knowledge views, and interview questions as an authorized owner. Confirm no publishing controls are available and production settings remain disabled/paused/`draft_only`.
- [ ] Compare the displayed unanswered-question count with read-only database counts. Use **existing, authorized real interview work only** for any write-path smoke test; if none exists, defer it. Never seed production with development fixtures.
- [ ] If the owner explicitly authorizes a real answer, check that another unanswered question stays visible, the count decreases by one, the resulting entry is pending, and public use remains false. Rely on the automated regression test for duplicate-POST behavior rather than risking an unnecessary production mutation.
- [ ] Verify audit events and error monitoring; check that no scheduler, manual publish, or Shopify publication happened. Record results, owner sign-off, and the rollback decision. Do not enable auto-publishing as a final smoke-test step.

## Outstanding release prerequisites at acceptance

Production target and configuration, reconciliation of older publishing instructions, secret presence/validity, backup and restore rehearsal, authorized read-only production schema comparison, Railway `/ready` configuration, owner-access policy, and live smoke-test results are **not yet verified**. Local verification does not make this candidate production-release-approved.
