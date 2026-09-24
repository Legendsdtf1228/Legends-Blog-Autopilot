# Verification evidence manifest

These files archive the checks performed on 2026-09-24 for commit `33995a82c48114c064285cdc9329a8ebe4ff9d45`. They are stored outside the standalone M5 branch so its accepted tip remains unchanged.

- `full-test-suite.log`: unedited original `npm test` output, 273/273 passing, against the disposable local `m5_tests` PostgreSQL database.
- `test-files.txt`: names of the 28 discovered test files.
- `migration-first.txt`, `migration-second.txt`: original post-run `schema_migrations` timestamps, default settings, and raw `pg_dump` hashes from a separate disposable `m5_migrations` database.
- `dump-before.sql`, `dump-after.sql`: unedited `pg_dump --schema-only --no-owner --no-privileges` output before and after an additional rerun.
- `schema-before-normalized.sql`, `schema-after-normalized.sql`: those dumps with only randomized `\restrict` / `\unrestrict` lines removed. They are identical.
- `static-checks.txt`: preserved command results for typecheck, lint, and build from the same immutable commit; includes script scope and emitted-file count.
- `branch-and-migrations.txt`: branch lineage/diff, local migration comparison result, and safety defaults.
- `SHA256SUMS`: hashes of the archived evidence files (excluding this README and the checksum manifest).

Tests and migrations received only local loopback database URLs; no production connection was used. Logs and schema dumps must still be handled as project records, not published publicly without review. The database server and data directory were deleted after verification. See [`../ACCEPTANCE.md`](../ACCEPTANCE.md) for conclusions and limitations.