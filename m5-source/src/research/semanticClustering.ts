/**
 * Deterministic semantic ReaderTask clustering (M3).
 * Keyword overlap is a signal only — shared reader decisions drive merges.
 */
import { createHash } from "node:crypto";
import { jaccard } from "./cluster.js";
import {
  DEFAULT_CLUSTERING_THRESHOLDS,
  MERGE_AUDIENCE_FLOOR,
  MERGE_DECISION_FLOOR,
  OPPORTUNITY_CLUSTER_SCHEMA_VERSION,
  SEMANTIC_CLUSTERING_VERSION,
  type ClusterConflictRecord,
  type ClusterReviewCandidate,
  type ClusterableReaderTask,
  type ClusteringThresholds,
  type OpportunityCluster,
  type SemanticComparisonResult
} from "./opportunityCluster.js";
import type { ReaderTask, ReaderTaskConfidence } from "./readerTask.js";
import { createPipelineVersionStamp } from "./versioning.js";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter(t => t.length > 2)
  );
}

function containment(a: string, b: string): number {
  const A = normalize(a);
  const B = normalize(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) {
    const shorter = Math.min(A.length, B.length);
    const longer = Math.max(A.length, B.length);
    return shorter / longer;
  }
  return jaccard(A, B);
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export type AudienceClass =
  | "school"
  | "team"
  | "clothing_brand"
  | "local_business"
  | "educator"
  | "firsthand_operator"
  | "consumer"
  | "general";

export type SurfaceClass = "apparel" | "hard_surface_uv" | "unknown";
export type GeographyClass = "local" | "national" | "unknown";

export interface TaskSemanticFeatures {
  audienceClass: AudienceClass;
  surfaceClass: SurfaceClass;
  geographyClass: GeographyClass;
  firsthand: boolean;
  educational: boolean;
  quantity: number | null;
  hasDeadline: boolean;
  hasBudget: boolean;
  productCategory: string;
  decisionFamily: string;
}

export function extractSemanticFeatures(task: ReaderTask): TaskSemanticFeatures {
  const blob = normalize(
    [
      task.audience,
      task.situation,
      task.problem,
      task.actualQuestion,
      task.decisionOrAction,
      task.desiredOutcome,
      task.stakes,
      ...(task.constraints || []),
      task.legendsRelevance,
      ...(task.sourceProvenance || [])
    ].join(" ")
  );

  let audienceClass: AudienceClass = "general";
  if (/\b(school|booster|spirit coordinator|pta|teacher)\b/.test(blob)) audienceClass = "school";
  else if (/\b(team|coach|athletic|league)\b/.test(blob)) audienceClass = "team";
  else if (/\b(clothing brand|apparel brand|brand owner|retail merchandise|merch line)\b/.test(blob)) {
    audienceClass = "clothing_brand";
  } else if (/\b(local business|shop owner|storefront|warner robins business)\b/.test(blob)) {
    audienceClass = "local_business";
  } else if (/\b(educator|instructor|curriculum)\b/.test(blob)) audienceClass = "educator";
  else if (/\b(my shop|our shop|i learned|firsthand|running a print)\b/.test(blob)) {
    audienceClass = "firsthand_operator";
  } else if (/\b(buyer|customer|consumer|home)\b/.test(blob)) audienceClass = "consumer";

  let surfaceClass: SurfaceClass = "unknown";
  if (/\b(uv dtf|hard surface|tumbler|mug|glass|phone case|bottle)\b/.test(blob)) {
    surfaceClass = "hard_surface_uv";
  } else if (/\b(shirt|hoodie|apparel|garment|textile|cotton|polyester|embroidery|dtf transfer)\b/.test(blob)) {
    surfaceClass = "apparel";
  }

  let geographyClass: GeographyClass = "unknown";
  if (/\b(warner robins|middle georgia|near me|local printer|local shop)\b/.test(blob)) {
    geographyClass = "local";
  } else if (/\b(nationwide|national|united states|online customers|ship nationwide)\b/.test(blob)) {
    geographyClass = "national";
  }

  const firsthand =
    audienceClass === "firsthand_operator" ||
    /\b(firsthand|my experience|our production|honest lessons from)\b/.test(blob);
  const educational =
    !firsthand &&
    (task.searchIntent === "informational" ||
      /\b(learn|guide|education|overview|explain)\b/.test(blob));

  const quantityMatch = blob.match(/\b(\d{2,5})\s*(piece|pc|pcs|shirt|unit|units|order)?\b/);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : null;

  const hasDeadline = /\b(friday|deadline|kickoff|before|rush|turnaround|same.?day)\b/.test(blob);
  const hasBudget = /\b(budget|cost|price|afford)\b/.test(blob);

  let productCategory = "general";
  if (surfaceClass === "hard_surface_uv") productCategory = "hard_surface_uv";
  else if (/\b(cotton|polyester|fabric|blank)\b/.test(blob)) productCategory = "garment_fabric";
  else if (/\b(decoration|dtf|screen print|embroidery|method)\b/.test(blob)) productCategory = "decoration_method";
  else if (/\b(artwork|dpi|resolution|logo file)\b/.test(blob)) productCategory = "artwork_prep";
  else if (surfaceClass === "apparel") productCategory = "apparel";

  let decisionFamily = "other";
  const decision = normalize(task.decisionOrAction);
  if (/\b(choose|select|pick).*(fabric|cotton|polyester)\b/.test(decision) || /\bfabric\b/.test(decision)) {
    decisionFamily = "choose_fabric";
  } else if (/\b(choose|select|pick).*(method|dtf|screen|embroidery)\b/.test(decision)) {
    decisionFamily = "choose_decoration_method";
  } else if (/\b(evaluate|check|fix).*(resolution|artwork|dpi|file)\b/.test(decision)) {
    decisionFamily = "evaluate_artwork";
  } else if (/\b(choose|select|pick).*(printer|shop|vendor)\b/.test(decision)) {
    decisionFamily = "choose_vendor";
  } else if (/\border\b/.test(decision)) {
    decisionFamily = "place_order";
  }

  return {
    audienceClass,
    surfaceClass,
    geographyClass,
    firsthand,
    educational,
    quantity,
    hasDeadline,
    hasBudget,
    productCategory,
    decisionFamily
  };
}

export function detectHardConflicts(left: ReaderTask, right: ReaderTask): string[] {
  const a = extractSemanticFeatures(left);
  const b = extractSemanticFeatures(right);
  const reasons: string[] = [];

  const audiencePairs: Array<[AudienceClass, AudienceClass]> = [
    ["school", "clothing_brand"],
    ["team", "clothing_brand"],
    ["school", "firsthand_operator"],
    ["team", "firsthand_operator"],
    ["educator", "clothing_brand"],
    ["local_business", "clothing_brand"]
  ];
  for (const [x, y] of audiencePairs) {
    if ((a.audienceClass === x && b.audienceClass === y) || (a.audienceClass === y && b.audienceClass === x)) {
      reasons.push(`audience mismatch (${a.audienceClass} vs ${b.audienceClass})`);
      break;
    }
  }

  if (
    a.surfaceClass !== "unknown" &&
    b.surfaceClass !== "unknown" &&
    a.surfaceClass !== b.surfaceClass
  ) {
    reasons.push(`surface/product mismatch (${a.surfaceClass} vs ${b.surfaceClass})`);
  }

  if (
    a.productCategory !== "general" &&
    b.productCategory !== "general" &&
    a.productCategory !== b.productCategory
  ) {
    reasons.push(`product category mismatch (${a.productCategory} vs ${b.productCategory})`);
  }

  if (
    a.decisionFamily !== "other" &&
    b.decisionFamily !== "other" &&
    a.decisionFamily !== b.decisionFamily
  ) {
    reasons.push(`decision/action mismatch (${a.decisionFamily} vs ${b.decisionFamily})`);
  }

  const intents = [left.searchIntent, right.searchIntent];
  if (
    intents.includes("commercial") &&
    intents.includes("informational") &&
    !intents.includes("unknown" as never)
  ) {
    // commercial vs informational is a hard conflict when both are explicit
    reasons.push("commercial versus informational intent");
  }
  if (intents.includes("local") && intents.includes("transactional") === false) {
    // local vs non-local handled below via geography
  }

  if (
    a.geographyClass !== "unknown" &&
    b.geographyClass !== "unknown" &&
    a.geographyClass !== b.geographyClass
  ) {
    // Locality changes the answer when decision is vendor/printer selection or local service
    if (
      a.decisionFamily === "choose_vendor" ||
      b.decisionFamily === "choose_vendor" ||
      /\b(near me|local printer|warner robins)\b/.test(normalize(left.actualQuestion + right.actualQuestion))
    ) {
      reasons.push(`local versus national decision context (${a.geographyClass} vs ${b.geographyClass})`);
    }
  }

  if (a.firsthand !== b.firsthand && (a.firsthand || b.firsthand) && (a.educational || b.educational)) {
    reasons.push("firsthand-business experience versus general education");
  }

  if (a.quantity != null && b.quantity != null) {
    const ratio = Math.max(a.quantity, b.quantity) / Math.min(a.quantity, b.quantity);
    if (ratio >= 2.5) {
      reasons.push(`quantity constraint conflict (${a.quantity} vs ${b.quantity})`);
    }
  }

  if (a.hasDeadline !== b.hasDeadline && (a.hasDeadline || b.hasDeadline)) {
    // Only conflict when deadline materially changes decoration advice (school rush vs no rush brand)
    if (a.audienceClass !== b.audienceClass || a.decisionFamily !== b.decisionFamily) {
      reasons.push("deadline/constraint changes the recommendation");
    }
  }

  const outcomeSim = containment(left.desiredOutcome, right.desiredOutcome);
  if (outcomeSim < 0.25 && left.desiredOutcome.trim() && right.desiredOutcome.trim()) {
    // Soft unless also decision mismatch — escalate when outcomes diverge strongly with different verbs
    const leftOut = normalize(left.desiredOutcome);
    const rightOut = normalize(right.desiredOutcome);
    if (
      (/\bon.?time\b/.test(leftOut) && /\bretail|durability|brand\b/.test(rightOut)) ||
      (/\bon.?time\b/.test(rightOut) && /\bretail|durability|brand\b/.test(leftOut))
    ) {
      reasons.push("desired outcome conflict");
    }
  }

  return [...new Set(reasons)];
}

/**
 * Declared pairwise decision policy — the only automatic-merge gate.
 * score in [reviewMin, mergeMin) → review/separate, never merge.
 */
export function resolvePairDecision(args: {
  score: number;
  audience: number;
  decisionSimilarity: number;
  hardConflicts: string[];
  thresholds?: ClusteringThresholds;
}): SemanticComparisonResult["decision"] {
  const thresholds = args.thresholds ?? DEFAULT_CLUSTERING_THRESHOLDS;
  if (args.hardConflicts.length) return "separate";
  if (
    args.score >= thresholds.mergeMin &&
    args.decisionSimilarity >= MERGE_DECISION_FLOOR &&
    args.audience >= MERGE_AUDIENCE_FLOOR
  ) {
    return "merge";
  }
  if (args.score >= thresholds.reviewMin) return "review";
  return "separate";
}

export function compareReaderTasksSemantically(
  left: ReaderTask,
  right: ReaderTask,
  thresholds: ClusteringThresholds = DEFAULT_CLUSTERING_THRESHOLDS
): SemanticComparisonResult {
  const hardConflicts = detectHardConflicts(left, right);
  const softConflicts: string[] = [];

  const signals = {
    audience: containment(left.audience, right.audience),
    situation: containment(left.situation, right.situation),
    problem: containment(left.problem, right.problem),
    question: containment(left.actualQuestion, right.actualQuestion),
    decision: containment(left.decisionOrAction, right.decisionOrAction),
    intent:
      left.searchIntent === right.searchIntent
        ? 1
        : left.searchIntent === "unknown" || right.searchIntent === "unknown"
          ? 0.5
          : 0,
    outcome: containment(left.desiredOutcome, right.desiredOutcome),
    stakes: containment(left.stakes || "", right.stakes || ""),
    constraints: jaccard((left.constraints || []).join(" "), (right.constraints || []).join(" ")),
    geography: (() => {
      const a = extractSemanticFeatures(left).geographyClass;
      const b = extractSemanticFeatures(right).geographyClass;
      if (a === "unknown" || b === "unknown") return 0.5;
      return a === b ? 1 : 0.2;
    })(),
    provenance: jaccard(
      (left.sourceProvenance || []).join(" "),
      (right.sourceProvenance || []).join(" ")
    )
  };

  const fa = extractSemanticFeatures(left);
  const fb = extractSemanticFeatures(right);

  // Decision-family agreement boosts paraphrase-resistant merges (shared reader decision).
  if (fa.decisionFamily !== "other" && fa.decisionFamily === fb.decisionFamily) {
    signals.decision = Math.max(signals.decision, 0.78);
  }
  if (fa.productCategory !== "general" && fa.productCategory === fb.productCategory) {
    signals.problem = Math.max(signals.problem, 0.45);
  }

  const keywordOverlap = jaccard(
    `${left.actualQuestion} ${left.problem}`,
    `${right.actualQuestion} ${right.problem}`
  );

  // Weighted semantic score — keyword overlap is capped contribution.
  const score =
    signals.audience * 0.16 +
    signals.situation * 0.12 +
    signals.problem * 0.12 +
    signals.question * 0.16 +
    signals.decision * 0.18 +
    signals.intent * 0.06 +
    signals.outcome * 0.08 +
    signals.constraints * 0.04 +
    signals.geography * 0.04 +
    Math.min(keywordOverlap, 0.35) * 0.04;

  if (fa.geographyClass !== fb.geographyClass && fa.geographyClass !== "unknown" && fb.geographyClass !== "unknown") {
    if (!hardConflicts.some(r => /local versus national/i.test(r))) {
      softConflicts.push("geography differs but may still share a non-local decision");
    }
  }
  if (signals.audience >= 0.7 && signals.decision < 0.45) {
    softConflicts.push("same audience but weak decision alignment");
  }

  let decision: SemanticComparisonResult["decision"] = resolvePairDecision({
    score,
    audience: signals.audience,
    decisionSimilarity: signals.decision,
    hardConflicts,
    thresholds
  });

  // Keyword-only near-duplicates without decision/audience alignment cannot auto-merge.
  if (decision === "merge" && keywordOverlap >= 0.7 && signals.decision < MERGE_DECISION_FLOOR) {
    decision = "review";
    softConflicts.push("high keyword overlap without decision alignment");
  }

  const explanationParts = [
    `score=${score.toFixed(3)}`,
    `keywordOverlap=${keywordOverlap.toFixed(3)}`,
    `decision=${decision}`,
    hardConflicts.length ? `hardConflicts=${hardConflicts.join("|")}` : null,
    softConflicts.length ? `softConflicts=${softConflicts.join("|")}` : null,
    `topSignals=audience:${signals.audience.toFixed(2)},question:${signals.question.toFixed(2)},decision:${signals.decision.toFixed(2)}`
  ].filter(Boolean);

  return {
    leftTaskId: left.id,
    rightTaskId: right.id,
    score,
    keywordOverlap,
    hardConflicts,
    softConflicts,
    signals,
    decision,
    explanation: explanationParts.join("; ")
  };
}

function demandRank(status: ReaderTask["demandEvidence"]["status"]): number {
  switch (status) {
    case "verified":
      return 4;
    case "observed":
      return 3;
    case "unavailable":
      return 1;
    case "inferred_seed":
      return 0;
    default:
      return 0;
  }
}

function freshnessRank(f: ReaderTask["freshness"]): number {
  switch (f) {
    case "fresh":
      return 30;
    case "aging":
      return 15;
    case "unknown":
      return 5;
    case "stale":
      return 0;
    default:
      return 0;
  }
}

function confidenceRank(c: ReaderTaskConfidence): number {
  switch (c) {
    case "high":
      return 20;
    case "medium":
      return 10;
    case "low":
      return 5;
    default:
      return 0;
  }
}

function completenessScore(task: ReaderTask): number {
  const fields = [
    task.audience,
    task.situation,
    task.problem,
    task.actualQuestion,
    task.decisionOrAction,
    task.desiredOutcome,
    task.stakes,
    task.legendsRelevance
  ];
  return fields.filter(f => (f || "").trim().length >= 8).length * 2 + (task.constraints?.length || 0);
}

function specificityScore(task: ReaderTask): number {
  const tokens = tokenize(`${task.actualQuestion} ${task.decisionOrAction} ${task.situation}`);
  return Math.min(tokens.size, 24);
}

/** Demand used for ranking — unsupported claims do not count as verified/observed. */
export function justifiedDemandStatus(
  item: ClusterableReaderTask
): ReaderTask["demandEvidence"]["status"] {
  if (item.inactive || item.task.freshness === "stale") {
    return item.task.demandEvidence.status === "inferred_seed" ? "inferred_seed" : "unavailable";
  }
  if (!item.hasActiveApprovedEvidence) {
    return item.task.demandEvidence.status === "inferred_seed" ? "inferred_seed" : "unavailable";
  }
  const status = item.task.demandEvidence.status;
  if (status === "verified" || status === "observed") return status;
  if (status === "inferred_seed") return "inferred_seed";
  return "unavailable";
}

export function scoreCanonicalCandidate(
  item: ClusterableReaderTask
): { score: number; breakdown: Record<string, number> } {
  const task = item.task;
  const justified = justifiedDemandStatus(item);
  const breakdown = {
    demand: demandRank(justified) * 1000,
    approvedEvidence: item.hasActiveApprovedEvidence && !item.inactive && task.freshness !== "stale" ? 200 : 0,
    freshness: freshnessRank(task.freshness),
    confidence: confidenceRank(task.confidence),
    completeness: completenessScore(task),
    specificity: specificityScore(task)
  };
  // Stable ID is used only as tie-break outside numeric score.
  return {
    score: Object.values(breakdown).reduce((s, n) => s + n, 0),
    breakdown
  };
}

export function selectCanonicalReaderTask(members: ClusterableReaderTask[]): ClusterableReaderTask {
  const sorted = [...members].sort((a, b) => {
    const sa = scoreCanonicalCandidate(a);
    const sb = scoreCanonicalCandidate(b);
    if (sb.score !== sa.score) return sb.score - sa.score;
    return a.task.id.localeCompare(b.task.id);
  });
  return sorted[0]!;
}

export function clusterDemandStatus(
  members: ClusterableReaderTask[]
): OpportunityCluster["demandStatus"] {
  // Cannot exceed what active approved sources justify.
  const activeApproved = members.filter(
    m =>
      !m.inactive &&
      m.hasActiveApprovedEvidence &&
      m.task.demandEvidence.status !== "inferred_seed" &&
      m.task.demandEvidence.status !== "unavailable"
  );
  if (activeApproved.some(m => m.task.demandEvidence.status === "verified")) return "verified";
  if (activeApproved.some(m => m.task.demandEvidence.status === "observed")) return "observed";

  const active = members.filter(m => !m.inactive);
  if (active.length && active.every(m => m.task.demandEvidence.status === "inferred_seed")) {
    return "inferred_seed";
  }
  return "unavailable";
}

export function clusterConfidence(members: ClusterableReaderTask[]): ReaderTaskConfidence {
  if (members.some(m => m.task.confidence === "unknown")) return "unknown";
  if (members.every(m => m.task.confidence === "high")) return "high";
  if (members.some(m => m.task.confidence === "medium" || m.task.confidence === "high")) return "medium";
  return "low";
}

function materialClusterHash(cluster: Omit<OpportunityCluster, "materialHash" | "pipelineVersions" | "createdAt" | "updatedAt"> & { pipelineVersions?: unknown }): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: cluster.id,
        canonicalReaderTaskId: cluster.canonicalReaderTaskId,
        semanticFingerprint: cluster.semanticFingerprint,
        clusteringVersion: cluster.clusteringVersion,
        status: cluster.status,
        memberReaderTaskIds: [...cluster.memberReaderTaskIds].sort(),
        supportingSourceEvidenceIds: [...cluster.supportingSourceEvidenceIds].sort(),
        mergeConfidence: cluster.mergeConfidence,
        requiresManualReview: cluster.requiresManualReview,
        demandStatus: cluster.demandStatus,
        wordingVariants: [...cluster.wordingVariants].sort(),
        similarityExplanation: cluster.similarityExplanation,
        mergedEvidenceSummary: cluster.mergedEvidenceSummary
      })
    )
    .digest("hex");
}

export function buildClusterId(memberFingerprints: string[], clusteringVersion = SEMANTIC_CLUSTERING_VERSION): string {
  const sorted = [...memberFingerprints].sort();
  return createHash("sha1")
    .update(`${clusteringVersion}|${sorted.join("|")}`)
    .digest("hex")
    .slice(0, 24);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Complete-link compatibility: every cross-pair between components must be merge-eligible.
 * Hard conflicts, review, or separate relationships block automatic component joins.
 */
export function componentsAreMergeCompatible(
  leftIds: string[],
  rightIds: string[],
  cmpByPair: Map<string, SemanticComparisonResult>
): { ok: boolean; blocking: SemanticComparisonResult[] } {
  const blocking: SemanticComparisonResult[] = [];
  for (const a of leftIds) {
    for (const b of rightIds) {
      const cmp = cmpByPair.get(pairKey(a, b));
      if (!cmp) {
        blocking.push({
          leftTaskId: a,
          rightTaskId: b,
          score: 0,
          keywordOverlap: 0,
          hardConflicts: ["missing pairwise comparison"],
          softConflicts: [],
          signals: {},
          decision: "separate",
          explanation: "missing pairwise comparison"
        });
        continue;
      }
      if (cmp.decision !== "merge") blocking.push(cmp);
    }
  }
  return { ok: blocking.length === 0, blocking };
}

/** Every pair inside an automatic multi-task cluster must be merge-eligible. */
export function clusterSatisfiesCompleteLinkInvariant(
  memberIds: string[],
  cmpByPair: Map<string, SemanticComparisonResult>
): boolean {
  for (let i = 0; i < memberIds.length; i++) {
    for (let j = i + 1; j < memberIds.length; j++) {
      const cmp = cmpByPair.get(pairKey(memberIds[i]!, memberIds[j]!));
      if (!cmp || cmp.decision !== "merge" || cmp.hardConflicts.length) return false;
    }
  }
  return true;
}

/**
 * Greedy complete-link agglomeration. Merge edges processed by score desc, then IDs.
 * Components join only when every cross-pair is merge-eligible.
 */
export function agglomerateCompleteLink(
  taskIds: string[],
  cmpByPair: Map<string, SemanticComparisonResult>,
  onBlocked?: (blocking: SemanticComparisonResult[]) => void
): string[][] {
  const components: string[][] = [...taskIds].sort((a, b) => a.localeCompare(b)).map(id => [id]);
  const findComponentIndex = (id: string): number => components.findIndex(c => c.includes(id));

  const mergeEdges = [...cmpByPair.values()]
    .filter(c => c.decision === "merge")
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aMin = a.leftTaskId < a.rightTaskId ? a.leftTaskId : a.rightTaskId;
      const aMax = a.leftTaskId < a.rightTaskId ? a.rightTaskId : a.leftTaskId;
      const bMin = b.leftTaskId < b.rightTaskId ? b.leftTaskId : b.rightTaskId;
      const bMax = b.leftTaskId < b.rightTaskId ? b.rightTaskId : b.leftTaskId;
      if (aMin !== bMin) return aMin.localeCompare(bMin);
      return aMax.localeCompare(bMax);
    });

  for (const edge of mergeEdges) {
    const i = findComponentIndex(edge.leftTaskId);
    const j = findComponentIndex(edge.rightTaskId);
    if (i < 0 || j < 0 || i === j) continue;
    const leftComp = components[i]!;
    const rightComp = components[j]!;
    const compat = componentsAreMergeCompatible(leftComp, rightComp, cmpByPair);
    if (!compat.ok) {
      onBlocked?.(compat.blocking);
      continue;
    }
    const merged = [...leftComp, ...rightComp].sort((a, b) => a.localeCompare(b));
    const keep = Math.min(i, j);
    const drop = Math.max(i, j);
    components[keep] = merged;
    components.splice(drop, 1);
  }

  return components
    .map(c => [...c].sort((a, b) => a.localeCompare(b)))
    .sort((a, b) => a[0]!.localeCompare(b[0]!));
}

export interface SemanticClusteringResult {
  clusteringVersion: string;
  clusters: OpportunityCluster[];
  reviewCandidates: ClusterReviewCandidate[];
  conflictPairs: ClusterConflictRecord[];
  comparisons: SemanticComparisonResult[];
  unassignedTaskIds: string[];
  inactiveTaskIds: string[];
}

/**
 * Pure deterministic clustering with complete-link constraints.
 * Same active tasks + version → same clusters/canonicals regardless of input order.
 * Bridge tasks cannot transitively merge hard-conflict or review-only pairs.
 */
export function clusterReaderTasksSemantically(
  inputs: ClusterableReaderTask[],
  thresholds: ClusteringThresholds = DEFAULT_CLUSTERING_THRESHOLDS
): SemanticClusteringResult {
  const byId = new Map<string, ClusterableReaderTask>();
  for (const item of inputs) {
    byId.set(item.task.id, item);
  }

  const inactiveTaskIds = [...byId.values()]
    .filter(i => i.inactive || i.task.freshness === "stale")
    .map(i => i.task.id)
    .sort();

  const active = [...byId.values()]
    .filter(i => !i.inactive && i.task.freshness !== "stale")
    .sort((a, b) => a.task.id.localeCompare(b.task.id));

  const comparisons: SemanticComparisonResult[] = [];
  const cmpByPair = new Map<string, SemanticComparisonResult>();
  const reviewCandidates: ClusterReviewCandidate[] = [];
  const conflictPairs: ClusterConflictRecord[] = [];

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const left = active[i]!.task;
      const right = active[j]!.task;
      const cmp = compareReaderTasksSemantically(left, right, thresholds);
      comparisons.push(cmp);
      cmpByPair.set(pairKey(left.id, right.id), cmp);
      if (cmp.hardConflicts.length) {
        conflictPairs.push({
          leftTaskId: left.id,
          rightTaskId: right.id,
          reasons: cmp.hardConflicts
        });
      }
      if (cmp.decision === "review") {
        reviewCandidates.push({
          leftTaskId: left.id,
          rightTaskId: right.id,
          similarityScore: cmp.score,
          explanation: cmp.explanation,
          reasons: [...cmp.softConflicts, "ambiguous similarity requires review"]
        });
      }
    }
  }

  const components = agglomerateCompleteLink(
    active.map(a => a.task.id),
    cmpByPair,
    blocking => {
      for (const blocked of blocking) {
        if (blocked.decision === "review") {
          const exists = reviewCandidates.some(
            r =>
              (r.leftTaskId === blocked.leftTaskId && r.rightTaskId === blocked.rightTaskId) ||
              (r.leftTaskId === blocked.rightTaskId && r.rightTaskId === blocked.leftTaskId)
          );
          if (!exists) {
            reviewCandidates.push({
              leftTaskId: blocked.leftTaskId,
              rightTaskId: blocked.rightTaskId,
              similarityScore: blocked.score,
              explanation: `${blocked.explanation}; bridge merge blocked by complete-link policy`,
              reasons: [...blocked.softConflicts, "bridge merge blocked — ambiguous pair"]
            });
          }
        }
      }
    }
  );

  comparisons.sort((a, b) =>
    a.leftTaskId === b.leftTaskId
      ? a.rightTaskId.localeCompare(b.rightTaskId)
      : a.leftTaskId.localeCompare(b.leftTaskId)
  );
  reviewCandidates.sort((a, b) =>
    a.leftTaskId === b.leftTaskId
      ? a.rightTaskId.localeCompare(b.rightTaskId)
      : a.leftTaskId.localeCompare(b.leftTaskId)
  );
  conflictPairs.sort((a, b) =>
    a.leftTaskId === b.leftTaskId
      ? a.rightTaskId.localeCompare(b.rightTaskId)
      : a.leftTaskId.localeCompare(b.leftTaskId)
  );

  const clusters: OpportunityCluster[] = [];

  for (const memberIds of [...components].sort((a, b) => a[0]!.localeCompare(b[0]!))) {
    // Safety: never emit an automatic multi-task cluster that violates complete-link.
    if (memberIds.length > 1 && !clusterSatisfiesCompleteLinkInvariant(memberIds, cmpByPair)) {
      for (const id of memberIds) {
        const singleton = [id];
        clusters.push(buildClusterFromMembers(singleton, byId, cmpByPair, thresholds, reviewCandidates, conflictPairs));
      }
      continue;
    }
    clusters.push(buildClusterFromMembers(memberIds, byId, cmpByPair, thresholds, reviewCandidates, conflictPairs));
  }

  clusters.sort((a, b) => a.id.localeCompare(b.id));

  const assigned = new Set(clusters.flatMap(c => c.memberReaderTaskIds));
  const unassignedTaskIds = [...byId.keys()].filter(id => !assigned.has(id)).sort();

  return {
    clusteringVersion: SEMANTIC_CLUSTERING_VERSION,
    clusters,
    reviewCandidates,
    conflictPairs,
    comparisons,
    unassignedTaskIds,
    inactiveTaskIds
  };
}

function buildClusterFromMembers(
  memberIds: string[],
  byId: Map<string, ClusterableReaderTask>,
  cmpByPair: Map<string, SemanticComparisonResult>,
  thresholds: ClusteringThresholds,
  reviewCandidates: ClusterReviewCandidate[],
  conflictPairs: ClusterConflictRecord[]
): OpportunityCluster {
  const members = memberIds.map(id => byId.get(id)!);
  const canonical = selectCanonicalReaderTask(members);
  const fingerprints = members.map(m => m.task.semanticFingerprint);
  const id = buildClusterId(fingerprints);
  const evidenceIds = [...new Set(members.flatMap(m => m.supportingSourceEvidenceIds))].sort();

  const pairExplanations: string[] = [];
  let minPairScore = 1;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const cmp =
        cmpByPair.get(pairKey(members[i]!.task.id, members[j]!.task.id)) ||
        compareReaderTasksSemantically(members[i]!.task, members[j]!.task, thresholds);
      pairExplanations.push(`${members[i]!.task.id}~${members[j]!.task.id}: ${cmp.explanation}`);
      minPairScore = Math.min(minPairScore, cmp.score);
    }
  }
  if (members.length === 1) minPairScore = 1;

  const wordingVariants = [...new Set(members.map(m => m.task.actualQuestion.trim()))].sort();
  // Multi-task automatic clusters are complete-link merge-only; review flag is for singleton peers.
  const requiresManualReview =
    members.length === 1 &&
    reviewCandidates.some(r => memberIds.includes(r.leftTaskId) || memberIds.includes(r.rightTaskId));

  const memberConflicts = conflictPairs.filter(
    c => memberIds.includes(c.leftTaskId) && memberIds.includes(c.rightTaskId)
  );

  const mergedEvidenceSummary = members
    .map(m => m.task.demandEvidence.summary)
    .filter(Boolean)
    .sort()
    .join(" | ");

  const base = {
    id,
    canonicalReaderTaskId: canonical.task.id,
    semanticFingerprint: createHash("sha1")
      .update([...fingerprints].sort().join("|"))
      .digest("hex")
      .slice(0, 24),
    clusteringVersion: SEMANTIC_CLUSTERING_VERSION,
    status: (requiresManualReview ? "needs_review" : "active") as OpportunityCluster["status"],
    memberReaderTaskIds: [...memberIds].sort(),
    supportingSourceEvidenceIds: evidenceIds,
    canonicalAudience: canonical.task.audience,
    canonicalSituation: canonical.task.situation,
    canonicalProblem: canonical.task.problem,
    canonicalQuestion: canonical.task.actualQuestion,
    canonicalDecision: canonical.task.decisionOrAction,
    canonicalIntent: canonical.task.searchIntent,
    canonicalDesiredOutcome: canonical.task.desiredOutcome,
    mergedEvidenceSummary: mergedEvidenceSummary || "No evidence summaries available.",
    similarityExplanation:
      members.length === 1
        ? "Singleton cluster — no merge performed."
        : pairExplanations.sort().join(" || "),
    mergeConfidence: members.length === 1 ? 1 : Number(minPairScore.toFixed(4)),
    requiresManualReview,
    demandStatus: clusterDemandStatus(members),
    confidence: clusterConfidence(members),
    wordingVariants,
    conflicts: memberConflicts,
    schemaVersion: OPPORTUNITY_CLUSTER_SCHEMA_VERSION
  };

  const pipelineVersions = createPipelineVersionStamp("M3");
  const materialHash = materialClusterHash(base);

  return {
    ...base,
    materialHash,
    pipelineVersions
  };
}

/** Re-export avg for tests if needed. */
export { avg, normalize, containment };
