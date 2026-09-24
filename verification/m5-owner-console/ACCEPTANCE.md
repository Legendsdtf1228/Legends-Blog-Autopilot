# M5 owner-console acceptance checkpoint

**Accepted by the user:** 2026-09-24  
**Repository:** `Legendsdtf1228/Legends-Blog-Autopilot`  
**Branch:** `replit/owner-console`  
**Immutable verified checkpoint:** `33995a82c48114c064285cdc9329a8ebe4ff9d45`

The accepted commit is the branch tip verified against disposable PostgreSQL. Its sole parent is `0bbad3857311c5cf0ef637dae6bf8ee6f890d70d`, whose sole parent is accepted M5 base `26da6a826312f3ba870dc359fc00dc038d3d0f18`. There are two single-parent commits after that base; no merge of `main` occurred. The isolated checkout was clean. The branch was not modified by this acceptance record, and it must not be silently advanced, merged, or deployed.

## Verification result

| Check | Recorded result |
| --- | --- |
| Standalone dependencies | `npm ci` from the checkpoint's existing lockfile in an isolated checkout; 151 packages installed; no dependency-version or manifest changes |
| TypeScript | `npm run typecheck` passed (exit 0) |
| Full automated suite | 28 test files; **273 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo** against disposable loopback PostgreSQL |
| Production build | `npm run build` passed (exit 0); 77 emitted files |
| Lint | `npm run lint` passed (exit 0); this script runs the same TypeScript check, not a separate linter |
| Migrations | Fresh apply and repeated runs succeeded; 11 migration records. Normalized schema, migration IDs/timestamps, and default settings did not change on rerun |
| Safety defaults | Fresh DB: `enabled=false`, `draftOnlyMode=true`, `rolloutMode=draft_only` |
| Git | Remote branch matched checkpoint; two single-parent commits from accepted base; `git diff --check` clean; isolated working tree clean |

The database-backed owner-console regression test confirmed that answering one question leaves another question in the same packet visible and answerable; the unanswered count changes from two to one to zero; repeating an answer returns HTTP 409; and both answers remain `PENDING_APPROVAL` with `publicUsageAllowed=false`, even when public-use permission was requested. M5's approval validator separately requires explicit approval details and `publicUsageAllowed=true` for approved production knowledge. The owner answer route does not set either.

## Evidence and boundaries

The original complete test output, migration snapshots, schema dumps, and a command/result record are preserved in [`evidence/`](evidence/README.md). PostgreSQL 16's `pg_dump` generates different `\restrict` / `\unrestrict` markers for each dump; after removing only those volatile lines, the schema dumps were byte-identical. The raw-hash difference was not schema drift.

The verification used Node 24.13.0 and a PostgreSQL 16.10 instance bound to loopback. The test process had a clean environment containing only a local test `DATABASE_URL` and `NODE_ENV=test`; the migration process likewise had only a local `DATABASE_URL`. The disposable server and its data directory were removed afterward. No production database, live Shopify/OpenAI account, production credentials, merge, or deployment was involved.

**Limits:** The project's `tsconfig.json` includes `src/**/*.ts` and excludes `test`; test files were executed by the suite but were not part of the configured static typecheck. There is no separately configured lint tool. Local verification does not establish production configuration, migration compatibility with the existing production schema, owner-role authorization policy, or live service health. These remain release gates in [`DEPLOYMENT_READINESS.md`](DEPLOYMENT_READINESS.md).

**Status:** M5 owner-console code checkpoint accepted; **deployment not authorized**. This acceptance is not approval to turn on publishing or to use pending answers publicly.