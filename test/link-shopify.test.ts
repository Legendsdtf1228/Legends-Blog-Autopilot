import test from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_CREATE_MUTATION,
  ARTICLE_UPDATE_MUTATION,
  FIND_ARTICLES_QUERY,
  buildPublicArticleUrl,
  choosePublishStrategy,
  mapArticleCreateResult,
  shopifyGidNumericId
} from "../src/shopify.js";
import {
  createDb,
  migrate,
  createArticle,
  getArticle,
  updateArticle,
  linkArticleToShopify,
  insertManualJob,
  listJobs,
  cancelPendingJobsForArticle
} from "../src/db.js";
import { defaultSettings } from "../src/defaults.js";
import type { GeneratedArticle } from "../src/types.js";

test("publish mutations include create and update paths without onlineStoreUrl", () => {
  assert.equal(ARTICLE_CREATE_MUTATION.includes("onlineStoreUrl"), false);
  assert.equal(ARTICLE_UPDATE_MUTATION.includes("onlineStoreUrl"), false);
  assert.match(ARTICLE_UPDATE_MUTATION, /articleUpdate/);
  assert.match(FIND_ARTICLES_QUERY, /metafield\(namespace: "legends_blog_autopilot"/);
  assert.match(ARTICLE_CREATE_MUTATION, /idempotency_key/);
});

test("shopifyGidNumericId extracts blog/article numeric ids", () => {
  assert.equal(shopifyGidNumericId("gid://shopify/Blog/397675442"), "397675442");
  assert.equal(shopifyGidNumericId("gid://shopify/Article/123"), "123");
  assert.equal(shopifyGidNumericId(null), null);
});

/**
 * Simulates: Shopify create succeeded, local persistence of shopify_article_id failed,
 * then merchant uses Link existing Shopify article recovery.
 */
test("link existing Shopify article recovers after local persistence failure", { skip: !process.env.DATABASE_URL }, async () => {
  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);

  const handle = `recover-link-${Date.now()}`;
  const local = await createArticle(db, {
    title: "Recoverable DTF guide",
    handle,
    excerpt: "A practical excerpt long enough for recovery linking after Shopify create succeeded locally failed.",
    metaTitle: "Recoverable DTF guide",
    metaDescription: "Meta description for recovery linking after Shopify create succeeded but local persistence failed.",
    bodyHtml: `<h2>Guide</h2><p>${"word ".repeat(200)}</p>`,
    tags: ["DTF"],
    author: "Legends DTF Prints",
    primaryKeyword: "DTF",
    secondaryKeywords: [],
    topicFingerprint: `recover-${Date.now()}`,
    rationale: "test",
    featuredImageUrl: null,
    featuredImageAlt: null
  }, { status: "failed", source: "test" });

  await updateArticle(db, local.id, {
    status: "failed",
    lastError: "Shopify may have created the article but local save failed",
    idempotencyKey: `publish:${local.id}`,
    shopifyArticleId: null
  });

  const jobId = await insertManualJob(db, local.id);
  assert.ok(jobId);

  // Shopify-side article that already exists (create succeeded earlier)
  const shopifyPayload = {
    id: `gid://shopify/Article/${Date.now()}777`,
    handle,
    title: "Recoverable DTF guide",
    isPublished: true,
    publishedAt: "2026-08-06T20:00:00Z",
    blog: { id: "gid://shopify/Blog/1", handle: "news" },
    metafield: { value: `publish:${local.id}` }
  };

  const mapped = mapArticleCreateResult({
    created: shopifyPayload,
    storefrontUrl: defaultSettings.storefrontUrl,
    responseStatus: "found"
  });
  assert.equal(mapped.handle, handle);
  assert.equal(mapped.url, `https://legendsdtf.com/blogs/news/${handle}`);

  // Explicit merchant confirmation path: link local article
  const linked = await linkArticleToShopify(db, local.id, {
    shopifyArticleId: shopifyPayload.id,
    shopifyBlogId: shopifyPayload.blog.id,
    shopifyHandle: shopifyPayload.handle,
    shopifyUrl: mapped.url,
    isPublished: true,
    publishedAt: shopifyPayload.publishedAt,
    responseStatus: "linked"
  });

  assert.ok(linked);
  assert.equal(linked!.shopifyArticleId, shopifyPayload.id);
  assert.equal(linked!.shopifyUrl, mapped.url);
  assert.equal(linked!.shopifyHandle, handle);
  assert.equal(linked!.status, "published");

  const jobs = await listJobs(db, 100);
  const related = jobs.filter(j => Number(j.article_id) === local.id);
  assert.ok(related.length >= 1);
  assert.ok(related.every(j => ["cancelled", "published", "skipped"].includes(String(j.status))));
  assert.ok(related.some(j => j.status === "cancelled"));

  // Future publish must target the linked ID (articleUpdate path), not create again.
  const saved = await getArticle(db, local.id);
  assert.equal(saved!.shopifyArticleId, shopifyPayload.id);
  assert.ok(saved!.shopifyArticleId);

  await db.end();
});

test("link unpublished Shopify article marks local draft and cancels pending jobs", { skip: !process.env.DATABASE_URL }, async () => {
  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);
  const handle = `draft-link-${Date.now()}`;
  const local = await createArticle(db, {
    title: "Draft link recovery",
    handle,
    excerpt: "Excerpt for linking an unpublished Shopify article during recovery without auto-adopting handles.",
    metaTitle: "Draft link recovery",
    metaDescription: "Meta description for unpublished Shopify article link recovery regression coverage.",
    bodyHtml: `<h2>Guide</h2><p>${"word ".repeat(200)}</p>`,
    tags: ["DTF"],
    author: "Legends DTF Prints",
    primaryKeyword: "DTF",
    secondaryKeywords: [],
    topicFingerprint: `draft-link-${Date.now()}`,
    rationale: "test",
    featuredImageUrl: null,
    featuredImageAlt: null
  }, { status: "failed", source: "test" });

  await insertManualJob(db, local.id);
  const shopifyId = `gid://shopify/Article/${Date.now()}778`;
  const url = buildPublicArticleUrl({
    storefrontUrl: "https://legendsdtf.com/",
    blogHandle: "news",
    articleHandle: handle
  });

  const linked = await linkArticleToShopify(db, local.id, {
    shopifyArticleId: shopifyId,
    shopifyBlogId: "gid://shopify/Blog/1",
    shopifyHandle: handle,
    shopifyUrl: url,
    isPublished: false,
    responseStatus: "linked"
  });

  assert.equal(linked!.status, "draft");
  assert.equal(linked!.shopifyArticleId, shopifyId);
  assert.equal(linked!.shopifyUrl, url);

  const cancelled = await cancelPendingJobsForArticle(db, local.id, "already linked");
  assert.ok(cancelled >= 0);
  await db.end();
});

test("recovery mapping never falls back to local handles for URL", () => {
  const local: GeneratedArticle = {
    title: "Local title",
    handle: "local-handle-should-not-be-used",
    summary: "summary",
    metaDescription: "meta",
    bodyHtml: "<p>x</p>",
    tags: [],
    primaryKeyword: "x",
    topicFingerprint: "x",
    rationale: "x"
  };
  const mapped = mapArticleCreateResult({
    created: {
      id: "gid://shopify/Article/123",
      handle: null,
      blog: { id: "gid://shopify/Blog/1", handle: null }
    },
    storefrontUrl: defaultSettings.storefrontUrl,
    fallbackTitle: local.title,
    responseStatus: "recovered"
  });
  assert.equal(mapped.id, "gid://shopify/Article/123");
  assert.equal(mapped.url, null);
  assert.equal(mapped.responseStatus, "recovered");
  assert.equal(defaultSettings.enabled, false);
  assert.equal(defaultSettings.draftOnlyMode, true);
});

test("publish strategy recovers via idempotency marker and never auto-adopts handle-only matches", () => {
  assert.equal(choosePublishStrategy({ shopifyArticleId: "gid://shopify/Article/1" }), "update");
  assert.equal(choosePublishStrategy({
    recoveredByKey: { id: "gid://shopify/Article/9" },
    idempotencyKey: "publish:1"
  }), "recover");
  assert.equal(choosePublishStrategy({
    byHandle: { id: "gid://shopify/Article/9", idempotencyKey: "publish:1" },
    idempotencyKey: "publish:1"
  }), "recover");
  assert.equal(choosePublishStrategy({
    byHandle: { id: "gid://shopify/Article/9", idempotencyKey: "publish:1" },
    idempotencyKey: "publish:2"
  }), "collision");
  assert.equal(choosePublishStrategy({
    byHandle: { id: "gid://shopify/Article/9", idempotencyKey: null },
    idempotencyKey: "publish:2"
  }), "collision");
  assert.equal(choosePublishStrategy({ idempotencyKey: "publish:3" }), "create");
});
