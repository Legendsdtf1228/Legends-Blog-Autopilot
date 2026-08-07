import { slugify } from "../content.js";
import { validateOrReclassify } from "./classification.js";
import { clusterSignals } from "./cluster.js";
import {
  classifyDemandEvidence,
  decideTopicOutcome,
  scorecardFromOpportunity,
  uniquenessFromOverlap
} from "./outcomes.js";
import { findClosestOverlap, isRejectedByOverlap, type ExistingArticleRef } from "./overlap.js";
import { AUDIENCE_LABELS, CONTENT_PILLARS, DEFAULT_RESEARCH_SETTINGS, FORMAT_LABELS, pillarById } from "./pillars.js";
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
import { isIncoherentSearchIntent, isQuarantinedArticle } from "./semanticIntent.js";
import { assessTopicSpecificity, buildTopicSpecificOutline, suggestRefinement } from "./specificity.js";
import type {
  DataCompleteness,
  ResearchCycleResult,
  ResearchOpportunity,
  ResearchProviderId,
  ResearchSettings,
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

export async function runResearchCycle(args: {
  products: ProviderContext["products"];
  existingArticles: ExistingArticleRef[];
  usage: UsageRecord[];
  settings?: ResearchSettings;
  env?: NodeJS.ProcessEnv;
  now?: Date;
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

  const missingIds = missingProviders.map(m => m.provider);
  const clusters = clusterSignals(allSignals, missingIds);
  const opportunities: ResearchOpportunity[] = [];
  const volumePool = allSignals.map(s => s.volume).filter((v): v is number => typeof v === "number" && v >= 0);
  const interestPool = allSignals.map(s => s.relativeInterest).filter((v): v is number => typeof v === "number" && v >= 0);
  const maxVolume = volumePool.length ? Math.max(...volumePool) : null;
  const maxInterest = interestPool.length ? Math.max(...interestPool) : null;

  for (const cluster of clusters) {
    if (!fitsLegends(cluster.pillar, cluster.primaryKeyword)) continue;

    const reclass = validateOrReclassify(cluster.primaryKeyword, {
      pillar: cluster.pillar,
      subcategory: cluster.subcategory
    });
    cluster.pillar = reclass.pillar;
    cluster.subcategory = reclass.subcategory;

    const pillarDef = pillarById(cluster.pillar);
    cluster.audience = pickRotatedAudience(pillarDef.audiences, args.usage);
    cluster.format = pickRotatedFormat(pillarDef.formats, args.usage);

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
    const scores = scoreOpportunity({
      signals: demandSignals,
      businessRelevance: business,
      conversionIntent: conversionIntent(cluster.intent, cluster.primaryKeyword),
      rankingOpportunity: completeness === "unavailable" ? 0.35 : 0.55,
      localRelevance: localRelevance(cluster.primaryKeyword, settings.region),
      freshnessScore: completeness === "unavailable" ? 0.3 : 0.7,
      contentGapScore: closest ? 1 - closest.score : 0.85,
      overlapPenalty: closest?.score ?? 0,
      factualConfidence: cluster.pillar === "honest_entrepreneurship" ? 0.4 : 0.7,
      weights: settings.weights,
      maxVolume,
      maxInterest
    });

    const productsToFeature = args.products
      .filter(p => {
        const t = p.title.toLowerCase();
        return cluster.secondaryKeywords.concat(cluster.primaryKeyword).some(k => t.includes(k.toLowerCase().split(" ")[0] || ""));
      })
      .slice(0, 3)
      .map(p => ({
        id: (p as { id?: string }).id,
        title: p.title,
        handle: p.handle,
        url: p.url,
        description: p.description || "",
        productType: (p as { productType?: string }).productType,
        options: (p as { options?: string[] }).options || [],
        retrievedAt: (p as { retrievedAt?: string }).retrievedAt || now.toISOString()
      }));

    const requiresInterview = settings.requireInterviewForFirstPerson &&
      (cluster.format === "first_person_story" || cluster.pillar === "honest_entrepreneurship" || cluster.pillar === "legends_story");

    const refinement = suggestRefinement(cluster.primaryKeyword);
    // Auto-refine broad seeds and incoherent search intents before generation.
    const shouldRefine =
      Boolean(refinement) &&
      (cluster.primaryKeyword.trim().split(/\s+/).length <= 2 ||
        isIncoherentSearchIntent(cluster.primaryKeyword) ||
        isQuarantinedArticle("", cluster.primaryKeyword));
    if (shouldRefine && refinement) {
      cluster.primaryKeyword = refinement.keyword;
      cluster.secondaryKeywords = [...new Set([cluster.primaryKeyword, ...cluster.secondaryKeywords])].slice(0, 8);
      const again = validateOrReclassify(cluster.primaryKeyword, {
        pillar: cluster.pillar,
        subcategory: cluster.subcategory
      });
      cluster.pillar = again.pillar;
      cluster.subcategory = again.subcategory;
  // Prefer commercial / local formats for printer-selection refinements.
      if (refinement.intent === "local" || refinement.intent === "commercial") {
        cluster.intent = refinement.intent === "local" ? "local" : "commercial";
        if (cluster.format === "first_person_story") {
          cluster.format = "checklist";
        }
      }
    }

    const proposedTitle = refinement && shouldRefine ? refinement.title : buildTitle(cluster);
    const readerQuestion = refinement?.readerQuestion
      || `What should ${AUDIENCE_LABELS[cluster.audience].toLowerCase()} know about ${cluster.primaryKeyword}?`;
    const proposedOutline = buildTopicSpecificOutline(cluster, readerQuestion);
    const audienceLabel = refinement?.audience || AUDIENCE_LABELS[cluster.audience];

    const specificity = assessTopicSpecificity({
      primaryKeyword: cluster.primaryKeyword,
      proposedTitle,
      outline: proposedOutline,
      audienceLabel,
      whyDistinct: closest ? `Different angle from “${closest.title}”` : "No close match"
    });

    // If semantic alignment still fails after attempted refinement, reject before generation.
    const semanticRejected =
      isIncoherentSearchIntent(cluster.primaryKeyword) ||
      isQuarantinedArticle(proposedTitle, cluster.primaryKeyword) ||
      (!specificity.ok && specificity.reasons.some(r =>
        /coherent apparel-buyer search intent|Audience\/purpose drift|Title does not represent/i.test(r)
      ));

    const uniqueness = uniquenessFromOverlap(closest?.score ?? 0);
    const sourceQuality = demandClass === "verified_demand" ? 0.85 : demandClass === "inferred_opportunity" ? 0.55 : 0.45;
    const scorecard = scorecardFromOpportunity({
      scores,
      topicSpecificity: specificity.score,
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
        !specificity.reasons.some(r => /Broad one-word|Generic title|placeholder|coherent apparel-buyer|Audience\/purpose drift/i.test(r)),
      overlapRejected,
      classificationInvalid: false,
      semanticRejected,
      semanticReasons: specificity.reasons.filter(r =>
        /coherent apparel-buyer|Audience\/purpose drift|Title does not represent|quarantined|template/i.test(r)
      )
    });

    // Skip rejected broad/overlap/semantic topics from the candidate list entirely
    if (outcome.decision === "REJECTED") continue;

    const failedGates = [
      ...specificity.reasons,
      ...outcome.reasons.filter(r => outcome.decision !== "AUTO_ELIGIBLE")
    ];

    const dataLabel = formatCollectedLabel(now, completeness);
    // Never claim popularity without verified metrics
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
      topicSpecificity: specificity.score,
      uniqueness,
      demandClass,
      decision: outcome.decision,
      decisionReasons: outcome.reasons,
      failedGates,
      internalLinks: productsToFeature.map(p => p.url),
      externalSources: [],
      status: "suggested"
    });
  }

  // Prefer AUTO_ELIGIBLE, then DRAFT_ONLY / NEEDS_MERCHANT_INPUT by score
  const rank = (d: TopicDecision) =>
    d === "AUTO_ELIGIBLE" ? 3 : d === "DRAFT_ONLY" ? 2 : d === "NEEDS_MERCHANT_INPUT" ? 1 : 0;
  opportunities.sort((a, b) =>
    rank(b.decision) - rank(a.decision) || b.scores.opportunityScore - a.scores.opportunityScore
  );

  const selected = opportunities.find(o =>
    o.decision === "AUTO_ELIGIBLE" || o.decision === "DRAFT_ONLY" || o.decision === "NEEDS_MERCHANT_INPUT"
  ) ?? null;

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
      : ["No topic met specificity, uniqueness, and safety requirements. Safe skip."]
  };
}

export function rejectPopularIrrelevant(keyword: string): boolean {
  return !fitsLegends("dtf_education", keyword) && /\b(crypto|celebrity|dating|sports betting)\b/i.test(keyword);
}

export { FORMAT_LABELS, AUDIENCE_LABELS };
