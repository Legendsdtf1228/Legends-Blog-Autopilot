# AGENTS.md

## Cursor Cloud specific instructions

Legends Blog Autopilot is a single Node.js/TypeScript Express service that autonomously writes and publishes Shopify blog posts. There is one process: a web server (`src/server.ts`) that also runs an in-process worker (`src/scheduler.ts`) once per minute. It depends on PostgreSQL, and uses OpenAI + Shopify only inside the publishing worker.

Standard commands live in `package.json` (`dev`, `build`, `start`, `typecheck`, `test`, `db:migrate`) and `README.md`. This repo has no linter; `npm run typecheck` (tsc) is the closest lint equivalent.

Non-obvious notes for this environment:
- PostgreSQL is not started automatically on VM boot. Start it before running the app or migrations: `sudo pg_ctlcluster 16 main start`. The dev DB is `legends_blog` with role `postgres`/`postgres` (matches `.env.example`'s `DATABASE_URL`). Verify with `curl -s localhost:3000/health` (returns `{"ok":true}` only when Postgres is reachable).
- A local `.env` is required and is gitignored (see `.env.example`). `src/config.ts` validates all vars at startup and the server will not boot if any are missing; `ADMIN_PASSWORD` must be at least 12 characters. `OPENAI_API_KEY`, `SHOPIFY_CLIENT_ID`, and `SHOPIFY_CLIENT_SECRET` may be placeholder values for local dev — the dashboard, migration, tests, build, and server startup do not call OpenAI/Shopify. Only the publishing worker (Publish Now, or a due schedule) calls them, and it will just record a failed job in history without real credentials.
- The dashboard uses HTTP Basic auth: any username, password = `ADMIN_PASSWORD`. In a browser, embedding credentials in the URL works: `http://admin:<ADMIN_PASSWORD>@localhost:3000/`. `/health` is the only unauthenticated route.
- The service starts **paused** by design (`enabled: false`) so it never auto-publishes on boot. Toggle "Automatic publishing enabled" or use "Publish now" to exercise the worker.
- `npm run dev` uses `tsx watch` and hot-reloads on source changes. `npm test` and `npm run db:migrate` run TypeScript directly via `tsx` (no build step needed); `npm run build` compiles to `dist/` for the production `npm start`.
