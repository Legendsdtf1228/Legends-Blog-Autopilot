import { slugify } from "../content.js";
import { clusterSignals } from "./cluster.js";
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
import { formatCollectedLabel, scoreOpportunity } from "./scoring.js";
import type {
  DataCompleteness,
  ResearchCycleResult,
  ResearchOpportunity,
  ResearchProviderId,
  ResearchSettings,
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

    const pillarDef = pillarById(cluster.pillar);
    cluster.audience = pickRotatedAudience(pillarDef.audiences, args.usage);
    cluster.format = pickRotatedFormat(pillarDef.formats, args.usage);

    const closest = findClosestOverlap(cluster, args.existingArticles);
    if (isRejectedByOverlap(closest, settings.overlapRejectThreshold)) continue;

    const demandSignals = cluster.signals.filter(s => s.provider !== "existing_content");
    const completeness = completenessFor(demandSignals, missingIds);
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
      .map(p => ({ title: p.title, url: p.url }));

    const requiresInterview = settings.requireInterviewForFirstPerson &&
      (cluster.format === "first_person_story" || cluster.pillar === "honest_entrepreneurship" || cluster.pillar === "legends_story");

    const titleBase = cluster.primaryKeyword.replace(/\b\w/g, c => c.toUpperCase());
    const proposedTitle =
      cluster.format === "comparison" ? `${titleBase}: A Practical Comparison for Apparel Printers`
        : cluster.format === "first_person_story" ? `${titleBase}: Lessons From Building a Print Business`
          : cluster.format === "checklist" ? `${titleBase}: A Practical Checklist`
            : `A Practical Guide to ${titleBase}`;

    opportunities.push({
      id: cluster.id,
      cluster,
      scores,
      freshnessClass: freshnessClass(cluster.primaryKeyword, cluster.pillar),
      dataCollectedLabel: formatCollectedLabel(now, completeness),
      completeness,
      closestExisting: closest,
      whyDistinct: closest && closest.score >= 0.45
        ? `Related to “${closest.title}” but targets a different angle (${cluster.intent} / ${cluster.subcategory}).`
        : "No close existing article covers this keyword cluster and intent.",
      whyFitsLegends: `Fits the ${pillarDef.label} pillar and connects to custom apparel, printing, branding, or entrepreneurship.`,
      requiresInterview,
      productsToFeature,
      proposedTitle,
      proposedHandle: slugify(proposedTitle),
      proposedOutline: [
        `What ${cluster.primaryKeyword} means for ${AUDIENCE_LABELS[cluster.audience]}`,
        "Practical steps or comparisons",
        "Common mistakes to avoid",
        "How this connects to custom apparel or print production",
        "Next actions and local CTA when appropriate"
      ],
      internalLinks: productsToFeature.map(p => p.url),
      externalSources: [],
      status: "suggested"
    });
  }

  opportunities.sort((a, b) => b.scores.opportunityScore - a.scores.opportunityScore);
  const selected = opportunities[0] ?? null;

  return {
    collectedAt: now.toISOString(),
    missingProviders,
    signals: allSignals,
    opportunities,
    selected
  };
}

export function rejectPopularIrrelevant(keyword: string): boolean {
  return !fitsLegends("dtf_education", keyword) && /\b(crypto|celebrity|dating|sports betting)\b/i.test(keyword);
}

export { FORMAT_LABELS, AUDIENCE_LABELS };
