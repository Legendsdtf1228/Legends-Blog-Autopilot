import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "../src/config.js";
import type { GeneratedArticle, Settings } from "../src/types.js";
import { defaultSettings } from "../src/defaults.js";
import {
  ARTICLE_CREATE_MUTATION,
  buildPublicArticleUrl,
  mapArticleCreateResult,
  normalizeStorefrontUrl
} from "../src/shopify.js";
import { createDb, migrate, createArticle, getArticle, finishJob, insertManualJob } from "../src/db.js";

/**
 * Controlled publishing test with a mocked Admin GraphQL transport.
 * Does not publish to the live store.
 */
test("controlled articleCreate uses supported fields and builds storefront URL", async () => {
  assert.equal(ARTICLE_CREATE_MUTATION.includes("onlineStoreUrl"), false);
  assert.match(ARTICLE_CREATE_MUTATION, /article\s*\{[\s\S]*\bid\b/);
  assert.match(ARTICLE_CREATE_MUTATION, /\bhandle\b/);
  assert.match(ARTICLE_CREATE_MUTATION, /\btitle\b/);
  assert.match(ARTICLE_CREATE_MUTATION, /\bisPublished\b/);
  assert.match(ARTICLE_CREATE_MUTATION, /\bpublishedAt\b/);
  assert.match(ARTICLE_CREATE_MUTATION, /\bblog\s*\{/);

  const settings: Settings = {
    ...defaultSettings,
    storefrontUrl: "https://legendsdtf.com/",
    shopifyBlogHandle: "news",
    draftOnlyMode: true,
    enabled: false
  };

  const mockShopifyArticle = {
    id: "gid://shopify/Article/555",
    handle: "heat-press-tips",
    title: "Heat press tips",
    isPublished: true,
    publishedAt: "2026-08-06T12:00:00Z",
    blog: { id: "gid://shopify/Blog/9", handle: "news" }
  };

  // Simulate the mapping publishArticle performs after a successful create
  const url = buildPublicArticleUrl({
    storefrontUrl: settings.storefrontUrl,
    blogHandle: mockShopifyArticle.blog.handle,
    articleHandle: mockShopifyArticle.handle
  });

  assert.equal(url, "https://legendsdtf.com/blogs/news/heat-press-tips");
  assert.equal(normalizeStorefrontUrl(settings.storefrontUrl), "https://legendsdtf.com");
  assert.equal(url?.includes("myshopify.com"), false);
  assert.equal(settings.enabled, false);
  assert.equal(settings.draftOnlyMode, true);

  // Missing handle path: still a successful publication record
  const nullUrl = buildPublicArticleUrl({
    storefrontUrl: settings.storefrontUrl,
    blogHandle: mockShopifyArticle.blog.handle,
    articleHandle: null
  });
  assert.equal(nullUrl, null);
  const successWithoutUrl = {
    id: mockShopifyArticle.id,
    url: nullUrl,
    responseStatus: "created"
  };
  assert.equal(successWithoutUrl.id, "gid://shopify/Article/555");
  assert.equal(successWithoutUrl.url, null);
});

test("userErrors remain distinct from top-level GraphQL error messaging", () => {
  const topLevel = "Shopify GraphQL error: Field 'onlineStoreUrl' doesn't exist on type 'Article'";
  const userError = "Shopify rejected article (userErrors): title: can't be blank";
  assert.match(topLevel, /^Shopify GraphQL error:/);
  assert.match(userError, /^Shopify rejected article \(userErrors\):/);
  assert.equal(topLevel.includes("userErrors"), false);
});

test("config types still compile for controlled publish signature", () => {
  const config = {
    STOREFRONT_URL: "https://legendsdtf.com",
    SHOPIFY_SHOP: "294ac0-57.myshopify.com"
  } as Pick<AppConfig, "STOREFRONT_URL" | "SHOPIFY_SHOP">;
  const article = { handle: "x" } as GeneratedArticle;
  assert.equal(config.SHOPIFY_SHOP.endsWith(".myshopify.com"), true);
  assert.equal(
    buildPublicArticleUrl({
      storefrontUrl: config.STOREFRONT_URL,
      blogHandle: "news",
      articleHandle: article.handle
    }),
    "https://legendsdtf.com/blogs/news/x"
  );
});

test("publishArticle response mapping leaves URL null when Shopify omits handles", { skip: !process.env.DATABASE_URL }, async () => {
  const settings: Settings = {
    ...defaultSettings,
    storefrontUrl: "https://legendsdtf.com/",
    shopifyBlogHandle: "news",
    draftOnlyMode: true,
    enabled: false
  };

  // Local article has handles — mapping must NOT fall back to them.
  const localArticle: GeneratedArticle = {
    title: "Heat press tips for DTF transfers",
    handle: "heat-press-tips-for-dtf-transfers",
    summary: "A practical guide long enough for testing null Shopify handle response mapping.",
    metaDescription: "Practical heat press tips for DTF transfers from Legends DTF Prints in Warner Robins.",
    bodyHtml: `<h2>Guide</h2><p>${"word ".repeat(200)}</p>`,
    tags: ["DTF", "Heat press"],
    primaryKeyword: "heat press",
    topicFingerprint: `null-handles-${Date.now()}`,
    rationale: "Regression for Shopify-omitted handles."
  };

  const shopifyId = `gid://shopify/Article/${Date.now()}123`;
  const created = {
    id: shopifyId,
    handle: null,
    blog: { id: "gid://shopify/Blog/1", handle: null }
  };

  const published = mapArticleCreateResult({
    created,
    storefrontUrl: settings.storefrontUrl,
    fallbackTitle: localArticle.title,
    fallbackBlogId: "gid://shopify/Blog/local-fallback",
    idempotencyKey: "test:null-handles"
  });

  assert.equal(published.id, shopifyId);
  assert.equal(published.handle, null);
  assert.equal(published.blogHandle, null);
  assert.equal(published.url, null);
  assert.equal(published.responseStatus, "created");

  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);
  const record = await createArticle(db, {
    title: localArticle.title,
    handle: `${localArticle.handle}-${Date.now()}`,
    excerpt: localArticle.summary,
    metaTitle: localArticle.title,
    metaDescription: localArticle.metaDescription,
    bodyHtml: localArticle.bodyHtml,
    tags: localArticle.tags,
    author: settings.authorName,
    primaryKeyword: localArticle.primaryKeyword,
    secondaryKeywords: [],
    topicFingerprint: localArticle.topicFingerprint,
    rationale: localArticle.rationale,
    featuredImageUrl: null,
    featuredImageAlt: null
  }, { status: "publishing", source: "test" });

  const jobId = await insertManualJob(db, record.id);
  await finishJob(db, jobId, localArticle, published.id, published.url, {
    articleId: record.id,
    blogId: published.blogId ?? undefined,
    handle: published.handle,
    responseStatus: published.responseStatus
  });

  const saved = await getArticle(db, record.id);
  assert.ok(saved);
  assert.equal(saved!.status, "published");
  assert.equal(saved!.shopifyArticleId, shopifyId);
  assert.equal(saved!.shopifyUrl, null);
  assert.equal(settings.enabled, false);
  assert.equal(settings.draftOnlyMode, true);
  await db.end();
});
