/**
 * Derive claim requirements from a canonical ReaderTask (M4).
 * Does not generate titles, outlines, or articles.
 */
import { createHash } from "node:crypto";
import type { OpportunityCluster } from "./opportunityCluster.js";
import type { ReaderTask } from "./readerTask.js";
import type { ClaimClass, ClaimRequirement } from "./knowledgeRegistry.js";
import { extractSemanticFeatures } from "./semanticClustering.js";

function claimId(clusterId: string, claimClass: ClaimClass, normalized: string): string {
  return createHash("sha1")
    .update(`${clusterId}|${claimClass}|${normalized.toLowerCase()}`)
    .digest("hex")
    .slice(0, 24);
}

function baseRequirement(
  cluster: OpportunityCluster,
  claimClass: ClaimClass,
  normalizedClaim: string,
  evidenceNeeded: string,
  verificationPlan: string,
  extras: Partial<ClaimRequirement> = {}
): ClaimRequirement {
  return {
    id: claimId(cluster.id, claimClass, normalizedClaim),
    clusterId: cluster.id,
    canonicalReaderTaskId: cluster.canonicalReaderTaskId,
    normalizedClaim,
    claimClass,
    evidenceNeeded,
    evidenceFound: [],
    supportingSourceEvidenceIds: [],
    supportingKnowledgeIds: [],
    supportingRevisionIds: [],
    supportStatus: "unsupported",
    confidence: "unknown",
    freshness: "unknown",
    contradictions: [],
    safeToState: false,
    qualificationRequired: false,
    merchantInputRequired: false,
    prohibitedWording: [],
    verificationPlan,
    explanation: "Not yet evaluated against approved knowledge/evidence.",
    ...extras
  };
}

/**
 * Propose claim requirements implied by the canonical ReaderTask.
 * Conservative: only claims clearly needed by the reader decision.
 */
export function deriveClaimRequirementsFromCluster(
  cluster: OpportunityCluster,
  canonicalTask: ReaderTask
): ClaimRequirement[] {
  const requirements: ClaimRequirement[] = [];
  const features = extractSemanticFeatures(canonicalTask);
  const blob = [
    canonicalTask.actualQuestion,
    canonicalTask.decisionOrAction,
    canonicalTask.problem,
    canonicalTask.situation,
    canonicalTask.desiredOutcome,
    ...(canonicalTask.constraints || [])
  ]
    .join(" ")
    .toLowerCase();

  requirements.push(
    baseRequirement(
      cluster,
      "general_educational",
      `Explain the decision factors for: ${canonicalTask.actualQuestion}`,
      "Approved educational or first-party evidence matching audience/situation",
      "Confirm sources address the same decision and audience before stating."
    )
  );

  if (features.decisionFamily === "choose_fabric" || /\b(cotton|polyester|fabric|blank)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "comparison_recommendation",
        "Compare cotton vs polyester (or relevant fabrics) with explicit criteria and tradeoffs",
        "Comparison criteria plus tradeoff evidence for the stated use case",
        "List criteria (feel, durability, print behavior, cost) with supporting sources."
      )
    );
    requirements.push(
      baseRequirement(
        cluster,
        "technical",
        "State garment/print behavior relevant to the fabric choice",
        "Authoritative technical or approved shop knowledge in apparel scope",
        "Cite technical source scoped to apparel DTF/garment selection."
      )
    );
  }

  if (features.decisionFamily === "choose_decoration_method" || /\b(dtf|screen print|embroidery|decoration method)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "comparison_recommendation",
        "Compare decoration methods with criteria for the stated quantity/deadline/use case",
        "Method tradeoff evidence matching quantity, deadline, and surface",
        "Do not blur UV DTF hard-surface with apparel DTF."
      )
    );
  }

  if (features.decisionFamily === "evaluate_artwork" || /\b(dpi|resolution|artwork|logo file)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "technical",
        "State artwork resolution / preparation requirements at final print size",
        "Authoritative technical artwork-prep guidance",
        "Verify units and final output size assumptions."
      )
    );
  }

  if (/\b(price|pricing|cost|budget|\$)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "price_cost",
        "State price or cost figures for the decision",
        "Approved current pricing or authoritative cited range with assumptions",
        "Numeric evidence required; otherwise leave UNKNOWN.",
        { prohibitedWording: ["cheap", "lowest price", "guaranteed price"] }
      )
    );
  }

  if (/\b(turnaround|deadline|friday|rush|business day)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "turnaround",
        "State turnaround or rush timeline relevant to the order",
        "Approved current business turnaround/policy facts",
        "Confirm effective dates; do not invent same-day promises."
      )
    );
  }

  if (/\b(policy|shipping|production day|monday through friday)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "merchant_policy",
        "State merchant policy relevant to fulfillment or production",
        "Approved current Legends policy fact",
        "Bind to approved policy revision with effective dates."
      )
    );
  }

  if (features.firsthand || /\b(firsthand|my shop|our shop|honest lessons)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "merchant_experience",
        "State firsthand merchant experience or lessons",
        "Approved merchant firsthand knowledge with usage permission",
        "Firsthand wording requires approved firsthand sourceType.",
        { merchantInputRequired: true }
      )
    );
  }

  if (/\b(customer results?|testimonial|our customers)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "customer_result",
        "State customer results or outcomes",
        "Approved customer evidence with explicit public-usage permission",
        "Without permission, claim is prohibited.",
        { prohibitedWording: ["guaranteed results"] }
      )
    );
  }

  if (features.geographyClass === "local" || /\b(warner robins|middle georgia|near me|local)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "local_claim",
        "State local relevance for Middle Georgia / Warner Robins decision context",
        "Approved local facts or local first-party evidence",
        "Do not promote local facts as national."
      )
    );
  }

  if (features.surfaceClass === "hard_surface_uv") {
    requirements.push(
      baseRequirement(
        cluster,
        "technical",
        "State UV DTF hard-surface process facts (not apparel DTF)",
        "Authoritative UV DTF / hard-surface documentation",
        "Reject apparel-DTF sources for this claim."
      )
    );
  }

  if (/\b(safety|compliance|wash|cure)\b/.test(blob)) {
    requirements.push(
      baseRequirement(
        cluster,
        "safety_compliance",
        "State safety or care/compliance guidance",
        "Authoritative standards or manufacturer documentation",
        "Prefer manufacturer/standards over generic blog claims."
      )
    );
  }

  // Deduplicate by id
  const seen = new Set<string>();
  return requirements.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}
