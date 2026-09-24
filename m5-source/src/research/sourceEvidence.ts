/**
 * SourceEvidence — first-party evidence records (M2).
 * Seeds are brainstorming-only. Only production-APPROVED evidence is observed demand.
 */
import { createHash } from "node:crypto";
import {
  isProductionApproved,
  type EvidenceApprovalRecord
} from "./evidenceApproval.js";
import {
  PIPELINE_VERSIONS,
  createPipelineVersionStamp,
  type PipelineVersionStamp
} from "./versioning.js";

export const SOURCE_EVIDENCE_SCHEMA_VERSION = "sourceEvidence.v1";

export type SourceEvidenceType =
  | "approved_customer_faq"
  | "approved_support_question"
  | "approved_product_question"
  | "approved_merchant_knowledge"
  | "manually_approved_import"
  | "pending_faq_template"
  | "seed_brainstorm";

export type SourceEvidenceConfidence = "high" | "medium" | "low" | "unknown";
export type SourceEvidenceFreshness = "fresh" | "aging" | "stale" | "unknown";

export interface SourceEvidenceProvenance {
  /** Privacy-safe: no raw PII, emails, phone numbers, or customer names. */
  description: string;
  approvedBy?: string;
  approvedAt?: string;
  approvalMethod?: string;
  importPath?: string;
  contentHash?: string;
  publicUsageAllowed?: boolean;
  usageScope?: string;
  templateExample?: boolean;
  /** Explicit marker for seed brainstorming provenance. */
  brainstormOnly?: boolean;
}

export interface SourceEvidenceMetrics {
  /** Only populate when genuinely available — never invent volume. */
  volume?: number | null;
  relativeInterest?: number | null;
  occurrenceCount?: number | null;
  [key: string]: number | null | undefined;
}

export interface SourceEvidence {
  id: string;
  provider: string;
  providerVersion: string;
  sourceType: SourceEvidenceType;
  sourceReference: string;
  collectedAt: string;
  periodStart: string | null;
  periodEnd: string | null;
  geographicRelevance: string | null;
  normalizedProblem: string;
  normalizedQuestion: string;
  evidenceSummary: string;
  metrics: SourceEvidenceMetrics;
  confidence: SourceEvidenceConfidence;
  freshness: SourceEvidenceFreshness;
  provenance: SourceEvidenceProvenance;
  /** Authoritative structured approval — not free-form JSON alone. */
  approval: EvidenceApprovalRecord | null;
  /** Optional structured fields that aid ReaderTask normalization. */
  audienceHint?: string;
  situationHint?: string;
  decisionHint?: string;
  desiredOutcomeHint?: string;
  stakesHint?: string;
  constraintsHint?: string[];
  legendsRelevanceHint?: string;
  schemaVersion: string;
  pipelineVersions: PipelineVersionStamp;
}

export interface SourceEvidenceValidationResult {
  ok: boolean;
  reasons: string[];
}

const PII_PATTERN =
  /\b([A-Z][a-z]+ [A-Z][a-z]+@|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|\+?\d[\d\s().-]*[()\s.-][\d\s().-]*\d)\b/i;

export function isSeedBrainstormEvidence(evidence: Pick<SourceEvidence, "sourceType" | "provenance">): boolean {
  return evidence.sourceType === "seed_brainstorm" || evidence.provenance.brainstormOnly === true;
}

export function isPendingOrTemplateEvidence(
  evidence: Pick<SourceEvidence, "sourceType" | "approval" | "provenance">
): boolean {
  if (evidence.sourceType === "pending_faq_template") return true;
  if (evidence.provenance.templateExample === true) return true;
  if (evidence.approval?.approvalState === "PENDING_APPROVAL") return true;
  if (evidence.approval?.approvalState === "REJECTED") return true;
  if (evidence.approval?.approvalState === "REVOKED") return true;
  return false;
}

export function sourceEvidenceDemandStatus(
  evidence: Pick<SourceEvidence, "sourceType" | "provenance" | "metrics" | "approval">
): "verified" | "observed" | "inferred_seed" | "unavailable" {
  if (isSeedBrainstormEvidence(evidence)) return "inferred_seed";
  if (isPendingOrTemplateEvidence(evidence)) return "unavailable";
  if (!isProductionApproved(evidence.approval ?? undefined, evidence.approval?.contentHash)) {
    return "unavailable";
  }
  const hasMetric = Object.values(evidence.metrics || {}).some(v => typeof v === "number" && Number.isFinite(v));
  if (hasMetric) return "observed";
  if (
    evidence.sourceType === "approved_customer_faq" ||
    evidence.sourceType === "approved_support_question" ||
    evidence.sourceType === "approved_product_question" ||
    evidence.sourceType === "approved_merchant_knowledge" ||
    evidence.sourceType === "manually_approved_import"
  ) {
    return "observed";
  }
  return "unavailable";
}

export function validateSourceEvidence(raw: Partial<SourceEvidence>): SourceEvidenceValidationResult {
  const reasons: string[] = [];
  if (!raw.provider?.trim()) reasons.push("provider is required");
  if (!raw.providerVersion?.trim()) reasons.push("providerVersion is required");
  if (!raw.sourceType) reasons.push("sourceType is required");
  if (!raw.sourceReference?.trim()) reasons.push("sourceReference is required");
  if (!raw.collectedAt?.trim()) reasons.push("collectedAt is required");
  if (!raw.normalizedProblem?.trim() || raw.normalizedProblem.trim().length < 12) {
    reasons.push("normalizedProblem is missing or too thin");
  }
  if (!raw.normalizedQuestion?.trim() || raw.normalizedQuestion.trim().length < 12) {
    reasons.push("normalizedQuestion is missing or too thin");
  }
  if (!raw.evidenceSummary?.trim()) reasons.push("evidenceSummary is required");
  if (!raw.confidence) reasons.push("confidence is required");
  if (!raw.freshness) reasons.push("freshness is required");
  if (!raw.provenance?.description?.trim()) reasons.push("provenance.description is required");

  const blob = `${raw.provenance?.description || ""} ${raw.evidenceSummary || ""} ${raw.normalizedProblem || ""}`;
  if (PII_PATTERN.test(blob)) {
    reasons.push("provenance or summary appears to contain PII (email/phone/name pattern)");
  }

  return { ok: reasons.length === 0, reasons };
}

export function buildSourceEvidenceId(provider: string, sourceReference: string): string {
  return createHash("sha1")
    .update(`${provider}|${sourceReference}`)
    .digest("hex")
    .slice(0, 24);
}

export function stampSourceEvidence(
  partial: Omit<SourceEvidence, "id" | "schemaVersion" | "pipelineVersions"> & {
    id?: string;
    approval?: EvidenceApprovalRecord | null;
  }
): SourceEvidence {
  const stamped: SourceEvidence = {
    ...partial,
    id: partial.id || buildSourceEvidenceId(partial.provider, partial.sourceReference),
    metrics: partial.metrics || {},
    approval: partial.approval ?? null,
    schemaVersion: SOURCE_EVIDENCE_SCHEMA_VERSION,
    pipelineVersions: createPipelineVersionStamp("M2")
  };
  return stamped;
}

export function computeFreshness(periodEnd: string | null, now = new Date()): SourceEvidenceFreshness {
  if (!periodEnd) return "unknown";
  const end = new Date(periodEnd);
  if (Number.isNaN(end.getTime())) return "unknown";
  const ageDays = (now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= 120) return "fresh";
  if (ageDays <= 365) return "aging";
  return "stale";
}

/** Material content fingerprint for idempotent upsert accounting (excludes collection timestamp). */
export function materialEvidenceFingerprint(row: SourceEvidence): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        providerVersion: row.providerVersion,
        sourceType: row.sourceType,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        geographicRelevance: row.geographicRelevance,
        normalizedProblem: row.normalizedProblem,
        normalizedQuestion: row.normalizedQuestion,
        evidenceSummary: row.evidenceSummary,
        metrics: row.metrics || {},
        confidence: row.confidence,
        freshness: row.freshness,
        provenance: {
          ...row.provenance,
          // importPath may differ across machines; not material evidence content.
          importPath: undefined
        },
        approval: row.approval,
        audienceHint: row.audienceHint || "",
        situationHint: row.situationHint || "",
        decisionHint: row.decisionHint || "",
        desiredOutcomeHint: row.desiredOutcomeHint || "",
        stakesHint: row.stakesHint || "",
        constraintsHint: row.constraintsHint || [],
        legendsRelevanceHint: row.legendsRelevanceHint || ""
      })
    )
    .digest("hex");
}

/** Re-export for providers that need current version pins. */
export { PIPELINE_VERSIONS };
