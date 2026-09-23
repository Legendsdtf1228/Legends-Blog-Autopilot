import test from "node:test";
import assert from "node:assert/strict";
import {
  assessTopicSpecificity,
  classifyTopic,
  decideTopicOutcome,
  DEFAULT_AUTO_THRESHOLDS,
  detectPillar,
  evaluateCustomTopic,
  isPlaceholderOutline,
  qualityGatesPassed,
  runEditorialReview,
  runQualityGates,
  runResearchCycle,
  scorecardFromOpportunity,
  suggestRefinement,
  validateInternalLinks,
  DEFAULT_RESEARCH_SETTINGS
} from "../src/research/index.js";
import {
  canAutoPublish,
  canGenerateArticles,
  canRunResearch,
  killSwitchFromCondition,
  promotionAllowsAutoPublish,
  recordsShadowDecision
} from "../src/autopilot/rollout.js";
import { dueResearchSlots, dueSlots } from "../src/scheduler.js";
import { defaultSettings } from "../src/defaults.js";
import { buildSeoDeliverables } from "../src/research/seo.js";
import { rejectUnrelatedProductLink } from "../src/research/links.js";
import { ARTICLE_CREATE_MUTATION, ARTICLE_UPDATE_MUTATION, mapArticleCreateResult } from "../src/shopify.js";
import { DateTime } from "luxon";

test("embroidery is not classified as DTF education", () => {
  const c = classifyTopic("embroidery");
  assert.equal(c.pillar, "apparel_garment");
  assert.equal(c.subcategory, "embroidery");
  const d = detectPillar("embroidery");
  assert.equal(d.pillar, "apparel_garment");
  assert.notEqual(d.pillar, "dtf_education");
});

test("classification maps comparison, garment, design, business, entrepreneurship topics", () => {
  assert.equal(classifyTopic("embroidery vs DTF for work shirts").subcategory, "decoration comparison");
  assert.equal(classifyTopic("color psychology in branding").pillar, "design_color_branding");
  assert.equal(classifyTopic("best T-shirt brands for printing").pillar, "apparel_garment");
  assert.equal(classifyTopic("pricing custom shirts").pillar, "apparel_business");
  assert.equal(classifyTopic("leaving a 9-to-5").pillar, "honest_entrepreneurship");
});

test("broad embroidery topic is rejected or refined", () => {
  const specificity = assessTopicSpecificity({
    primaryKeyword: "embroidery",
    proposedTitle: "A Practical Guide to Embroidery",
    outline: ["Practical steps or comparisons", "Key points", "Introduction"],
    audienceLabel: "everyone"
  });
  assert.equal(specificity.ok, false);
  assert.ok(specificity.refinedKeyword?.includes("embroidery vs DTF"));
  assert.ok(suggestRefinement("embroidery"));

  const custom = evaluateCustomTopic("embroidery", {
    businessFacts: [],
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  // Either refined into a qualified topic (ok) or rejected as too broad
  if (!custom.ok) {
    assert.match(custom.message, /broad|qualified|generic/i);
  } else {
    assert.ok(custom.brief.primaryKeyword.split(/\s+/).length >= 3);
    assert.ok(!/^a practical guide to\b/i.test(custom.brief.proposedTitle));
  }
});

test("specific embroidery-vs-DTF commercial topic passes specificity", () => {
  const keyword = "embroidery vs DTF for work shirts";
  const title = "Embroidery vs. DTF Printing: Which Is Better for Work Shirts?";
  const outline = [
    "What embroidery vs DTF means for small-business owners choosing work-shirt decoration",
    "Answer the reader question: Should I choose embroidery or DTF printing for employee work shirts?",
    "Compare durability, detail, cost-per-piece, and turnaround for workwear",
    "Common mistakes when mixing methods on uniforms",
    "How Legends DTF Prints in Warner Robins can help next"
  ];
  const result = assessTopicSpecificity({
    primaryKeyword: keyword,
    proposedTitle: title,
    outline,
    audienceLabel: "Small-business owners purchasing employee uniforms",
    whyDistinct: "Commercial comparison focused on work shirts, not a general embroidery primer."
  });
  assert.ok(result.score >= 0.85, `expected specificity >= 0.85, got ${result.score}`);
  assert.equal(detectPillar(keyword).pillar, "apparel_garment");
});

test("generic title and placeholder outline are rejected", () => {
  assert.equal(
    assessTopicSpecificity({
      primaryKeyword: "gang sheet planning for schools",
      proposedTitle: "A Practical Guide to Gang Sheet Planning for Schools",
      outline: ["Introduction", "Practical steps or comparisons", "Key points"]
    }).ok,
    false
  );
  assert.equal(isPlaceholderOutline(["Practical steps or comparisons", "Key points", "Next steps"]), true);
});

test("weak middling score cannot become AUTO_ELIGIBLE", () => {
  const scorecard = scorecardFromOpportunity({
    scores: {
      demandScore: 0.4,
      growthScore: 0.4,
      businessRelevance: 0.6,
      conversionIntent: 0.5,
      rankingOpportunity: 0.4,
      localRelevance: 0.5,
      freshnessScore: 0.4,
      contentGapScore: 0.5,
      overlapPenalty: 0.2,
      factualConfidence: 0.5,
      opportunityScore: 0.5497
    },
    topicSpecificity: 0.9,
    uniqueness: 0.9,
    sourceQuality: 0.7,
    articleQuality: 0.95,
    internalLinkConfidence: 0.8
  });
  const decision = decideTopicOutcome({
    scorecard,
    thresholds: DEFAULT_AUTO_THRESHOLDS,
    requiresInterview: false,
    interviewComplete: false,
    specificityOk: true,
    overlapRejected: false
  });
  assert.notEqual(decision.decision, "AUTO_ELIGIBLE");
  assert.equal(decision.decision, "DRAFT_ONLY");
});

test("no verified metrics are invented in research cycle labels", async () => {
  const result = await runResearchCycle({
    products: [],
    existingArticles: [],
    usage: [],
    env: {},
    now: new Date("2026-08-06T15:00:00Z")
  });
  for (const opp of result.opportunities.slice(0, 10)) {
    assert.notEqual(opp.demandClass, "verified_demand");
    assert.doesNotMatch(opp.dataCollectedLabel, /\b(popular|trending|high volume)\b/i);
  }
  if (!result.selected) {
    assert.equal(result.cycleDecision, "SKIPPED_NO_QUALIFIED_TOPIC");
  }
});

test("first-person content requires approved merchant material", () => {
  const review = runEditorialReview({
    title: "Leaving a 9-to-5 for a Print Shop",
    metaDescription: "Honest lessons about leaving a 9-to-5 for apparel printing without invented milestones from Legends.",
    bodyHtml: "<h2>Story</h2><p>I quit my job and my revenue hit six figures in month two.</p>",
    primaryKeyword: "leaving a 9-to-5",
    requiresInterview: true,
    interviewApproved: false,
    brokenLinks: 0,
    overlapScore: 0.1,
    hasPlaceholderLanguage: false
  });
  assert.equal(review.blocksAutoPublish, true);
  assert.ok(review.findings.some(f => f.gate === "first_person_source" && f.severity === "critical"));
});

test("broken internal link blocks publication", () => {
  const links = validateInternalLinks([
    { url: "https://evil.example/products/x", title: "Bad", kind: "product", anchorText: "Bad" }
  ], "https://legendsdtf.com");
  assert.ok(links.broken >= 1);
  assert.equal(links.confidence, 0);
});

test("source-free technical overclaims are blocked by editorial review", () => {
  const review = runEditorialReview({
    title: "Color Psychology in Branding for Apparel Teams",
    metaDescription: "Practical color psychology guidance for apparel branding without universal sales guarantees from Legends.",
    bodyHtml: "<h2>Color</h2><p>Red is scientifically proven to increase sales and universally means power.</p>",
    primaryKeyword: "color psychology",
    requiresInterview: false,
    interviewApproved: false,
    brokenLinks: 0,
    overlapScore: 0.1,
    hasPlaceholderLanguage: false
  });
  assert.ok(review.findings.some(f => f.severity === "major" || f.severity === "critical"));
  assert.equal(review.blocksAutoPublish, true);
});

test("approved stable Legends facts can power quality gates without invented demand", () => {
  const brief = evaluateCustomTopic("cotton vs polyester shirts for school spirit wear", {
    businessFacts: ["Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia."],
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(brief.ok, true);
  if (!brief.ok) return;
  const report = runQualityGates({
    brief: brief.brief,
    draft: {
      title: "Cotton vs Polyester Shirts for School Spirit Wear",
      handle: "cotton-vs-polyester-school-spirit",
      excerpt: "How schools can choose cotton or polyester for spirit wear with practical print considerations.",
      metaTitle: "Cotton vs Polyester for Spirit Wear",
      metaDescription: "Compare cotton vs polyester shirts for school spirit wear with practical print guidance from Legends DTF Prints.",
      bodyHtml: `<h2>Fabric choice</h2><p>${"word ".repeat(520)}</p><p>Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia.</p>`,
      primaryKeyword: brief.brief.primaryKeyword,
      secondaryKeywords: []
    }
  });
  assert.ok(report.legendsFactsUsed.length >= 1);
  assert.equal(report.qualityGateResults.find(g => g.gate === "invented_demand_language")?.ok, true);
});

test("major or critical review findings block publication helpers", () => {
  const briefOk = evaluateCustomTopic("gang sheet planning for school spirit orders", {
    businessFacts: [],
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(briefOk.ok, true);
  if (!briefOk.ok) return;
  briefOk.brief.decision = "AUTO_ELIGIBLE";
  const report = runQualityGates({
    brief: briefOk.brief,
    draft: {
      title: "A Practical Guide to Gang Sheets",
      handle: "practical-guide-gang-sheets",
      excerpt: "Generic draft",
      metaTitle: "Guide",
      metaDescription: "short",
      bodyHtml: "<p>guaranteed best in the world</p>",
      primaryKeyword: "gang sheets",
      secondaryKeywords: []
    }
  });
  assert.equal(qualityGatesPassed(report), false);
});

test("rollout modes gate research, generation, and publishing", () => {
  assert.equal(canRunResearch("paused"), false);
  assert.equal(canRunResearch("observe"), true);
  assert.equal(canGenerateArticles("observe"), false);
  assert.equal(canGenerateArticles("draft_only"), true);
  assert.equal(canAutoPublish("draft_only"), false);
  assert.equal(canAutoPublish("shadow_auto"), false);
  assert.equal(recordsShadowDecision("shadow_auto"), true);
  assert.equal(canAutoPublish("auto_publish"), true);
});

test("kill-switch conditions pause publishing with recovery steps", () => {
  const kill = killSwitchFromCondition("incomplete_inventory");
  assert.equal(kill.paused, true);
  assert.match(kill.reason || "", /inventory/i);
  assert.ok(kill.recoveryStep);
});

test("DRAFT_ONLY defaults remain safe; research cadence supports twice daily", () => {
  assert.equal(defaultSettings.rolloutMode, "draft_only");
  assert.equal(defaultSettings.draftOnlyMode, true);
  assert.equal(defaultSettings.enabled, false);
  assert.equal(defaultSettings.researchCadence, "twice_daily");
  const now = DateTime.fromISO("2026-08-06T17:00:00", { zone: "America/New_York" });
  const researchSlots = dueResearchSlots(now, {
    ...defaultSettings,
    research: { ...defaultSettings.research, enabled: true },
    rolloutMode: "draft_only",
    killSwitch: { ...defaultSettings.killSwitch, paused: false }
  });
  assert.ok(researchSlots.length >= 1);
  assert.ok(researchSlots.every(s => s.key.startsWith("research:")));
  assert.deepEqual(dueSlots(now, { ...defaultSettings, enabled: false }), []);
});

test("duplicate scheduled research slot keys are stable/idempotent", () => {
  const now = DateTime.fromISO("2026-08-06T17:00:00", { zone: "America/New_York" });
  const a = dueResearchSlots(now, defaultSettings);
  const b = dueResearchSlots(now, defaultSettings);
  assert.deepEqual(a.map(s => s.key), b.map(s => s.key));
});

test("unrelated product link is rejected", () => {
  const rejected = rejectUnrelatedProductLink({
    productTitle: "UV DTF Cup Wraps Assortment",
    primaryKeyword: "embroidery vs DTF for work shirts",
    secondaryKeywords: ["work shirts", "embroidery"]
  });
  assert.equal(rejected, true);
  const related = rejectUnrelatedProductLink({
    productTitle: "DTF Transfers for Work Shirts",
    primaryKeyword: "embroidery vs DTF for work shirts",
    secondaryKeywords: ["work shirts", "embroidery"]
  });
  assert.equal(related, false);
});

test("SEO deliverables include canonical, image brief, and structured data", () => {
  const brief = evaluateCustomTopic("embroidery vs DTF for work shirts", {
    businessFacts: [],
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(brief.ok, true);
  if (!brief.ok) return;
  const seo = buildSeoDeliverables({
    brief: brief.brief,
    storefrontUrl: "https://legendsdtf.com",
    blogHandle: "news"
  });
  assert.match(seo.canonicalUrl || "", /\/blogs\/news\//);
  assert.ok(seo.imageBrief.length > 20);
  assert.ok(seo.imageAltText.length > 5);
  assert.equal(seo.structuredDataRecommendation.type, "BlogPosting");
});

test("SHADOW_AUTO records decisions and cannot auto-publish", () => {
  assert.equal(recordsShadowDecision("shadow_auto"), true);
  assert.equal(canAutoPublish("shadow_auto"), false);
  assert.equal(canGenerateArticles("shadow_auto"), true);
});

test("AUTO_PUBLISH requires promotion gates and explicit activation path", () => {
  const blocked = promotionAllowsAutoPublish({
    consecutiveReviewedDrafts: 2,
    merchantApprovalRate: 0.5,
    shadowAutoDays: 1
  });
  assert.equal(blocked.ok, false);
  const ready = promotionAllowsAutoPublish({
    consecutiveReviewedDrafts: 30,
    merchantApprovalRate: 0.9,
    shadowAutoDays: 14
  });
  assert.equal(ready.ok, true);
  assert.equal(defaultSettings.promotionProgress.autoPublishExplicitlyActivated, false);
  assert.equal(defaultSettings.rolloutMode, "draft_only");
});

test("Shopify articleUpdate mutation exists and create path never uses onlineStoreUrl", () => {
  assert.match(ARTICLE_UPDATE_MUTATION, /articleUpdate/);
  assert.equal(ARTICLE_UPDATE_MUTATION.includes("onlineStoreUrl"), false);
  assert.equal(ARTICLE_CREATE_MUTATION.includes("onlineStoreUrl"), false);
  const mapped = mapArticleCreateResult({
    created: {
      id: "gid://shopify/Article/1",
      handle: "existing-post",
      title: "Existing",
      isPublished: true,
      publishedAt: "2026-08-01T00:00:00Z",
      blog: { id: "gid://shopify/Blog/1", handle: "news" }
    },
    storefrontUrl: "https://legendsdtf.com",
    responseStatus: "updated"
  });
  assert.equal(mapped.responseStatus, "updated");
  assert.equal(mapped.url, "https://legendsdtf.com/blogs/news/existing-post");
});

test("frequency defaults keep research and publish limits separate", () => {
  assert.equal(defaultSettings.researchCadence, "twice_daily");
  assert.equal(defaultSettings.frequencyLimits.maxArticlesPerCycle, 1);
  assert.equal(defaultSettings.frequencyLimits.maxPublishedPerRolling7Days, 5);
  assert.equal(defaultSettings.enabled, false);
});

test("kill switch maps consecutive failures and duplicate create", () => {
  assert.match(killSwitchFromCondition("consecutive_failures").reason || "", /Consecutive/);
  assert.match(killSwitchFromCondition("duplicate_shopify_create").reason || "", /Duplicate/);
  assert.match(killSwitchFromCondition("frequency_limit").recoveryStep || "", /rolling window/i);
});
