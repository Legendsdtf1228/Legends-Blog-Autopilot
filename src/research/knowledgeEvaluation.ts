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
  claimClassAllowsSource,
  claimRelevanceScore,
  factsContradict,
  geographyCompatible,
  hasUsableNumericEvidence,
  knowledgeClassAligns,
  processSurfacesCompatible,
  resolveKnowledgePrecedence,
  sourceAuthorityRank
} from "./knowledgeAuthority.js";
import {
  KNOWLEDGE_EVALUATION_VERSION,
  type ClaimRequirement,
  type ClaimSupportStatus,
  type ClusterEvidenceBudgetM4,
  type GeographicKnowledgeScope,
  type KnowledgeEntry,
  type ProcessSurfaceScope
} from "./knowledgeRegistry.js";
import { extractSemanticFeatures } from "./semanticClustering.js";
import { createPipelineVersionStamp } from "./versioning.js";

export interface ActiveSourceEvidenceStub {
  id: string;
  summary: string;
  sourceType: string;
  approvalState: string;
  publicUsageAllowed: boolean;
  geographicScope?: GeographicKnowledgeScope;
  processSurface?: ProcessSurfaceScope;
  freshness?: "fresh" | "aging" | "stale" | "unknown";
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

function freshnessOf(entry: KnowledgeEntry, now: Date): "fresh" | "aging" | "stale" | "unknown" {
  if (entry.approvalState === "STALE") return "stale";
  if (entry.effectiveTo) {
    const to = Date.parse(entry.effectiveTo);
    if (!Number.isNaN(to) && to < now.getTime()) return "stale";
  }
  if (entry.freshnessPolicyDays != null && entry.approvedAt) {
    const approved = Date.parse(entry.approvedAt);
    if (!Number.isNaN(approved)) {
      const ageDays = (now.getTime() - approved) / 86400000;
      if (ageDays > entry.freshnessPolicyDays) return "stale";
      if (ageDays > entry.freshnessPolicyDays * 0.7) return "aging";
      return "fresh";
    }
  }
  if (entry.approvedAt) return "fresh";
  return "unknown";
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
  const taskContext = [
    args.task.actualQuestion,
    args.task.decisionOrAction,
    args.task.problem,
    args.task.situation,
    args.task.desiredOutcome,
    ...(args.task.constraints || [])
  ].join(" ");
  const candidates: Array<{ entry: KnowledgeEntry; relevance: number; scopeScore: number }> = [];

  for (const entry of args.knowledgeEntries) {
    let relevance = claimRelevanceScore(requirement.normalizedClaim, entry, taskContext);
    if (relevance <= 0) continue;
    if (knowledgeClassAligns(requirement.claimClass, entry.knowledgeClass)) {
      relevance = Math.min(1, relevance + 0.15);
    } else if (relevance < 0.4) {
      // Non-aligned classes need stronger textual overlap to avoid keyword stretch.
      continue;
    }
    const scopeScore = scopeMatchScore(entry, surface, geo);
    if (scopeScore < 0) continue;
    candidates.push({ entry, relevance, scopeScore });
  }

  // Sort by relevance then authority for stable evaluation
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

  const activeApproved = candidates.filter(c => {
    if (!isActivelyApprovedKnowledge(c.entry, c.entry.contentHash, args.now)) return false;
    const allow = claimClassAllowsSource(requirement.claimClass, c.entry);
    return allow.ok;
  });

  // Strict numeric / permission rules
  if (requirement.claimClass === "price_cost" || requirement.claimClass === "time_sensitive") {
    // price and time-sensitive need freshness
  }

  // Detect contradictions among active approved candidates with high relevance.
  // Precedence is recorded for audit, but material conflicts always block support —
  // never silently choose the source that makes an article easier.
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

  const chosen = material[0];

  if (chosen) {
    const entry = chosen.entry;
    const fresh = freshnessOf(entry, args.now);
    freshness = fresh;
    evidenceFound.push(entry.exactApprovedFact);
    supportingKnowledgeIds.push(entry.id);
    supportingRevisionIds.push(entry.revisionId);

    if (fresh === "stale") {
      supportStatus = "stale";
      explanation =
        requirement.claimClass === "price_cost" ||
        requirement.claimClass === "turnaround" ||
        requirement.claimClass === "merchant_policy"
          ? "Pricing/policy/turnaround cannot be supported by stale knowledge."
          : "Matching knowledge is stale relative to freshness policy or effective window.";
      safeToState = false;
    } else if (requirement.claimClass === "price_cost" && !hasUsableNumericEvidence(entry.exactApprovedFact)) {
      supportStatus = "unsupported";
      explanation = "Cost/price claim lacks usable numeric evidence; remains UNKNOWN.";
      merchantInputRequired = true;
    } else if (requirement.claimClass === "customer_result" && entry.publicUsageAllowed !== true) {
      supportStatus = "prohibited";
      explanation = "Customer-result claim lacks public-usage permission.";
      safeToState = false;
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
    // Check why candidates failed
    const pending = candidates.filter(c => c.entry.approvalState === "PENDING_APPROVAL");
    const revoked = candidates.filter(c => c.entry.approvalState === "REVOKED" || c.entry.approvalState === "INVALIDATED");
    const stale = candidates.filter(c => c.entry.approvalState === "STALE" || freshnessOf(c.entry, args.now) === "stale");
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

    if (noPermissionCustomer.length) {
      supportStatus = "prohibited";
      explanation = "Customer-result evidence exists but public-usage permission is missing; claim remains prohibited.";
      safeToState = false;
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
    } else if (stale.length && !activeApproved.length) {
      supportStatus = "stale";
      explanation = "Matching knowledge is stale and cannot support current claims.";
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

    // Active source evidence may partially support educational claims
    const approvedSources = args.sourceEvidence.filter(
      s => s.approvalState === "APPROVED" && s.publicUsageAllowed
    );
    for (const src of approvedSources) {
      const rel = claimRelevanceScore(requirement.normalizedClaim, {
        normalizedClaim: src.summary,
        exactApprovedFact: src.summary,
        knowledgeClass: "general_authoritative_education"
      });
      if (rel >= 0.35) {
        supportingSourceEvidenceIds.push(src.id);
        evidenceFound.push(`source_evidence:${src.id}`);
      }
    }
    if (
      supportStatus === "unsupported" &&
      supportingSourceEvidenceIds.length &&
      (requirement.claimClass === "general_educational" || requirement.claimClass === "technical")
    ) {
      supportStatus = "partially_supported";
      qualificationRequired = true;
      explanation = "Active first-party/source evidence present but approved knowledge map incomplete.";
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

export function buildEvidenceBudgetMaterialHash(budget: Omit<ClusterEvidenceBudgetM4, "materialHash" | "pipelineVersions">): string {
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
          safeToState: c.safeToState
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
