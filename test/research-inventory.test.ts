import test from "node:test";
import assert from "node:assert/strict";
import { createArticle, createDb, migrate } from "../src/db.js";
import {
  buildArticleBrief,
  buildLockedFactSheet,
  evaluateCustomTopic,
  findClosestOverlap,
  isRejectedByOverlap,
  listAllLocalArticles,
  listPendingBriefRefs,
  listReservedOpportunityRefs,
  productPagesAsInventory,
  reserveOpportunity,
  runResearchCycle,
  saveBrief,
  saveResearchCycle,
  DEFAULT_RESEARCH_SETTINGS
} from "../src/research/index.js";
import type { ExistingArticleRef } from "../src/research/overlap.js";
import type { ResearchOpportunity } from "../src/research/types.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";
const now = new Date("2026-08-06T18:00:00.000Z");

async function seedArticle(
  db: ReturnType<typeof createDb>,
  opts: { title: string; handle: string; keyword: string; status?: "draft" | "failed" | "generating" | "published" | "ready" }
) {
  return createArticle(db, {
    title: opts.title,
    handle: opts.handle,
    excerpt: `${opts.title} excerpt for overlap detection coverage.`,
    metaTitle: opts.title,
    metaDescription: `Meta for ${opts.title} used in inventory regression tests for Legends research.`,
    bodyHtml: `<h2>Body</h2><p>${"word ".repeat(220)}</p>`,
    tags: ["test"],
    author: "Legends DTF Prints",
    featuredImageUrl: null,
    featuredImageAlt: null,
    primaryKeyword: opts.keyword,
    secondaryKeywords: [],
    topicFingerprint: opts.handle,
    rationale: "inventory test"
  }, { status: opts.status ?? "draft", source: "test" });
}

test("custom duplicate topic is blocked; distinct angle is accepted", () => {
  const existing: ExistingArticleRef[] = [{
    id: 10,
    title: "DTF Pressing Temperature Guide",
    handle: "dtf-pressing-temperature-guide",
    status: "published",
    primaryKeyword: "DTF pressing temperature guide",
    topicFingerprint: "dtf-pressing-temperature-guide",
    excerpt: "How to press DTF transfers at the right temperature.",
    source: "local_article"
  }];

  const blocked = evaluateCustomTopic("DTF pressing temperature guide", {
    businessFacts: [],
    existingArticles: existing,
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.match(blocked.message, /substantially overlaps an existing article/i);
    assert.ok(blocked.overlap.score >= DEFAULT_RESEARCH_SETTINGS.overlapRejectThreshold);
    assert.equal(blocked.overlap.title, "DTF Pressing Temperature Guide");
  }

  const accepted = evaluateCustomTopic("How Middle Georgia schools plan spirit-wear order timelines", {
    businessFacts: [],
    existingArticles: existing,
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.ok((accepted.overlap?.score ?? 0) < DEFAULT_RESEARCH_SETTINGS.overlapRejectThreshold);
    assert.equal(accepted.brief.customTopic, "How Middle Georgia schools plan spirit-wear order timelines");
  }
});

test("Shopify descriptions reach the locked fact sheet; missing descriptions warn instead of inventing", () => {
  const withDescription = buildLockedFactSheet({
    businessFacts: [],
    products: [{
      title: "Gang Sheet Builder",
      handle: "gang-sheet-builder",
      url: "https://legendsdtf.com/products/gang-sheet-builder",
      description: "Build custom DTF gang sheets with your artwork for apparel decoration.",
      productType: "DTF Transfers",
      options: ["Size: 22x24, 22x60"],
      retrievedAt: "2026-08-06T18:00:00.000Z"
    }],
    requiresInterview: false,
    pillar: "dtf_education"
  });
  assert.ok(withDescription.productFacts.some(f => /Approved Shopify description/i.test(f)));
  assert.ok(withDescription.productFacts.some(f => /Build custom DTF gang sheets/i.test(f)));
  assert.ok(withDescription.productFacts.some(f => /product type: DTF Transfers/i.test(f)));
  assert.ok(withDescription.productFacts.some(f => /retrieved 2026-08-06/i.test(f)));

  const opportunity = {
    id: "prod-fact",
    cluster: {
      id: "prod-fact",
      primaryKeyword: "gang sheets",
      secondaryKeywords: [],
      intent: "commercial" as const,
      pillar: "dtf_education" as const,
      subcategory: "gang-sheet planning",
      audience: "apparel_decorators" as const,
      format: "how_to" as const,
      signals: [],
      missingProviders: []
    },
    scores: {
      demandScore: 0.4,
      growthScore: 0.4,
      businessRelevance: 0.8,
      conversionIntent: 0.7,
      rankingOpportunity: 0.5,
      localRelevance: 0.5,
      freshnessScore: 0.5,
      contentGapScore: 0.8,
      overlapPenalty: 0,
      factualConfidence: 0.7,
      opportunityScore: 0.6
    },
    freshnessClass: "evergreen" as const,
    dataCollectedLabel: "Search data collected August 6, 2026.",
    completeness: "partial" as const,
    closestExisting: null,
    whyDistinct: "Distinct",
    whyFitsLegends: "DTF",
    requiresInterview: false,
    productsToFeature: [{
      title: "Mystery Transfer Pack",
      handle: "mystery-transfer-pack",
      url: "https://legendsdtf.com/products/mystery-transfer-pack",
      description: "Official pack description from Shopify catalog.",
      retrievedAt: "2026-08-06T18:00:00.000Z"
    }],
    proposedTitle: "Gang Sheets Guide",
    proposedHandle: "gang-sheets-guide",
    proposedOutline: ["Intro"],
    internalLinks: [],
    externalSources: [],
    status: "suggested" as const
  } satisfies ResearchOpportunity;

  const brief = buildArticleBrief(opportunity, { businessFacts: [] });
  assert.ok(brief.factSheet.productFacts.some(f => /Official pack description from Shopify catalog/i.test(f)));
  assert.equal(
    brief.productsToFeature[0]?.description,
    "Official pack description from Shopify catalog."
  );

  const missing = buildLockedFactSheet({
    businessFacts: [],
    products: [{
      title: "Untitled Transfer",
      url: "https://legendsdtf.com/products/untitled-transfer",
      description: ""
    }],
    requiresInterview: false,
    pillar: "dtf_education"
  });
  assert.ok(missing.productFacts.some(f => /do not invent product capabilities/i.test(f)));
  assert.ok(!missing.productFacts.some(f => /Approved Shopify description/i.test(f)));
});

test("Shopify blog articles and product pages participate in overlap checks", () => {
  const inventory: ExistingArticleRef[] = [
    ...productPagesAsInventory([{
      title: "UV DTF Decals",
      handle: "uv-dtf-decals",
      url: "https://legendsdtf.com/products/uv-dtf-decals",
      description: "UV DTF decals for hard goods."
    }]),
    {
      id: null,
      title: "Starting a T-shirt Business Checklist",
      handle: "starting-a-t-shirt-business-checklist",
      status: "published_shopify",
      primaryKeyword: "starting a T-shirt business",
      topicFingerprint: "starting-a-t-shirt-business-checklist",
      excerpt: "Checklist for clothing-brand startups.",
      source: "shopify_article",
      shopifyArticleId: "gid://shopify/Article/999",
      url: "https://legendsdtf.com/blogs/news/starting-a-t-shirt-business-checklist"
    }
  ];

  const productOverlap = evaluateCustomTopic("UV DTF Decals", {
    businessFacts: [],
    existingArticles: inventory,
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(productOverlap.ok, false);

  const shopifyOverlap = evaluateCustomTopic("starting a T-shirt business checklist", {
    businessFacts: [],
    existingArticles: inventory,
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(shopifyOverlap.ok, false);
  if (!shopifyOverlap.ok) {
    assert.equal(shopifyOverlap.overlap.source, "shopify_article");
    assert.equal(shopifyOverlap.overlap.shopifyArticleId, "gid://shopify/Article/999");
  }
});

test("full-inventory pagination detects articles beyond the first 50 and does not truncate", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const suffix = Date.now().toString(36);
  const createdIds: number[] = [];

  for (let i = 0; i < 55; i++) {
    const article = await seedArticle(db, {
      title: `Inventory filler ${i} ${suffix}`,
      handle: `inventory-filler-${i}-${suffix}`,
      keyword: `inventory filler ${i} ${suffix}`,
      status: i % 5 === 0 ? "failed" : i % 5 === 1 ? "generating" : "draft"
    });
    createdIds.push(article.id);
  }

  const deep = await seedArticle(db, {
    title: `Deep Unique Overlap Target ${suffix}`,
    handle: `deep-unique-overlap-target-${suffix}`,
    keyword: `deep unique overlap target ${suffix}`,
    status: "published"
  });
  createdIds.push(deep.id);

  const { items, total, pagesRead } = await listAllLocalArticles(db);
  assert.ok(total >= 56);
  assert.ok(pagesRead >= 2, "must read more than one page when inventory exceeds pageSize 50");
  assert.equal(items.length, total, "loaded count must equal reported total — no silent truncation");
  assert.ok(items.some(a => a.id === deep.id), "article beyond the first 50 must be present");

  const existing = items.map(a => ({
    id: a.id,
    title: a.title,
    handle: a.handle,
    status: a.status,
    primaryKeyword: a.primaryKeyword,
    topicFingerprint: a.topicFingerprint,
    excerpt: a.excerpt,
    source: "local_article" as const
  }));

  const blocked = evaluateCustomTopic(`Deep Unique Overlap Target ${suffix}`, {
    businessFacts: [],
    existingArticles: existing,
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.overlap.articleId, deep.id);
  }

  // Cleanup created rows to keep the shared DB tidy
  for (const id of createdIds) {
    await db.query("DELETE FROM articles WHERE id=$1", [id]);
  }
  await db.end();
});

test("drafts, failed articles, reservations, and pending briefs count as existing topics", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const suffix = Date.now().toString(36);

  const draft = await seedArticle(db, {
    title: `Draft Overlap Subject ${suffix}`,
    handle: `draft-overlap-subject-${suffix}`,
    keyword: `draft overlap subject ${suffix}`,
    status: "draft"
  });
  const failed = await seedArticle(db, {
    title: `Failed Overlap Subject ${suffix}`,
    handle: `failed-overlap-subject-${suffix}`,
    keyword: `failed overlap subject ${suffix}`,
    status: "failed"
  });

  const cycle = await runResearchCycle({
    products: [],
    existingArticles: [],
    usage: [],
    now,
    env: {}
  });
  assert.ok(cycle.selected);
  // Force a distinctive reserved opportunity (unique id avoids collisions with parallel tests)
  cycle.selected!.id = `reserved-opp-${suffix}`;
  cycle.selected!.cluster.id = `reserved-opp-${suffix}`;
  cycle.selected!.proposedTitle = `Reserved Opportunity Topic ${suffix}`;
  cycle.selected!.proposedHandle = `reserved-opportunity-topic-${suffix}`;
  cycle.selected!.cluster.primaryKeyword = `reserved opportunity topic ${suffix}`;
  await saveResearchCycle(db, cycle);
  const reserved = await reserveOpportunity(db, cycle.selected!.id, `test-worker-${suffix}`, 600);
  assert.ok(reserved, "expected to reserve the uniquely-keyed test opportunity");

  const brief = await saveBrief(db, buildArticleBrief({
    ...cycle.opportunities[1] || cycle.selected!,
    proposedTitle: `Pending Brief Topic ${suffix}`,
    proposedHandle: `pending-brief-topic-${suffix}`,
    cluster: {
      ...(cycle.opportunities[1] || cycle.selected!).cluster,
      primaryKeyword: `pending brief topic ${suffix}`
    }
  }, { businessFacts: [] }));

  const { items } = await listAllLocalArticles(db);
  const reservedRefs = await listReservedOpportunityRefs(db);
  const pendingRefs = await listPendingBriefRefs(db);
  const inventory: ExistingArticleRef[] = [
    ...items.map(a => ({
      id: a.id,
      title: a.title,
      handle: a.handle,
      status: a.status,
      primaryKeyword: a.primaryKeyword,
      topicFingerprint: a.topicFingerprint,
      excerpt: a.excerpt,
      source: "local_article" as const
    })),
    ...reservedRefs,
    ...pendingRefs
  ];

  assert.ok(inventory.some(i => i.id === draft.id && i.status === "draft"));
  assert.ok(inventory.some(i => i.id === failed.id && i.status === "failed"));
  assert.ok(reservedRefs.some(r => /Reserved Opportunity Topic/i.test(r.title)));
  assert.ok(pendingRefs.some(r => r.id === brief.id));

  assert.equal(evaluateCustomTopic(`Draft Overlap Subject ${suffix}`, {
    businessFacts: [],
    existingArticles: inventory,
    settings: DEFAULT_RESEARCH_SETTINGS
  }).ok, false);

  assert.equal(evaluateCustomTopic(`Failed Overlap Subject ${suffix}`, {
    businessFacts: [],
    existingArticles: inventory,
    settings: DEFAULT_RESEARCH_SETTINGS
  }).ok, false);

  assert.equal(evaluateCustomTopic(`Reserved Opportunity Topic ${suffix}`, {
    businessFacts: [],
    existingArticles: inventory,
    settings: DEFAULT_RESEARCH_SETTINGS
  }).ok, false);

  assert.equal(evaluateCustomTopic(`Pending Brief Topic ${suffix}`, {
    businessFacts: [],
    existingArticles: inventory,
    settings: DEFAULT_RESEARCH_SETTINGS
  }).ok, false);

  const closestShopifyStyle = findClosestOverlap(
    {
      id: "x",
      primaryKeyword: `pending brief topic ${suffix}`,
      secondaryKeywords: [],
      intent: "informational",
      pillar: "apparel_business",
      subcategory: "custom",
      audience: "small_business_owners",
      format: "how_to",
      signals: [],
      missingProviders: []
    },
    inventory
  );
  assert.ok(closestShopifyStyle);
  assert.equal(isRejectedByOverlap(closestShopifyStyle, DEFAULT_RESEARCH_SETTINGS.overlapRejectThreshold), true);

  await db.query("DELETE FROM merchant_interviews WHERE brief_id=$1", [brief.id]);
  await db.query("DELETE FROM article_briefs WHERE id=$1", [brief.id]);
  await db.query("DELETE FROM articles WHERE id=ANY($1::bigint[])", [[draft.id, failed.id]]);
  await db.end();
});
