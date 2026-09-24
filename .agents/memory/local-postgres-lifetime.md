---
name: Local PostgreSQL test lifetime
description: Running disposable PostgreSQL clusters for tests in this Replit shell environment.
---

A PostgreSQL server started with `pg_ctl -w start` from a foreground shell command stopped being reachable after that command returned. Running `postgres` in a managed background shell kept it available for separate test commands. The default socket directory was also absent, so the temporary cluster needed a writable socket path such as `/tmp`.

**Why:** The foreground command lifecycle and missing default socket directory can make a successful startup look like a database regression.

**How to apply:** For disposable local database verification, run the server as a managed background shell and configure loopback TCP plus a writable socket path. Keep production connections out of this flow.