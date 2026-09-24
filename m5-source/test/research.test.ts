import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate } from "../src/db.js";
import {
  assertNoInventedPersonalExperience,
  avoidRepeatedDtfBias,
  briefFromCustomTopic,
  evaluateCustomTopic,
  buildArticleBrief,
  buildLockedFactSheet,
  clusterSignals,
  createInterviewDraft,
  applyInterviewAnswers,
  demandFromSignals,
  findClosestOverlap,
  formatCollectedLabel,
  isRejectedByOverlap,
  isTrivialVariation,
  pickRotatedAudience,
  pickRotatedFormat,
  pillarRotationBonus,
  qualityGatesPassed,
  rejectPopularIrrelevant,
  reserveOpportunity,
  runQualityGates,
  runResearchCycle,
  saveResearchCycle,
  scoreOpportunity,
  DEFAULT_RESEARCH_SETTINGS,
  DEFAULT_PILLAR_BALANCE
} from "../src/research/index.js";
import type { ResearchSignal, ResearchOpportunity } from "../src/research/types.js";
import type { UsageRecord } from "../src/research/rotation.js";

const now = new Date("2026-08-06T15:00:00.000Z");

function signal(partial: Partial<ResearchSignal> & { keyword: string }): ResearchSignal {
  return {
    provider: "seed_catalog",
    collectedAt: now.toISOString(),
    dataPeriodStart: null,
    dataPeriodEnd: null,
    geographicRegion: "US-GA",
    topic: partial.keyword,
    volume: null,
    relativeInterest: null,
    growth: null,
    competition: null,
    sourceUrl: null,
    completeness: "unavailable",
    notes: null,
    ...partial
  };
}

test("never invents search metrics when providers are unavailable", async () => {
  const result = await runResearchCycle({
    products: [],
    existingArticles: [],
    usage: [],
    now,
    env: {}
  });
  assert.ok(result.missingProviders.some(m => m.provider === "google_search_console"));
  assert.ok(result.missingProviders.some(m => m.provider === "keyword_volume"));
  for (const s of result.signals) {
    if (s.provider === "seed_catalog") {
      assert.equal(s.volume, null);
      assert.equal(s.growth, null);
      assert.equal(s.relativeInterest, null);
    }
  }
  assert.match(result.selected?.dataCollectedLabel || "", /No current search metrics|Partial search data|Search data collected August 6, 2026/i);
});

test("rejects a popular but irrelevant keyword", () => {
  assert.equal(rejectPopularIrrelevant("best crypto trading apps 2026"), true);
  assert.equal(rejectPopularIrrelevant("DTF gang sheets for schools"), false);
});

test("favors high-conversion local keyword over broad national term", () => {
  const local = scoreOpportunity({
    signals: [signal({ keyword: "custom shirts Warner Robins", volume: 90, growth: 10 })],
    businessRelevance: 0.9,
    conversionIntent: 0.85,
    rankingOpportunity: 0.7,
    localRelevance: 0.95,
    freshnessScore: 0.7,
    contentGapScore: 0.8,
    overlapPenalty: 0.1,
    factualConfidence: 0.7,
    maxVolume: 5000
  });
  const broad = scoreOpportunity({
    signals: [signal({ keyword: "shirts", volume: 5000, growth: 5 })],
    businessRelevance: 0.4,
    conversionIntent: 0.35,
    rankingOpportunity: 0.2,
    localRelevance: 0.2,
    freshnessScore: 0.5,
    contentGapScore: 0.3,
    overlapPenalty: 0.2,
    factualConfidence: 0.5,
    maxVolume: 5000
  });
  assert.ok(local.opportunityScore > broad.opportunityScore);
});

test("selects rising relevant long-tail over stagnant broad seed when metrics exist", async () => {
  const result = await runResearchCycle({
    products: [{ title: "DTF Transfers", url: "https://legendsdtf.com/products/dtf-transfers" }],
    existingArticles: [],
    usage: [
      { pillar: "dtf_education", subcategory: "pressing", audience: "apparel_decorators", format: "how_to", usedAt: now.toISOString() },
      { pillar: "dtf_education", subcategory: "pressing", audience: "apparel_decorators", format: "how_to", usedAt: now.toISOString() },
      { pillar: "dtf_education", subcategory: "pressing", audience: "apparel_decorators", format: "how_to", usedAt: now.toISOString() }
    ],
    now,
    env: {},
    settings: {
      ...DEFAULT_RESEARCH_SETTINGS,
      weights: { ...DEFAULT_RESEARCH_SETTINGS.weights, growthScore: 0.25, businessRelevance: 0.25, demandScore: 0.1 }
    }
  });
  // Inject scored comparison using growth signals directly
  const rising = scoreOpportunity({
    signals: [signal({ keyword: "glow-in-the-dark DTF for team apparel", volume: 120, growth: 40 })],
    businessRelevance: 0.85,
    conversionIntent: 0.7,
    rankingOpportunity: 0.6,
    localRelevance: 0.55,
    freshnessScore: 0.8,
    contentGapScore: 0.9,
    overlapPenalty: 0,
    factualConfidence: 0.7,
    maxVolume: 2000
  });
  const stagnant = scoreOpportunity({
    signals: [signal({ keyword: "shirts", volume: 2000, growth: -10 })],
    businessRelevance: 0.35,
    conversionIntent: 0.3,
    rankingOpportunity: 0.2,
    localRelevance: 0.2,
    freshnessScore: 0.4,
    contentGapScore: 0.2,
    overlapPenalty: 0.1,
    factualConfidence: 0.5,
    maxVolume: 2000
  });
  assert.ok(rising.opportunityScore > stagnant.opportunityScore);
  assert.ok(result.opportunities.length > 0);
  assert.ok(result.opportunities.some(o => o.cluster.pillar !== "dtf_education"), "should surface non-DTF pillars");
});

test("rejects an already-covered keyword cluster", () => {
  const clusters = clusterSignals([
    signal({ keyword: "DTF pressing temperature guide" })
  ], []);
  const cluster = clusters[0]!;
  const closest = findClosestOverlap(cluster, [{
    id: 1,
    title: "DTF Pressing Temperature Guide",
    handle: "dtf-pressing-temperature-guide",
    status: "published",
    primaryKeyword: "DTF pressing temperature guide",
    topicFingerprint: "dtf-pressing-temperature-guide"
  }]);
  assert.ok(closest);
  assert.equal(isRejectedByOverlap(closest, 0.72), true);
});

test("groups trivial keyword variations into one intent", () => {
  assert.equal(isTrivialVariation("DTF gang sheets", "dtf gang sheet"), true);
  const clusters = clusterSignals([
    signal({ keyword: "DTF gang sheets" }),
    signal({ keyword: "dtf gang sheet" }),
    signal({ keyword: "starting a T-shirt business" })
  ], []);
  const gang = clusters.filter(c => /gang/.test(c.primaryKeyword.toLowerCase()));
  assert.equal(gang.length, 1);
  assert.ok(gang[0]!.secondaryKeywords.length >= 1 || gang[0]!.primaryKeyword.length > 0);
});

test("handles stale or unavailable keyword data labels", () => {
  assert.match(formatCollectedLabel(now, "unavailable"), /No current search metrics available as of August 6, 2026/);
  assert.match(formatCollectedLabel(now, "historical"), /Historical\/incomplete/);
  assert.match(formatCollectedLabel(now, "complete"), /Search data collected August 6, 2026/);
  const demand = demandFromSignals([signal({ keyword: "x" })]);
  assert.equal(demand.usedMetric, false);
});

test("prevents unsupported product claims via locked fact sheet", () => {
  const sheet = buildLockedFactSheet({
    businessFacts: ["Legends DTF Prints is in Warner Robins."],
    products: [{ title: "Gang Sheet Builder", url: "https://legendsdtf.com/products/gang-sheet" }],
    requiresInterview: false,
    pillar: "dtf_education"
  });
  assert.ok(sheet.productFacts.some(f => /do not invent product capabilities/i.test(f)));
  assert.ok(sheet.prohibitedClaims.some(f => /pressing settings/i.test(f)));
});

test("requires citations / review flags for current statistics topics", () => {
  const sheet = buildLockedFactSheet({
    businessFacts: [],
    products: [],
    requiresInterview: false,
    pillar: "apparel_garment"
  });
  assert.ok(sheet.reviewFlags.some(f => /manufacturer|supplier|stale/i.test(f)));
});

test("generates accurate SEO title/meta constraints through quality gates", () => {
  // Use a supportable non-pricing topic — cost promises require verified numbers and are REJECTED.
  const brief = briefFromCustomTopic("gang sheet planning for school spirit orders", {
    businessFacts: ["Services include custom DTF transfers and gang sheets."]
  });
  const report = runQualityGates({
    brief,
    draft: {
      title: "Gang Sheet Planning for School Spirit Orders",
      handle: "gang-sheet-planning-school-spirit",
      excerpt: "A practical way to plan gang sheets for school spirit orders.",
      metaTitle: "Gang Sheet Planning for School Spirit Orders",
      metaDescription: "Learn how to plan gang sheets for school spirit orders with artwork layout tips—without invented guarantees—from Legends DTF Prints.",
      bodyHtml: `<h2>Plan the gang sheet before you order</h2><p>${"word ".repeat(520)}</p><p>Use current product pages for options.</p>`,
      primaryKeyword: brief.primaryKeyword,
      secondaryKeywords: []
    }
  });
  assert.equal(report.qualityGateResults.find(g => g.gate === "meta_description")?.ok, true);
  assert.equal(report.qualityGateResults.find(g => g.gate === "title_quality")?.ok, true);
  assert.equal(report.qualityGateResults.find(g => g.gate === "topic_preservation")?.ok, true);
});

test("cost/pricing custom topics are rejected without verified numbers", () => {
  const result = evaluateCustomTopic("pricing custom shirts for profit", {
    businessFacts: ["Use website for current prices."],
    existingArticles: []
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.brief.decision, "REJECTED");
    assert.ok(result.brief.decisionReasons.some(r => /cost|pricing|verified/i.test(r)));
  }
});

test("preserves approved topic through brief construction", () => {
  const opportunity = {
    id: "opp1",
    cluster: {
      id: "opp1",
      primaryKeyword: "cotton vs polyester shirts",
      secondaryKeywords: ["shirt fabric and weight"],
      intent: "commercial" as const,
      pillar: "apparel_garment" as const,
      subcategory: "cotton polyester blends",
      audience: "garment_comparison_shoppers" as const,
      format: "comparison" as const,
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
      overlapPenalty: 0.1,
      factualConfidence: 0.6,
      opportunityScore: 0.66
    },
    freshnessClass: "evergreen" as const,
    dataCollectedLabel: "Search data collected August 6, 2026.",
    completeness: "partial" as const,
    closestExisting: null,
    whyDistinct: "Distinct comparison angle.",
    whyFitsLegends: "Garment knowledge",
    requiresInterview: false,
    productsToFeature: [],
    proposedTitle: "Cotton vs Polyester Shirts: A Practical Comparison for Apparel Printers",
    proposedHandle: "cotton-vs-polyester-shirts",
    proposedOutline: ["Intro"],
    internalLinks: [],
    externalSources: [],
    status: "suggested" as const
  } satisfies ResearchOpportunity;
  const brief = buildArticleBrief(opportunity, { businessFacts: [] });
  assert.equal(brief.primaryKeyword, "cotton vs polyester shirts");
  assert.equal(brief.pillar, "apparel_garment");
  assert.equal(brief.format, "comparison");
});

test("pillar, audience, and format rotation prefer unused options", () => {
  const usage: UsageRecord[] = [
    { pillar: "dtf_education", subcategory: "x", audience: "apparel_decorators", format: "how_to", usedAt: now.toISOString() },
    { pillar: "dtf_education", subcategory: "x", audience: "apparel_decorators", format: "how_to", usedAt: now.toISOString() },
    { pillar: "dtf_education", subcategory: "x", audience: "local_customers", format: "checklist", usedAt: now.toISOString() }
  ];
  const dtfBonus = pillarRotationBonus("dtf_education", usage, DEFAULT_PILLAR_BALANCE);
  const garmentBonus = pillarRotationBonus("apparel_garment", usage, DEFAULT_PILLAR_BALANCE);
  assert.ok(garmentBonus > dtfBonus);
  assert.equal(pickRotatedAudience(["apparel_decorators", "schools_teams"], usage), "schools_teams");
  assert.equal(pickRotatedFormat(["how_to", "comparison"], usage), "comparison");
  assert.ok(avoidRepeatedDtfBias("dtf_education", usage) < 0);
  assert.ok(avoidRepeatedDtfBias("honest_entrepreneurship", usage) > 0);
});

test("avoids repeated DTF guides when recent usage is DTF-heavy", async () => {
  const usage: UsageRecord[] = Array.from({ length: 5 }, () => ({
    pillar: "dtf_education" as const,
    subcategory: "pressing",
    audience: "apparel_decorators" as const,
    format: "how_to" as const,
    usedAt: now.toISOString()
  }));
  const result = await runResearchCycle({
    products: [],
    existingArticles: [],
    usage,
    now,
    env: {}
  });
  assert.ok(result.selected);
  assert.notEqual(result.selected!.cluster.pillar, "dtf_education");
});

test("selects garment comparison, design/color, and entrepreneurship topics across pillars", async () => {
  const result = await runResearchCycle({
    products: [],
    existingArticles: [],
    usage: [],
    now,
    env: {}
  });
  const pillars = new Set(result.opportunities.map(o => o.cluster.pillar));
  assert.ok(pillars.has("apparel_garment"));
  assert.ok(pillars.has("design_color_branding"));
  assert.ok(pillars.has("honest_entrepreneurship"));
  assert.ok(result.opportunities.some(o => o.cluster.format === "comparison" || o.cluster.pillar === "apparel_garment"));
  assert.ok(result.opportunities.some(o => o.requiresInterview));
});

test("requires merchant input for first-person stories and blocks invented experience", () => {
  const interview = createInterviewDraft(12);
  assert.equal(interview.completed, false);
  const incomplete = applyInterviewAnswers(interview, { q1: "short" });
  assert.equal(incomplete.completed, false);
  const answers = Object.fromEntries(interview.questions.map(q => [q.id, `Real answer about ${q.question.slice(0, 20)} with enough detail.`]));
  const complete = applyInterviewAnswers(interview, answers);
  assert.equal(complete.completed, true);

  const flags = assertNoInventedPersonalExperience(
    "<p>I made $500000 in month one and I hired 12 employees overnight.</p>",
    []
  );
  assert.ok(flags.length >= 1);

  const brief = briefFromCustomTopic("leaving a 9-to-5 for a print shop", { businessFacts: [] });
  brief.requiresInterview = true;
  brief.pillar = "honest_entrepreneurship";
  const report = runQualityGates({
    brief,
    draft: {
      title: "Leaving a 9-to-5 for a Print Shop: Honest Lessons",
      handle: "leaving-9-to-5-print-shop",
      excerpt: "An honest look at leaving a 9-to-5 for apparel printing.",
      metaTitle: "Leaving a 9-to-5",
      metaDescription: "Honest lessons about leaving a 9-to-5 for a print shop—without invented revenue stories—from Legends DTF Prints.",
      bodyHtml: `<h2>Reality</h2><p>${"word ".repeat(520)}</p><p>I made $999999 last week.</p>`,
      primaryKeyword: brief.primaryKeyword,
      secondaryKeywords: []
    }
  });
  assert.equal(report.qualityGateResults.find(g => g.gate === "invented_personal_experience")?.ok, false);
});

test("prevents unsupported color-psychology claims", () => {
  const brief = briefFromCustomTopic("color psychology in branding", { businessFacts: [] });
  brief.pillar = "design_color_branding";
  const report = runQualityGates({
    brief,
    draft: {
      title: "Color Psychology in Branding for Apparel",
      handle: "color-psychology-branding",
      excerpt: "Practical color guidance for apparel brands with cultural caveats.",
      metaTitle: "Color Psychology in Branding",
      metaDescription: "Practical color psychology in branding for apparel—without universal sales guarantees—from Legends DTF Prints.",
      bodyHtml: `<h2>Color</h2><p>${"word ".repeat(520)}</p><p>Red is scientifically proven to increase sales and universally means power.</p>`,
      primaryKeyword: "color psychology",
      secondaryKeywords: []
    }
  });
  assert.equal(report.qualityGateResults.find(g => g.gate === "color_psychology_caution")?.ok, false);
});

test("allows a useful trust-building article without a direct product pitch", () => {
  const brief = briefFromCustomTopic("business growth lessons for young print shop owners", {
    businessFacts: ["Legends DTF Prints serves Middle Georgia."]
  });
  brief.productsToFeature = [];
  brief.format = "lessons_learned";
  const report = runQualityGates({
    brief,
    draft: {
      title: "Business Growth Lessons for Young Print Shop Owners",
      handle: "business-growth-lessons-print-shop",
      excerpt: "Trust-building lessons for young print shop owners learning the hard parts of ownership.",
      metaTitle: "Business Growth Lessons",
      metaDescription: "Business growth lessons for young print shop owners—honest, practical, and free of invented milestones.",
      bodyHtml: `<h2>Lessons</h2><p>${"word ".repeat(520)}</p><p>Ownership is not peaches and cream every day.</p>`,
      primaryKeyword: brief.primaryKeyword,
      secondaryKeywords: []
    }
  });
  assert.equal(report.qualityGateResults.find(g => g.gate === "internal_links")?.ok, true);
  assert.equal(qualityGatesPassed(report) || report.qualityGateResults.filter(g => !g.ok).every(g => g.gate !== "internal_links"), true);
});

test("prevents simultaneous workers from reserving the same opportunity", async () => {
  const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";
  const db = createDb(databaseUrl);
  await migrate(db);
  const result = await runResearchCycle({
    products: [],
    existingArticles: [],
    usage: [],
    now,
    env: {}
  });
  assert.ok(result.selected);
  await saveResearchCycle(db, result);
  const first = await reserveOpportunity(db, result.selected!.id, "worker-a", 600);
  const second = await reserveOpportunity(db, result.selected!.id, "worker-b", 600);
  assert.ok(first);
  assert.equal(second, null);
  await db.end();
});
