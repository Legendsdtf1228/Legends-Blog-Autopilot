/**
 * Normalize SourceEvidence → ReaderTask (M2).
 * No title generation. No M3 semantic clustering.
 * Pending/template/revoked/seed evidence cannot become accepted production ReaderTasks.
 */
import { createHash } from "node:crypto";
import { isProductionApproved } from "./evidenceApproval.js";
import {
  buildReaderTaskStatement,
  emptyReaderTask,
  validateReaderTaskCoherence,
  type ReaderTask,
  type ReaderTaskConfidence
} from "./readerTask.js";
import {
  isPendingOrTemplateEvidence,
  isSeedBrainstormEvidence,
  sourceEvidenceDemandStatus,
  type SourceEvidence
} from "./sourceEvidence.js";
import { createPipelineVersionStamp } from "./versioning.js";
import type { SearchIntent } from "./types.js";

export const READER_TASK_SCHEMA_VERSION = "readerTask.v1";

export interface ReaderTaskNormalizationResult {
  accepted: boolean;
  task: ReaderTask | null;
  statement: string;
  reasons: string[];
  supportingEvidenceIds: string[];
}

function inferIntent(question: string, geographic: string | null): SearchIntent | "unknown" {
  const q = `${question} ${geographic || ""}`.toLowerCase();
  if (/\b(near me|warner robins|middle georgia|local)\b/.test(q)) return "local";
  if (/\b(buy|price|pricing|cost|order)\b/.test(q)) return "transactional";
  if (/\b(best|vs|versus|compare|which)\b/.test(q)) return "commercial";
  if (/\b(how|when|should|evaluate)\b/.test(q)) return "informational";
  return "unknown";
}

function confidenceFromEvidence(evidence: SourceEvidence[]): ReaderTaskConfidence {
  if (evidence.some(e => isSeedBrainstormEvidence(e))) return "low";
  if (evidence.some(e => isPendingOrTemplateEvidence(e))) return "low";
  if (evidence.every(e => e.confidence === "high" && isProductionApproved(e.approval ?? undefined))) {
    return "high";
  }
  if (evidence.some(e => e.confidence === "medium" || e.confidence === "high")) return "medium";
  return "low";
}

function freshnessFromEvidence(evidence: SourceEvidence[]): ReaderTask["freshness"] {
  if (evidence.some(e => e.freshness === "stale")) return "stale";
  if (evidence.some(e => e.freshness === "aging")) return "aging";
  if (evidence.some(e => e.freshness === "fresh")) return "fresh";
  return "unknown";
}

export function buildSemanticFingerprint(parts: {
  audience: string;
  actualQuestion: string;
  decisionOrAction: string;
  situation: string;
}): string {
  const norm = [parts.audience, parts.actualQuestion, parts.decisionOrAction, parts.situation]
    .map(s => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim())
    .join("|");
  return createHash("sha1").update(norm).digest("hex").slice(0, 24);
}

/**
 * Normalize one or more evidence records that already share the same customer question
 * into a single ReaderTask. Callers must not use this for M3-style semantic merge of
 * different questions — only identical/explicitly grouped evidence.
 */
export function normalizeSourceEvidenceToReaderTask(
  evidenceList: SourceEvidence[]
): ReaderTaskNormalizationResult {
  if (!evidenceList.length) {
    return {
      accepted: false,
      task: null,
      statement: "",
      reasons: ["No source evidence provided."],
      supportingEvidenceIds: []
    };
  }

  if (evidenceList.some(e => e.approval?.approvalState === "REVOKED")) {
    return {
      accepted: false,
      task: null,
      statement: "",
      reasons: ["Revoked evidence cannot create active ReaderTasks."],
      supportingEvidenceIds: evidenceList.map(e => e.id)
    };
  }

  // Stale non-seed evidence is rejected from active ReaderTask creation in M2.
  if (evidenceList.some(e => e.freshness === "stale" && !isSeedBrainstormEvidence(e))) {
    return {
      accepted: false,
      task: null,
      statement: "",
      reasons: ["Evidence is stale; refresh approved source before creating a ReaderTask."],
      supportingEvidenceIds: evidenceList.map(e => e.id)
    };
  }

  const primary = evidenceList[0]!;
  const audience = (primary.audienceHint || "").trim();
  const situation = (primary.situationHint || primary.normalizedProblem || "").trim();
  const problem = primary.normalizedProblem.trim();
  const actualQuestion = primary.normalizedQuestion.trim();
  const decisionOrAction = (primary.decisionHint || "").trim();
  const desiredOutcome = (primary.desiredOutcomeHint || "").trim();

  const coherence = validateReaderTaskCoherence({
    audience,
    situation,
    problem,
    actualQuestion,
    decisionOrAction,
    desiredOutcome
  });

  const seedOnly = evidenceList.every(e => isSeedBrainstormEvidence(e));
  const pendingOnly = evidenceList.every(e => isPendingOrTemplateEvidence(e));
  const demandStatuses = evidenceList.map(sourceEvidenceDemandStatus);
  const demandStatus = seedOnly
    ? "inferred_seed"
    : demandStatuses.includes("observed")
      ? "observed"
      : demandStatuses.includes("verified")
        ? "verified"
        : "unavailable";

  // Seed-only tasks are retained as brainstorming records but never validated demand.
  if (seedOnly) {
    const fingerprint = buildSemanticFingerprint({
      audience: audience || "brainstorm",
      actualQuestion,
      decisionOrAction: decisionOrAction || "brainstorm",
      situation: situation || problem
    });
    const task = emptyReaderTask({
      id: `rt:${fingerprint}`,
      audience: audience || "unspecified brainstorm audience",
      situation: situation || problem,
      problem,
      actualQuestion,
      decisionOrAction: decisionOrAction || "brainstorm only",
      searchIntent: "unknown",
      desiredOutcome: desiredOutcome || "brainstorm exploration",
      stakes: primary.stakesHint || "",
      constraints: primary.constraintsHint || [],
      evidenceRequired: ["Validated first-party demand or approved FAQ/support evidence"],
      evidenceAvailable: evidenceList.map(e => e.sourceReference),
      demandEvidence: {
        status: "inferred_seed",
        summary: "Seed brainstorming only — not validated search demand.",
        metrics: {},
        sourceRefs: evidenceList.map(e => e.sourceReference),
        lastUpdated: primary.collectedAt
      },
      legendsRelevance: primary.legendsRelevanceHint || "",
      conversionPath: null,
      sourceProvenance: evidenceList.map(
        e => `${e.provider}:${e.sourceReference} (brainstormOnly)`
      ),
      confidence: "low",
      freshness: "unknown",
      semanticFingerprint: fingerprint,
      pipelineVersions: createPipelineVersionStamp("M2")
    });
    return {
      accepted: false,
      task,
      statement: buildReaderTaskStatement(task),
      reasons: [
        "Seed-only evidence cannot become a validated-demand ReaderTask.",
        ...coherence.reasons
      ],
      supportingEvidenceIds: evidenceList.map(e => e.id)
    };
  }

  // Pending/template evidence may be stored for merchant review but never accepted as production.
  if (pendingOnly || evidenceList.some(e => isPendingOrTemplateEvidence(e))) {
    const fingerprint = buildSemanticFingerprint({
      audience: audience || "pending",
      actualQuestion,
      decisionOrAction: decisionOrAction || "pending review",
      situation: situation || problem
    });
    const task = emptyReaderTask({
      id: `rt:${fingerprint}`,
      audience: audience || "unspecified audience",
      situation: situation || problem,
      problem,
      actualQuestion,
      decisionOrAction: decisionOrAction || "pending merchant approval",
      searchIntent: inferIntent(actualQuestion, primary.geographicRelevance),
      desiredOutcome: desiredOutcome || "pending approval",
      stakes: primary.stakesHint || "",
      constraints: primary.constraintsHint || [],
      evidenceRequired: ["Explicit merchant approval with content hash"],
      evidenceAvailable: evidenceList.map(e => e.sourceReference),
      demandEvidence: {
        status: "unavailable",
        summary: "Pending or template evidence — not observed demand.",
        metrics: {},
        sourceRefs: evidenceList.map(e => e.sourceReference),
        lastUpdated: primary.collectedAt
      },
      legendsRelevance: primary.legendsRelevanceHint || "",
      conversionPath: null,
      sourceProvenance: evidenceList.map(
        e => `${e.provider}:${e.sourceReference} (PENDING_APPROVAL)`
      ),
      confidence: "low",
      freshness: freshnessFromEvidence(evidenceList),
      semanticFingerprint: fingerprint,
      pipelineVersions: createPipelineVersionStamp("M2")
    });
    return {
      accepted: false,
      task,
      statement: buildReaderTaskStatement(task),
      reasons: [
        "Pending/template evidence cannot create accepted production ReaderTasks or observed demand.",
        ...coherence.reasons
      ],
      supportingEvidenceIds: evidenceList.map(e => e.id)
    };
  }

  // Production acceptance requires explicit APPROVED authority on every supporting record.
  const unapproved = evidenceList.filter(
    e => !isProductionApproved(e.approval ?? undefined, e.approval?.contentHash)
  );
  if (unapproved.length) {
    return {
      accepted: false,
      task: null,
      statement: coherence.statement,
      reasons: [
        "Supporting evidence lacks valid production approval (approvalState/approvedBy/approvedAt/method/hash/scope)."
      ],
      supportingEvidenceIds: evidenceList.map(e => e.id)
    };
  }

  if (!coherence.ok) {
    return {
      accepted: false,
      task: null,
      statement: coherence.statement,
      reasons: coherence.reasons,
      supportingEvidenceIds: evidenceList.map(e => e.id)
    };
  }

  if (!decisionOrAction || decisionOrAction.length < 8) {
    return {
      accepted: false,
      task: null,
      statement: coherence.statement,
      reasons: ["Missing decision/action."],
      supportingEvidenceIds: evidenceList.map(e => e.id)
    };
  }

  const fingerprint = buildSemanticFingerprint({
    audience,
    actualQuestion,
    decisionOrAction,
    situation
  });

  const task = emptyReaderTask({
    id: `rt:${fingerprint}`,
    audience,
    situation,
    problem,
    actualQuestion,
    decisionOrAction,
    searchIntent: inferIntent(actualQuestion, primary.geographicRelevance),
    desiredOutcome,
    stakes: primary.stakesHint || "",
    constraints: primary.constraintsHint || [],
    evidenceRequired: ["Approved first-party evidence supporting the central question"],
    evidenceAvailable: evidenceList.map(e => `${e.sourceType}:${e.sourceReference}`),
    demandEvidence: {
      status: demandStatus,
      summary: `Observed from ${evidenceList.length} merchant-approved first-party evidence record(s).`,
      metrics: Object.assign({}, ...evidenceList.map(e => e.metrics || {})),
      sourceRefs: evidenceList.map(e => e.sourceReference),
      lastUpdated: primary.collectedAt
    },
    legendsRelevance: primary.legendsRelevanceHint || "",
    conversionPath: null,
    sourceProvenance: evidenceList.map(e => {
      const bits = [
        e.provider,
        e.sourceReference,
        e.approval?.approvedBy ? `approvedBy=${e.approval.approvedBy}` : null,
        e.approval?.approvedAt ? `approvedAt=${e.approval.approvedAt}` : null,
        e.approval?.contentHash ? `contentHash=${e.approval.contentHash.slice(0, 12)}` : null
      ].filter(Boolean);
      return bits.join(":");
    }),
    confidence: confidenceFromEvidence(evidenceList),
    freshness: freshnessFromEvidence(evidenceList),
    semanticFingerprint: fingerprint,
    pipelineVersions: createPipelineVersionStamp("M2")
  });

  return {
    accepted: true,
    task,
    statement: coherence.statement,
    reasons: [],
    supportingEvidenceIds: evidenceList.map(e => e.id)
  };
}

/** Validated-demand gate for M2 — seed/pending never qualify. */
export function isValidatedDemandReaderTask(task: ReaderTask): boolean {
  if (task.demandEvidence.status === "inferred_seed") return false;
  if (task.sourceProvenance.some(p => /brainstormOnly|seed_brainstorm|PENDING_APPROVAL/i.test(p))) {
    return false;
  }
  if (task.demandEvidence.status === "unavailable") return false;
  const coherence = validateReaderTaskCoherence(task);
  return coherence.ok && (task.demandEvidence.status === "observed" || task.demandEvidence.status === "verified");
}

/** Seed/pending tasks must never be treated as AUTO_ELIGIBLE inputs. */
export function readerTaskMayBecomeAutoEligible(task: ReaderTask): boolean {
  return isValidatedDemandReaderTask(task);
}
