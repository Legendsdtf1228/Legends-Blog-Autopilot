import { detectIntentFromKeyword, validateOrReclassify } from "./classification.js";
import { clusterSignals } from "./cluster.js";
import { findClosestOverlap, isRejectedByOverlap, type ExistingArticleRef } from "./overlap.js";
import { AUDIENCE_LABELS, DEFAULT_RESEARCH_SETTINGS, pillarById } from "./pillars.js";
import { selectProductsForKeyword } from "./productSelection.js";
import { isIncoherentSearchIntent } from "./semanticIntent.js";
import { assessTopicSpecificity, buildTopicSpecificOutline, suggestRefinement } from "./specificity.js";
import { buildSeoDeliverables } from "./seo.js";
import type {
  ArticleBrief,
  FeaturedProduct,
  LockedFactSheet,
  OverlapMatch,
  ResearchOpportunity,
  ResearchSettings,
  ResearchSignal
} from "./types.js";

export function buildLockedFactSheet(args: {
  businessFacts: string[];
  products: FeaturedProduct[];
  requiresInterview: boolean;
  pillar: string;
  externalFacts?: LockedFactSheet["externalFacts"];
}): LockedFactSheet {
  const productFacts = args.products.flatMap(p => {
    const facts = [
      `Product “${p.title}” is available at ${p.url}.`,
      p.handle ? `Shopify handle: ${p.handle}.` : null,
      p.productType ? `Shopify product type: ${p.productType}.` : null,
      p.options?.length ? `Shopify options/variants: ${p.options.join(" | ")}.` : null,
      p.retrievedAt ? `Shopify product facts retrieved ${p.retrievedAt}.` : null
    ].filter((f): f is string => Boolean(f));

    if (p.description?.trim()) {
      facts.push(`Approved Shopify description for ${p.title}: ${p.description.trim().slice(0, 500)}`);
    } else {
      facts.push(
        `No additional Shopify description was available for ${p.title}; do not invent product capabilities from the name or URL alone.`
      );
    }
    return facts;
  });

  const legendsFacts = [
    ...args.businessFacts.slice(0, 20),
    ...productFacts
  ];

  const prohibited = [
    "Do not invent prices, turnaround times, pressing settings, equipment capabilities, or guarantees.",
    "Do not claim a product does something unsupported by Shopify product data or approved business facts.",
    "Do not present color psychology as universal scientific fact.",
    "Do not invent personal entrepreneurship stories, revenue, employees, or milestones.",
    "Do not label topics popular/trending/high-volume without verified demand metrics."
  ];

  const reviewFlags: string[] = [];
  if (args.requiresInterview) {
    reviewFlags.push("First-person story requires completed merchant interview answers before generation.");
  }
  if (args.pillar === "design_color_branding") {
    reviewFlags.push("Color-psychology claims need cautious, non-universal framing.");
  }
  if (args.pillar === "apparel_garment") {
    reviewFlags.push("Garment specifications require current manufacturer/supplier sources; flag stale specs.");
  }

  const externalFacts = args.externalFacts ?? [];
  return {
    legendsFacts,
    productFacts,
    businessFacts: args.businessFacts.slice(0, 20),
    externalFacts,
    sourcedIndustryFacts: externalFacts.map(f => ({
      claim: f.claim,
      url: f.sourceUrl,
      retrievedAt: f.retrievedAt
    })),
    prohibitedClaims: prohibited,
    reviewFlags
  };
}

export function buildArticleBrief(
  opportunity: ResearchOpportunity,
  args: {
    businessFacts: string[];
    settings?: ResearchSettings;
    products?: FeaturedProduct[];
    storefrontUrl?: string;
    blogHandle?: string;
  }
): ArticleBrief {
  const settings = args.settings ?? DEFAULT_RESEARCH_SETTINGS;
  // Prefer opportunity-selected products (already intent-filtered). Never reintroduce
  // the full catalog, which can revive unrelated links from a discarded seed framing.
  const sourceProducts = opportunity.productsToFeature.length
    ? opportunity.productsToFeature
    : selectProductsForKeyword({
        products: args.products || [],
        primaryKeyword: opportunity.cluster.primaryKeyword,
        secondaryKeywords: opportunity.cluster.secondaryKeywords,
        title: opportunity.proposedTitle,
        readerQuestion: opportunity.readerQuestion,
        limit: 3
      });
  const products = sourceProducts.map(p => ({
    ...p,
    description: p.description ?? ""
  }));
  const factSheet = buildLockedFactSheet({
    businessFacts: args.businessFacts,
    products,
    requiresInterview: opportunity.requiresInterview,
    pillar: opportunity.cluster.pillar,
    externalFacts: opportunity.externalSources.map(s => ({
      claim: s.note,
      sourceTitle: s.title || s.note,
      sourceUrl: s.url,
      publisher: s.publisher || "external",
      retrievedAt: s.retrievedAt,
      freshness: opportunity.freshnessClass
    }))
  });

  const partial = {
    opportunityId: opportunity.id,
    pillar: opportunity.cluster.pillar,
    subcategory: opportunity.cluster.subcategory,
    audience: opportunity.cluster.audience,
    format: opportunity.cluster.format,
    primaryKeyword: opportunity.cluster.primaryKeyword,
    secondaryKeywords: opportunity.cluster.secondaryKeywords,
    searchIntent: opportunity.cluster.intent,
    targetAudienceLabel: AUDIENCE_LABELS[opportunity.cluster.audience],
    readerQuestion: opportunity.readerQuestion,
    geographicTarget: settings.region,
    demandEvidence: opportunity.dataCollectedLabel,
    demandClass: opportunity.demandClass,
    dataCollectedLabel: opportunity.dataCollectedLabel,
    estimatedCompetition: opportunity.scores.rankingOpportunity >= 0.6 ? "Moderate/unknown" : "Unknown — provider unavailable",
    conversionRelevance: `Intent ${opportunity.cluster.intent}; conversion score ${opportunity.scores.conversionIntent}.`,
    closestExistingTitle: opportunity.closestExisting?.title ?? null,
    overlapScore: opportunity.closestExisting?.score ?? 0,
    whyDistinct: opportunity.whyDistinct,
    proposedTitle: opportunity.proposedTitle,
    proposedH1: opportunity.proposedH1 || opportunity.proposedTitle,
    proposedHandle: opportunity.proposedHandle,
    proposedOutline: opportunity.proposedOutline,
    productsToFeature: products,
    internalLinks: products.map(p => p.url).length ? products.map(p => p.url) : opportunity.internalLinks,
    externalSources: opportunity.externalSources,
    freshnessClass: opportunity.freshnessClass,
    requiresInterview: opportunity.requiresInterview,
    factSheet,
    decision: opportunity.decision,
    decisionReasons: opportunity.decisionReasons,
    failedGates: opportunity.failedGates,
    automaticPublishingEligible: opportunity.decision === "AUTO_ELIGIBLE",
    conversionPath: products.length
      ? `Feature ${products.map(p => p.title).join(", ")} and point to current product pages for options.`
      : "Trust-building article; no direct product pitch required.",
    status: "pending_review" as const,
    scores: opportunity.scores,
    topicSpecificity: opportunity.topicSpecificity,
    uniqueness: opportunity.uniqueness
  };

  const seoDeliverables = buildSeoDeliverables({
    brief: partial,
    storefrontUrl: args.storefrontUrl || "https://legendsdtf.com",
    blogHandle: args.blogHandle || "news"
  });

  return { ...partial, seoDeliverables };
}

export function clusterFromCustomTopic(topic: string, collectedAt = new Date()): ReturnType<typeof clusterSignals>[number] {
  const signal: ResearchSignal = {
    provider: "seed_catalog",
    collectedAt: collectedAt.toISOString(),
    dataPeriodStart: null,
    dataPeriodEnd: null,
    geographicRegion: "custom",
    keyword: topic,
    topic,
    volume: null,
    relativeInterest: null,
    growth: null,
    competition: null,
    sourceUrl: null,
    completeness: "unavailable",
    notes: "Merchant-entered custom topic"
  };
  const clusters = clusterSignals([signal], []);
  const cluster = clusters[0];
  if (!cluster) throw new Error("Unable to build keyword cluster for custom topic");
  return cluster;
}

export type CustomTopicResult =
  | { ok: true; brief: ArticleBrief; overlap: OverlapMatch | null }
  | { ok: false; overlap: OverlapMatch; topic: string; message: string }
  | { ok: false; overlap: null; topic: string; message: string; specificityReasons: string[] };

export function evaluateCustomTopic(topic: string, args: {
  businessFacts: string[];
  existingArticles: ExistingArticleRef[];
  settings?: ResearchSettings;
  products?: FeaturedProduct[];
}): CustomTopicResult {
  const settings = args.settings ?? DEFAULT_RESEARCH_SETTINGS;
  let cluster = clusterFromCustomTopic(topic);
  const refinement = suggestRefinement(topic);
  const shouldRefine =
    Boolean(refinement) &&
    (topic.trim().split(/\s+/).length <= 2 ||
      /\blocal small-?business stories\b/i.test(topic) ||
      /\bstories\b/i.test(topic) ||
      isIncoherentSearchIntent(topic));
  if (shouldRefine && refinement) {
    // Rebuild cluster from refined keyword so pillar/intent/format are not stale.
    cluster = clusterFromCustomTopic(refinement.keyword);
    const classified = validateOrReclassify(refinement.keyword, {
      pillar: cluster.pillar,
      subcategory: cluster.subcategory
    });
    cluster.pillar = classified.pillar;
    cluster.subcategory = classified.subcategory;
    cluster.intent =
      refinement.intent === "local" || refinement.intent === "commercial"
        ? refinement.intent
        : detectIntentFromKeyword(refinement.keyword);
    const pillarDef = pillarById(cluster.pillar);
    if (pillarDef.formats.includes("checklist")) cluster.format = "checklist";
    else if (pillarDef.formats.includes("how_to")) cluster.format = "how_to";
    if (pillarDef.audiences.includes("local_customers")) cluster.audience = "local_customers";
  }

  // Overlap / uniqueness must use the refined cluster only.
  const overlap = findClosestOverlap(cluster, args.existingArticles);
  if (isRejectedByOverlap(overlap, settings.overlapRejectThreshold)) {
    return {
      ok: false,
      overlap: overlap!,
      topic,
      message: "This topic substantially overlaps an existing article."
    };
  }

  const readerQuestion = shouldRefine && refinement?.readerQuestion
    ? refinement.readerQuestion
    : `What should readers know about ${cluster.primaryKeyword}?`;
  const proposedTitle = shouldRefine && refinement?.title
    ? refinement.title
    : `${cluster.primaryKeyword.replace(/\b\w/g, c => c.toUpperCase())}: What Buyers Should Know`;
  const outline = buildTopicSpecificOutline(cluster, readerQuestion);
  const specificity = assessTopicSpecificity({
    primaryKeyword: cluster.primaryKeyword,
    proposedTitle,
    outline,
    audienceLabel: (shouldRefine && refinement?.audience) || AUDIENCE_LABELS[cluster.audience],
    whyDistinct: "Merchant-entered topic"
  });

  const stillIncoherent =
    /\blocal small-?business stories\b/i.test(cluster.primaryKeyword) ||
    (/\bstories\b/i.test(cluster.primaryKeyword) && !shouldRefine);

  if (stillIncoherent || specificity.score < settings.minTopicSpecificity || !specificity.ok) {
    return {
      ok: false,
      overlap: null,
      topic,
      message: specificity.refinedKeyword
        ? `Topic is too broad or incoherent. Try a qualified angle such as “${specificity.refinedKeyword}”.`
        : "Topic is too broad, incoherent, or generic to generate a useful article.",
      specificityReasons: specificity.reasons
    };
  }

  const productsToFeature = selectProductsForKeyword({
    products: args.products || [],
    primaryKeyword: cluster.primaryKeyword,
    secondaryKeywords: cluster.secondaryKeywords,
    title: proposedTitle,
    readerQuestion,
    limit: 3
  });

  const requiresInterview = settings.requireInterviewForFirstPerson &&
    (cluster.format === "first_person_story" ||
      cluster.pillar === "honest_entrepreneurship" ||
      cluster.pillar === "legends_story");

  const opportunityLike: ResearchOpportunity = {
    id: `custom:${slug(cluster.primaryKeyword)}`,
    cluster,
    scores: {
      demandScore: 0,
      growthScore: 0,
      businessRelevance: 0.7,
      conversionIntent: cluster.intent === "local" || cluster.intent === "commercial" ? 0.7 : 0.5,
      rankingOpportunity: 0.4,
      localRelevance: /\blocal|warner|georgia\b/i.test(cluster.primaryKeyword + proposedTitle) ? 0.9 : 0.5,
      freshnessScore: 0.5,
      contentGapScore: overlap ? 1 - overlap.score : 0.7,
      overlapPenalty: overlap?.score ?? 0,
      factualConfidence: 0.5,
      opportunityScore: 0.55
    },
    freshnessClass: "evergreen",
    dataCollectedLabel: `Custom topic entered ${new Date().toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York"
    })}. No search metrics invented.`,
    completeness: "unavailable",
    closestExisting: overlap,
    whyDistinct: overlap && overlap.score >= 0.45
      ? `Related to “${overlap.title}” but merchant asserts a distinct angle.`
      : "Merchant-entered topic with no close existing match.",
    whyFitsLegends: "Merchant-selected topic pending review.",
    requiresInterview,
    productsToFeature,
    proposedTitle,
    proposedH1: proposedTitle,
    proposedHandle: slug(proposedTitle),
    proposedOutline: outline,
    readerQuestion,
    topicSpecificity: specificity.score,
    uniqueness: 1 - (overlap?.score ?? 0),
    demandClass: "editorial_business_opportunity",
    decision: "DRAFT_ONLY",
    decisionReasons: ["Merchant-entered topic; draft-only until gates pass."],
    failedGates: [],
    internalLinks: productsToFeature.map(p => p.url),
    externalSources: [],
    status: "suggested"
  };

  const brief = buildArticleBrief(opportunityLike, {
    businessFacts: args.businessFacts,
    settings,
    products: args.products
  });
  brief.customTopic = topic;
  return { ok: true, brief, overlap };
}

export function briefFromCustomTopic(topic: string, args: {
  businessFacts: string[];
  settings?: ResearchSettings;
  products?: FeaturedProduct[];
  existingArticles?: ExistingArticleRef[];
}): ArticleBrief {
  const result = evaluateCustomTopic(topic, {
    businessFacts: args.businessFacts,
    settings: args.settings,
    products: args.products,
    existingArticles: args.existingArticles ?? []
  });
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.brief;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "topic";
}
