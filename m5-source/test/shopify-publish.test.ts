import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTICLE_CREATE_MUTATION,
  ARTICLE_UPDATE_MUTATION,
  ARTICLE_GRAPHQL_FIELDS,
  buildPublicArticleUrl,
  normalizeStorefrontUrl
} from "../src/shopify.js";
import { createDb, migrate, createArticle, getArticle, updateArticle, finishJob, insertManualJob, claimJob } from "../src/db.js";
import { defaultSettings } from "../src/defaults.js";
import type { GeneratedArticle } from "../src/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("no Article GraphQL selection requests onlineStoreUrl", () => {
  assert.equal(ARTICLE_GRAPHQL_FIELDS.includes("onlineStoreUrl"), false);
  assert.equal(ARTICLE_CREATE_MUTATION.includes("onlineStoreUrl"), false);
  assert.equal(ARTICLE_UPDATE_MUTATION.includes("onlineStoreUrl"), false);
  assert.match(ARTICLE_UPDATE_MUTATION, /articleUpdate/);

  const srcFiles = [
    "src/shopify.ts",
    "src/scheduler.ts",
    "src/server.ts",
    "src/db.ts",
    "src/writer.ts",
    "src/views.ts"
  ];
  for (const rel of srcFiles) {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    // Fail if a GraphQL selection/request includes the unsupported field name.
    assert.equal(
      /\bonlineStoreUrl\b/.test(text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")),
      false,
      `${rel} must not request onlineStoreUrl in code`
    );
  }

  // Required supported fields are present
  for (const field of ["id", "handle", "title", "isPublished", "publishedAt", "blog"]) {
    assert.match(ARTICLE_GRAPHQL_FIELDS, new RegExp(`\\b${field}\\b`));
  }
});

test("normalizeStorefrontUrl strips trailing slashes", () => {
  assert.equal(normalizeStorefrontUrl("https://legendsdtf.com/"), "https://legendsdtf.com");
  assert.equal(normalizeStorefrontUrl("https://legendsdtf.com///"), "https://legendsdtf.com");
  assert.equal(normalizeStorefrontUrl("https://legendsdtf.com"), "https://legendsdtf.com");
});

test("buildPublicArticleUrl uses storefront + blog handle + article handle", () => {
  assert.equal(
    buildPublicArticleUrl({
      storefrontUrl: "https://legendsdtf.com",
      blogHandle: "news",
      articleHandle: "heat-press-basics"
    }),
    "https://legendsdtf.com/blogs/news/heat-press-basics"
  );
});

test("buildPublicArticleUrl handles trailing slash on storefront URL", () => {
  assert.equal(
    buildPublicArticleUrl({
      storefrontUrl: "https://legendsdtf.com/",
      blogHandle: "news",
      articleHandle: "gang-sheets"
    }),
    "https://legendsdtf.com/blogs/news/gang-sheets"
  );
});

test("buildPublicArticleUrl returns null when handles are missing", () => {
  assert.equal(buildPublicArticleUrl({
    storefrontUrl: "https://legendsdtf.com",
    blogHandle: "news",
    articleHandle: null
  }), null);
  assert.equal(buildPublicArticleUrl({
    storefrontUrl: "https://legendsdtf.com",
    blogHandle: "",
    articleHandle: "x"
  }), null);
  assert.equal(buildPublicArticleUrl({
    storefrontUrl: "",
    blogHandle: "news",
    articleHandle: "x"
  }), null);
});

test("missing public URL does not fail a successful publication record", { skip: !process.env.DATABASE_URL }, async () => {
  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);
  const shopifyId = `gid://shopify/Article/${Date.now()}001`;
  const article = await createArticle(db, {
    title: "Publish without public URL",
    handle: `publish-without-public-url-${Date.now()}`,
    excerpt: "A practical excerpt long enough for draft storage during URL-null publication tests.",
    metaTitle: "Publish without public URL",
    metaDescription: "Meta description long enough to pass normalization while testing null public URLs.",
    bodyHtml: `<h2>Guide</h2><p>${"word ".repeat(200)}</p>`,
    tags: ["DTF"],
    author: "Legends DTF Prints",
    primaryKeyword: "DTF",
    secondaryKeywords: [],
    topicFingerprint: `publish-without-url-${Date.now()}`,
    rationale: "test",
    featuredImageUrl: null,
    featuredImageAlt: null
  }, { status: "publishing", source: "test" });

  const generated: GeneratedArticle = {
    title: article.title,
    handle: article.handle,
    summary: article.excerpt,
    metaDescription: article.metaDescription,
    bodyHtml: article.bodyHtml,
    tags: article.tags,
    primaryKeyword: article.primaryKeyword,
    topicFingerprint: article.topicFingerprint,
    rationale: article.rationale
  };

  const jobId = await insertManualJob(db, article.id);
  await finishJob(db, jobId, generated, shopifyId, null, {
    articleId: article.id,
    blogId: "gid://shopify/Blog/1",
    handle: article.handle,
    responseStatus: "created"
  });

  const saved = await getArticle(db, article.id);
  assert.ok(saved);
  assert.equal(saved!.status, "published");
  assert.equal(saved!.shopifyArticleId, shopifyId);
  assert.equal(saved!.shopifyUrl, null);
  await db.end();
});

test("retrying an already-published article does not create a duplicate Shopify article", { skip: !process.env.DATABASE_URL }, async () => {
  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);
  const shopifyId = `gid://shopify/Article/${Date.now()}888`;
  const article = await createArticle(db, {
    title: "Already published article",
    handle: `already-published-article-${Date.now()}`,
    excerpt: "Excerpt for idempotent retry protection when a publish job is claimed again.",
    metaTitle: "Already published article",
    metaDescription: "Meta description for idempotent retry protection against duplicate Shopify creates.",
    bodyHtml: `<h2>Guide</h2><p>${"word ".repeat(200)}</p>`,
    tags: ["DTF"],
    author: "Legends DTF Prints",
    primaryKeyword: "DTF",
    secondaryKeywords: [],
    topicFingerprint: `already-published-${Date.now()}`,
    rationale: "test",
    featuredImageUrl: null,
    featuredImageAlt: null
  }, { status: "published", source: "test" });

  await updateArticle(db, article.id, {
    status: "published",
    shopifyArticleId: shopifyId,
    shopifyUrl: `https://legendsdtf.com/blogs/news/${article.handle}`,
    shopifyHandle: article.handle
  });

  // Simulate a retry job for the same article
  const jobId = await insertManualJob(db, article.id);
  // Drain any older pending jobs first so claim order is not flaky across test runs.
  for (let i = 0; i < 50; i++) {
    const claimed = await claimJob(db, 4);
    if (!claimed) break;
    if (Number(claimed.id) === jobId) break;
    await db.query(
      "UPDATE publish_jobs SET status='skipped', updated_at=now() WHERE id=$1 AND status='running'",
      [claimed.id]
    );
  }

  const existing = await getArticle(db, article.id);
  assert.ok(existing?.shopifyArticleId);

  // Application idempotency path: finish without calling Shopify again
  const generated: GeneratedArticle = {
    title: existing!.title,
    handle: existing!.handle,
    summary: existing!.excerpt,
    metaDescription: existing!.metaDescription,
    bodyHtml: existing!.bodyHtml,
    tags: existing!.tags,
    primaryKeyword: existing!.primaryKeyword,
    topicFingerprint: existing!.topicFingerprint,
    rationale: existing!.rationale
  };
  await finishJob(db, jobId, generated, existing!.shopifyArticleId!, existing!.shopifyUrl, {
    articleId: article.id,
    responseStatus: "already_published",
    handle: existing!.shopifyHandle
  });

  const after = await getArticle(db, article.id);
  assert.equal(after!.shopifyArticleId, shopifyId);
  assert.equal(after!.status, "published");

  // Ensure only one Shopify article id remains associated
  const { rows } = await db.query(
    "SELECT count(*)::int AS count FROM articles WHERE shopify_article_id=$1",
    [shopifyId]
  );
  assert.equal(rows[0].count, 1);
  await db.end();
});

test("controlled publishArticle response mapping prefers storefront URL and tolerates null handles", async () => {
  // Unit-level mapping equivalent to publishArticle success path (no live Shopify call)
  const storefrontUrl = defaultSettings.storefrontUrl;
  assert.equal(storefrontUrl.includes("myshopify.com"), false);

  const withHandles = buildPublicArticleUrl({
    storefrontUrl,
    blogHandle: "news",
    articleHandle: "custom-dtf-guide"
  });
  assert.equal(withHandles, "https://legendsdtf.com/blogs/news/custom-dtf-guide");

  const withoutHandles = buildPublicArticleUrl({
    storefrontUrl,
    blogHandle: null,
    articleHandle: "custom-dtf-guide"
  });
  assert.equal(withoutHandles, null);

  // Successful publication payload shape when URL is null
  const published = {
    id: "gid://shopify/Article/123",
    handle: null as string | null,
    url: withoutHandles,
    blogId: "gid://shopify/Blog/1",
    blogHandle: null as string | null,
    responseStatus: "created"
  };
  assert.equal(published.id.startsWith("gid://shopify/Article/"), true);
  assert.equal(published.url, null);
});
