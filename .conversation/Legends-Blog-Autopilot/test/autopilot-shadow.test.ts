import test from "node:test";
import assert from "node:assert/strict";
import { createArticle, createDb, getArticle, migrate, getSettings, saveSettings, updateArticle } from "../src/db.js";
import { defaultSettings } from "../src/defaults.js";
import {
  authorizeAutomaticPublication,
  evaluateShadowSettingsReadiness
} from "../src/autopilot/authorizePublish.js";
import { executeScheduledResearchCycle } from "../src/autopilot/researchCycle.js";
import {
  evaluateCustomTopic,
  saveBrief,
  saveEvidenceReport,
  updateBrief,
  runQualityGates,
  qualityGatesPassed,
  DEFAULT_RESEARCH_SETTINGS
} from "../src/research/index.js";
import type { ResearchCycleResult, ResearchOpportunity, EvidenceReport, ArticleBrief } from "../src/research/types.js";
import type { GeneratedArticle, Settings } from "../src/types.js";
import type { AppConfig } from "../src/config.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

const fakeConfig = {
  OPENAI_API_KEY: "test",
  OPENAI_MODEL: "gpt-test",
  STOREFRONT_URL: "https://legendsdtf.com",
  SHOPIFY_SHOP: "example.myshopify.com",
  SHOPIFY_CLIENT_ID: "id",
  SHOPIFY_CLIENT_SECRET: "secret",
  SHOPIFY_API_VERSION: "2026-07",
  ADMIN_PASSWORD: "x",
  SESSION_SECRET: "x",
  PORT: 3000
} as unknown as AppConfig;

function emptyInventory() {
  return {
    existing: [],
    products: [],
    warnings: [] as string[],
    counts: {
      localArticles: 0,
      shopifyArticles: 0,
      productPages: 0,
      reservedOpportunities: 0,
      pendingBriefs: 0,
      total: 0,
      truncated: false
    }
  };
}

function qualifiedMeta(keyword: string): string {
  // 145–160 chars, includes keyword naturally
  const base = `${keyword}: compare durability, detail, cost, and turnaround for uniform buyers with Legends DTF Prints.`;
  if (base.length >= 145 && base.length <= 160) return base;
  if (base.length > 160) return base.slice(0, 157).replace(/\s+\S*$/, "") + "…";
  return (base + " See current options on legendsdtf.com.").slice(0, 160);
}

function makeGenerated(title: string, keyword: string): GeneratedArticle {
  const meta = qualifiedMeta(keyword);
  const paragraph =
    "Small-business owners choosing employee uniforms need a clear commercial comparison of embroidery and DTF for work shirts, covering durability, detail, cost-per-piece, and turnaround without invented guarantees. ";
  const body = `<h2>What embroidery vs DTF means for work shirts</h2><p>${paragraph.repeat(25)}</p><h2>How to decide for your team</h2><p>${paragraph.repeat(15)}</p><p>Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia.</p>`;
  const safeTitle = title.length >= 25 ? title.slice(0, 70) : "Embroidery vs. DTF Printing: Which Is Better for Work Shirts?";
  return {
    title: safeTitle,
    handle: "embroidery-vs-dtf-for-work-shirts",
    summary: meta.slice(0, 200),
    metaDescription: meta,
    bodyHtml: body,
    tags: ["embroidery", "DTF", "work shirts"],
    primaryKeyword: keyword,
    topicFingerprint: "embroidery-vs-dtf-work-shirts",
    rationale: "Commercial comparison from research brief"
  };
}

function autoEligibleOpportunity(): ResearchOpportunity {
  const custom = evaluateCustomTopic("embroidery vs DTF for work shirts", {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) throw new Error("fixture failed");
  const brief = custom.brief;
  return {
    id: `opp-shadow-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    cluster: {
      id: "cluster-shadow",
      primaryKeyword: brief.primaryKeyword,
      secondaryKeywords: brief.secondaryKeywords,
      intent: brief.searchIntent,
      pillar: brief.pillar,
      subcategory: brief.subcategory,
      audience: brief.audience,
      format: brief.format,
      signals: [],
      missingProviders: []
    },
    scores: {
      demandScore: 0.5,
      growthScore: 0.5,
      businessRelevance: 0.9,
      conversionIntent: 0.8,
      rankingOpportunity: 0.6,
      localRelevance: 0.7,
      freshnessScore: 0.6,
      contentGapScore: 0.8,
      overlapPenalty: 0.05,
      factualConfidence: 0.95,
      opportunityScore: 0.88
    },
    freshnessClass: "evergreen",
    dataCollectedLabel: "Editorial opportunity — no verified search metrics invented.",
    completeness: "unavailable",
    closestExisting: null,
    whyDistinct: brief.whyDistinct,
    whyFitsLegends: "Commercial decoration comparison for workwear buyers.",
    requiresInterview: false,
    productsToFeature: [],
    proposedTitle: brief.proposedTitle,
    proposedH1: brief.proposedH1,
    proposedHandle: brief.proposedHandle,
    proposedOutline: brief.proposedOutline,
    readerQuestion: brief.readerQuestion,
    topicSpecificity: 0.92,
    uniqueness: 0.95,
    demandClass: "editorial_business_opportunity",
    decision: "DRAFT_ONLY",
    decisionReasons: ["Pre-generation fixture"],
    failedGates: [],
    internalLinks: ["https://legendsdtf.com/pages/contact"],
    externalSources: [],
    status: "suggested"
  };
}

function cycleResult(selected: ResearchOpportunity): ResearchCycleResult {
  return {
    collectedAt: new Date().toISOString(),
    missingProviders: [],
    signals: [],
    opportunities: [selected],
    selected,
    cycleDecision: selected.decision,
    cycleDecisionReasons: selected.decisionReasons
  };
}

async function withSettings(db: ReturnType<typeof createDb>, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(db);
  const next: Settings = {
    ...current,
    ...patch,
    research: { ...current.research, ...(patch.research || {}) },
    promotionProgress: { ...current.promotionProgress, ...(patch.promotionProgress || {}) },
    promotionThresholds: { ...current.promotionThresholds, ...(patch.promotionThresholds || {}) },
    frequencyLimits: { ...current.frequencyLimits, ...(patch.frequencyLimits || {}) },
    killSwitch: { ...current.killSwitch, ...(patch.killSwitch || {}) }
  };
  await saveSettings(db, next);
  return next;
}

async function seedQualifiedArticle(db: ReturnType<typeof createDb>): Promise<{
  articleId: number;
  brief: ArticleBrief;
  evidence: EvidenceReport;
}> {
  const custom = evaluateCustomTopic("embroidery vs DTF for work shirts", {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) throw new Error("brief failed");

  const generated = makeGenerated(custom.brief.proposedTitle, custom.brief.primaryKeyword);
  const evidence = runQualityGates({
    brief: custom.brief,
    draft: {
      title: generated.title,
      handle: generated.handle,
      excerpt: generated.summary,
      metaTitle: generated.title,
      metaDescription: generated.metaDescription,
      bodyHtml: generated.bodyHtml,
      primaryKeyword: generated.primaryKeyword,
      secondaryKeywords: custom.brief.secondaryKeywords,
      h1: custom.brief.proposedH1
    },
    storefrontUrl: "https://legendsdtf.com"
  });
  assert.equal(qualityGatesPassed(evidence), true, evidence.reviewFlags.join("; "));

  custom.brief.decision = "AUTO_ELIGIBLE";
  custom.brief.automaticPublishingEligible = true;
  custom.brief.failedGates = [];
  custom.brief.scores = {
    ...custom.brief.scores,
    opportunityScore: 0.88,
    businessRelevance: 0.9,
    factualConfidence: 0.95,
    conversionIntent: 0.8
  };
  custom.brief.topicSpecificity = 0.92;
  custom.brief.uniqueness = 0.95;
  evidence.decision = "AUTO_ELIGIBLE";

  // Briefs require an opportunity row when opportunity_id is set.
  const oppId = `seed-opp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  custom.brief.opportunityId = oppId;
  await db.query(
    `INSERT INTO research_opportunities(id, payload, status)
     VALUES ($1, $2::jsonb, 'used')
     ON CONFLICT (id) DO NOTHING`,
    [oppId, JSON.stringify({ id: oppId, proposedTitle: custom.brief.proposedTitle })]
  );

  const savedBrief = await saveBrief(db, custom.brief);
  const article = await createArticle(db, {
    title: generated.title,
    handle: generated.handle,
    excerpt: generated.summary,
    metaTitle: generated.title,
    metaDescription: generated.metaDescription,
    bodyHtml: generated.bodyHtml,
    tags: generated.tags,
    author: defaultSettings.authorName,
    featuredImageUrl: null,
    featuredImageAlt: null,
    primaryKeyword: generated.primaryKeyword,
    secondaryKeywords: custom.brief.secondaryKeywords,
    topicFingerprint: generated.topicFingerprint,
    rationale: generated.rationale
  }, {
    status: "draft",
    source: "research",
    generationSettings: {
      briefId: savedBrief.id,
      researchPipeline: true,
      opportunityId: savedBrief.opportunityId
    }
  });

  savedBrief.status = "generated";
  await updateBrief(db, savedBrief.id!, savedBrief);
  await db.query(`UPDATE article_briefs SET article_id=$2, status='generated' WHERE id=$1`, [savedBrief.id, article.id]);
  await saveEvidenceReport(db, article.id, savedBrief.id!, evidence);

  return { articleId: article.id, brief: savedBrief, evidence };
}

const promotionReady = {
  consecutiveReviewedDrafts: 30,
  merchantApprovalRate: 0.95,
  shadowAutoDays: 14,
  autoPublishExplicitlyActivated: false
};

test("shadow settings readiness ignores draftOnly and activation", () => {
  const ready = evaluateShadowSettingsReadiness({
    ...defaultSettings,
    enabled: true,
    draftOnlyMode: true,
    rolloutMode: "shadow_auto",
    promotionProgress: promotionReady,
    killSwitch: { ...defaultSettings.killSwitch, paused: false }
  });
  assert.equal(ready.ready, true);
  assert.deepEqual(ready.promotionReasons, []);
});

test("fully qualified SHADOW_AUTO article: wouldPublish=true, ok=false, no Shopify, stays draft", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const lockedSettings = await withSettings(db, {
    enabled: true,
    draftOnlyMode: true,
    rolloutMode: "shadow_auto",
    promotionProgress: promotionReady,
    killSwitch: { ...defaultSettings.killSwitch, paused: false },
    frequencyLimits: { maxArticlesPerCycle: 1, maxPublishedPerRolling7Days: 10_000, minHoursBetweenPublishes: 0 }
  });

  let publishCalls = 0;
  const opportunity = autoEligibleOpportunity();
  const result = await executeScheduledResearchCycle({
    db,
    config: fakeConfig,
    slotKey: `research:shadow-qualified:${Date.now()}`,
    settingsOverride: lockedSettings,
    deps: {
      loadContentInventory: async () => emptyInventory(),
      runResearchCycle: async () => cycleResult(opportunity),
      generateArticle: async ({ brief }) => makeGenerated(brief!.proposedTitle, brief!.primaryKeyword),
      publishArticle: async () => {
        publishCalls += 1;
        throw new Error("SHADOW_AUTO must never publish");
      },
      getProductLinks: async () => ({ products: [], warning: undefined })
    }
  });

  assert.ok(result.articleId, "expected generated article");
  assert.equal(publishCalls, 0);

  const auth = await authorizeAutomaticPublication({
    db,
    settings: lockedSettings,
    articleId: result.articleId!,
    shadowEvaluation: true
  });
  assert.equal(auth.ok, false, auth.reasons.join("; "));
  assert.equal(
    auth.wouldPublish,
    true,
    `articleReady=${auth.articleReady} promotionReady=${auth.promotionReady} frequencyReady=${auth.frequencyReady} settingsReady=${auth.settingsReady} reasons=${auth.reasons.join(" | ")}`
  );
  assert.equal(result.wouldPublish, true, result.reasons.join("; "));
  assert.equal(auth.articleReady, true);
  assert.equal(auth.promotionReady, true);
  assert.equal(auth.frequencyReady, true);
  assert.ok(auth.livePublicationReasons.some(r => /SHADOW_AUTO never authorizes/i.test(r)));
  assert.ok(auth.livePublicationReasons.some(r => /draftOnlyMode=true/i.test(r)));
  assert.ok(auth.livePublicationReasons.some(r => /activation checkbox/i.test(r)));

  const article = await getArticle(db, result.articleId!);
  assert.equal(article?.status, "draft");
  assert.equal(article?.shopifyArticleId, null);

  const { rows } = await db.query<{
    detail: {
      ok?: boolean;
      wouldPublish?: boolean;
      articleReasons?: string[];
      promotionReasons?: string[];
      frequencyReasons?: string[];
      livePublicationReasons?: string[];
    };
  }>(
    `SELECT detail FROM audit_events WHERE article_id=$1 AND action='shadow_auto_decision' ORDER BY id DESC LIMIT 1`,
    [result.articleId]
  );
  assert.ok(rows[0]);
  assert.equal(rows[0]!.detail.ok, false);
  assert.equal(rows[0]!.detail.wouldPublish, true);
  assert.ok(Array.isArray(rows[0]!.detail.articleReasons));
  assert.ok(Array.isArray(rows[0]!.detail.livePublicationReasons));

  await saveSettings(db, defaultSettings);
  await db.end();
});

test("SHADOW_AUTO failed quality gate => wouldPublish=false", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await withSettings(db, {
    enabled: true,
    draftOnlyMode: true,
    rolloutMode: "shadow_auto",
    promotionProgress: promotionReady,
    frequencyLimits: { maxArticlesPerCycle: 1, maxPublishedPerRolling7Days: 5, minHoursBetweenPublishes: 0 }
  });

  const seeded = await seedQualifiedArticle(db);
  // Corrupt evidence so gates fail
  const badEvidence: EvidenceReport = {
    ...seeded.evidence,
    qualityGateResults: [
      ...seeded.evidence.qualityGateResults.map(g =>
        g.gate === "unsupported_claims" ? { ...g, ok: false, severity: "critical" } : g
      )
    ],
    editorialFindings: [
      ...(seeded.evidence.editorialFindings || []),
      { gate: "unsupported_claims", severity: "critical", detail: "Blocked claim" }
    ],
    decision: "DRAFT_ONLY"
  };
  seeded.brief.decision = "DRAFT_ONLY";
  seeded.brief.automaticPublishingEligible = false;
  await updateBrief(db, seeded.brief.id!, seeded.brief);
  await saveEvidenceReport(db, seeded.articleId, seeded.brief.id!, badEvidence);

  const auth = await authorizeAutomaticPublication({
    db,
    articleId: seeded.articleId,
    brief: seeded.brief,
    evidence: badEvidence,
    shadowEvaluation: true
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.wouldPublish, false);
  assert.equal(auth.articleReady, false);
  assert.ok(auth.articleReasons.length > 0);

  await saveSettings(db, defaultSettings);
  await db.end();
});

test("SHADOW_AUTO incomplete promotion => wouldPublish=false", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await withSettings(db, {
    enabled: true,
    draftOnlyMode: true,
    rolloutMode: "shadow_auto",
    promotionProgress: {
      consecutiveReviewedDrafts: 2,
      merchantApprovalRate: 0.4,
      shadowAutoDays: 1,
      autoPublishExplicitlyActivated: false
    },
    frequencyLimits: { maxArticlesPerCycle: 1, maxPublishedPerRolling7Days: 5, minHoursBetweenPublishes: 0 }
  });

  const seeded = await seedQualifiedArticle(db);
  const auth = await authorizeAutomaticPublication({
    db,
    articleId: seeded.articleId,
    brief: seeded.brief,
    evidence: seeded.evidence,
    shadowEvaluation: true
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.wouldPublish, false);
  assert.equal(auth.promotionReady, false);
  assert.ok(auth.promotionReasons.some(r => /reviewed drafts|approval|SHADOW/i.test(r)));

  await saveSettings(db, defaultSettings);
  await db.end();
});

test("SHADOW_AUTO active kill switch => wouldPublish=false", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await withSettings(db, {
    enabled: true,
    draftOnlyMode: true,
    rolloutMode: "shadow_auto",
    promotionProgress: promotionReady,
    killSwitch: {
      paused: true,
      reason: "test pause",
      recoveryStep: "clear",
      triggeredAt: new Date().toISOString(),
      consecutiveFailureThreshold: 3
    },
    frequencyLimits: { maxArticlesPerCycle: 1, maxPublishedPerRolling7Days: 5, minHoursBetweenPublishes: 0 }
  });

  const seeded = await seedQualifiedArticle(db);
  const auth = await authorizeAutomaticPublication({
    db,
    articleId: seeded.articleId,
    brief: seeded.brief,
    evidence: seeded.evidence,
    shadowEvaluation: true
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.wouldPublish, false);
  assert.ok(auth.reasons.some(r => /Kill switch/i.test(r)));

  await saveSettings(db, defaultSettings);
  await db.end();
});

test("SHADOW_AUTO frequency limits => wouldPublish=false", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await withSettings(db, {
    enabled: true,
    draftOnlyMode: true,
    rolloutMode: "shadow_auto",
    promotionProgress: promotionReady,
    killSwitch: { ...defaultSettings.killSwitch, paused: false },
    // Cap at zero so any publish attempt is blocked by the rolling window.
    frequencyLimits: { maxArticlesPerCycle: 1, maxPublishedPerRolling7Days: 0, minHoursBetweenPublishes: 18 }
  });

  const draft = await seedQualifiedArticle(db);
  const auth = await authorizeAutomaticPublication({
    db,
    articleId: draft.articleId,
    brief: draft.brief,
    evidence: draft.evidence,
    shadowEvaluation: true
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.wouldPublish, false);
  assert.equal(auth.frequencyReady, false);
  assert.ok(auth.frequencyReasons.some(r => /7-day|spacing|Frequency|limit/i.test(r)));

  await saveSettings(db, defaultSettings);
  await db.end();
});
