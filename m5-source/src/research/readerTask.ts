/**
 * ReaderTask — first-class opportunity source of truth (M1 types + validation only).
 * Not yet wired into runResearchCycle; M2+ ingestion will populate these.
 */
import { createPipelineVersionStamp, type PipelineVersionStamp } from "./versioning.js";
import type { SearchIntent } from "./types.js";

export type ReaderTaskConfidence = "high" | "medium" | "low" | "unknown";

export interface ReaderTaskDemandEvidence {
  /** Never present invented volume as measured demand. */
  status: "verified" | "observed" | "inferred_seed" | "unavailable";
  summary: string;
  metrics?: Record<string, number | null>;
  sourceRefs: string[];
  lastUpdated: string | null;
}

export interface ReaderTask {
  id: string;
  audience: string;
  situation: string;
  problem: string;
  actualQuestion: string;
  decisionOrAction: string;
  searchIntent: SearchIntent | "unknown";
  desiredOutcome: string;
  stakes: string;
  constraints: string[];
  evidenceRequired: string[];
  evidenceAvailable: string[];
  demandEvidence: ReaderTaskDemandEvidence;
  legendsRelevance: string;
  conversionPath: string | null;
  sourceProvenance: string[];
  confidence: ReaderTaskConfidence;
  freshness: "fresh" | "aging" | "stale" | "unknown";
  semanticFingerprint: string;
  pipelineVersions?: PipelineVersionStamp;
}

export interface ReaderTaskCoherenceResult {
  ok: boolean;
  statement: string;
  reasons: string[];
}

const GENERIC_AUDIENCE = /^(readers?|everyone|anyone|general|buyers?|customers?)$/i;
const TAXONOMY_LEAK = /\b(production education|content pillar|subcategory|seed catalog)\b/i;

/**
 * Coherence statement:
 * “[Specific reader] needs to [decision/action] because [situation/problem].”
 */
export function buildReaderTaskStatement(task: Pick<
  ReaderTask,
  "audience" | "decisionOrAction" | "situation" | "problem"
>): string {
  const situation = task.situation || task.problem;
  return `${task.audience} needs to ${task.decisionOrAction} because ${situation}.`;
}

export function validateReaderTaskCoherence(
  task: Pick<
    ReaderTask,
    | "audience"
    | "situation"
    | "problem"
    | "actualQuestion"
    | "decisionOrAction"
    | "desiredOutcome"
  >
): ReaderTaskCoherenceResult {
  const reasons: string[] = [];
  const statement = buildReaderTaskStatement(task);

  if (!task.audience || task.audience.trim().length < 8 || GENERIC_AUDIENCE.test(task.audience.trim())) {
    reasons.push("Audience is missing or generic.");
  }
  if (!task.actualQuestion || task.actualQuestion.trim().length < 20) {
    reasons.push("Actual question is missing or too thin.");
  }
  if (!task.decisionOrAction || task.decisionOrAction.trim().length < 8) {
    reasons.push("Decision/action is missing.");
  }
  if ((!task.situation || task.situation.length < 12) && (!task.problem || task.problem.length < 12)) {
    reasons.push("Situation/problem is missing.");
  }
  if (!task.desiredOutcome || task.desiredOutcome.trim().length < 8) {
    reasons.push("Desired outcome is missing.");
  }
  if (/what should .+ know about/i.test(task.actualQuestion)) {
    reasons.push("Question is manufactured from a generic know-about template.");
  }
  if (TAXONOMY_LEAK.test(statement) || TAXONOMY_LEAK.test(task.actualQuestion)) {
    reasons.push("Taxonomy/internal labels leaked into the reader-facing statement.");
  }
  // Circular: decision restates keyword without a real problem
  if (
    task.decisionOrAction &&
    task.problem &&
    task.decisionOrAction.toLowerCase() === task.problem.toLowerCase()
  ) {
    reasons.push("Decision and problem are circular.");
  }

  return {
    ok: reasons.length === 0,
    statement,
    reasons
  };
}

/** Factory for empty tasks during M2 scaffolding / tests. */
export function emptyReaderTask(partial: Partial<ReaderTask> & Pick<ReaderTask, "id">): ReaderTask {
  return {
    id: partial.id,
    audience: partial.audience || "",
    situation: partial.situation || "",
    problem: partial.problem || "",
    actualQuestion: partial.actualQuestion || "",
    decisionOrAction: partial.decisionOrAction || "",
    searchIntent: partial.searchIntent || "unknown",
    desiredOutcome: partial.desiredOutcome || "",
    stakes: partial.stakes || "",
    constraints: partial.constraints || [],
    evidenceRequired: partial.evidenceRequired || [],
    evidenceAvailable: partial.evidenceAvailable || [],
    demandEvidence: partial.demandEvidence || {
      status: "unavailable",
      summary: "No demand evidence attached.",
      sourceRefs: [],
      lastUpdated: null
    },
    legendsRelevance: partial.legendsRelevance || "",
    conversionPath: partial.conversionPath ?? null,
    sourceProvenance: partial.sourceProvenance || [],
    confidence: partial.confidence || "unknown",
    freshness: partial.freshness || "unknown",
    semanticFingerprint: partial.semanticFingerprint || partial.id,
    pipelineVersions: partial.pipelineVersions || createPipelineVersionStamp("M1")
  };
}
