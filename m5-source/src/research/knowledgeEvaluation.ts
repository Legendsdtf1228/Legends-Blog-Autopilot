/**
 * Claim-level evidence evaluation and cluster evidence budgets (M4).
 * Never assigns AUTO_ELIGIBLE. Never converts seeds/templates/inference into approved facts.
 */
import { createHash } from "node:crypto";
import type { OpportunityCluster } from "./opportunityCluster.js";
import type { ReaderTask } from "./readerTask.js";
import { deriveClaimRequirementsFromCluster } from "./claimRequirements.js";
import { isActivelyApprovedKnowledge } from "./knowledgeApproval.js";
import {
  assessKnowledgeFreshness,
  allowedSourceTypesForClaimAttachment,
  claimClassAllowsSource,
  claimRelevanceScore,
  claimRequiresExplicitFreshness,
  factsContradict,
  geographyCompatible,
  hasUsableNumericEvidence,
  isKnownSourceEvidenceAttachmentType,
  isObservationScopedFact,
  knowledgeClassAligns,
  processSurfacesCompatible,
  resolveKnowledgePrecedence,
  sourceAuthorityRank,
  sourceEvidenceGeographicScopeAllows,
  sourceEvidenceProcessScopeAllows,
  type FreshnessAssessment
} from "./knowledgeAuthority.js";
import {
  KNOWLEDGE_EVALUATION_VERSION,
  type ClaimClass,
  type ClaimRequirement,
  type ClaimSupportStatus,
  type ClusterEvidenceBudgetM4,
  type GeographicKnowledgeScope,
  type KnowledgeEntry,
  type ProcessSurfaceScope
} from "./knowledgeRegistry.js";
import { extractSemanticFeatures } from "./semanticClustering.js";
import { createPipelineVersionStamp } from "./versioning.js";

export type SourceEvidenceRole = "customer_question" | "factual_answer" | "technical_reference" | "unknown";

export interface ActiveSourceEvidenceStub {
  id: string;
  summary: string;
  sourceType: string;
  approvalState: string;
  publicUsageAllowed: boolean;
  geographicScope?: GeographicKnowledgeScope;
  processSurface?: ProcessSurfaceScope;
  freshness?: "fresh" | "aging" | "stale" | "unknown";
  /** Explicit role — customer questions prove demand, not technical answers. */
  evidenceRole?: SourceEvidenceRole;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  freshnessPolicyDays?: number | null;
  checkedAt?: string | null;
}

export interface EvaluateClusterKnowledgeArgs {
  cluster: OpportunityCluster;
  canonicalTask: ReaderTask;
  knowledgeEntries: KnowledgeEntry[];
  sourceEvidence?: ActiveSourceEvidenceStub[];
  now?: Date;
}

function claimSurface(task: ReaderTask): ProcessSurfaceScope {
  const features = extractSemanticFeatures(task);
  if (features.surfaceClass === "hard_surface_uv") return "uv_dtf_hard_surface";
  if (features.surfaceClass === "apparel") return "apparel_dtf";
  if (/\bembroidery\b/i.test(task.actualQuestion + task.decisionOrAction)) return "embroidery";
  return "general";
}

function claimGeography(task: ReaderTask): GeographicKnowledgeScope {
  const features = extractSemanticFeatures(task);
  if (features.geographyClass === "local") return "local";
  if (features.geographyClass === "national") return "national";
  return "unspecified";
}

function mapFreshnessToClaim(status: FreshnessAssessment["status"]): ClaimRequirement["freshness"] {
  if (status === "fresh" || status === "aging" || status === "stale" || status === "unknown") return status;
  return "unknown";
}

function assessSourceEvidenceFreshness(
  src: ActiveSourceEvidenceStub,
  now: Date,
  opts: { timeSensitive: boolean }
): FreshnessAssessment {
  if (src.freshness === "stale") return { status: "stale", reason: "source evidence marked stale" };
  const synthetic = {
    approvalState: src.approvalState === "STALE" ? ("STALE" as const) : ("APPROVED" as const),
    effectiveFrom: src.effectiveFrom ?? src.checkedAt ?? null,
    effectiveTo: src.effectiveTo ?? null,
    freshnessPolicyDays: src.freshnessPolicyDays ?? null,
    approvedAt: src.checkedAt ?? null
  };
  return assessKnowledgeFreshness(synthetic, now, opts);
}

function inferEvidenceRole(src: ActiveSourceEvidenceStub): SourceEvidenceRole {
  if (src.evidenceRole) return src.evidenceRole;
  if (
    src.sourceType === "active_first_party_customer_evidence" ||
    /\b(customer question|faq question|asked whether|customers ask)\b/i.test(src.summary)
  ) {
    return "customer_question";
  }
  if (
    src.sourceType === "authoritative_technical_source" ||
    src.sourceType === "manufacturer_documentation" ||
    src.sourceType === "public_government_standards"
  ) {
    return "technical_reference";
  }
  return "unknown";
}

/**
 * Validate SourceEvidence before any partial-support attachment.
 * Uses an explicit claim-aware source-type allowlist (unknown types fail closed).
 * Customer-question evidence may prove demand, never technical answer evidence.
 * Scope-sensitive claims require explicit applicable process/geography metadata.
 */
export function sourceEvidenceMayAttachToClaim(
  src: ActiveSourceEvidenceStub,
  claimClass: ClaimClass,
  surface: ProcessSurfaceScope,
  geo: GeographicKnowledgeScope,
  now: Date
): { ok: boolean; reason: string } {
  if (src.approvalState !== "APPROVED") {
    return { ok: false, reason: "source evidence is not APPROVED" };
  }
  if (src.publicUsageAllowed !== true) {
    return { ok: false, reason: "source evidence lacks public-usage permission" };
  }

  if (!isKnownSourceEvidenceAttachmentType(src.sourceType)) {
    return {
      ok: false,
      reason: `unknown or unlisted sourceType "${src.sourceType}" cannot attach; explicit allowlist policy required`
    };
  }

  const role = inferEvidenceRole(src);
  if (role === "customer_question") {
    if (
      claimClass === "technical" ||
      claimClass === "safety_compliance" ||
      claimClass === "product_behavior" ||
      claimClass === "price_cost" ||
      claimClass === "turnaround" ||
      claimClass === "merchant_policy" ||
      claimClass === "time_sensitive" ||
      claimClass === "comparison_recommendation" ||
      claimClass === "merchant_experience" ||
      claimClass === "customer_result"
    ) {
      return {
        ok: false,
        reason: "customer-question evidence proves demand, not factual/technical answer evidence"
      };
    }
  }

  const allowedTypes = allowedSourceTypesForClaimAttachment(claimClass);
  if (!allowedTypes.has(src.sourceType)) {
    return {
      ok: false,
      reason: `sourceType ${src.sourceType} is not on the allowlist for claim class ${claimClass}`
    };
  }

  if (claimRequiresExplicitFreshness(claimClass)) {
    const fresh = assessSourceEvidenceFreshness(src, now, { timeSensitive: true });
    if (fresh.status === "stale") return { ok: false, reason: fresh.reason };
    if (fresh.status === "unknown" || fresh.status === "not_yet_effective") {
      return { ok: false, reason: fresh.reason };
    }
  } else if (src.freshness === "stale") {
    return { ok: false, reason: "source evidence is stale" };
  }

  const processScope = sourceEvidenceProcessScopeAllows(src.processSurface, surface, claimClass);
  if (!processScope.ok) return { ok: false, reason: processScope.reason };

  const geoScope = sourceEvidenceGeographicScopeAllows(src.geographicScope, geo, claimClass);
  if (!geoScope.ok) return { ok: false, reason: geoScope.reason };

  return { ok: true, reason: "eligible" };
}

function scopeMatchScore(
  entry: KnowledgeEntry,
  surface: ProcessSurfaceScope,
  geo: GeographicKnowledgeScope
): number {
  let score = 0;
  if (processSurfacesCompatible(entry.scope.processSurface, surface)) score += 2;
  else return -100;
  const geoOk = geographyCompatible(entry.scope.geographic, geo);
  if (!geoOk.ok) return -100;
  if (entry.scope.geographic === geo) score += 2;
  else score += 1;
  return score;
}

function evaluateOneClaim(
  requirement: ClaimRequirement,
  args: {
    task: ReaderTask;
    knowledgeEntries: KnowledgeEntry[];
    sourceEvidence: ActiveSourceEvidenceStub[];
    now: Date;
  }
): ClaimRequirement {
  const surface = claimSurface(args.task);
  const geo = claimGeography(args.task);
  const timeSensitive = claimRequiresExplicitFreshness(requirement.claimClass);
  const taskContext = [
    args.task.actualQuestion,
    args.task.decisionOrAction,
    args.task.problem,
    args.task.situation,
    args.task.desiredOutcome,
    ...(args.task.constraints || [])
  ].join(" ");
  const candidates: Array<{
    entry: KnowledgeEntry;
    relevance: number;
    scopeScore: number;
    observationOnly: boolean;
    authorityOk: boolean;
    authorityReason?: string;
  }> = [];

  for (const entry of args.knowledgeEntries) {
    let relevance = claimRelevanceScore(requirement.normalizedClaim, entry, taskContext);
    if (relevance <= 0) continue;
    if (knowledgeClassAligns(requirement.claimClass, entry.knowledgeClass)) {
      relevance = Math.min(1, relevance + 0.15);
    } else if (relevance < 0.4) {
      continue;
    }
    const scopeScore = scopeMatchScore(entry, surface, geo);
    if (scopeScore < 0) continue;
    const allow = claimClassAllowsSource(requirement.claimClass, entry);
    candidates.push({
      entry,
      relevance,
      scopeScore,
      observationOnly: allow.observationOnly === true,
      authorityOk: allow.ok,
      authorityReason: allow.reason
    });
  }

  candidates.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    return sourceAuthorityRank(b.entry.sourceType) - sourceAuthorityRank(a.entry.sourceType);
  });

  const evidenceFound: string[] = [];
  const supportingKnowledgeIds: string[] = [];
  const supportingRevisionIds: string[] = [];
  const supportingSourceEvidenceIds: string[] = [];
  const contradictions: string[] = [];
  let supportStatus: ClaimSupportStatus = "unsupported";
  let confidence: ClaimRequirement["confidence"] = "unknown";
  let freshness: ClaimRequirement["freshness"] = "unknown";
  let safeToState = false;
  let qualificationRequired = false;
  let merchantInputRequired = requirement.merchantInputRequired;
  let explanation = "No matching approved knowledge or active evidence.";

  const freshnessByEntry = new Map<string, FreshnessAssessment>();
  for (const c of candidates) {
    freshnessByEntry.set(
      c.entry.id,
      assessKnowledgeFreshness(c.entry, args.now, { timeSensitive })
    );
  }

  const activeApproved = candidates.filter(c => {
    if (!c.authorityOk) return false;
    if (!isActivelyApprovedKnowledge(c.entry, c.entry.contentHash, args.now)) return false;
    const fresh = freshnessByEntry.get(c.entry.id)!;
    if (timeSensitive) {
      if (fresh.status === "unknown" || fresh.status === "not_yet_effective" || fresh.status === "stale") {
        return false;
      }
    } else if (fresh.status === "stale" || fresh.status === "not_yet_effective") {
      return false;
    }
    return true;
  });

  // Detect contradictions among active approved candidates with high relevance.
  const material = activeApproved.filter(c => c.relevance >= 0.35);
  let hasMaterialConflict = false;
  for (let i = 0; i < material.length; i++) {
    for (let j = i + 1; j < material.length; j++) {
      const left = material[i]!.entry;
      const right = material[j]!.entry;
      if (!factsContradict(left.exactApprovedFact, right.exactApprovedFact)) continue;
      hasMaterialConflict = true;
      const resolved = resolveKnowledgePrecedence(left, right, material[i]!.scopeScore, material[j]!.scopeScore);
      if (!resolved.winner) {
        contradictions.push(
          `Unresolved contradiction between ${left.id}@${left.revisionId} and ${right.id}@${right.revisionId}`
        );
      } else {
        contradictions.push(
          `Material contradiction ${left.id} vs ${right.id}; diagnostic precedence prefers ${resolved.winner.id} but claim remains blocked`
        );
      }
    }
  }

  if (hasMaterialConflict) {
    supportStatus = "conflicting";
    explanation = "Material contradictions between current sources block this claim.";
    return {
      ...requirement,
      evidenceFound,
      supportingKnowledgeIds,
      supportingRevisionIds,
      supportingSourceEvidenceIds,
      supportStatus,
      confidence: "unknown",
      freshness: "unknown",
      contradictions,
      safeToState: false,
      qualificationRequired: true,
      merchantInputRequired,
      explanation
    };
  }

  // Prefer full (non-observation-only) support when available.
  const chosen =
    material.find(c => !c.observationOnly) ||
    material[0];

  if (chosen) {
    const entry = chosen.entry;
    const fresh = freshnessByEntry.get(entry.id)!;
    freshness = mapFreshnessToClaim(fresh.status);
    evidenceFound.push(entry.exactApprovedFact);
    supportingKnowledgeIds.push(entry.id);
    supportingRevisionIds.push(entry.revisionId);

    if (requirement.claimClass === "price_cost" && !hasUsableNumericEvidence(entry.exactApprovedFact)) {
      supportStatus = "unsupported";
      explanation = "Cost/price claim lacks usable numeric evidence; remains UNKNOWN.";
      merchantInputRequired = true;
    } else if (requirement.claimClass === "customer_result" && entry.publicUsageAllowed !== true) {
      supportStatus = "prohibited";
      explanation = "Customer-result claim lacks public-usage permission.";
      safeToState = false;
    } else if (
      chosen.observationOnly ||
      (requirement.claimClass === "product_behavior" && entry.sourceType === "approved_merchant_firsthand")
    ) {
      const scoped = isObservationScopedFact(entry.exactApprovedFact);
      supportStatus = "partially_supported";
      qualificationRequired = true;
      safeToState = false;
      explanation = scoped
        ? `Merchant observation ${entry.id} may qualify product behavior only as scoped shop experience — not a general technical fact.`
        : `Merchant firsthand ${entry.id} cannot be promoted to a general technical/product-behavior fact without observation scoping and authoritative support.`;
    } else if (requirement.claimClass === "comparison_recommendation") {
      const hasCriteria = /\b(criteria|tradeoff|versus|vs|because|when|if)\b/i.test(entry.exactApprovedFact);
      if (!hasCriteria && chosen.relevance < 0.55) {
        supportStatus = "partially_supported";
        qualificationRequired = true;
        explanation = "Comparison evidence incomplete; criteria/tradeoffs need qualification.";
      } else {
        supportStatus = "supported";
        safeToState = true;
        confidence = entry.confidence === "unknown" ? "medium" : entry.confidence;
        explanation = `Supported by approved knowledge ${entry.id} revision ${entry.revisionId}.`;
      }
    } else if (requirement.claimClass === "local_claim" && entry.scope.geographic !== "local") {
      supportStatus = "unsupported";
      explanation = "Local claim requires local-scoped knowledge.";
    } else {
      supportStatus = "supported";
      safeToState = true;
      confidence = entry.confidence === "unknown" ? "medium" : entry.confidence;
      explanation = `Supported by approved knowledge ${entry.id} revision ${entry.revisionId} (${entry.sourceType}).`;
    }
  } else {
    const pending = candidates.filter(c => c.entry.approvalState === "PENDING_APPROVAL");
    const revoked = candidates.filter(
      c => c.entry.approvalState === "REVOKED" || c.entry.approvalState === "INVALIDATED"
    );
    const stale = candidates.filter(c => {
      const f = freshnessByEntry.get(c.entry.id);
      return c.entry.approvalState === "STALE" || f?.status === "stale";
    });
    const missingFreshness = candidates.filter(c => {
      const f = freshnessByEntry.get(c.entry.id);
      return timeSensitive && f?.status === "unknown";
    });
    const notYet = candidates.filter(c => freshnessByEntry.get(c.entry.id)?.status === "not_yet_effective");
    const inferenceOnly = candidates.filter(
      c =>
        c.entry.sourceType === "model_inference" ||
        c.entry.sourceType === "inferred_seed" ||
        c.entry.sourceType === "template_example"
    );
    const noPermissionCustomer = candidates.filter(
      c =>
        requirement.claimClass === "customer_result" &&
        c.entry.publicUsageAllowed !== true &&
        (c.entry.sourceType === "active_first_party_customer_evidence" ||
          c.entry.sourceType === "approved_merchant_firsthand")
    );
    const merchantBlockedTechnical = candidates.filter(
      c =>
        !c.authorityOk &&
        (requirement.claimClass === "technical" || requirement.claimClass === "safety_compliance") &&
        (c.entry.sourceType === "approved_merchant_firsthand" ||
          c.entry.sourceType === "approved_business_fact_or_policy")
    );

    if (noPermissionCustomer.length) {
      supportStatus = "prohibited";
      explanation =
        "Customer-result evidence exists but public-usage permission is missing; claim remains prohibited.";
      safeToState = false;
    } else if (missingFreshness.length) {
      supportStatus = "unsupported";
      freshness = "unknown";
      explanation =
        "Time-sensitive claim requires explicit effective/checked date plus freshness window or expiration; remains UNKNOWN.";
      merchantInputRequired = true;
    } else if (notYet.length && !activeApproved.length) {
      supportStatus = "unsupported";
      freshness = "unknown";
      explanation = "Matching knowledge is not yet effective (future effectiveFrom).";
    } else if (stale.length && !activeApproved.length) {
      supportStatus = "stale";
      freshness = "stale";
      explanation =
        timeSensitive
          ? "Time-sensitive knowledge is stale (expired effectiveTo or exceeded freshness window)."
          : "Matching knowledge is stale and cannot support current claims.";
    } else if (merchantBlockedTechnical.length && !activeApproved.length) {
      supportStatus = "unsupported";
      explanation =
        requirement.claimClass === "safety_compliance"
          ? "Approved shop policy/merchant opinion cannot establish a safety requirement; authoritative or standards support required."
          : "Approved merchant opinion cannot fully support a technical specification; authoritative/manufacturer/standards support required.";
    } else if (
      requirement.claimClass === "merchant_experience" ||
      requirement.merchantInputRequired
    ) {
      supportStatus = "requires_merchant_input";
      merchantInputRequired = true;
      explanation = "Firsthand/merchant claim blocked until approved merchant knowledge exists.";
    } else if (inferenceOnly.length && !activeApproved.length) {
      supportStatus = "unsupported";
      explanation = "Only model inference/seed/template candidates found; they cannot satisfy claims.";
    } else if (pending.length) {
      supportStatus = "requires_merchant_input";
      merchantInputRequired = true;
      explanation = "Matching knowledge exists but is PENDING_APPROVAL.";
    } else if (revoked.length) {
      supportStatus = "unsupported";
      explanation = "Matching knowledge was revoked/invalidated and no longer supports claims.";
    } else if (requirement.claimClass === "price_cost") {
      supportStatus = "unsupported";
      merchantInputRequired = true;
      explanation = "Cost claim without numeric approved evidence remains UNKNOWN.";
    }

    // Hardened SourceEvidence attachment — validate type/approval/permission/freshness/scope/claim suitability.
    for (const src of args.sourceEvidence) {
      const attach = sourceEvidenceMayAttachToClaim(src, requirement.claimClass, surface, geo, args.now);
      if (!attach.ok) continue;
      const rel = claimRelevanceScore(
        requirement.normalizedClaim,
        {
          normalizedClaim: src.summary,
          exactApprovedFact: src.summary,
          knowledgeClass: "general_authoritative_education"
        },
        taskContext
      );
      if (rel < 0.35) continue;
      supportingSourceEvidenceIds.push(src.id);
      evidenceFound.push(`source_evidence:${src.id}`);
    }

    if (supportStatus === "unsupported" && supportingSourceEvidenceIds.length) {
      const roles = args.sourceEvidence
        .filter(s => supportingSourceEvidenceIds.includes(s.id))
        .map(inferEvidenceRole);
      if (roles.every(r => r === "customer_question")) {
        // Demand signal only — do not upgrade support for answer claims.
        explanation =
          "Customer-question SourceEvidence shows demand only; it is not factual answer or technical evidence.";
      } else if (
        requirement.claimClass === "general_educational" ||
        (requirement.claimClass === "technical" &&
          args.sourceEvidence.some(
            s =>
              supportingSourceEvidenceIds.includes(s.id) &&
              (s.sourceType === "authoritative_technical_source" ||
                s.sourceType === "manufacturer_documentation" ||
                s.sourceType === "public_government_standards")
          ))
      ) {
        supportStatus = "partially_supported";
        qualificationRequired = true;
        explanation =
          requirement.claimClass === "technical"
            ? "Authoritative SourceEvidence partially supports the technical claim; approved knowledge map still incomplete."
            : "Eligible SourceEvidence partially supports educational framing; approved knowledge map incomplete.";
      }
    }
  }

  return {
    ...requirement,
    evidenceFound,
    supportingKnowledgeIds,
    supportingRevisionIds,
    supportingSourceEvidenceIds,
    supportStatus,
    confidence,
    freshness,
    contradictions,
    safeToState,
    qualificationRequired,
    merchantInputRequired,
    explanation
  };
}

export function buildEvidenceBudgetMaterialHash(
  budget: Omit<ClusterEvidenceBudgetM4, "materialHash" | "pipelineVersions">
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        clusterId: budget.clusterId,
        evaluationVersion: budget.evaluationVersion,
        supportedClaims: budget.supportedClaims,
        partiallySupportedClaims: budget.partiallySupportedClaims,
        unsupportedClaims: budget.unsupportedClaims,
        conflictingClaims: budget.conflictingClaims,
        staleClaims: budget.staleClaims,
        missingFirsthandKnowledge: budget.missingFirsthandKnowledge,
        missingTechnicalEvidence: budget.missingTechnicalEvidence,
        missingQuantitativeEvidence: budget.missingQuantitativeEvidence,
        prohibitedClaims: budget.prohibitedClaims,
        approvedFacts: budget.approvedFacts,
        safeExclusions: budget.safeExclusions,
        evidenceReadiness: budget.evidenceReadiness,
        claimRequirements: budget.claimRequirements.map(c => ({
          id: c.id,
          supportStatus: c.supportStatus,
          supportingKnowledgeIds: c.supportingKnowledgeIds,
          supportingRevisionIds: c.supportingRevisionIds,
          contradictions: c.contradictions,
          safeToState: c.safeToState,
          freshness: c.freshness
        }))
      })
    )
    .digest("hex");
}

export function evaluateClusterKnowledge(args: EvaluateClusterKnowledgeArgs): ClusterEvidenceBudgetM4 {
  const now = args.now ?? new Date();
  const requirements = deriveClaimRequirementsFromCluster(args.cluster, args.canonicalTask).map(req =>
    evaluateOneClaim(req, {
      task: args.canonicalTask,
      knowledgeEntries: args.knowledgeEntries,
      sourceEvidence: args.sourceEvidence || [],
      now
    })
  );

  const supportedClaims = requirements.filter(r => r.supportStatus === "supported").map(r => r.id);
  const partiallySupportedClaims = requirements
    .filter(r => r.supportStatus === "partially_supported" || r.supportStatus === "requires_qualification")
    .map(r => r.id);
  const unsupportedClaims = requirements.filter(r => r.supportStatus === "unsupported").map(r => r.id);
  const conflictingClaims = requirements.filter(r => r.supportStatus === "conflicting").map(r => r.id);
  const staleClaims = requirements.filter(r => r.supportStatus === "stale").map(r => r.id);
  const prohibitedClaims = requirements.filter(r => r.supportStatus === "prohibited").map(r => r.id);
  const missingFirsthandKnowledge = requirements
    .filter(
      r =>
        r.supportStatus === "requires_merchant_input" ||
        (r.claimClass === "merchant_experience" && r.supportStatus !== "supported")
    )
    .map(r => r.id);
  const missingTechnicalEvidence = requirements
    .filter(
      r =>
        (r.claimClass === "technical" || r.claimClass === "safety_compliance" || r.claimClass === "product_behavior") &&
        (r.supportStatus === "unsupported" || r.supportStatus === "partially_supported")
    )
    .map(r => r.id);
  const missingQuantitativeEvidence = requirements
    .filter(r => r.claimClass === "price_cost" && r.supportStatus !== "supported")
    .map(r => r.id);

  const approvedFacts = [
    ...new Set(
      requirements.flatMap(r =>
        r.supportStatus === "supported" || r.supportStatus === "partially_supported" ? r.evidenceFound : []
      )
    )
  ].sort();

  const safeExclusions = [
    ...new Set(
      requirements
        .filter(r => !r.safeToState)
        .map(r => `Do not state: ${r.normalizedClaim} (${r.supportStatus})`)
    )
  ].sort();

  const blockingReasons: string[] = [];
  if (conflictingClaims.length) blockingReasons.push(`${conflictingClaims.length} conflicting claim(s)`);
  if (prohibitedClaims.length) blockingReasons.push(`${prohibitedClaims.length} prohibited claim(s)`);
  if (missingFirsthandKnowledge.length) blockingReasons.push("missing approved firsthand knowledge");
  if (missingQuantitativeEvidence.length) blockingReasons.push("missing quantitative cost/price evidence");
  if (staleClaims.length) blockingReasons.push("stale knowledge blocks current claims");
  if (unsupportedClaims.length) blockingReasons.push(`${unsupportedClaims.length} unsupported claim(s)`);

  let status: ClusterEvidenceBudgetM4["evidenceReadiness"]["status"] = "ready";
  if (conflictingClaims.length || prohibitedClaims.length) status = "blocked";
  else if (missingFirsthandKnowledge.length) status = "needs_merchant_input";
  else if (
    unsupportedClaims.length ||
    partiallySupportedClaims.length ||
    staleClaims.length ||
    missingTechnicalEvidence.length ||
    missingQuantitativeEvidence.length
  ) {
    status = "partial";
  }

  const summary =
    status === "ready"
      ? "All derived claim requirements are supported by approved in-scope evidence."
      : status === "blocked"
        ? `Blocked: ${blockingReasons.join("; ")}.`
        : status === "needs_merchant_input"
          ? `Merchant input required: ${blockingReasons.join("; ")}.`
          : `Partial evidence readiness: ${blockingReasons.join("; ") || "some claims incomplete"}.`;

  const withoutHash: Omit<ClusterEvidenceBudgetM4, "materialHash" | "pipelineVersions"> = {
    clusterId: args.cluster.id,
    canonicalReaderTaskId: args.cluster.canonicalReaderTaskId,
    evaluationVersion: KNOWLEDGE_EVALUATION_VERSION,
    supportedClaims,
    partiallySupportedClaims,
    unsupportedClaims,
    conflictingClaims,
    staleClaims,
    missingFirsthandKnowledge,
    missingTechnicalEvidence,
    missingQuantitativeEvidence,
    prohibitedClaims,
    approvedFacts,
    safeExclusions,
    evidenceReadiness: { status, summary, blockingReasons },
    claimRequirements: requirements,
    schemaVersion: "clusterEvidenceBudget.v1"
  };

  return {
    ...withoutHash,
    materialHash: buildEvidenceBudgetMaterialHash(withoutHash),
    pipelineVersions: createPipelineVersionStamp("M4")
  };
}

/** Convenience: whether a budget marks a claim as safely stateable. Never AUTO_ELIGIBLE. */
export function claimIsSafeToState(budget: ClusterEvidenceBudgetM4, claimId: string): boolean {
  const req = budget.claimRequirements.find(r => r.id === claimId);
  return Boolean(req?.safeToState && req.supportStatus === "supported");
}
