import type {
  AutoPublishThresholds,
  DemandEvidenceClass,
  OpportunityScores,
  TopicDecision
} from "./types.js";

export type { TopicDecision, DemandEvidenceClass, AutoPublishThresholds };

export const DEFAULT_AUTO_THRESHOLDS: AutoPublishThresholds = {
  overallOpportunityScore: 0.78,
  businessRelevance: 0.7,
  topicSpecificity: 0.85,
  factualConfidence: 0.9,
  uniqueness: 0.85,
  conversionRelevance: 0.55,
  sourceQuality: 0.6,
  articleQuality: 0.9,
  internalLinkConfidence: 0.7
};

export interface GateScorecard {
  opportunityScore: number;
  businessRelevance: number;
  topicSpecificity: number;
  factualConfidence: number;
  uniqueness: number;
  conversionRelevance: number;
  sourceQuality: number;
  articleQuality: number;
  internalLinkConfidence: number;
  criticalViolations: number;
  majorViolations: number;
}

export function classifyDemandEvidence(args: {
  usedVolumeMetric: boolean;
  usedGrowthMetric: boolean;
  providersAvailable: string[];
}): DemandEvidenceClass {
  if (args.usedVolumeMetric || args.usedGrowthMetric) return "verified_demand";
  if (args.providersAvailable.some(p => p === "shopify_catalog" || p === "existing_content")) {
    return "inferred_opportunity";
  }
  return "editorial_business_opportunity";
}

export function decideTopicOutcome(args: {
  scorecard: GateScorecard;
  thresholds?: AutoPublishThresholds;
  requiresInterview: boolean;
  interviewComplete: boolean;
  specificityOk: boolean;
  overlapRejected: boolean;
  classificationInvalid?: boolean;
  /** Pre-generation semantic misalignment (keyword/title/audience/intent). */
  semanticRejected?: boolean;
  semanticReasons?: string[];
  /** Editorial-controls decision (content promise / evidence / depth). */
  editorialDecision?: TopicDecision;
  editorialReasons?: string[];
}): { decision: TopicDecision; reasons: string[] } {
  const t = args.thresholds ?? DEFAULT_AUTO_THRESHOLDS;
  const reasons: string[] = [];
  const s = args.scorecard;

  if (args.editorialDecision === "REJECTED" || args.semanticRejected) {
    return {
      decision: "REJECTED",
      reasons: (args.editorialReasons?.length && args.editorialDecision === "REJECTED"
        ? args.editorialReasons
        : args.semanticReasons?.length
          ? args.semanticReasons
          : ["Failed content-promise / evidence / depth gates."])
    };
  }
  if (args.overlapRejected || args.classificationInvalid) {
    return { decision: "REJECTED", reasons: ["Failed overlap or classification validation."] };
  }
  if (!args.specificityOk || s.topicSpecificity < t.topicSpecificity) {
    reasons.push(`Topic specificity ${s.topicSpecificity} below threshold ${t.topicSpecificity}.`);
    return { decision: "REJECTED", reasons };
  }
  if (
    args.editorialDecision === "NEEDS_MERCHANT_INPUT" ||
    (args.requiresInterview && !args.interviewComplete)
  ) {
    return {
      decision: "NEEDS_MERCHANT_INPUT",
      reasons: args.editorialReasons?.length
        ? args.editorialReasons
        : ["Firsthand / merchant-knowledge topic requires approved input before generation."]
    };
  }
  if (s.criticalViolations > 0 || s.majorViolations > 0) {
    reasons.push(`Quality violations: critical=${s.criticalViolations}, major=${s.majorViolations}.`);
    return { decision: "DRAFT_ONLY", reasons };
  }

  const checks: Array<[keyof AutoPublishThresholds, number]> = [
    ["overallOpportunityScore", s.opportunityScore],
    ["businessRelevance", s.businessRelevance],
    ["topicSpecificity", s.topicSpecificity],
    ["factualConfidence", s.factualConfidence],
    ["uniqueness", s.uniqueness],
    ["conversionRelevance", s.conversionRelevance],
    ["sourceQuality", s.sourceQuality],
    ["articleQuality", s.articleQuality],
    ["internalLinkConfidence", s.internalLinkConfidence]
  ];

  let autoOk = true;
  for (const [key, value] of checks) {
    if (value < t[key]) {
      autoOk = false;
      reasons.push(`${key} ${value} < ${t[key]}`);
    }
  }

  if (autoOk) {
    return { decision: "AUTO_ELIGIBLE", reasons: ["All auto-publish thresholds met with zero critical/major violations."] };
  }
  reasons.push("Does not meet auto-publish thresholds; draft-only.");
  return { decision: "DRAFT_ONLY", reasons };
}

export function uniquenessFromOverlap(overlapScore: number): number {
  return Math.max(0, Math.min(1, 1 - overlapScore));
}

export function scorecardFromOpportunity(args: {
  scores: OpportunityScores;
  topicSpecificity: number;
  uniqueness: number;
  sourceQuality: number;
  articleQuality?: number;
  internalLinkConfidence?: number;
  criticalViolations?: number;
  majorViolations?: number;
}): GateScorecard {
  return {
    opportunityScore: args.scores.opportunityScore,
    businessRelevance: args.scores.businessRelevance,
    topicSpecificity: args.topicSpecificity,
    factualConfidence: args.scores.factualConfidence,
    uniqueness: args.uniqueness,
    conversionRelevance: args.scores.conversionIntent,
    sourceQuality: args.sourceQuality,
    articleQuality: args.articleQuality ?? 0,
    internalLinkConfidence: args.internalLinkConfidence ?? 0.5,
    criticalViolations: args.criticalViolations ?? 0,
    majorViolations: args.majorViolations ?? 0
  };
}
