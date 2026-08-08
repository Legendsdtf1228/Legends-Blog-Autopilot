import { createHash } from "node:crypto";
import { slugify } from "../content.js";
import { detectIntentFromKeyword, validateOrReclassify } from "./classification.js";
import { clusterSignals } from "./cluster.js";
import {
  classifyDemandEvidence,
  decideTopicOutcome,
  scorecardFromOpportunity,
  uniquenessFromOverlap
} from "./outcomes.js";
import { findClosestOverlap, isRejectedByOverlap, type ExistingArticleRef } from "./overlap.js";
import { AUDIENCE_LABELS, CONTENT_PILLARS, DEFAULT_RESEARCH_SETTINGS, FORMAT_LABELS, pillarById } from "./pillars.js";
import { selectProductsForKeyword } from "./productSelection.js";
import { existingContentProvider } from "./providers/existingContent.js";
import {
  approvedWebProvider,
  googleSearchConsoleProvider,
  googleTrendsProvider,
  keywordVolumeProvider,
  siteSearchProvider
} from "./providers/externalStubs.js";
import { seedCatalogProvider } from "./providers/seedCatalog.js";
import { shopifyCatalogProvider } from "./providers/shopifyCatalog.js";
import type { ProviderContext, ResearchProvider } from "./providers/types.js";
import {
  avoidRepeatedDtfBias,
  pickRotatedAudience,
  pickRotatedFormat,
  pillarRotationBonus,
  type UsageRecord
} from "./rotation.js";
import { demandFromSignals, formatCollectedLabel, growthFromSignals, scoreOpportunity } from "./scoring.js";
import { evaluatePreGeneration } from "./editorialControls.js";
import { isIncoherentSearchIntent } from "./semanticIntent.js";
import { assessTopicSpecificity, suggestRefinement } from "./specificity.js";
import { buildIntentOutline } from "./templateDetection.js";
import type {
  ArticleFormatId,
  AudienceId,
  DataCompleteness,
  KeywordCluster,
  ResearchCycleResult,
  ResearchOpportunity,
  ResearchProviderId,
  ResearchSettings,
  SearchIntent,
  TopicDecision,
  TopicFreshnessClass
} from "./types.js";

const PROVIDERS: ResearchProvider[] = [
  seedCatalogProvider,
  shopifyCatalogProvider,
  existingContentProvider,
  googleSearchConsoleProvider,
  googleTrendsProvider,
  keywordVolumeProvider,
  siteSearchProvider,
  approvedWebProvider
];

function completenessFor(signals: { completeness: DataCompleteness }[], missing: ResearchProviderId[]): DataCompleteness {
  if (signals.every(s => s.completeness === "unavailable") && missing.length) return "unavailable";
  if (signals.some(s => s.completeness === "complete")) return missing.length ? "partial" : "complete";
  if (signals.some(s => s.completeness === "historical")) return "historical";
  if (signals.some(s => s.completeness === "partial")) return "partial";
  return "unavailable";
}

function freshnessClass(keyword: string, pillar: string): TopicFreshnessClass {
  const n = keyword.toLowerCase();
  if (/\b(2026|trend|news|this week)\b/.test(n)) return "news_sensitive";
  if (/\b(season|holiday|school year|spirit)\b/.test(n)) return "seasonal";
  if (pillar === "honest_entrepreneurship" || pillar === "legends_story") return "evergreen";
  return "evergreen";
}

function businessRelevance(keyword: string, pillar: string, products: ProviderContext["products"]): number {
  const n = keyword.toLowerCase();
  let score = 0.45;
  if (CONTENT_PILLARS.some(p => p.id === pillar)) score += 0.2;
  if (/\b(dtf|transfer|gang sheet|shirt|apparel|print|embroidery|brand)\b/.test(n)) score += 0.2;
  if (products.some(p => n.includes(p.title.toLowerCase().slice(0, 12)) || p.title.toLowerCase().includes(n.slice(0, 12)))) {
    score += 0.15;
  }
  if (/\b(crypto|celebrity|sports score|recipe|dating)\b/.test(n)) score -= 0.8;
  return Math.max(0, Math.min(1, score));
}

function conversionIntent(intent: string, keyword: string): number {
  const n = keyword.toLowerCase();
  if (intent === "transactional") return 0.9;
  if (intent === "commercial") return 0.75;
  if (intent === "local") return 0.7;
  if (/\b(how to|guide|what is)\b/.test(n)) return 0.45;
  if (/\b(story|burnout|quit|entrepreneur)\b/.test(n)) return 0.35;
  return 0.5;
}

function localRelevance(keyword: string, region: string): number {
  const n = keyword.toLowerCase();
  if (/\b(warner robins|middle georgia|georgia|local|near me)\b/.test(n)) return 0.95;
  if (/georgia/i.test(region)) return 0.55;
  return 0.35;
}

function fitsLegends(pillar: string, keyword: string): boolean {
  const n = keyword.toLowerCase();
  if (/\b(crypto|celebrity gossip|dating app|sports betting)\b/.test(n)) return false;
  return (
    /\b(apparel|shirt|dtf|print|brand|transfer|embroidery|entrepreneur|business|design|color|garment|uniform|hoodie)\b/.test(n) ||
    ["dtf_education", "apparel_garment", "design_color_branding", "apparel_business", "honest_entrepreneurship", "legends_story"].includes(pillar)
  );
}

function buildTitle(cluster: { primaryKeyword: string; format: string; intent: string; subcategory: string }): string {
  const refinement = suggestRefinement(cluster.primaryKeyword);
  if (refinement) return refinement.title;
  const k = cluster.primaryKeyword.replace(/\b\w/g, c => c.toUpperCase());
  if (cluster.format === "comparison" || cluster.intent === "commercial") {
    return `${k}: Which Option Fits Your Apparel Project?`;
  }
  if (cluster.format === "first_person_story") {
    return `${k}: Honest Lessons From Building a Print Business`;
  }
  if (cluster.format === "checklist") {
    // Avoid pairing checklist titles with incoherent / story keywords.
    if (/\bstories?\b/i.test(cluster.primaryKeyword) || isIncoherentSearchIntent(cluster.primaryKeyword)) {
      return `${k}: Practical Questions Local Buyers Should Ask`;
    }
    return `${k}: A Decision Checklist for Apparel Buyers`;
  }
  return `${k}: What ${cluster.subcategory.replace(/\b\w/g, c => c.toUpperCase())} Buyers Should Know`;
}

function audienceForRefinement(refinementAudience: string, pillarAudiences: AudienceId[]): AudienceId {
  const lower = refinementAudience.toLowerCase();
  if (/middle georgia|local|school|team/.test(lower) && pillarAudiences.includes("local_customers")) {
    return "local_customers";
  }
  if (/school|team/.test(lower) && pillarAudiences.includes("schools_teams")) {
    return "schools_teams";
  }
  if (/business|brand/.test(lower) && pillarAudiences.includes("small_business_owners")) {
    return "small_business_owners";
  }
  return pillarAudiences[0]!;
}

function formatForRefinedIntent(pillarFormats: ArticleFormatId[], intent: SearchIntent): ArticleFormatId {
  if (intent === "local" || intent === "commercial") {
    if (pillarFormats.includes("checklist")) return "checklist";
    if (pillarFormats.includes("how_to")) return "how_to";
    if (pillarFormats.includes("faq")) return "faq";
  }
  return pillarFormats[0]!;
}

function productsPlaceholderConversion(products: { title: string }[]): string {
  if (!products.length) return "Trust-building article; no direct product pitch required.";
  return "Point readers to the single most relevant next step after their decision.";
}

/**
 * Apply keyword refinement *before* overlap/products/scores/interview so every
 * dependent field describes the refined candidate, never the discarded seed.
 */
export function applyTopicRefinement(cluster: KeywordCluster, usage: UsageRecord[]): KeywordCluster {
  const next: KeywordCluster = {
    ...cluster,
    secondaryKeywords: [...cluster.secondaryKeywords],
    signals: [...cluster.signals]
  };

  const reclassSeed = validateOrReclassify(next.primaryKeyword, {
    pillar: next.pillar,
    subcategory: next.subcategory
  });
  next.pillar = reclassSeed.pillar;
  next.subcategory = reclassSeed.subcategory;

  const refinement = suggestRefinement(next.primaryKeyword);
  const shouldRefine =
    Boolean(refinement) &&
    (next.primaryKeyword.trim().split(/\s+/).length <= 2 ||
      isIncoherentSearchIntent(next.primaryKeyword) ||
      isIncoherentSearchIntent(next.primaryKeyword));

  if (shouldRefine && refinement) {
    next.primaryKeyword = refinement.keyword;
    next.secondaryKeywords = [...new Set([refinement.keyword, ...next.secondaryKeywords])].slice(0, 8);
    const again = validateOrReclassify(next.primaryKeyword, {
      pillar: next.pillar,
      subcategory: next.subcategory
    });
    next.pillar = again.pillar;
    next.subcategory = again.subcategory;
    const intentHint = (refinement.intent === "local" || refinement.intent === "commercial"
      ? refinement.intent
      : detectIntentFromKeyword(next.primaryKeyword)) as SearchIntent;
    next.intent = intentHint;
  } else {
    next.intent = detectIntentFromKeyword(next.primaryKeyword);
  }

  const pillarDef = pillarById(next.pillar);
  if (shouldRefine && refinement) {
    next.audience = audienceForRefinement(refinement.audience, pillarDef.audiences);
    next.format = formatForRefinedIntent(pillarDef.formats, next.intent);
  } else {
    next.audience = pickRotatedAudience(pillarDef.audiences, usage);
    next.format = pickRotatedFormat(pillarDef.formats, usage);
  }

  next.id = createHash("sha1")
    .update(`${next.pillar}|${next.intent}|${next.primaryKeyword.toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);

  return next;
}

export async function runResearchCycle(args: {
  products: ProviderContext["products"];
  existingArticles: ExistingArticleRef[];
  usage: UsageRecord[];
  settings?: ResearchSettings;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** Extra seed keywords (tests / merchant overrides) merged as seed_catalog signals. */
  extraKeywords?: string[];
}): Promise<ResearchCycleResult> {
  const settings = args.settings ?? DEFAULT_RESEARCH_SETTINGS;
  const now = args.now ?? new Date();
  const ctx: ProviderContext = {
    collectedAt: now,
    region: settings.region,
    storefrontUrl: "https://legendsdtf.com",
    businessFacts: [],
    existingTopics: args.existingArticles.map(a => `${a.title} ${a.primaryKeyword || ""} ${a.topicFingerprint || ""}`),
    products: args.products,
    env: args.env ?? process.env
  };

  const missingProviders: Array<{ provider: ResearchProviderId; reason: string }> = [];
  const allSignals = [];
  for (const provider of PROVIDERS) {
    const result = await provider.collect(ctx);
    if (!result.available) {
      missingProviders.push({ provider: result.provider, reason: result.reason || "Unavailable" });
    }
    allSignals.push(...result.signals);
  }

  for (const keyword of args.extraKeywords || []) {
    allSignals.push({
      provider: "seed_catalog" as const,
      collectedAt: now.toISOString(),
      dataPeriodStart: null,
      dataPeriodEnd: null,
      geographicRegion: settings.region,
      keyword,
      topic: keyword,
      volume: null,
      relativeInterest: null,
      growth: null,
      competition: null,
      sourceUrl: null,
      completeness: "unavailable" as const,
      notes: "Extra seed keyword for discovery/refinement."
    });
  }

  const missingIds = missingProviders.map(m => m.provider);
  const clusters = clusterSignals(allSignals, missingIds);
  const opportunities: ResearchOpportunity[] = [];
  const volumePool = allSignals.map(s => s.volume).filter((v): v is number => typeof v === "number" && v >= 0);
  const interestPool = allSignals.map(s => s.relativeInterest).filter((v): v is number => typeof v === "number" && v >= 0);
  const maxVolume = volumePool.length ? Math.max(...volumePool) : null;
  const maxInterest = interestPool.length ? Math.max(...interestPool) : null;

  for (const rawCluster of clusters) {
    if (!fitsLegends(rawCluster.pillar, rawCluster.primaryKeyword)) continue;

    // 1) Refine first when the seed is broad/incoherent — then re-evaluate everything
    // against the refined candidate so links/scores/overlap/interview never linger.
    const cluster = applyTopicRefinement(rawCluster, args.usage);
    if (!fitsLegends(cluster.pillar, cluster.primaryKeyword)) continue;

    const pillarDef = pillarById(cluster.pillar);

    // 2) Dependent evaluation — all computed from the (possibly refined) cluster only.
    const closest = findClosestOverlap(cluster, args.existingArticles);
    const overlapRejected = isRejectedByOverlap(closest, settings.overlapRejectThreshold);

    const demandSignals = cluster.signals.filter(s => s.provider !== "existing_content");
    const completeness = completenessFor(demandSignals, missingIds);
    const demandMeta = demandFromSignals(demandSignals, { maxVolume, maxInterest });
    const growthMeta = growthFromSignals(demandSignals);
    const demandClass = classifyDemandEvidence({
      usedVolumeMetric: demandMeta.usedMetric,
      usedGrowthMetric: growthMeta.usedMetric,
      providersAvailable: PROVIDERS.filter(p => !missingIds.includes(p.id)).map(p => p.id)
    });

    const rotation = pillarRotationBonus(cluster.pillar, args.usage, settings.pillarBalance);
    const dtfBias = avoidRepeatedDtfBias(cluster.pillar, args.usage);
    const business = Math.max(0, Math.min(1,
      businessRelevance(cluster.primaryKeyword, cluster.pillar, args.products) * (0.7 + 0.3 * rotation) + dtfBias
    ));

    // Prefer refinement metadata for either the raw seed or the (already refined) keyword.
    const refinementMeta =
      suggestRefinement(rawCluster.primaryKeyword) || suggestRefinement(cluster.primaryKeyword);
    let proposedTitle = refinementMeta?.title || buildTitle(cluster);
    let readerQuestion = refinementMeta?.readerQuestion
      || `What should ${AUDIENCE_LABELS[cluster.audience].toLowerCase()} know about ${cluster.primaryKeyword}?`;
    let audienceLabel = refinementMeta?.audience || AUDIENCE_LABELS[cluster.audience];
    let proposedOutline = buildIntentOutline({
      primaryKeyword: cluster.primaryKeyword,
      readerQuestion,
      promiseClass: "informational_general",
      audienceLabel,
      subcategory: cluster.subcategory
    });

    const preGen = evaluatePreGeneration({
      primaryKeyword: cluster.primaryKeyword,
      proposedTitle,
      audienceLabel,
      readerQuestion,
      outline: proposedOutline,
      whyDistinct: closest ? `Different angle from “${closest.title}”` : "No close match",
      conversionPath: productsPlaceholderConversion(args.products),
      format: cluster.format,
      intent: cluster.intent,
      pillar: cluster.pillar,
      interviewComplete: false,
      hasTechnicalFacts: args.products.length > 0,
      hasLocalFacts: /\blocal|warner|georgia\b/i.test(cluster.primaryKeyword + proposedTitle)
    });

    // Apply editorial refinement (feature-based) onto the live candidate
    if (preGen.refined) {
      cluster.primaryKeyword = preGen.refined.keyword;
      cluster.secondaryKeywords = [...new Set([preGen.refined.keyword, ...cluster.secondaryKeywords])].slice(0, 8);
      cluster.intent = (preGen.refined.intent === "local" || preGen.refined.intent === "commercial"
        ? preGen.refined.intent
        : cluster.intent) as SearchIntent;
      const again = validateOrReclassify(cluster.primaryKeyword, {
        pillar: cluster.pillar,
        subcategory: cluster.subcategory
      });
      cluster.pillar = again.pillar;
      cluster.subcategory = again.subcategory;
      const pillarAfter = pillarById(cluster.pillar);
      if (pillarAfter.formats.includes("checklist")) cluster.format = "checklist";
      if (pillarAfter.audiences.includes("local_customers")) cluster.audience = "local_customers";
      proposedTitle = preGen.refined.title;
      readerQuestion = preGen.refined.readerQuestion;
      audienceLabel = preGen.refined.audience;
      proposedOutline = preGen.refined.outline;
      cluster.id = createHash("sha1")
        .update(`${cluster.pillar}|${cluster.intent}|${cluster.primaryKeyword.toLowerCase()}`)
        .digest("hex")
        .slice(0, 16);
    } else {
      proposedOutline = buildIntentOutline({
        primaryKeyword: cluster.primaryKeyword,
        readerQuestion,
        promiseClass: preGen.contentPromise.primaryClass,
        audienceLabel,
        subcategory: cluster.subcategory
      });
    }

    const productsToFeature = selectProductsForKeyword({
      products: args.products,
      primaryKeyword: cluster.primaryKeyword,
      secondaryKeywords: cluster.secondaryKeywords,
      title: proposedTitle,
      readerQuestion,
      nowIso: now.toISOString(),
      limit: 3
    });

    const requiresInterview =
      preGen.requiresInterview ||
      (settings.requireInterviewForFirstPerson &&
        (cluster.format === "first_person_story" ||
          cluster.pillar === "honest_entrepreneurship" ||
          cluster.pillar === "legends_story") &&
        preGen.contentPromise.requiresFirsthand);

    const scores = scoreOpportunity({
      signals: demandSignals,
      businessRelevance: business,
      conversionIntent: conversionIntent(cluster.intent, cluster.primaryKeyword),
      rankingOpportunity: completeness === "unavailable" ? 0.35 : 0.55,
      localRelevance: localRelevance(cluster.primaryKeyword, settings.region),
      freshnessScore: completeness === "unavailable" ? 0.3 : 0.7,
      contentGapScore: closest ? 1 - closest.score : 0.85,
      overlapPenalty: closest?.score ?? 0,
      factualConfidence: requiresInterview ? 0.35 : cluster.pillar === "honest_entrepreneurship" ? 0.4 : 0.7,
      weights: settings.weights,
      maxVolume,
      maxInterest
    });

    const specificity = assessTopicSpecificity({
      primaryKeyword: cluster.primaryKeyword,
      proposedTitle,
      outline: proposedOutline,
      audienceLabel,
      whyDistinct: closest ? `Different angle from “${closest.title}”` : "No close match"
    });

    const uniqueness = uniquenessFromOverlap(closest?.score ?? 0);
    const sourceQuality = demandClass === "verified_demand" ? 0.85 : demandClass === "inferred_opportunity" ? 0.55 : 0.45;
    const scorecard = scorecardFromOpportunity({
      scores,
      topicSpecificity: Math.min(specificity.score, preGen.depth.score),
      uniqueness,
      sourceQuality,
      articleQuality: 0,
      internalLinkConfidence: productsToFeature.length ? 0.8 : 0.75
    });

    const outcome = decideTopicOutcome({
      scorecard,
      thresholds: settings.autoThresholds,
      requiresInterview,
      interviewComplete: false,
      specificityOk:
        specificity.ok &&
        specificity.score >= settings.minTopicSpecificity &&
        preGen.depth.ok !== false &&
        !specificity.reasons.some(r => /Broad one-word|Generic title|placeholder|coherent apparel-buyer|Audience\/purpose drift/i.test(r)),
      overlapRejected,
      classificationInvalid: false,
      semanticRejected: preGen.decision === "REJECTED",
      semanticReasons: preGen.reasons,
      editorialDecision: preGen.decision,
      editorialReasons: preGen.reasons
    });

    // Prefer editorial controls when they are stricter than score-only outcomes
    let finalDecision = outcome.decision;
    let finalReasons = outcome.reasons;
    if (preGen.decision === "NEEDS_MERCHANT_INPUT") {
      finalDecision = "NEEDS_MERCHANT_INPUT";
      finalReasons = preGen.reasons;
    } else if (preGen.decision === "REJECTED") {
      finalDecision = "REJECTED";
      finalReasons = preGen.reasons;
    } else if (preGen.decision === "DRAFT_ONLY" && outcome.decision === "AUTO_ELIGIBLE") {
      finalDecision = "DRAFT_ONLY";
      finalReasons = preGen.reasons;
    }

    const failedGates = [
      ...specificity.reasons,
      ...preGen.evidenceBudget.missingEvidence,
      ...finalReasons.filter(r => finalDecision !== "AUTO_ELIGIBLE")
    ];

    const dataLabel = formatCollectedLabel(now, completeness);
    const safeDemandLabel = demandClass === "verified_demand"
      ? `${dataLabel} Verified demand metrics available.`
      : `${dataLabel} No verified volume/growth metrics; treated as ${demandClass.replace(/_/g, " ")}.`;

    opportunities.push({
      id: cluster.id,
      cluster,
      scores,
      freshnessClass: freshnessClass(cluster.primaryKeyword, cluster.pillar),
      dataCollectedLabel: safeDemandLabel,
      completeness,
      closestExisting: closest,
      whyDistinct: closest && closest.score >= 0.45
        ? `Related to “${closest.title}” but targets a different question (${cluster.intent} / ${cluster.subcategory}): ${readerQuestion}`
        : `No close existing article answers: ${readerQuestion}`,
      whyFitsLegends: `Fits the ${pillarDef.label} pillar (${cluster.subcategory}) and connects to custom apparel, printing, branding, or entrepreneurship.`,
      requiresInterview,
      productsToFeature,
      proposedTitle,
      proposedH1: proposedTitle,
      proposedHandle: slugify(proposedTitle),
      proposedOutline,
      readerQuestion,
      topicSpecificity: Math.min(specificity.score, preGen.depth.score),
      uniqueness,
      demandClass,
      decision: finalDecision,
      decisionReasons: finalReasons,
      failedGates,
      internalLinks: productsToFeature.map(p => p.url),
      externalSources: [],
      status: finalDecision === "REJECTED" ? "rejected" : "suggested",
      editorialDecision: {
        ...preGen.trace,
        decision: finalDecision,
        reasons: finalReasons
      },
      contentPromiseClass: preGen.contentPromise.primaryClass,
      evidenceConfidence: preGen.evidenceBudget.confidence
    });
  }

  // Autonomous schedule selection: AUTO_ELIGIBLE only for generation.
  // DRAFT_ONLY stays visible in opportunities but never fills the schedule.
  // Merchant-input may be selected solely to create an interview packet.
  const rank = (d: TopicDecision) =>
    d === "AUTO_ELIGIBLE" ? 4 : d === "NEEDS_MERCHANT_INPUT" ? 2 : d === "DRAFT_ONLY" ? 1 : 0;
  opportunities.sort((a, b) =>
    rank(b.decision) - rank(a.decision) || b.scores.opportunityScore - a.scores.opportunityScore
  );

  const auto = opportunities.find(o => o.decision === "AUTO_ELIGIBLE");
  const merchant = opportunities.find(o => o.decision === "NEEDS_MERCHANT_INPUT");
  const draft = opportunities.find(o => o.decision === "DRAFT_ONLY");
  const selected = auto ?? merchant ?? null;
  if (selected && merchant && selected.id !== merchant.id) {
    merchant.editorialDecision = {
      ...(merchant.editorialDecision || {
        originalKeyword: merchant.cluster.primaryKeyword,
        originalTitle: merchant.proposedTitle,
        missingEvidence: [],
        reasons: merchant.decisionReasons
      }),
      replacedByOtherTopic: true,
      reasons: [
        ...(merchant.editorialDecision?.reasons || merchant.decisionReasons),
        `Skipped for schedule — selected “${selected.proposedTitle}” instead.`
      ]
    };
  }
  if (auto && draft && draft.id !== auto.id) {
    draft.editorialDecision = {
      ...(draft.editorialDecision || {
        originalKeyword: draft.cluster.primaryKeyword,
        originalTitle: draft.proposedTitle,
        missingEvidence: [],
        reasons: draft.decisionReasons
      }),
      replacedByOtherTopic: true,
      reasons: [
        ...(draft.editorialDecision?.reasons || draft.decisionReasons),
        `DRAFT_ONLY not auto-generated — selected AUTO_ELIGIBLE “${auto.proposedTitle}” instead.`
      ]
    };
  }

  const cycleDecision: TopicDecision = selected
    ? selected.decision
    : "SKIPPED_NO_QUALIFIED_TOPIC";

  return {
    collectedAt: now.toISOString(),
    missingProviders,
    signals: allSignals,
    opportunities,
    selected,
    cycleDecision,
    cycleDecisionReasons: selected
      ? selected.decisionReasons
      : [
          draft
            ? "Only DRAFT_ONLY topics remain; refusing to auto-generate filler. Safe skip."
            : "No topic met content-promise, evidence, depth, and safety requirements. Safe skip — do not publish weak filler."
        ]
  };
}

export function rejectPopularIrrelevant(keyword: string): boolean {
  return !fitsLegends("dtf_education", keyword) && /\b(crypto|celebrity|dating|sports betting)\b/i.test(keyword);
}

export { FORMAT_LABELS, AUDIENCE_LABELS };
