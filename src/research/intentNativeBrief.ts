/**
 * Intent-native brief construction from ReaderTask + evidence (M5).
 * Does not assign AUTO_ELIGIBLE or change opportunity decision thresholds.
 */
import { createHash } from "node:crypto";
import type { ReaderTask } from "./readerTask.js";
import type { ClusterEvidenceBudgetM4 } from "./knowledgeRegistry.js";
import type { OpportunityCluster } from "./opportunityCluster.js";
import type { NaturalTitleProposal } from "./naturalTitle.js";
import { generateNaturalTitleFromReaderTask } from "./naturalTitle.js";
import { createPipelineVersionStamp, type PipelineVersionStamp } from "./versioning.js";
import { extractSemanticFeatures } from "./semanticClustering.js";
import type { FeaturedProduct, SearchIntent } from "./types.js";

export const INTENT_NATIVE_BRIEF_VERSION = "brief.v2.intent-native-reader-task";

export interface IntentNativeBrief {
  id: string;
  clusterId: string | null;
  canonicalReaderTaskId: string;
  proposedTitle: string;
  readerQuestion: string;
  targetAudienceLabel: string;
  searchIntent: SearchIntent | "unknown";
  /** Decision-centered outline — not format template filler. */
  proposedOutline: string[];
  whyDistinct: string;
  conversionPath: string | null;
  approvedFacts: string[];
  safeExclusions: string[];
  missingEvidence: string[];
  evidenceReadinessStatus: ClusterEvidenceBudgetM4["evidenceReadiness"]["status"] | "unknown";
  /** Never AUTO — M5 briefs do not invent opportunity decisions. */
  decisionHint: "DRAFT_CANDIDATE" | "NEEDS_EVIDENCE" | "NEEDS_MERCHANT_INPUT" | "BLOCKED";
  titleProposalId: string;
  briefVersion: string;
  materialHash: string;
  schemaVersion: string;
  pipelineVersions: PipelineVersionStamp;
  productsToFeature: FeaturedProduct[];
}

function briefId(taskId: string, title: string): string {
  return createHash("sha1").update(`brief|${taskId}|${title}`).digest("hex").slice(0, 24);
}

function hashBrief(parts: object): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function buildDecisionOutline(task: ReaderTask, budget?: ClusterEvidenceBudgetM4 | null): string[] {
  const features = extractSemanticFeatures(task);
  const outline: string[] = [];
  outline.push(`Clarify the decision: ${task.actualQuestion}`);
  outline.push(`Situation and constraints: ${task.situation || task.problem}`);
  if (task.constraints?.length) {
    outline.push(`Hard constraints to respect: ${task.constraints.slice(0, 4).join("; ")}`);
  }

  if (features.decisionFamily === "choose_fabric" || /\b(cotton|polyester|fabric)\b/i.test(task.actualQuestion)) {
    outline.push("Compare fabric options with explicit criteria (feel, durability, print behavior, cost assumptions)");
    outline.push("State tradeoffs for the stated use case — do not declare a universal winner");
  } else if (
    features.decisionFamily === "choose_decoration_method" ||
    /\b(dtf|embroidery|screen print|decoration)\b/i.test(task.actualQuestion)
  ) {
    outline.push("Compare decoration methods against quantity, deadline, and surface constraints");
    outline.push("Keep apparel DTF distinct from UV DTF hard-surface guidance");
  } else if (features.decisionFamily === "evaluate_artwork" || /\b(dpi|artwork)\b/i.test(task.actualQuestion)) {
    outline.push("Explain artwork preparation requirements at final print size with units");
    outline.push("Call out common failure modes without inventing manufacturer settings");
  } else if (features.geographyClass === "local" || task.searchIntent === "local") {
    outline.push("Cover local decision factors that change the answer (pickup, timeline, vendor proximity)");
    outline.push("Do not promote local facts as national guidance");
  } else {
    outline.push(`Walk through how to ${task.decisionOrAction}`);
    outline.push(`Define a successful outcome: ${task.desiredOutcome || "a confident next step"}`);
  }

  if (budget?.missingFirsthandKnowledge?.length) {
    outline.push("Note where firsthand merchant experience is still required before stronger claims");
  }
  if (budget?.safeExclusions?.length) {
    outline.push("Explicitly avoid unsupported or prohibited claims listed in the evidence budget");
  } else {
    outline.push("Close with the next practical step for this reader decision");
  }

  // Deduplicate while preserving order
  const seen = new Set<string>();
  return outline.filter(line => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

function decisionHintFromBudget(
  budget?: ClusterEvidenceBudgetM4 | null
): IntentNativeBrief["decisionHint"] {
  if (!budget) return "NEEDS_EVIDENCE";
  if (budget.evidenceReadiness.status === "blocked") return "BLOCKED";
  if (budget.evidenceReadiness.status === "needs_merchant_input") return "NEEDS_MERCHANT_INPUT";
  if (budget.evidenceReadiness.status === "partial") return "NEEDS_EVIDENCE";
  return "DRAFT_CANDIDATE";
}

/**
 * Build an intent-native brief from a ReaderTask (and optional cluster evidence budget).
 * Does not create research opportunities or assign AUTO_ELIGIBLE.
 */
export function buildIntentNativeBriefFromReaderTask(args: {
  task: ReaderTask;
  cluster?: OpportunityCluster | null;
  evidenceBudget?: ClusterEvidenceBudgetM4 | null;
  titleProposal?: NaturalTitleProposal | null;
  recentTitles?: string[];
  products?: FeaturedProduct[];
}): IntentNativeBrief {
  const titleProposal =
    args.titleProposal ||
    generateNaturalTitleFromReaderTask({
      task: args.task,
      cluster: args.cluster,
      evidenceBudget: args.evidenceBudget,
      recentTitles: args.recentTitles
    });

  const budget = args.evidenceBudget || null;
  const outline = buildDecisionOutline(args.task, budget);
  const approvedFacts = budget?.approvedFacts?.slice(0, 12) || [];
  const safeExclusions = budget?.safeExclusions?.slice(0, 12) || [];
  const missingEvidence = [
    ...(budget?.missingFirsthandKnowledge?.length
      ? ["Missing approved firsthand merchant knowledge"]
      : []),
    ...(budget?.missingTechnicalEvidence?.length ? ["Missing authoritative technical evidence"] : []),
    ...(budget?.missingQuantitativeEvidence?.length ? ["Missing quantitative price/cost evidence"] : []),
    ...(budget?.unsupportedClaims?.length
      ? [`${budget.unsupportedClaims.length} unsupported claim(s)`]
      : [])
  ];

  const evidenceReadinessStatus: IntentNativeBrief["evidenceReadinessStatus"] =
    budget?.evidenceReadiness.status || "unknown";
  const decisionHint = decisionHintFromBudget(budget);

  const withoutHash = {
    id: briefId(args.task.id, titleProposal.title),
    clusterId: args.cluster?.id || null,
    canonicalReaderTaskId: args.task.id,
    proposedTitle: titleProposal.title,
    readerQuestion: args.task.actualQuestion,
    targetAudienceLabel: args.task.audience,
    searchIntent: args.task.searchIntent,
    proposedOutline: outline,
    whyDistinct: args.cluster?.similarityExplanation
      ? `Canonical ReaderTask cluster: ${args.cluster.similarityExplanation.slice(0, 180)}`
      : `Distinct reader decision: ${args.task.decisionOrAction}`,
    conversionPath: args.task.conversionPath,
    approvedFacts,
    safeExclusions,
    missingEvidence,
    evidenceReadinessStatus,
    decisionHint,
    titleProposalId: titleProposal.id,
    briefVersion: INTENT_NATIVE_BRIEF_VERSION,
    schemaVersion: "intentNativeBrief.v1",
    productsToFeature: (args.products || []).slice(0, 3)
  };

  return {
    ...withoutHash,
    materialHash: hashBrief({
      ...withoutHash,
      productsToFeature: withoutHash.productsToFeature.map(p => p.handle || p.title)
    }),
    pipelineVersions: createPipelineVersionStamp("M5")
  };
}
