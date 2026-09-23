/**
 * Build pending/approved knowledge entries without inventing approval fields.
 */
import { createHash } from "node:crypto";
import {
  KNOWLEDGE_ENTRY_SCHEMA_VERSION,
  buildKnowledgeEntryId,
  computeKnowledgeContentHash,
  emptyKnowledgeScope,
  materialKnowledgeHash,
  type KnowledgeApprovalMethod,
  type KnowledgeApprovalState,
  type KnowledgeCanonicalContent,
  type KnowledgeClass,
  type KnowledgeEntry,
  type KnowledgeSourceType,
  type KnowledgeScope
} from "./knowledgeRegistry.js";
import { createPipelineVersionStamp } from "./versioning.js";

export function buildRevisionId(entryId: string, contentHash: string): string {
  return createHash("sha1").update(`${entryId}|${contentHash}`).digest("hex").slice(0, 24);
}

export interface BuildKnowledgeArgs {
  knowledgeClass: KnowledgeClass;
  normalizedClaim: string;
  exactApprovedFact: string;
  scope?: Partial<KnowledgeScope>;
  sourceType: KnowledgeSourceType;
  sourceReference: string;
  provenance: string;
  firsthand?: boolean;
  publicUsageAllowed?: boolean;
  usageScope?: string;
  confidence?: KnowledgeEntry["confidence"];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  freshnessPolicyDays?: number | null;
  contradictions?: string[];
  templateExample?: boolean;
  /** Label fixtures clearly so they cannot masquerade as production knowledge. */
  fixtureLabel?: string;
  approvalState?: KnowledgeApprovalState;
  approvedBy?: string | null;
  approvedAt?: string | null;
  approvalMethod?: KnowledgeApprovalMethod | null;
}

export function buildPendingKnowledgeEntry(args: BuildKnowledgeArgs): KnowledgeEntry {
  const scope = emptyKnowledgeScope(args.scope || {});
  const content: KnowledgeCanonicalContent = {
    knowledgeClass: args.knowledgeClass,
    normalizedClaim: args.normalizedClaim.trim(),
    exactApprovedFact: args.exactApprovedFact.trim(),
    scope,
    sourceType: args.sourceType,
    sourceReference: args.sourceReference.trim(),
    effectiveFrom: args.effectiveFrom ?? null,
    effectiveTo: args.effectiveTo ?? null,
    freshnessPolicyDays: args.freshnessPolicyDays ?? null,
    firsthand: args.firsthand === true,
    publicUsageAllowed: args.publicUsageAllowed === true,
    usageScope: (args.usageScope || "").trim()
  };
  const contentHash = computeKnowledgeContentHash(content);
  const id = buildKnowledgeEntryId(args.knowledgeClass, args.sourceReference);
  const revisionId = buildRevisionId(id, contentHash);
  const approvalState = args.approvalState || "PENDING_APPROVAL";
  const provenance = args.fixtureLabel
    ? `FIXTURE_NOT_PRODUCTION:${args.fixtureLabel}|${args.provenance}`
    : args.provenance;

  const partial: Omit<KnowledgeEntry, "materialHash" | "pipelineVersions"> = {
    id,
    knowledgeClass: content.knowledgeClass,
    normalizedClaim: content.normalizedClaim,
    exactApprovedFact: content.exactApprovedFact,
    scope,
    sourceType: content.sourceType,
    sourceReference: content.sourceReference,
    provenance,
    approvalState,
    approvedBy: approvalState === "APPROVED" ? args.approvedBy ?? null : null,
    approvedAt: approvalState === "APPROVED" ? args.approvedAt ?? null : null,
    approvalMethod: approvalState === "APPROVED" ? args.approvalMethod ?? null : null,
    contentHash,
    revisionId,
    publicUsageAllowed: content.publicUsageAllowed,
    usageScope: content.usageScope,
    firsthand: content.firsthand,
    confidence: args.confidence || "unknown",
    effectiveFrom: content.effectiveFrom,
    effectiveTo: content.effectiveTo,
    freshnessPolicyDays: content.freshnessPolicyDays,
    contradictions: args.contradictions || [],
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    schemaVersion: KNOWLEDGE_ENTRY_SCHEMA_VERSION,
    templateExample: args.templateExample === true || Boolean(args.fixtureLabel)
  };

  // Never invent APPROVED fields — if caller asked APPROVED without identity, force PENDING.
  if (
    partial.approvalState === "APPROVED" &&
    (!partial.approvedBy || !partial.approvedAt || !partial.approvalMethod || !partial.publicUsageAllowed)
  ) {
    partial.approvalState = "PENDING_APPROVAL";
    partial.approvedBy = null;
    partial.approvedAt = null;
    partial.approvalMethod = null;
  }

  return {
    ...partial,
    pipelineVersions: createPipelineVersionStamp("M4"),
    materialHash: materialKnowledgeHash(partial)
  };
}

/** Apply explicit approval to a pending entry bound to its current content hash. */
export function applyExplicitApproval(
  entry: KnowledgeEntry,
  args: {
    approvedBy: string;
    approvedAt: string;
    approvalMethod: KnowledgeApprovalMethod;
    publicUsageAllowed: boolean;
    usageScope: string;
  }
): KnowledgeEntry {
  if (!args.approvedBy?.trim()) throw new Error("approvedBy is required");
  if (/^merchant$/i.test(args.approvedBy.trim())) {
    throw new Error('approvedBy must be an explicit identity, not the generic label "merchant"');
  }
  if (!args.approvedAt?.trim()) throw new Error("approvedAt is required");
  if (!args.approvalMethod) throw new Error("approvalMethod is required");
  if (args.publicUsageAllowed !== true) throw new Error("publicUsageAllowed must be explicitly true");
  if (!args.usageScope?.trim()) throw new Error("usageScope is required");

  const partial: Omit<KnowledgeEntry, "materialHash" | "pipelineVersions"> = {
    ...entry,
    approvalState: "APPROVED",
    approvedBy: args.approvedBy.trim(),
    approvedAt: args.approvedAt,
    approvalMethod: args.approvalMethod,
    publicUsageAllowed: true,
    usageScope: args.usageScope.trim(),
    revokedAt: null,
    revokedBy: null,
    revokeReason: null
  };
  return {
    ...partial,
    pipelineVersions: createPipelineVersionStamp("M4"),
    materialHash: materialKnowledgeHash(partial)
  };
}

export function reviseKnowledgeContent(
  previous: KnowledgeEntry,
  next: Pick<BuildKnowledgeArgs, "normalizedClaim" | "exactApprovedFact" | "scope" | "effectiveFrom" | "effectiveTo" | "freshnessPolicyDays" | "firsthand" | "publicUsageAllowed" | "usageScope" | "sourceType" | "confidence">
): KnowledgeEntry {
  const rebuilt = buildPendingKnowledgeEntry({
    knowledgeClass: previous.knowledgeClass,
    normalizedClaim: next.normalizedClaim ?? previous.normalizedClaim,
    exactApprovedFact: next.exactApprovedFact ?? previous.exactApprovedFact,
    scope: next.scope || previous.scope,
    sourceType: next.sourceType || previous.sourceType,
    sourceReference: previous.sourceReference,
    provenance: previous.provenance,
    firsthand: next.firsthand ?? previous.firsthand,
    publicUsageAllowed: next.publicUsageAllowed ?? false,
    usageScope: next.usageScope ?? "",
    confidence: next.confidence || "unknown",
    effectiveFrom: next.effectiveFrom !== undefined ? next.effectiveFrom : previous.effectiveFrom,
    effectiveTo: next.effectiveTo !== undefined ? next.effectiveTo : previous.effectiveTo,
    freshnessPolicyDays:
      next.freshnessPolicyDays !== undefined ? next.freshnessPolicyDays : previous.freshnessPolicyDays,
    templateExample: previous.templateExample,
    approvalState: "PENDING_APPROVAL"
  });
  // Preserve stable entry id
  const withId: Omit<KnowledgeEntry, "materialHash" | "pipelineVersions"> = {
    ...rebuilt,
    id: previous.id,
    revisionId: buildRevisionId(previous.id, rebuilt.contentHash),
    approvalState: "INVALIDATED",
    approvedBy: null,
    approvedAt: null,
    approvalMethod: null,
    contradictions: previous.contradictions
  };
  // Content change invalidates prior approval — leave as INVALIDATED until re-approved.
  // Callers typically set PENDING_APPROVAL for the new revision awaiting review.
  withId.approvalState = "PENDING_APPROVAL";
  return {
    ...withId,
    pipelineVersions: createPipelineVersionStamp("M4"),
    materialHash: materialKnowledgeHash(withId)
  };
}
