import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate, getArticle, getSettings, saveSettings } from "../src/db.js";
import { defaultSettings } from "../src/defaults.js";
import {
  authorizeAutomaticPublication,
  evaluateArticlePublishReadiness,
  evaluateSettingsPublishReadiness
} from "../src/autopilot/authorizePublish.js";
import {
  claimResearchSlotForTest,
  executeScheduledResearchCycle
} from "../src/autopilot/researchCycle.js";
import {
  getBrief,
  getEvidenceReportForArticle,
  qualityGatesPassed,
  runQualityGates,
  evaluateCustomTopic,
  DEFAULT_RESEARCH_SETTINGS
} from "../src/research/index.js";
import type { ResearchCycleResult, ResearchOpportunity } from "../src/research/types.js";
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

function makeOpportunity(overrides: Partial<ResearchOpportunity> = {}): ResearchOpportunity {
  const custom = evaluateCustomTopic("embroidery vs DTF for work shirts", {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) throw new Error("fixture brief failed");
  const brief = custom.brief;
  return {
    id: overrides.id || `opp-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    cluster: {
      id: "cluster-1",
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
      ...brief.scores,
      opportunityScore: 0.85,
      businessRelevance: 0.85,
      factualConfidence: 0.95,
      conversionIntent: 0.8
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
    topicSpecificity: 0.9,
    uniqueness: 0.92,
    demandClass: "editorial_business_opportunity",
    decision: "DRAFT_ONLY",
    decisionReasons: ["Fixture opportunity"],
    failedGates: [],
    internalLinks: ["https://legendsdtf.com/pages/contact"],
    externalSources: [],
    status: "suggested",
    ...overrides
  };
}

function makeCycleResult(selected: ResearchOpportunity | null): ResearchCycleResult {
  return {
    collectedAt: new Date().toISOString(),
    missingProviders: [],
    signals: [],
    opportunities: selected ? [selected] : [],
    selected,
    cycleDecision: selected ? selected.decision : "SKIPPED_NO_QUALIFIED_TOPIC",
    cycleDecisionReasons: selected ? selected.decisionReasons : ["No qualified topic"]
  };
}

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

function makeGenerated(briefTitle: string, keyword: string): GeneratedArticle {
  const body = `<h2>Compare decoration methods for work shirts</h2><p>${"Practical guidance for small-business owners choosing embroidery or DTF for employee uniforms. ".repeat(45)}</p><p>Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia.</p>`;
  return {
    title: briefTitle.slice(0, 70),
    handle: "embroidery-vs-dtf-for-work-shirts",
    summary: "Compare embroidery and DTF for work shirts with practical buyer guidance.",
    metaDescription: "Embroidery vs DTF for work shirts: durability, detail, and cost guidance for uniform buyers from Legends DTF Prints.",
    bodyHtml: body,
    tags: ["embroidery", "DTF", "work shirts"],
    primaryKeyword: keyword,
    topicFingerprint: "embroidery-vs-dtf-work-shirts",
    rationale: "Commercial comparison from research brief"
  };
}

async function withSettings(db: ReturnType<typeof createDb>, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(db);
  const next = { ...current, ...patch, research: { ...current.research, ...(patch.research || {}) } };
  await saveSettings(db, next);
  return next;
}

test("atomic claim: two concurrent claims yield one winner", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const slot = `research:claim-test:${Date.now()}`;
  const [a, b] = await Promise.all([
    claimResearchSlotForTest(db, slot, "draft_only"),
    claimResearchSlotForTest(db, slot, "draft_only")
  ]);
  const winners = [a, b].filter(r => r.claimed);
  const losers = [a, b].filter(r => !r.claimed);
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  await db.end();
});

test("DRAFT_ONLY scheduled cycle creates a complete article preserving the brief", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await withSettings(db, {
    ...defaultSettings,
    enabled: false,
    draftOnlyMode: true,
    rolloutMode: "draft_only",
    research: { ...defaultSettings.research, enabled: true }
  });

  const opportunity = makeOpportunity();
  const slot = `research:draft-pipeline:${Date.now()}`;
  let publishCalls = 0;

  const result = await executeScheduledResearchCycle({
    db,
    config: fakeConfig,
    slotKey: slot,
    actor: "test",
    deps: {
      loadContentInventory: async () => emptyInventory(),
      runResearchCycle: async () => makeCycleResult(opportunity),
      generateArticle: async ({ brief }) => {
        assert.ok(brief);
        assert.equal(brief.primaryKeyword, opportunity.cluster.primaryKeyword);
        return makeGenerated(brief!.proposedTitle, brief!.primaryKeyword);
      },
      publishArticle: async () => {
        publishCalls += 1;
        throw new Error("DRAFT_ONLY must not publish");
      },
      getProductLinks: async () => ({ products: [], warning: undefined })
    }
  });

  assert.equal(result.alreadyClaimed, undefined);
  assert.ok(result.briefId);
  assert.ok(result.articleId);
  assert.equal(publishCalls, 0);

  const brief = await getBrief(db, result.briefId!);
  const article = await getArticle(db, result.articleId!);
  const evidence = await getEvidenceReportForArticle(db, result.articleId!);

  assert.ok(brief);
  assert.equal(brief!.status, "generated");
  assert.equal(article?.source, "research");
  assert.equal(article?.status, "draft");
  assert.equal(article?.primaryKeyword, opportunity.cluster.primaryKeyword);
  assert.match(article?.title || "", /embroidery|DTF|work/i);
  assert.ok(evidence);
  assert.ok(Array.isArray(evidence!.qualityGateResults));
  assert.ok(Array.isArray(evidence!.editorialFindings));
  assert.equal((article?.generationSettings as { researchPipeline?: boolean })?.researchPipeline, true);
  assert.equal((article?.generationSettings as { briefId?: number })?.briefId, brief!.id);

  await db.end();
});

test("NEEDS_MERCHANT_INPUT does not generate an article", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await withSettings(db, { rolloutMode: "draft_only", draftOnlyMode: true, enabled: false });

  const opportunity = makeOpportunity({
    requiresInterview: true,
    decision: "NEEDS_MERCHANT_INPUT",
    decisionReasons: ["Interview required"],
    cluster: {
      ...makeOpportunity().cluster,
      pillar: "honest_entrepreneurship",
      format: "first_person_story",
      primaryKeyword: "leaving a 9-to-5 for a print shop"
    }
  });

  let generated = 0;
  const result = await executeScheduledResearchCycle({
    db,
    config: fakeConfig,
    slotKey: `research:interview:${Date.now()}`,
    deps: {
      loadContentInventory: async () => emptyInventory(),
      runResearchCycle: async () => makeCycleResult(opportunity),
      generateArticle: async () => {
        generated += 1;
        return makeGenerated("x", "y");
      }
    }
  });

  assert.equal(result.cycleDecision, "NEEDS_MERCHANT_INPUT");
  assert.ok(result.briefId);
  assert.equal(result.articleId, undefined);
  assert.equal(generated, 0);
  await db.end();
});

test("two concurrent executions of one slot produce one cycle/brief/article", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await withSettings(db, { rolloutMode: "draft_only", draftOnlyMode: true, enabled: false });

  const opportunity = makeOpportunity({ id: `opp-concurrent-${Date.now()}` });
  const slot = `research:concurrent:${Date.now()}`;
  let researchRuns = 0;
  let generateRuns = 0;

  const deps = {
    loadContentInventory: async () => emptyInventory(),
    runResearchCycle: async () => {
      researchRuns += 1;
      await new Promise(r => setTimeout(r, 50));
      return makeCycleResult(opportunity);
    },
    generateArticle: async ({ brief }: { brief?: { proposedTitle: string; primaryKeyword: string } }) => {
      generateRuns += 1;
      return makeGenerated(brief!.proposedTitle, brief!.primaryKeyword);
    },
    getProductLinks: async () => ({ products: [], warning: undefined })
  };

  const [a, b] = await Promise.all([
    executeScheduledResearchCycle({ db, config: fakeConfig, slotKey: slot, deps }),
    executeScheduledResearchCycle({ db, config: fakeConfig, slotKey: slot, deps })
  ]);

  const winners = [a, b].filter(r => !r.alreadyClaimed);
  const skipped = [a, b].filter(r => r.alreadyClaimed);
  assert.equal(winners.length, 1);
  assert.equal(skipped.length, 1);
  assert.equal(researchRuns, 1);
  assert.equal(generateRuns, 1);
  assert.ok(winners[0]!.briefId);
  assert.ok(winners[0]!.articleId);
  assert.equal(skipped[0]!.briefId, undefined);
  assert.equal(skipped[0]!.articleId, undefined);

  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM research_cycle_runs WHERE slot_key=$1`,
    [slot]
  );
  assert.equal(Number(rows[0]!.count), 1);

  await db.end();
});

test("AUTO_PUBLISH authorization is fail-closed without activation/promotion/evidence", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  const settingsBlocked = await withSettings(db, {
    enabled: true,
    draftOnlyMode: false,
    rolloutMode: "auto_publish",
    promotionProgress: {
      consecutiveReviewedDrafts: 2,
      merchantApprovalRate: 0.5,
      shadowAutoDays: 1,
      autoPublishExplicitlyActivated: false
    }
  });
  const settingsEval = evaluateSettingsPublishReadiness(settingsBlocked);
  assert.equal(settingsEval.ready, false);
  assert.ok(settingsEval.reasons.some(r => /autoPublishExplicitlyActivated|approval|SHADOW|reviewed drafts/i.test(r)));

  const articleReady = evaluateArticlePublishReadiness({
    article: {
      id: 1,
      source: "research",
      generationSettings: { briefId: 1, researchPipeline: true },
      status: "draft"
    } as never,
    brief: {
      decision: "AUTO_ELIGIBLE",
      automaticPublishingEligible: true,
      failedGates: [],
      requiresInterview: false
    } as never,
    evidence: null
  });
  assert.equal(articleReady.ready, false);
  assert.ok(articleReady.reasons.some(r => /Evidence report is missing/i.test(r)));

  const custom = evaluateCustomTopic("embroidery vs DTF for work shirts", {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) return;
  custom.brief.decision = "AUTO_ELIGIBLE";
  custom.brief.automaticPublishingEligible = true;
  const badReport = runQualityGates({
    brief: custom.brief,
    draft: {
      title: "A Practical Guide to Embroidery",
      handle: "x",
      excerpt: "short",
      metaTitle: "x",
      metaDescription: "short",
      bodyHtml: "<p>guaranteed best in the world</p>",
      primaryKeyword: "embroidery",
      secondaryKeywords: []
    }
  });
  assert.equal(qualityGatesPassed(badReport), false);
  const readiness = evaluateArticlePublishReadiness({
    article: {
      id: 99,
      source: "research",
      generationSettings: { briefId: 1, researchPipeline: true }
    } as never,
    brief: custom.brief,
    evidence: { ...badReport, decision: "AUTO_ELIGIBLE" }
  });
  assert.equal(readiness.ready, false);

  await saveSettings(db, defaultSettings);
  await db.end();
});

test("inconsistent persisted auto_publish settings cannot bypass authorizeAutomaticPublication", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  // Persist inconsistent settings directly (as if edited outside the form).
  await saveSettings(db, {
    ...defaultSettings,
    enabled: true,
    draftOnlyMode: false,
    rolloutMode: "auto_publish",
    promotionProgress: {
      consecutiveReviewedDrafts: 0,
      merchantApprovalRate: 0,
      shadowAutoDays: 0,
      autoPublishExplicitlyActivated: false
    }
  });

  const opportunity = makeOpportunity();
  const slot = `research:auth-bypass:${Date.now()}`;
  let publishCalls = 0;

  const result = await executeScheduledResearchCycle({
    db,
    config: fakeConfig,
    slotKey: slot,
    deps: {
      loadContentInventory: async () => emptyInventory(),
      runResearchCycle: async () => makeCycleResult({
        ...opportunity,
        scores: {
          ...opportunity.scores,
          opportunityScore: 0.9,
          businessRelevance: 0.9,
          factualConfidence: 0.95,
          conversionIntent: 0.8
        },
        topicSpecificity: 0.95,
        uniqueness: 0.95,
        decision: "DRAFT_ONLY"
      }),
      generateArticle: async ({ brief }) => makeGenerated(brief!.proposedTitle, brief!.primaryKeyword),
      publishArticle: async () => {
        publishCalls += 1;
        return {
          id: "gid://shopify/Article/1",
          handle: "x",
          title: "x",
          isPublished: true,
          publishedAt: new Date().toISOString(),
          url: "https://legendsdtf.com/blogs/news/x",
          blogId: "gid://shopify/Blog/1",
          blogHandle: "news",
          responseStatus: "created"
        };
      },
      getProductLinks: async () => ({ products: [], warning: undefined })
    }
  });

  assert.ok(result.articleId);
  assert.equal(publishCalls, 0);

  const auth = await authorizeAutomaticPublication({
    db,
    articleId: result.articleId!
  });
  assert.equal(auth.ok, false);
  assert.equal(auth.wouldPublish, false);
  assert.ok(auth.reasons.some(r => /autoPublishExplicitlyActivated|promotion|reviewed drafts|approval|SHADOW/i.test(r)));

  // Restore safe defaults
  await saveSettings(db, defaultSettings);
  await db.end();
});

test("SHADOW_AUTO cycle records wouldPublish without calling Shopify", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const lockedSettings = await withSettings(db, {
    enabled: true,
    draftOnlyMode: true,
    rolloutMode: "shadow_auto",
    promotionProgress: {
      consecutiveReviewedDrafts: 30,
      merchantApprovalRate: 0.95,
      shadowAutoDays: 14,
      autoPublishExplicitlyActivated: false
    },
    frequencyLimits: { maxArticlesPerCycle: 1, maxPublishedPerRolling7Days: 10_000, minHoursBetweenPublishes: 0 }
  });

  let publishCalls = 0;
  const opportunity = makeOpportunity();
  opportunity.scores = {
    ...opportunity.scores,
    opportunityScore: 0.88,
    businessRelevance: 0.9,
    factualConfidence: 0.95,
    conversionIntent: 0.8
  };
  opportunity.topicSpecificity = 0.92;
  opportunity.uniqueness = 0.95;

  const result = await executeScheduledResearchCycle({
    db,
    config: fakeConfig,
    slotKey: `research:shadow:${Date.now()}`,
    settingsOverride: lockedSettings,
    deps: {
      loadContentInventory: async () => emptyInventory(),
      runResearchCycle: async () => makeCycleResult(opportunity),
      generateArticle: async ({ brief }) => {
        const meta = `${brief!.primaryKeyword}: compare durability, detail, cost, and turnaround for uniform buyers with Legends DTF Prints.`;
        const padded = meta.length >= 145 ? meta.slice(0, 160) : (meta + " See current options on legendsdtf.com today.").slice(0, 160);
        const paragraph = "Practical guidance for small-business owners choosing embroidery or DTF for employee work-shirt uniforms with clear commercial tradeoffs. ";
        return {
          title: (brief!.proposedTitle.length >= 25 ? brief!.proposedTitle : "Embroidery vs. DTF Printing: Which Is Better for Work Shirts?").slice(0, 70),
          handle: brief!.proposedHandle || "embroidery-vs-dtf-for-work-shirts",
          summary: padded.slice(0, 200),
          metaDescription: padded,
          bodyHtml: `<h2>Compare decoration methods for work shirts</h2><p>${paragraph.repeat(30)}</p><h2>Decision checklist</h2><p>${paragraph.repeat(15)}</p><p>Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia.</p>`,
          tags: ["embroidery", "DTF", "work shirts"],
          primaryKeyword: brief!.primaryKeyword,
          topicFingerprint: "embroidery-vs-dtf-work-shirts",
          rationale: "Commercial comparison from research brief"
        };
      },
      publishArticle: async () => {
        publishCalls += 1;
        throw new Error("SHADOW_AUTO must not publish");
      },
      getProductLinks: async () => ({ products: [], warning: undefined })
    }
  });

  assert.ok(result.articleId);
  assert.equal(publishCalls, 0);
  assert.equal(result.wouldPublish, true, result.reasons.join("; "));
  const article = await getArticle(db, result.articleId!);
  assert.equal(article?.status, "draft");
  assert.equal(article?.shopifyArticleId, null);

  const { rows } = await db.query<{ detail: { wouldPublish?: boolean; ok?: boolean } }>(
    `SELECT detail FROM audit_events WHERE article_id=$1 AND action='shadow_auto_decision' ORDER BY id DESC LIMIT 1`,
    [result.articleId]
  );
  assert.ok(rows[0]);
  assert.equal(rows[0]!.detail.wouldPublish, true);
  assert.equal(rows[0]!.detail.ok, false);

  await saveSettings(db, defaultSettings);
  await db.end();
});

test("failed gate / missing evidence prevent AUTO_PUBLISH ok", () => {
  const missing = evaluateArticlePublishReadiness({
    article: { id: 1, source: "research", generationSettings: { researchPipeline: true } } as never,
    brief: {
      decision: "AUTO_ELIGIBLE",
      automaticPublishingEligible: true,
      failedGates: [],
      requiresInterview: false
    } as never,
    evidence: null
  });
  assert.equal(missing.ready, false);

  const custom = evaluateCustomTopic("gang sheet planning for school spirit orders", {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) return;
  custom.brief.decision = "AUTO_ELIGIBLE";
  custom.brief.automaticPublishingEligible = true;
  const report = runQualityGates({
    brief: custom.brief,
    draft: {
      title: "A Practical Guide to Gang Sheets",
      handle: "x",
      excerpt: "x",
      metaTitle: "x",
      metaDescription: "short",
      bodyHtml: "<p>guaranteed best</p>",
      primaryKeyword: "gang sheets",
      secondaryKeywords: []
    }
  });
  report.decision = "AUTO_ELIGIBLE";
  const blocked = evaluateArticlePublishReadiness({
    article: { id: 2, source: "research", generationSettings: { researchPipeline: true } } as never,
    brief: custom.brief,
    evidence: report
  });
  assert.equal(blocked.ready, false);
  assert.equal(qualityGatesPassed(report), false);
});
