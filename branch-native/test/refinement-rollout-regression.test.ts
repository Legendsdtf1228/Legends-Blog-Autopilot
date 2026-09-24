/**
 * PR #7 blockers:
 * 1) Refinement must restart candidate evaluation
 * 2) Rollout progress must use the real counter path
 * 3) Stored quarantined opportunities cannot generate
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate, createArticle, getSettings, saveSettings, updateArticle } from "../src/db.js";
import { defaultSettings } from "../src/defaults.js";
import { recordReviewedDraftForRollout } from "../src/autopilot/rolloutProgress.js";
import {
  applyTopicRefinement,
  DEFAULT_RESEARCH_SETTINGS,
  evaluateCustomTopic,
  isQuarantinedOpportunity,
  quarantineFailedRolloutOpportunities,
  qualityGatesPassed,
  reserveOpportunity,
  runQualityGates,
  runResearchCycle,
  saveEvidenceReport,
  saveResearchCycle,
  selectProductsForKeyword,
  suggestLocalPrinterRefinement
} from "../src/research/index.js";
import type { KeywordCluster, ResearchOpportunity } from "../src/research/types.js";
import { LOCAL_SMALL_BUSINESS_STORIES_FIXTURE } from "./fixtures/local-small-business-stories.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

const STORY_SEED_PRODUCTS = [
  {
    title: "UV DTF Gang Sheet Builder",
    handle: "uv-dtf-gang-sheet-builder",
    url: "https://legendsdtf.com/products/uv-dtf-gang-sheet-builder",
    description: "Hard-surface UV DTF decals"
  },
  {
    title: "Custom DTF Transfers",
    handle: "custom-dtf-transfers",
    url: "https://legendsdtf.com/products/custom-dtf-transfers",
    description: "Apparel DTF transfers"
  },
  {
    title: "Finished Custom Shirts",
    handle: "finished-custom-shirts",
    url: "https://legendsdtf.com/products/finished-custom-shirts",
    description: "Local custom shirt printing"
  }
];

function storySeedCluster(): KeywordCluster {
  return {
    id: "seed-stories",
    primaryKeyword: "local small-business stories",
    secondaryKeywords: ["local small-business stories"],
    intent: "informational",
    pillar: "honest_entrepreneurship",
    subcategory: "business growth lessons",
    audience: "aspiring_entrepreneurs",
    format: "first_person_story",
    signals: [],
    missingProviders: []
  };
}

test("applyTopicRefinement reclassifies local small-business stories into local printer angle", () => {
  const refined = applyTopicRefinement(storySeedCluster(), []);
  const expected = suggestLocalPrinterRefinement();
  assert.equal(refined.primaryKeyword, expected.keyword);
  assert.equal(refined.pillar, "apparel_business");
  assert.ok(refined.intent === "local" || refined.intent === "commercial");
  assert.notEqual(refined.format, "first_person_story");
  assert.ok(["local_customers", "schools_teams", "small_business_owners"].includes(refined.audience));
  assert.notEqual(refined.id, "seed-stories");
});

test("runResearchCycle recomputes every dependent field after refining story seed", async () => {
  const existingArticles = [
    {
      title: "Local Small-Business Stories From Warner Robins",
      primaryKeyword: "local small-business stories",
      topicFingerprint: "local-small-business-stories",
      handle: "local-small-business-stories-old"
    },
    {
      // Related but distinct — proves overlap is computed against the refined topic, not the story seed.
      title: "DTF Transfers vs Embroidery for School Spirit Wear",
      primaryKeyword: "DTF transfers vs embroidery for school spirit wear",
      topicFingerprint: "dtf-vs-embroidery-school",
      handle: "dtf-vs-embroidery-school"
    }
  ];

  const result = await runResearchCycle({
    products: STORY_SEED_PRODUCTS,
    existingArticles,
    usage: [],
    settings: DEFAULT_RESEARCH_SETTINGS,
    env: {},
    now: new Date("2026-08-07T15:00:00.000Z"),
    // Force the discarded seed so we can prove it is refined and fully re-scored.
    extraKeywords: ["local small-business stories"]
  });

  const printerOps = result.opportunities.filter(o =>
    /how to choose a local custom shirt printer/i.test(o.cluster.primaryKeyword)
  );
  assert.ok(printerOps.length >= 1, "refined printer opportunity should appear");
  assert.ok(
    !result.opportunities.some(o =>
      o.decision !== "REJECTED" &&
      /local small-business stories/i.test(o.cluster.primaryKeyword)
    ),
    "unrefined story keyword must not remain as a candidate"
  );

  for (const opp of printerOps) {
    assert.equal(opp.cluster.pillar, "apparel_business");
    assert.ok(opp.cluster.intent === "local" || opp.cluster.intent === "commercial");
    assert.match(opp.proposedTitle, /Custom Shirt Printer in Warner Robins/i);
    assert.match(opp.readerQuestion, /compare local custom-apparel printers/i);
    assert.equal(opp.requiresInterview, false, "refined local-printer topic must not require interview");
    assert.ok(
      !opp.productsToFeature.some(p => /\buv\s*dtf\b/i.test(p.title)),
      "UV DTF links must not survive refinement"
    );
    assert.ok(
      !opp.internalLinks.some(u => /uv-dtf/i.test(u)),
      "internal links must be selected against refined intent"
    );
    // Overlap uses refined topic — closest match should be the printer article when present
    if (opp.closestExisting) {
      assert.ok(
        /shirt printer|custom shirt/i.test(opp.closestExisting.title) ||
          opp.closestExisting.score < 0.72,
        `overlap should describe refined topic, got ${opp.closestExisting.title}`
      );
    }
    assert.ok(opp.scores.localRelevance >= 0.7, "local relevance score must reflect refined local intent");
    assert.ok(opp.scores.conversionIntent >= 0.55, "conversion score must reflect refined commercial/local intent");
    assert.notEqual(opp.cluster.pillar, "honest_entrepreneurship");
  }
});

test("selectProductsForKeyword drops UV DTF for printer-selection intent", () => {
  const selected = selectProductsForKeyword({
    products: STORY_SEED_PRODUCTS,
    primaryKeyword: "how to choose a local custom shirt printer",
    title: "How to Choose a Custom Shirt Printer in Warner Robins: 9 Questions to Ask",
    readerQuestion: "How should I compare local custom-apparel printers before placing an order?"
  });
  assert.ok(!selected.some(p => /\buv\s*dtf\b/i.test(p.title)));
  assert.ok(selected.some(p => /shirt|dtf|transfer/i.test(p.title)));
});

test("stale story-topic links and interview requirements do not survive evaluateCustomTopic refinement", () => {
  const custom = evaluateCustomTopic("local small-business stories", {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS,
    products: STORY_SEED_PRODUCTS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) throw new Error(custom.message);
  assert.equal(custom.brief.primaryKeyword, "how to choose a local custom shirt printer");
  assert.equal(custom.brief.pillar, "apparel_business");
  assert.ok(custom.brief.searchIntent === "local" || custom.brief.searchIntent === "commercial");
  assert.equal(custom.brief.requiresInterview, false);
  assert.match(custom.brief.proposedTitle, /Custom Shirt Printer in Warner Robins/i);
  assert.match(custom.brief.readerQuestion, /compare local custom-apparel printers/i);
  assert.ok(!custom.brief.productsToFeature.some(p => /\buv\s*dtf\b/i.test(p.title)));
  assert.ok(!custom.brief.internalLinks.some(u => /uv-dtf/i.test(u)));
});

test("stored legacy bad opportunities cannot be reserved or generated", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  const badOpp: ResearchOpportunity = {
    id: `legacy-bad-${Date.now()}`,
    cluster: {
      id: "legacy",
      primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
      secondaryKeywords: [],
      intent: "informational",
      pillar: "honest_entrepreneurship",
      subcategory: "stories",
      audience: "aspiring_entrepreneurs",
      format: "checklist",
      signals: [],
      missingProviders: []
    },
    scores: {
      demandScore: 0.5,
      growthScore: 0.5,
      businessRelevance: 0.5,
      conversionIntent: 0.5,
      rankingOpportunity: 0.5,
      localRelevance: 0.5,
      freshnessScore: 0.5,
      contentGapScore: 0.5,
      overlapPenalty: 0,
      factualConfidence: 0.5,
      opportunityScore: 0.8
    },
    freshnessClass: "evergreen",
    dataCollectedLabel: "legacy",
    completeness: "unavailable",
    closestExisting: null,
    whyDistinct: "legacy",
    whyFitsLegends: "legacy",
    requiresInterview: true,
    productsToFeature: [],
    proposedTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    proposedH1: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    proposedHandle: "legacy-bad",
    proposedOutline: ["a", "b", "c", "d"],
    readerQuestion: "legacy",
    topicSpecificity: 0.9,
    uniqueness: 0.9,
    demandClass: "editorial_business_opportunity",
    decision: "DRAFT_ONLY",
    decisionReasons: [],
    failedGates: [],
    internalLinks: [],
    externalSources: [],
    status: "approved"
  };

  await db.query(
    `INSERT INTO research_opportunities(id, payload, status)
     VALUES ($1, $2::jsonb, 'approved')
     ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload, status='approved'`,
    [badOpp.id, JSON.stringify(badOpp)]
  );

  assert.equal(isQuarantinedOpportunity(badOpp), true);

  const quarantined = await quarantineFailedRolloutOpportunities(db);
  assert.ok(quarantined.some(q => q.id === badOpp.id));

  const reserved = await reserveOpportunity(db, badOpp.id, "test-worker");
  assert.equal(reserved, null, "quarantined opportunity must not reserve");

  const { rows } = await db.query<{ status: string; payload: ResearchOpportunity }>(
    `SELECT status, payload FROM research_opportunities WHERE id=$1`,
    [badOpp.id]
  );
  assert.equal(rows[0]?.status, "rejected");
  assert.equal(rows[0]?.payload.decision, "REJECTED");
  await db.end();
});

test("rejected article cannot advance actual rollout progress; eligible advances once; duplicate is idempotent", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  const settings = await getSettings(db);
  const start = settings.promotionProgress.consecutiveReviewedDrafts;
  await saveSettings(db, {
    ...settings,
    enabled: false,
    draftOnlyMode: true,
    rolloutMode: "draft_only",
    promotionProgress: {
      ...settings.promotionProgress,
      consecutiveReviewedDrafts: start,
      autoPublishExplicitlyActivated: false
    }
  });

  // 1) Quarantined / rejected article through real review workflow — must not count
  const rejected = await createArticle(db, {
    title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    handle: `rejected-rollout-${Date.now()}`,
    excerpt: "Rejected fixture article for rollout counter proof.",
    metaTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title.slice(0, 70),
    metaDescription: "Local small-business stories checklist for apparel buyers choosing vendors and garments today.",
    bodyHtml: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.bodyHtml,
    tags: ["fixture"],
    author: "Autopilot",
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    secondaryKeywords: [],
    topicFingerprint: "local-small-business-stories",
    rationale: "regression"
  }, {
    status: "draft",
    source: "test",
    generationSettings: {
      decision: "REJECTED",
      countsTowardRollout: false,
      quarantined: true
    }
  });

  await updateArticle(db, rejected.id, { status: "ready", merchantEdited: true });
  const rejectedAttempt = await recordReviewedDraftForRollout(db, rejected.id, { actor: "test" });
  assert.equal(rejectedAttempt.counted, false);
  assert.ok(rejectedAttempt.reasons.length > 0);
  const afterRejected = (await getSettings(db)).promotionProgress.consecutiveReviewedDrafts;
  assert.equal(afterRejected, start, "rejected/quarantined article must not increase consecutiveReviewedDrafts");

  // 2) Genuinely eligible draft — quality gates pass, merchant marks ready
  const eligibleTitle = "Embroidery vs. DTF Printing: Which Is Better for Work Shirts?";
  const eligibleKeyword = "embroidery vs DTF for work shirts";
  const custom = evaluateCustomTopic(eligibleKeyword, {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) throw new Error(custom.message);

  const paragraph =
    "Small-business owners choosing employee uniforms should compare embroidery and DTF using durability, detail, wash performance, and cost-per-piece criteria before they decide. Ask which method fits daily wear, verify artwork constraints, and choose the option that matches the job. ";
  const bodyHtml = `<h2>Decision criteria for work-shirt decoration</h2><p>${paragraph.repeat(20)}</p><h2>Trade-offs and exceptions</h2><p>${paragraph.repeat(15)}</p><p>When you are ready, review current product options on the storefront.</p>`;
  const metaDescription =
    "Embroidery vs DTF for work shirts: durability, detail, and cost guidance for uniform buyers choosing the right decoration method.";

  const evidence = runQualityGates({
    brief: custom.brief,
    draft: {
      title: eligibleTitle,
      handle: "embroidery-vs-dtf-work-shirts-rollout",
      excerpt: "Compare embroidery and DTF for work shirts with practical buyer guidance.",
      metaTitle: eligibleTitle.slice(0, 70),
      metaDescription,
      bodyHtml,
      primaryKeyword: eligibleKeyword,
      secondaryKeywords: custom.brief.secondaryKeywords
    },
    storefrontUrl: "https://legendsdtf.com"
  });
  assert.equal(qualityGatesPassed(evidence), true, evidence.reviewFlags.join("; "));

  const eligible = await createArticle(db, {
    title: eligibleTitle,
    handle: `eligible-rollout-${Date.now()}`,
    excerpt: "Compare embroidery and DTF for work shirts with practical buyer guidance.",
    metaTitle: eligibleTitle.slice(0, 70),
    metaDescription,
    bodyHtml,
    tags: ["embroidery", "DTF"],
    author: "Autopilot",
    primaryKeyword: eligibleKeyword,
    secondaryKeywords: custom.brief.secondaryKeywords,
    topicFingerprint: "embroidery-vs-dtf-work-shirts",
    rationale: "eligible rollout draft"
  }, {
    status: "draft",
    source: "research",
    generationSettings: {
      decision: "DRAFT_ONLY",
      countsTowardRollout: true,
      quarantined: false
    }
  });

  // Persist evidence required by the advancement path
  await db.query(
    `INSERT INTO research_opportunities(id, payload, status)
     VALUES ($1, $2::jsonb, 'used')
     ON CONFLICT (id) DO NOTHING`,
    [custom.brief.opportunityId, JSON.stringify({ id: custom.brief.opportunityId })]
  );
  const { saveBrief, updateBrief, attachBriefArticle } = await import("../src/research/store.js");
  const savedBrief = await saveBrief(db, { ...custom.brief, status: "generated" });
  await attachBriefArticle(db, savedBrief.id!, eligible.id);
  await saveEvidenceReport(db, eligible.id, savedBrief.id!, evidence);

  await updateArticle(db, eligible.id, { status: "ready", merchantEdited: true });
  const counted = await recordReviewedDraftForRollout(db, eligible.id, { actor: "test" });
  assert.equal(counted.counted, true, counted.reasons.join("; "));
  assert.equal(counted.consecutiveReviewedDrafts, start + 1);

  const afterEligible = (await getSettings(db)).promotionProgress.consecutiveReviewedDrafts;
  assert.equal(afterEligible, start + 1, "eligible approved draft must increase counter exactly once");

  // 3) Duplicate review/progress event is idempotent
  const again = await recordReviewedDraftForRollout(db, eligible.id, { actor: "test" });
  assert.equal(again.counted, false);
  assert.equal(again.alreadyCounted, true);
  const afterDup = (await getSettings(db)).promotionProgress.consecutiveReviewedDrafts;
  assert.equal(afterDup, start + 1, "duplicate review must not double-count");

  // Keep production paused / draft_only
  const finalSettings = await getSettings(db);
  assert.equal(finalSettings.rolloutMode === "auto_publish" ? finalSettings.draftOnlyMode : true, true);
  assert.equal(finalSettings.promotionProgress.autoPublishExplicitlyActivated, false);

  await db.end();
});

test("saveResearchCycle + quarantine blocks previously approved story opportunities before selection", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  const cycle = await runResearchCycle({
    products: STORY_SEED_PRODUCTS,
    existingArticles: [],
    usage: [],
    settings: DEFAULT_RESEARCH_SETTINGS,
    env: {},
    now: new Date("2026-08-07T16:00:00.000Z")
  });
  await saveResearchCycle(db, cycle);

  // Manually inject a legacy approved bad opportunity that predates the gate
  const legacyId = `approved-legacy-${Date.now()}`;
  await db.query(
    `INSERT INTO research_opportunities(id, payload, status)
     VALUES ($1, $2::jsonb, 'approved')`,
    [
      legacyId,
      JSON.stringify({
        id: legacyId,
        proposedTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
        cluster: { primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword },
        decision: "AUTO_ELIGIBLE",
        status: "approved"
      })
    ]
  );

  const rejected = await quarantineFailedRolloutOpportunities(db);
  assert.ok(rejected.some(r => r.id === legacyId));
  const reserved = await reserveOpportunity(db, legacyId, "scheduler");
  assert.equal(reserved, null);
  await db.end();
});
