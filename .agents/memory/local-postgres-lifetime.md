---
name: Local PostgreSQL test lifetime
description: Running disposable PostgreSQL clusters for tests in this Replit shell environment.
---

A PostgreSQL server started with `pg_ctl -w start` from a foreground shell command stopped being reachable after that command returned. Running `postgres` in a managed background shell kept it available for separate test commands. The default socket directory was also absent, so the temporary cluster needed a writable socket path such as `/tmp`.

PostgreSQL 16's `pg_dump` emits randomized `\restrict` and `\unrestrict` lines. Raw schema-dump hashes therefore differ across runs even when migrations have not changed the schema.

**Why:** Shell lifetime and socket-path behavior can make a successful startup look like a database regression; volatile dump markers can make an idempotent migration look like schema drift.

**How to apply:** For disposable local database verification, run the server as a managed background shell and configure loopback TCP plus a writable socket path. Normalize only the volatile dump markers before comparing schema dumps. Keep production connections out of this flow.