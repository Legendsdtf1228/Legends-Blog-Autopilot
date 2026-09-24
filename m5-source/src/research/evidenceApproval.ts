/**
 * Explicit approval authority for first-party SourceEvidence (M2 correction).
 * Never invent merchant approval identities or dates.
 */
import { createHash } from "node:crypto";

export type EvidenceApprovalState =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "REVOKED";

export type EvidenceApprovalMethod =
  | "merchant_admin_ui"
  | "signed_import_manifest"
  | "manual_ops_approval"
  | "fixture_template";

export interface EvidenceApprovalRecord {
  approvalState: EvidenceApprovalState;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalMethod: EvidenceApprovalMethod | null;
  /** SHA-256 of canonical content fields; approval binds to this hash. */
  contentHash: string;
  publicUsageAllowed: boolean;
  usageScope: string;
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
}

export interface CanonicalEvidenceContent {
  sourceReference: string;
  normalizedProblem: string;
  normalizedQuestion: string;
  evidenceSummary: string;
  audienceHint?: string;
  situationHint?: string;
  decisionHint?: string;
  desiredOutcomeHint?: string;
  stakesHint?: string;
  constraintsHint?: string[];
  legendsRelevanceHint?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  geographicRelevance?: string | null;
  metrics?: Record<string, number | null | undefined>;
}

export function computeEvidenceContentHash(content: CanonicalEvidenceContent): string {
  const canonical = {
    sourceReference: content.sourceReference.trim(),
    normalizedProblem: content.normalizedProblem.trim(),
    normalizedQuestion: content.normalizedQuestion.trim(),
    evidenceSummary: content.evidenceSummary.trim(),
    audienceHint: (content.audienceHint || "").trim(),
    situationHint: (content.situationHint || "").trim(),
    decisionHint: (content.decisionHint || "").trim(),
    desiredOutcomeHint: (content.desiredOutcomeHint || "").trim(),
    stakesHint: (content.stakesHint || "").trim(),
    constraintsHint: [...(content.constraintsHint || [])].map(s => s.trim()).sort(),
    legendsRelevanceHint: (content.legendsRelevanceHint || "").trim(),
    periodStart: content.periodStart || null,
    periodEnd: content.periodEnd || null,
    geographicRelevance: (content.geographicRelevance || "").trim() || null,
    metrics: content.metrics || {}
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export interface ApprovalValidationResult {
  ok: boolean;
  reasons: string[];
}

/**
 * Validate APPROVED evidence. PENDING/REJECTED/REVOKED are structurally allowed
 * but must not claim APPROVED without complete authority fields.
 */
export function validateEvidenceApproval(
  approval: Partial<EvidenceApprovalRecord> | null | undefined,
  args: {
    requireApproved: boolean;
    periodStart?: string | null;
    periodEnd?: string | null;
    now?: Date;
    expectedContentHash?: string;
  }
): ApprovalValidationResult {
  const reasons: string[] = [];
  const now = args.now ?? new Date();

  if (!approval?.approvalState) {
    reasons.push("approvalState is required");
    return { ok: false, reasons };
  }

  if (approval.approvalState === "PENDING_APPROVAL" || approval.approvalState === "REJECTED") {
    if (args.requireApproved) {
      reasons.push(`approvalState ${approval.approvalState} cannot be used as approved first-party evidence`);
    }
    return { ok: reasons.length === 0, reasons };
  }

  if (approval.approvalState === "REVOKED") {
    reasons.push("approvalState REVOKED cannot create active ReaderTasks");
    return { ok: false, reasons };
  }

  if (approval.approvalState !== "APPROVED") {
    reasons.push(`unknown approvalState ${approval.approvalState}`);
    return { ok: false, reasons };
  }

  // APPROVED requires full authority — never default identities.
  if (!approval.approvedBy || !String(approval.approvedBy).trim()) {
    reasons.push("approvedBy is required for APPROVED evidence");
  } else if (/^merchant$/i.test(String(approval.approvedBy).trim())) {
    reasons.push("approvedBy must be an explicit identity, not the generic label “merchant”");
  }

  if (!approval.approvedAt || !String(approval.approvedAt).trim()) {
    reasons.push("approvedAt is required for APPROVED evidence");
  } else {
    const approvedAt = new Date(approval.approvedAt);
    if (Number.isNaN(approvedAt.getTime())) {
      reasons.push("approvedAt is malformed");
    } else {
      if (approvedAt.getTime() > now.getTime() + 60_000) {
        reasons.push("approvedAt must not be in the future");
      }
      if (args.periodEnd) {
        const periodEnd = new Date(args.periodEnd);
        if (!Number.isNaN(periodEnd.getTime()) && approvedAt.getTime() < periodEnd.getTime() - 86400000 * 370) {
          // Soft consistency: approval wildly before period is suspicious but periodStart check below is primary
        }
      }
      if (args.periodStart) {
        const periodStart = new Date(args.periodStart);
        if (!Number.isNaN(periodStart.getTime()) && approvedAt.getTime() < periodStart.getTime() - 86400000) {
          reasons.push("approvedAt is inconsistent with evidence periodStart");
        }
      }
    }
  }

  if (!approval.approvalMethod || approval.approvalMethod === "fixture_template") {
    reasons.push("approvalMethod must be an explicit production approval method");
  }

  if (!approval.contentHash || !/^[a-f0-9]{64}$/i.test(approval.contentHash)) {
    reasons.push("contentHash is required (sha256 hex) for APPROVED evidence");
  } else if (args.expectedContentHash && approval.contentHash !== args.expectedContentHash) {
    reasons.push("contentHash does not match current content; approval is invalid until re-approved");
  }

  if (approval.publicUsageAllowed !== true) {
    reasons.push("publicUsageAllowed must be true for APPROVED production evidence");
  }

  if (!approval.usageScope || !String(approval.usageScope).trim()) {
    reasons.push("usageScope is required for APPROVED evidence");
  }

  return { ok: reasons.length === 0, reasons };
}

export function isProductionApproved(
  approval: EvidenceApprovalRecord | null | undefined,
  expectedContentHash?: string
): boolean {
  if (!approval || approval.approvalState !== "APPROVED") return false;
  const result = validateEvidenceApproval(approval, {
    requireApproved: true,
    expectedContentHash
  });
  return result.ok;
}

export function pendingApprovalStub(contentHash: string, usageScope = "template_review_only"): EvidenceApprovalRecord {
  return {
    approvalState: "PENDING_APPROVAL",
    approvedBy: null,
    approvedAt: null,
    approvalMethod: "fixture_template",
    contentHash,
    publicUsageAllowed: false,
    usageScope,
    revokedAt: null,
    revokedBy: null,
    revokeReason: null
  };
}
