import type { OpportunityScores, ResearchSignal, ScoringWeights } from "./types.js";
import { DEFAULT_SCORING_WEIGHTS } from "./pillars.js";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Normalize optional volume into 0–1 without inventing missing metrics. */
export function demandFromSignals(
  signals: ResearchSignal[],
  opts?: { maxVolume?: number | null; maxInterest?: number | null }
): { score: number; usedMetric: boolean } {
  const volumes = signals.map(s => s.volume).filter((v): v is number => typeof v === "number" && v >= 0);
  const interests = signals.map(s => s.relativeInterest).filter((v): v is number => typeof v === "number" && v >= 0);
  if (volumes.length) {
    const peak = Math.max(...volumes);
    const denom = opts?.maxVolume && opts.maxVolume > 0 ? opts.maxVolume : Math.max(peak, 1);
    return { score: clamp01(peak / denom), usedMetric: true };
  }
  if (interests.length) {
    const peak = Math.max(...interests);
    const denom = opts?.maxInterest && opts.maxInterest > 0 ? opts.maxInterest : 100;
    return { score: clamp01(peak / denom), usedMetric: true };
  }
  return { score: 0.35, usedMetric: false }; // neutral heuristic, not claimed as volume
}

export function growthFromSignals(signals: ResearchSignal[]): { score: number; usedMetric: boolean } {
  const growths = signals.map(s => s.growth).filter((v): v is number => typeof v === "number");
  if (!growths.length) return { score: 0.4, usedMetric: false };
  // Map -50..+50 growth-ish into 0..1
  const g = Math.max(...growths);
  return { score: clamp01((g + 50) / 100), usedMetric: true };
}

export function competitionFromSignals(signals: ResearchSignal[]): number | null {
  const comps = signals.map(s => s.competition).filter((v): v is number => typeof v === "number");
  if (!comps.length) return null;
  return clamp01(Math.min(...comps));
}

export function scoreOpportunity(args: {
  signals: ResearchSignal[];
  businessRelevance: number;
  conversionIntent: number;
  rankingOpportunity: number;
  localRelevance: number;
  freshnessScore: number;
  contentGapScore: number;
  overlapPenalty: number;
  factualConfidence: number;
  weights?: ScoringWeights;
  maxVolume?: number | null;
  maxInterest?: number | null;
}): OpportunityScores {
  const weights = args.weights ?? DEFAULT_SCORING_WEIGHTS;
  const demand = demandFromSignals(args.signals, {
    maxVolume: args.maxVolume,
    maxInterest: args.maxInterest
  });
  const growth = growthFromSignals(args.signals);
  const opportunityScore =
    demand.score * weights.demandScore +
    growth.score * weights.growthScore +
    clamp01(args.businessRelevance) * weights.businessRelevance +
    clamp01(args.conversionIntent) * weights.conversionIntent +
    clamp01(args.rankingOpportunity) * weights.rankingOpportunity +
    clamp01(args.localRelevance) * weights.localRelevance +
    clamp01(args.freshnessScore) * weights.freshnessScore +
    clamp01(args.contentGapScore) * weights.contentGapScore -
    clamp01(args.overlapPenalty);

  return {
    demandScore: demand.score,
    growthScore: growth.score,
    businessRelevance: clamp01(args.businessRelevance),
    conversionIntent: clamp01(args.conversionIntent),
    rankingOpportunity: clamp01(args.rankingOpportunity),
    localRelevance: clamp01(args.localRelevance),
    freshnessScore: clamp01(args.freshnessScore),
    contentGapScore: clamp01(args.contentGapScore),
    overlapPenalty: clamp01(args.overlapPenalty),
    factualConfidence: clamp01(args.factualConfidence),
    opportunityScore: Number(opportunityScore.toFixed(4))
  };
}

export function formatCollectedLabel(collectedAt: Date | string, completeness: string): string {
  const d = new Date(collectedAt);
  const label = d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York"
  });
  if (completeness === "unavailable") return `No current search metrics available as of ${label}.`;
  if (completeness === "historical") return `Historical/incomplete search data referenced ${label}.`;
  if (completeness === "partial") return `Partial search data collected ${label}.`;
  return `Search data collected ${label}.`;
}
