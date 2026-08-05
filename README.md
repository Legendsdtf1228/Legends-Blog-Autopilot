# Legends Blog Autopilot

A standalone, private service that autonomously chooses, writes, validates, and publishes Shopify blog posts for Legends DTF Prints.

## V1 behavior

- Publishes once daily or twice daily in `America/New_York`.
- Starts **paused** so deployment cannot accidentally publish.
- Pulls active Shopify products for real internal links.
- Gives the writer only approved Legends DTF facts and rejects unsupported links or risky claims.
- Avoids the previous 90 topics using stable topic fingerprints.
- Stores every scheduled slot, article, Shopify ID, error, and retry attempt in Postgres.
- Retries temporary failures up to four times. A unique daily slot prevents double-publishing after restarts.
- Provides an authenticated dashboard with Pause/Live, scheduling, fact editing, Publish Now, and history.

## Required accounts and credentials

1. A Railway project with a Postgres service.
2. An OpenAI API key.
3. A Shopify app Client ID and Client Secret, installed on your own store with `read_products`, `read_content`, and `write_content`.
5. The public storefront URL (`https://legendsdtf.com`) for safe internal product links.

## Local setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The browser uses HTTP Basic authentication: any username works and the password is `ADMIN_PASSWORD`.

The service exchanges the Client ID and Secret for a 24-hour access token and refreshes it automatically. It also discovers the store's blog automatically, preferring the standard `news` blog. After deployment, visit `/api/verify-shopify` to verify the shop and selected blog.

## Railway deployment

1. Push this folder to a new GitHub repository.
2. Create a Railway project from that repository and add Postgres.
3. Add every variable from `.env.example`. Railway supplies `DATABASE_URL` when Postgres is linked.
4. Set `APP_URL` to the Railway public URL.
5. Deploy. `railway.json` runs the database migration before startup and checks `/health`.
6. Sign in, confirm the fact sheet, use **Publish now** for the first controlled live article, inspect it in Shopify, then turn on automatic publishing.

## Operational safety

- Keep `OPENAI_API_KEY`, `SHOPIFY_CLIENT_SECRET`, and `ADMIN_PASSWORD` only in Railway variables.
- Use a long random `ADMIN_PASSWORD`; the config requires at least 12 characters.
- The service defaults to one daily post at 9:00 AM ET and remains paused until explicitly enabled.
- To stop publication immediately, uncheck **Automatic publishing enabled**. Jobs already claimed as `running` may finish.
- Failed jobs show an error in history and retry after 15, 30, 60, then 120 minutes.

## Commands

```bash
npm run typecheck
npm test
npm run build
npm start
```

## Architecture

The web process also runs a lightweight worker. Once per minute it:

1. Creates any due daily slot using the store timezone.
2. Claims one job with a Postgres row lock.
3. Retrieves active products from Shopify.
4. Generates one schema-constrained article through the OpenAI Responses API.
5. Validates word count, HTML, claims, links, and topic uniqueness.
6. Publishes through Shopify's `articleCreate` mutation and records the result.

This is intentionally a single-store V1, but settings and job boundaries can later be made shop-scoped without replacing the publishing pipeline.
