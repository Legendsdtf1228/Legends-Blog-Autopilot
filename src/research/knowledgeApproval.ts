/**
 * Knowledge approval validation (M4). Never default identity/timestamps/state.
 */
import type {
  KnowledgeApprovalMethod,
  KnowledgeApprovalState,
  KnowledgeEntry
} from "./knowledgeRegistry.js";
import { sourceTypeCanSatisfyClaims } from "./knowledgeRegistry.js";

export interface KnowledgeApprovalValidationResult {
  ok: boolean;
  reasons: string[];
}

export function validateKnowledgeApproval(
  entry: Pick<
    KnowledgeEntry,
    | "approvalState"
    | "approvedBy"
    | "approvedAt"
    | "approvalMethod"
    | "contentHash"
    | "publicUsageAllowed"
    | "usageScope"
    | "sourceType"
    | "firsthand"
    | "effectiveFrom"
    | "effectiveTo"
  >,
  args: {
    requireApproved: boolean;
    expectedContentHash?: string;
    now?: Date;
  }
): KnowledgeApprovalValidationResult {
  const reasons: string[] = [];
  const now = args.now ?? new Date();
  const state = entry.approvalState as KnowledgeApprovalState | undefined;

  if (!state) {
    return { ok: false, reasons: ["approvalState is required"] };
  }

  if (
    state === "PENDING_APPROVAL" ||
    state === "REJECTED" ||
    state === "REVOKED" ||
    state === "INVALIDATED" ||
    state === "STALE"
  ) {
    if (args.requireApproved) {
      reasons.push(`approvalState ${state} cannot satisfy approved claim requirements`);
    }
    return { ok: reasons.length === 0, reasons };
  }

  if (state !== "APPROVED") {
    return { ok: false, reasons: [`unknown approvalState ${state}`] };
  }

  if (!entry.approvedBy || !String(entry.approvedBy).trim()) {
    reasons.push("approvedBy is required for APPROVED knowledge");
  } else if (/^merchant$/i.test(String(entry.approvedBy).trim())) {
    reasons.push("approvedBy must be an explicit identity, not the generic label “merchant”");
  }

  if (!entry.approvedAt || !String(entry.approvedAt).trim()) {
    reasons.push("approvedAt is required for APPROVED knowledge");
  } else {
    const approvedAt = new Date(entry.approvedAt);
    if (Number.isNaN(approvedAt.getTime())) {
      reasons.push("approvedAt is malformed");
    } else if (approvedAt.getTime() > now.getTime() + 60_000) {
      reasons.push("approvedAt must not be in the future");
    }
  }

  if (!entry.approvalMethod) {
    reasons.push("approvalMethod is required for APPROVED knowledge");
  }

  if (!entry.contentHash || !/^[a-f0-9]{64}$/i.test(entry.contentHash)) {
    reasons.push("contentHash is required (sha256 hex) for APPROVED knowledge");
  } else if (args.expectedContentHash && entry.contentHash !== args.expectedContentHash) {
    reasons.push("contentHash does not match current content; approval is invalid until re-approved");
  }

  if (entry.publicUsageAllowed !== true) {
    reasons.push("publicUsageAllowed must be true for APPROVED production knowledge");
  }

  if (!entry.usageScope || !String(entry.usageScope).trim()) {
    reasons.push("usageScope is required for APPROVED knowledge");
  }

  if (!sourceTypeCanSatisfyClaims(entry.sourceType)) {
    reasons.push(`sourceType ${entry.sourceType} cannot satisfy approved claims`);
  }

  if (entry.firsthand === true && entry.sourceType !== "approved_merchant_firsthand") {
    reasons.push("firsthand=true requires sourceType approved_merchant_firsthand");
  }

  if (entry.effectiveFrom) {
    const from = new Date(entry.effectiveFrom);
    if (Number.isNaN(from.getTime())) reasons.push("effectiveFrom is malformed");
  }
  if (entry.effectiveTo) {
    const to = new Date(entry.effectiveTo);
    if (Number.isNaN(to.getTime())) reasons.push("effectiveTo is malformed");
    else if (to.getTime() < now.getTime() - 86400000) {
      // Effective window ended — caller may mark STALE; still invalid for requireApproved use.
      reasons.push("effectiveTo is in the past; knowledge is outside its effective period");
    }
  }

  return { ok: reasons.length === 0, reasons };
}

export function isActivelyApprovedKnowledge(
  entry: KnowledgeEntry,
  expectedContentHash?: string,
  now?: Date
): boolean {
  return validateKnowledgeApproval(entry, {
    requireApproved: true,
    expectedContentHash: expectedContentHash ?? entry.contentHash,
    now
  }).ok;
}

export type { KnowledgeApprovalMethod };
