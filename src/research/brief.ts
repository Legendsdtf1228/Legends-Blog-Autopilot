import { clusterSignals } from "./cluster.js";
import { findClosestOverlap, isRejectedByOverlap, type ExistingArticleRef } from "./overlap.js";
import { AUDIENCE_LABELS, DEFAULT_RESEARCH_SETTINGS } from "./pillars.js";
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

  const prohibited = [
    "Do not invent prices, turnaround times, pressing settings, equipment capabilities, or guarantees.",
    "Do not claim a product does something unsupported by Shopify product data or approved business facts.",
    "Do not present color psychology as universal scientific fact.",
    "Do not invent personal entrepreneurship stories, revenue, employees, or milestones."
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

  return {
    productFacts,
    businessFacts: args.businessFacts.slice(0, 20),
    sourcedIndustryFacts: [],
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
  }
): ArticleBrief {
  const settings = args.settings ?? DEFAULT_RESEARCH_SETTINGS;
  const products = (args.products?.length ? args.products : opportunity.productsToFeature).map(p => ({
    ...p,
    description: p.description ?? ""
  }));
  const factSheet = buildLockedFactSheet({
    businessFacts: args.businessFacts,
    products,
    requiresInterview: opportunity.requiresInterview,
    pillar: opportunity.cluster.pillar
  });

  return {
    opportunityId: opportunity.id,
    pillar: opportunity.cluster.pillar,
    subcategory: opportunity.cluster.subcategory,
    audience: opportunity.cluster.audience,
    format: opportunity.cluster.format,
    primaryKeyword: opportunity.cluster.primaryKeyword,
    secondaryKeywords: opportunity.cluster.secondaryKeywords,
    searchIntent: opportunity.cluster.intent,
    targetAudienceLabel: AUDIENCE_LABELS[opportunity.cluster.audience],
    geographicTarget: settings.region,
    demandEvidence: opportunity.completeness === "unavailable"
      ? `${opportunity.dataCollectedLabel} No verified volume/growth metrics were available; ranking used relevance and gap signals only.`
      : `${opportunity.dataCollectedLabel} Opportunity score ${opportunity.scores.opportunityScore}.`,
    dataCollectedLabel: opportunity.dataCollectedLabel,
    estimatedCompetition: opportunity.scores.rankingOpportunity >= 0.6 ? "Moderate/unknown" : "Unknown — provider unavailable",
    conversionRelevance: `Intent ${opportunity.cluster.intent}; conversion score ${opportunity.scores.conversionIntent}.`,
    closestExistingTitle: opportunity.closestExisting?.title ?? null,
    overlapScore: opportunity.closestExisting?.score ?? 0,
    whyDistinct: opportunity.whyDistinct,
    proposedTitle: opportunity.proposedTitle,
    proposedHandle: opportunity.proposedHandle,
    proposedOutline: opportunity.proposedOutline,
    productsToFeature: products,
    internalLinks: opportunity.internalLinks,
    externalSources: opportunity.externalSources,
    freshnessClass: opportunity.freshnessClass,
    requiresInterview: opportunity.requiresInterview,
    factSheet,
    status: "pending_review",
    scores: opportunity.scores
  };
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
  if (!cluster) {
    throw new Error("Unable to build keyword cluster for custom topic");
  }
  return cluster;
}

export type CustomTopicResult =
  | { ok: true; brief: ArticleBrief; overlap: OverlapMatch | null }
  | { ok: false; overlap: OverlapMatch; topic: string; message: string };

/**
 * Build a custom-topic brief only after the same overlap/cannibalization checks
 * used for researched opportunities. Never bypasses duplicate protection.
 */
export function evaluateCustomTopic(topic: string, args: {
  businessFacts: string[];
  existingArticles: ExistingArticleRef[];
  settings?: ResearchSettings;
  products?: FeaturedProduct[];
}): CustomTopicResult {
  const settings = args.settings ?? DEFAULT_RESEARCH_SETTINGS;
  const cluster = clusterFromCustomTopic(topic);
  const overlap = findClosestOverlap(cluster, args.existingArticles);
  if (isRejectedByOverlap(overlap, settings.overlapRejectThreshold)) {
    return {
      ok: false,
      overlap: overlap!,
      topic,
      message: "This topic substantially overlaps an existing article."
    };
  }

  const opportunityLike: ResearchOpportunity = {
    id: `custom:${slug(topic)}`,
    cluster,
    scores: {
      demandScore: 0,
      growthScore: 0,
      businessRelevance: 0.7,
      conversionIntent: 0.5,
      rankingOpportunity: 0.4,
      localRelevance: 0.5,
      freshnessScore: 0.5,
      contentGapScore: overlap ? 1 - overlap.score : 0.7,
      overlapPenalty: overlap?.score ?? 0,
      factualConfidence: 0.5,
      opportunityScore: 0.55
    },
    freshnessClass: "evergreen",
    dataCollectedLabel: `Custom topic entered ${new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "America/New_York"
    })}. No search metrics invented.`,
    completeness: "unavailable",
    closestExisting: overlap,
    whyDistinct: overlap && overlap.score >= 0.45
      ? `Related to “${overlap.title}” but merchant asserts a distinct angle (${cluster.intent} / ${cluster.subcategory}).`
      : "Merchant-entered topic with no close existing match.",
    whyFitsLegends: "Merchant-selected topic pending review.",
    requiresInterview: settings.requireInterviewForFirstPerson &&
      (cluster.format === "first_person_story" ||
        cluster.pillar === "honest_entrepreneurship" ||
        cluster.pillar === "legends_story"),
    productsToFeature: (args.products || []).slice(0, 3),
    proposedTitle: topic,
    proposedHandle: slug(topic),
    proposedOutline: ["Introduction", "Key points", "Practical guidance", "Next steps"],
    internalLinks: (args.products || []).slice(0, 3).map(p => p.url),
    externalSources: [],
    status: "suggested"
  };

  const brief = buildArticleBrief(opportunityLike, {
    businessFacts: args.businessFacts,
    settings,
    products: args.products
  });
  brief.customTopic = topic;
  brief.geographicTarget = settings.region;
  brief.closestExistingTitle = overlap?.title ?? null;
  brief.overlapScore = overlap?.score ?? 0;
  return { ok: true, brief, overlap };
}

/** @deprecated Prefer evaluateCustomTopic — kept for callers that already passed overlap checks. */
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
    throw new Error(`${result.message} Matching: “${result.overlap.title}” (score ${result.overlap.score}).`);
  }
  return result.brief;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "topic";
}
