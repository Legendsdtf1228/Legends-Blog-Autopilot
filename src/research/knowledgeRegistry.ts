/**
 * Knowledge registry types (M4).
 * Approved knowledge only — never invent approvers, dates, or firsthand status.
 */
import { createHash } from "node:crypto";
import type { PipelineVersionStamp } from "./versioning.js";

export const KNOWLEDGE_ENTRY_SCHEMA_VERSION = "knowledgeEntry.v1";
export const KNOWLEDGE_EVALUATION_VERSION = "knowledgeEval.v1.claim-budget";

export type KnowledgeClass =
  | "dtf_shop_operations"
  | "equipment_startup_costs"
  | "artwork_preparation_failures"
  | "garment_selection"
  | "fulfillment_turnaround"
  | "local_customer_needs"
  | "embroidery_vs_dtf"
  | "uv_dtf_vs_apparel_dtf"
  | "print_shop_growth_lessons"
  | "legends_products_services"
  | "legends_policies"
  | "pricing_cost_facts"
  | "technical_specifications"
  | "general_authoritative_education";

export const KNOWLEDGE_CLASSES: KnowledgeClass[] = [
  "dtf_shop_operations",
  "equipment_startup_costs",
  "artwork_preparation_failures",
  "garment_selection",
  "fulfillment_turnaround",
  "local_customer_needs",
  "embroidery_vs_dtf",
  "uv_dtf_vs_apparel_dtf",
  "print_shop_growth_lessons",
  "legends_products_services",
  "legends_policies",
  "pricing_cost_facts",
  "technical_specifications",
  "general_authoritative_education"
];

export type KnowledgeSourceType =
  | "approved_merchant_firsthand"
  | "approved_business_fact_or_policy"
  | "active_first_party_customer_evidence"
  | "authoritative_technical_source"
  | "manufacturer_documentation"
  | "public_government_standards"
  | "inferred_seed"
  | "model_inference"
  | "template_example"
  | "unsupported_assertion";

export type KnowledgeApprovalState =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "REVOKED"
  | "INVALIDATED"
  | "STALE";

export type KnowledgeApprovalMethod =
  | "merchant_admin_ui"
  | "signed_import_manifest"
  | "manual_ops_approval"
  | "interview_packet_approval";

export type ClaimClass =
  | "general_educational"
  | "technical"
  | "product_behavior"
  | "price_cost"
  | "turnaround"
  | "merchant_policy"
  | "merchant_experience"
  | "customer_result"
  | "local_claim"
  | "comparison_recommendation"
  | "safety_compliance"
  | "time_sensitive";

export type ClaimSupportStatus =
  | "supported"
  | "partially_supported"
  | "unsupported"
  | "conflicting"
  | "stale"
  | "prohibited"
  | "requires_merchant_input"
  | "requires_qualification";

export type GeographicKnowledgeScope = "local" | "national" | "global" | "unspecified";
export type ProcessSurfaceScope = "apparel_dtf" | "uv_dtf_hard_surface" | "embroidery" | "general" | "unspecified";

export interface KnowledgeScope {
  geographic: GeographicKnowledgeScope;
  processSurface: ProcessSurfaceScope;
  audiences: string[];
  products: string[];
  exclusions: string[];
  applicableNotes: string;
}

export interface KnowledgeCanonicalContent {
  knowledgeClass: KnowledgeClass;
  normalizedClaim: string;
  exactApprovedFact: string;
  scope: KnowledgeScope;
  sourceType: KnowledgeSourceType;
  sourceReference: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  freshnessPolicyDays: number | null;
  firsthand: boolean;
  publicUsageAllowed: boolean;
  usageScope: string;
}

export function computeKnowledgeContentHash(content: KnowledgeCanonicalContent): string {
  const canonical = {
    knowledgeClass: content.knowledgeClass,
    normalizedClaim: content.normalizedClaim.trim(),
    exactApprovedFact: content.exactApprovedFact.trim(),
    scope: {
      geographic: content.scope.geographic,
      processSurface: content.scope.processSurface,
      audiences: [...content.scope.audiences].map(s => s.trim()).sort(),
      products: [...content.scope.products].map(s => s.trim()).sort(),
      exclusions: [...content.scope.exclusions].map(s => s.trim()).sort(),
      applicableNotes: content.scope.applicableNotes.trim()
    },
    sourceType: content.sourceType,
    sourceReference: content.sourceReference.trim(),
    effectiveFrom: content.effectiveFrom,
    effectiveTo: content.effectiveTo,
    freshnessPolicyDays: content.freshnessPolicyDays,
    firsthand: content.firsthand === true,
    publicUsageAllowed: content.publicUsageAllowed === true,
    usageScope: content.usageScope.trim()
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function buildKnowledgeEntryId(knowledgeClass: KnowledgeClass, sourceReference: string): string {
  return createHash("sha1")
    .update(`${knowledgeClass}|${sourceReference.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

export interface KnowledgeEntry {
  id: string;
  knowledgeClass: KnowledgeClass;
  normalizedClaim: string;
  exactApprovedFact: string;
  scope: KnowledgeScope;
  sourceType: KnowledgeSourceType;
  sourceReference: string;
  provenance: string;
  approvalState: KnowledgeApprovalState;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalMethod: KnowledgeApprovalMethod | null;
  contentHash: string;
  revisionId: string;
  publicUsageAllowed: boolean;
  usageScope: string;
  firsthand: boolean;
  confidence: "high" | "medium" | "low" | "unknown";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  freshnessPolicyDays: number | null;
  contradictions: string[];
  revokedAt: string | null;
  revokedBy: string | null;
  revokeReason: string | null;
  schemaVersion: string;
  pipelineVersions: PipelineVersionStamp;
  materialHash: string;
  templateExample?: boolean;
}

export interface KnowledgeRevision {
  revisionId: string;
  entryId: string;
  contentHash: string;
  exactApprovedFact: string;
  normalizedClaim: string;
  scope: KnowledgeScope;
  payload: KnowledgeEntry;
  createdAt?: string;
}

export interface ClaimRequirement {
  id: string;
  clusterId: string;
  canonicalReaderTaskId: string;
  normalizedClaim: string;
  claimClass: ClaimClass;
  evidenceNeeded: string;
  evidenceFound: string[];
  supportingSourceEvidenceIds: string[];
  supportingKnowledgeIds: string[];
  supportingRevisionIds: string[];
  supportStatus: ClaimSupportStatus;
  confidence: "high" | "medium" | "low" | "unknown";
  freshness: "fresh" | "aging" | "stale" | "unknown";
  contradictions: string[];
  safeToState: boolean;
  qualificationRequired: boolean;
  merchantInputRequired: boolean;
  prohibitedWording: string[];
  verificationPlan: string;
  explanation: string;
}

export interface ClusterEvidenceBudgetM4 {
  clusterId: string;
  canonicalReaderTaskId: string;
  evaluationVersion: string;
  supportedClaims: string[];
  partiallySupportedClaims: string[];
  unsupportedClaims: string[];
  conflictingClaims: string[];
  staleClaims: string[];
  missingFirsthandKnowledge: string[];
  missingTechnicalEvidence: string[];
  missingQuantitativeEvidence: string[];
  prohibitedClaims: string[];
  approvedFacts: string[];
  safeExclusions: string[];
  /** Structured readiness — not a false-precision composite score. */
  evidenceReadiness: {
    status: "ready" | "partial" | "blocked" | "needs_merchant_input";
    summary: string;
    blockingReasons: string[];
  };
  claimRequirements: ClaimRequirement[];
  materialHash: string;
  schemaVersion: string;
  pipelineVersions: PipelineVersionStamp;
}

export interface MerchantInterviewPacket {
  id: string;
  knowledgeClass: KnowledgeClass;
  reusableWhy: string;
  affectedClusterIds: string[];
  affectedReaderTaskIds: string[];
  questions: Array<{
    id: string;
    prompt: string;
    claimClasses: ClaimClass[];
    requiredScope: string;
    requiredUnits: string | null;
    requiredDateContext: string | null;
  }>;
  completionStatus: "open" | "answered_pending_approval" | "approved" | "closed";
  approvalRequired: true;
  usagePermissionRequired: true;
  materialHash: string;
}

export function emptyKnowledgeScope(partial: Partial<KnowledgeScope> = {}): KnowledgeScope {
  return {
    geographic: partial.geographic || "unspecified",
    processSurface: partial.processSurface || "unspecified",
    audiences: partial.audiences || [],
    products: partial.products || [],
    exclusions: partial.exclusions || [],
    applicableNotes: partial.applicableNotes || ""
  };
}

export function materialKnowledgeHash(entry: Omit<KnowledgeEntry, "materialHash" | "pipelineVersions">): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: entry.id,
        knowledgeClass: entry.knowledgeClass,
        normalizedClaim: entry.normalizedClaim,
        exactApprovedFact: entry.exactApprovedFact,
        scope: entry.scope,
        sourceType: entry.sourceType,
        sourceReference: entry.sourceReference,
        approvalState: entry.approvalState,
        approvedBy: entry.approvedBy,
        approvedAt: entry.approvedAt,
        approvalMethod: entry.approvalMethod,
        contentHash: entry.contentHash,
        revisionId: entry.revisionId,
        publicUsageAllowed: entry.publicUsageAllowed,
        usageScope: entry.usageScope,
        firsthand: entry.firsthand,
        confidence: entry.confidence,
        effectiveFrom: entry.effectiveFrom,
        effectiveTo: entry.effectiveTo,
        freshnessPolicyDays: entry.freshnessPolicyDays,
        contradictions: [...entry.contradictions].sort(),
        revokedAt: entry.revokedAt,
        revokeReason: entry.revokeReason
      })
    )
    .digest("hex");
}

/** Source types that can never satisfy approved claim requirements. */
export function sourceTypeCanSatisfyClaims(sourceType: KnowledgeSourceType): boolean {
  return !(
    sourceType === "inferred_seed" ||
    sourceType === "model_inference" ||
    sourceType === "template_example" ||
    sourceType === "unsupported_assertion"
  );
}

export function approvalStateCanSatisfyClaims(state: KnowledgeApprovalState): boolean {
  return state === "APPROVED";
}
