import type { ArticleBrief, LockedFactSheet, ResearchOpportunity, ResearchSettings } from "./types.js";
import { AUDIENCE_LABELS, DEFAULT_RESEARCH_SETTINGS } from "./pillars.js";

export function buildLockedFactSheet(args: {
  businessFacts: string[];
  products: Array<{ title: string; url: string; description?: string }>;
  requiresInterview: boolean;
  pillar: string;
}): LockedFactSheet {
  const productFacts = args.products.flatMap(p => {
    const facts = [`Product “${p.title}” is available at ${p.url}.`];
    if (p.description?.trim()) {
      facts.push(`Approved product description excerpt for ${p.title}: ${p.description.trim().slice(0, 240)}`);
    } else {
      facts.push(`No additional Shopify description was available for ${p.title}; do not invent product capabilities from the name alone.`);
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
  }
): ArticleBrief {
  const settings = args.settings ?? DEFAULT_RESEARCH_SETTINGS;
  const factSheet = buildLockedFactSheet({
    businessFacts: args.businessFacts,
    products: opportunity.productsToFeature.map(p => ({ ...p, description: undefined })),
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
    productsToFeature: opportunity.productsToFeature,
    internalLinks: opportunity.internalLinks,
    externalSources: opportunity.externalSources,
    freshnessClass: opportunity.freshnessClass,
    requiresInterview: opportunity.requiresInterview,
    factSheet,
    status: "pending_review",
    scores: opportunity.scores
  };
}

export function briefFromCustomTopic(topic: string, args: {
  businessFacts: string[];
  settings?: ResearchSettings;
}): ArticleBrief {
  const settings = args.settings ?? DEFAULT_RESEARCH_SETTINGS;
  const opportunityLike = {
    id: `custom:${slug(topic)}`,
    cluster: {
      id: `custom:${slug(topic)}`,
      primaryKeyword: topic,
      secondaryKeywords: [],
      intent: "informational" as const,
      pillar: "apparel_business" as const,
      subcategory: "custom topic",
      audience: "small_business_owners" as const,
      format: "how_to" as const,
      signals: [],
      missingProviders: []
    },
    scores: {
      demandScore: 0,
      growthScore: 0,
      businessRelevance: 0.7,
      conversionIntent: 0.5,
      rankingOpportunity: 0.4,
      localRelevance: 0.5,
      freshnessScore: 0.5,
      contentGapScore: 0.7,
      overlapPenalty: 0,
      factualConfidence: 0.5,
      opportunityScore: 0.55
    },
    freshnessClass: "evergreen" as const,
    dataCollectedLabel: `Custom topic entered ${new Date().toLocaleDateString("en-US")}. No search metrics invented.`,
    completeness: "unavailable" as const,
    closestExisting: null,
    whyDistinct: "Merchant-entered topic.",
    whyFitsLegends: "Merchant-selected topic pending review.",
    requiresInterview: false,
    productsToFeature: [],
    proposedTitle: topic,
    proposedHandle: slug(topic),
    proposedOutline: ["Introduction", "Key points", "Practical guidance", "Next steps"],
    internalLinks: [],
    externalSources: [],
    status: "suggested" as const
  };
  const brief = buildArticleBrief(opportunityLike, args);
  brief.customTopic = topic;
  brief.geographicTarget = settings.region;
  return brief;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "topic";
}
