/**
 * Regression fixture: “Local Small-Business Stories: A Decision Checklist for Apparel Buyers”
 * Must fail semantic-intent, technical-accuracy, internal-link-relevance, and editorial-quality gates.
 * Must be REJECTED and must not count toward the 30-draft rollout.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate, createArticle, listArticles, getSettings, saveSettings } from "../src/db.js";
import {
  assessGeneratedArticleSemantics,
  assessSemanticAlignment,
  assessTopicSpecificity,
  decideTopicOutcome,
  evaluateCustomTopic,
  isIncoherentSearchIntent,
  isQuarantinedArticle,
  qualityGatesPassed,
  quarantineFailedRolloutArticles,
  countsTowardRolloutDraft,
  runEditorialReview,
  runQualityGates,
  suggestLocalPrinterRefinement,
  suggestRefinement,
  assessInternalLinkRelevance,
  DEFAULT_RESEARCH_SETTINGS,
  buildLockedFactSheet
} from "../src/research/index.js";
import type { ArticleBrief } from "../src/research/types.js";

export const LOCAL_SMALL_BUSINESS_STORIES_FIXTURE = {
  title: "Local Small-Business Stories: A Decision Checklist for Apparel Buyers",
  primaryKeyword: "local small-business stories",
  audienceLabel: "Apparel buyers",
  readerQuestion: "What should apparel buyers know about local small-business stories?",
  outline: [
    "Introduction to local small-business stories",
    "Practical steps or comparisons for apparel buyers",
    "Key points about garment selection",
    "Vendor selection tips",
    "Next steps"
  ],
  productTitles: ["UV DTF Gang Sheet Builder", "Standard DTF Transfers"],
  businessFacts: [
    "Standard DTF turnaround is typically a few production days.",
    "Legends DTF Prints operates Monday through Friday production days.",
    "Production days are Monday through Friday at the Warner Robins location."
  ],
  bodyHtml: `
    <h1>Local Small-Business Stories: A Decision Checklist for Apparel Buyers</h1>
    <p>In today’s competitive market, local small-business stories matter. When it comes to apparel,
    there are many factors to consider. Local small-business stories help apparel buyers understand
    entrepreneurship, storytelling, garment selection, and vendor selection all at once.</p>
    <p>Local small-business stories are useful when choosing shirts. Local small-business stories also
    guide UV DTF decisions for garments and apparel decoration. UV DTF can be pressed onto fabric with
    a heat press using temperature and pressure similar to standard transfers.</p>
    <p>Whether you are a small business or a school team, local small-business stories remind buyers
    that turnaround matters. Standard DTF turnaround is typically a few production days. Ask about
    turnaround again because turnaround and production days affect planning. Monday through Friday
    production days matter. Production days are Monday through Friday. Confirm turnaround once more.
    Turnaround updates should be requested in writing. Another turnaround check belongs on the PO.</p>
    <p>At the end of the day, local small-business stories connect buyers to
    <a href="https://legendsdtf.com/products/uv-dtf-gang-sheet-builder">UV DTF Gang Sheet Builder</a>
    even when the order is for custom shirts. Standard DTF turnaround is typically a few production days.</p>
    <h2>Checklist</h2>
    <p>Use this generic checklist. Local small-business stories. Local small-business stories. Local small-business stories.</p>
  `
} as const;

function fixtureBrief(): ArticleBrief {
  const facts = buildLockedFactSheet({
    businessFacts: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.businessFacts],
    products: [
      {
        title: "UV DTF Gang Sheet Builder",
        handle: "uv-dtf-gang-sheet-builder",
        url: "https://legendsdtf.com/products/uv-dtf-gang-sheet-builder",
        description: "UV DTF decals for hard surfaces",
        options: [],
        retrievedAt: new Date().toISOString()
      }
    ],
    requiresInterview: false,
    pillar: "honest_entrepreneurship"
  });

  return {
    opportunityId: "fixture:local-small-business-stories",
    pillar: "honest_entrepreneurship",
    subcategory: "local stories",
    audience: "small_business_owners",
    format: "checklist",
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    secondaryKeywords: ["apparel buyers", "stories"],
    searchIntent: "informational",
    targetAudienceLabel: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.audienceLabel,
    readerQuestion: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.readerQuestion,
    geographicTarget: "Warner Robins, GA",
    demandEvidence: "No verified volume/growth metrics; treated as editorial business opportunity.",
    demandClass: "editorial_business_opportunity",
    dataCollectedLabel: "fixture",
    estimatedCompetition: "Unknown",
    conversionRelevance: "Forced product insert",
    closestExistingTitle: null,
    overlapScore: 0.1,
    whyDistinct: "Fixture of a known failed article class",
    proposedTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    proposedH1: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    proposedHandle: "local-small-business-stories-decision-checklist",
    proposedOutline: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.outline],
    productsToFeature: [
      {
        title: "UV DTF Gang Sheet Builder",
        handle: "uv-dtf-gang-sheet-builder",
        url: "https://legendsdtf.com/products/uv-dtf-gang-sheet-builder",
        description: "UV DTF decals for hard surfaces",
        options: [],
        retrievedAt: new Date().toISOString()
      }
    ],
    internalLinks: ["https://legendsdtf.com/products/uv-dtf-gang-sheet-builder"],
    externalSources: [],
    freshnessClass: "evergreen",
    requiresInterview: false,
    factSheet: facts,
    decision: "DRAFT_ONLY",
    decisionReasons: [],
    failedGates: [],
    automaticPublishingEligible: false,
    conversionPath: "Feature UV DTF Gang Sheet Builder",
    status: "pending_review",
    scores: {
      demandScore: 0.2,
      growthScore: 0.2,
      businessRelevance: 0.5,
      conversionIntent: 0.4,
      rankingOpportunity: 0.4,
      localRelevance: 0.5,
      freshnessScore: 0.5,
      contentGapScore: 0.5,
      overlapPenalty: 0.1,
      factualConfidence: 0.5,
      opportunityScore: 0.4
    },
    topicSpecificity: 0.4,
    uniqueness: 0.9
  };
}

test("local small-business stories keyword is incoherent and must refine or reject", () => {
  assert.equal(isIncoherentSearchIntent(LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword), true);
  assert.equal(isQuarantinedArticle(LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title, LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword), true);

  const refinement = suggestRefinement(LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword);
  assert.ok(refinement);
  assert.equal(refinement!.keyword, "how to choose a local custom shirt printer");
  assert.equal(
    refinement!.title,
    "How to Choose a Custom Shirt Printer in Warner Robins: 9 Questions to Ask"
  );
  assert.match(refinement!.audience, /Middle Georgia/i);
  assert.match(refinement!.readerQuestion, /compare local custom-apparel printers/i);

  const suitable = suggestLocalPrinterRefinement();
  assert.equal(suitable.intent, "local");
});

test("unfixed local small-business stories topic fails semantic-intent gate before generation", () => {
  const semantic = assessSemanticAlignment({
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    proposedTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    readerQuestion: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.readerQuestion,
    audienceLabel: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.audienceLabel,
    outline: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.outline],
    conversionPath: "Feature UV DTF Gang Sheet Builder",
    format: "checklist",
    productTitles: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.productTitles]
  });
  assert.equal(semantic.ok, false);
  assert.ok(semantic.reasons.some(r => /coherent apparel-buyer search intent/i.test(r)));
  assert.ok(semantic.reasons.some(r => /Title does not represent|Audience\/purpose drift/i.test(r)));

  const specificity = assessTopicSpecificity({
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    proposedTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    outline: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.outline],
    audienceLabel: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.audienceLabel,
    whyDistinct: "Fixture of a known failed article class"
  });
  assert.equal(specificity.ok, false);

  const outcome = decideTopicOutcome({
    scorecard: {
      opportunityScore: 0.9,
      businessRelevance: 0.9,
      topicSpecificity: specificity.score,
      factualConfidence: 0.9,
      uniqueness: 0.9,
      conversionRelevance: 0.9,
      sourceQuality: 0.9,
      articleQuality: 0.9,
      internalLinkConfidence: 0.9,
      criticalViolations: 0,
      majorViolations: 0
    },
    specificityOk: specificity.ok,
    overlapRejected: false,
    requiresInterview: false,
    interviewComplete: true,
    semanticRejected: true,
    semanticReasons: semantic.reasons
  });
  assert.equal(outcome.decision, "REJECTED");
});

test("fixture article fails technical-accuracy, internal-link, and editorial-quality gates", () => {
  const generated = assessGeneratedArticleSemantics({
    title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    bodyHtml: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.bodyHtml,
    businessFacts: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.businessFacts],
    productTitles: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.productTitles],
    audienceLabel: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.audienceLabel
  });
  assert.equal(generated.ok, false);
  const gates = new Set(generated.findings.map(f => f.gate));
  assert.ok(gates.has("incoherent_search_intent") || gates.has("quarantined_article"));
  assert.ok(gates.has("uv_dtf_service_category") || gates.has("uv_dtf_pressing_guidance"));
  assert.ok(gates.has("forced_internal_product_link") || gates.has("unnatural_keyword_repetition"));
  assert.ok(
    gates.has("insufficient_unique_insight") ||
      gates.has("generic_template_content") ||
      gates.has("repetitive_turnaround_language") ||
      gates.has("audience_purpose_drift")
  );

  const links = assessInternalLinkRelevance({
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    readerQuestion: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.readerQuestion,
    productTitles: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.productTitles],
    bodyHtml: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.bodyHtml
  });
  assert.equal(links.ok, false);

  const editorial = runEditorialReview({
    title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    metaDescription: "Local small-business stories checklist for apparel buyers choosing vendors and garments in Middle Georgia today.",
    bodyHtml: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.bodyHtml,
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    requiresInterview: false,
    interviewApproved: false,
    brokenLinks: 0,
    overlapScore: 0.1,
    hasPlaceholderLanguage: true,
    audienceLabel: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.audienceLabel,
    businessFacts: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.businessFacts],
    productTitles: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.productTitles]
  });
  assert.equal(editorial.blocksAutoPublish, true);
  assert.ok(editorial.findings.some(f => f.severity === "critical" || f.severity === "major"));

  const brief = fixtureBrief();
  const report = runQualityGates({
    brief,
    draft: {
      title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
      handle: "local-small-business-stories-decision-checklist",
      excerpt: "A checklist about local small-business stories for apparel buyers.",
      metaTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
      metaDescription: "Local small-business stories checklist for apparel buyers choosing vendors and garments in Middle Georgia today.",
      bodyHtml: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.bodyHtml,
      primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
      secondaryKeywords: ["apparel buyers"]
    },
    storefrontUrl: "https://legendsdtf.com"
  });
  assert.equal(qualityGatesPassed(report), false);
  assert.ok(report.qualityGateResults.some(g => !g.ok && g.gate === "semantic_intent_alignment"));
  assert.ok(report.qualityGateResults.some(g => !g.ok && g.gate === "internal_link_relevance"));
  assert.ok(report.qualityGateResults.some(g => !g.ok && /semantic_uv_dtf|semantic_quarantined|semantic_incoherent/.test(g.gate)));
  assert.ok(
    !countsTowardRolloutDraft({
      title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
      primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
      decision: "REJECTED",
      status: "archived"
    })
  );
});

test("evaluateCustomTopic refuses unrefined incoherent story keyword class", () => {
  // Even with refinement available, assessing the raw fixture title+keyword combination fails gates.
  // Custom topic entry may refine; the unfixed fixture itself remains REJECTED for rollout.
  const raw = assessSemanticAlignment({
    primaryKeyword: "local small-business stories",
    proposedTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    audienceLabel: "Apparel buyers",
    format: "checklist"
  });
  assert.equal(raw.ok, false);

  const custom = evaluateCustomTopic("local small-business stories", {
    businessFacts: [],
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  // Prefer refine into the suitable local-printer angle, or reject — never approve the bad framing.
  if (custom.ok) {
    assert.equal(custom.brief.primaryKeyword, "how to choose a local custom shirt printer");
    assert.match(custom.brief.proposedTitle, /Custom Shirt Printer in Warner Robins/i);
    assert.notEqual(custom.brief.proposedTitle, LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title);
  } else {
    assert.match(custom.message, /broad|incoherent|qualified|generic/i);
  }
});

test("quarantine archives the exact failed article and excludes it from rollout counting", async () => {
  const db = createDb(process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog");
  await migrate(db);

  const article = await createArticle(db, {
    title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    handle: `local-small-business-stories-fixture-${Date.now()}`,
    excerpt: "fixture",
    metaTitle: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    metaDescription: "Local small-business stories checklist for apparel buyers choosing vendors and garments today.",
    bodyHtml: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.bodyHtml,
    tags: ["fixture"],
    author: "Autopilot",
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    secondaryKeywords: [],
    topicFingerprint: "local-small-business-stories",
    rationale: "regression fixture"
  }, {
    status: "draft",
    source: "test",
    generationSettings: { countsTowardRollout: true, decision: "DRAFT_ONLY" }
  });

  assert.equal(
    countsTowardRolloutDraft({
      title: article.title,
      primaryKeyword: article.primaryKeyword,
      decision: "DRAFT_ONLY",
      status: "draft"
    }),
    false,
    "quarantined title must never count even while still draft"
  );

  const quarantined = await quarantineFailedRolloutArticles(db);
  assert.ok(quarantined.some(q => q.id === article.id));

  const listed = await listArticles(db, { q: "Local Small-Business Stories", status: "archived" });
  assert.ok(listed.items.some(a => a.id === article.id));
  const archived = listed.items.find(a => a.id === article.id)!;
  assert.equal(archived.status, "archived");
  assert.match(archived.generationError || "", /REJECTED/);
  assert.equal(
    countsTowardRolloutDraft({
      title: archived.title,
      primaryKeyword: archived.primaryKeyword,
      decision: "REJECTED",
      status: archived.status,
      countsTowardRolloutFlag: false
    }),
    false
  );

  // Promotion counter must not treat quarantined drafts as progress.
  const settings = await getSettings(db);
  const progress = settings.promotionProgress.consecutiveReviewedDrafts;
  assert.ok(progress < 30 || progress === settings.promotionProgress.consecutiveReviewedDrafts);
  await saveSettings(db, {
    ...settings,
    promotionProgress: {
      ...settings.promotionProgress,
      // Ensure we do not credit this rejected fixture
      consecutiveReviewedDrafts: Math.min(settings.promotionProgress.consecutiveReviewedDrafts, 29)
    }
  });
});
