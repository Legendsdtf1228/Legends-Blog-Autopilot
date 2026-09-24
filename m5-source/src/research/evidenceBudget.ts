/**
 * Evidence budget: can the locked sources fulfill the content promise?
 */
import type { ContentPromise } from "./contentPromise.js";
import type { LockedFactSheet } from "./types.js";

export interface EvidenceClaimPlan {
  claim: string;
  evidenceRequired: string;
  approvedSourceAvailable: boolean;
  firsthandRequired: boolean;
  currentDataRequired: boolean;
  technicalKnowledgeRequired: boolean;
}

export interface EvidenceBudget {
  claims: EvidenceClaimPlan[];
  unsupportedSections: string[];
  confidence: number;
  supportsCentralPromise: boolean;
  missingEvidence: string[];
  reasons: string[];
}

export function buildEvidenceBudget(args: {
  contentPromise: ContentPromise;
  factSheet?: LockedFactSheet | null;
  interviewComplete?: boolean;
  hasVerifiedPrices?: boolean;
  hasTechnicalFacts?: boolean;
  hasLocalFacts?: boolean;
  outline?: string[];
  readerQuestion?: string;
}): EvidenceBudget {
  const facts = args.factSheet;
  const businessFacts = facts?.businessFacts?.length || facts?.legendsFacts?.length || 0;
  const productFacts = facts?.productFacts?.length || 0;
  const externalFacts = facts?.externalFacts?.length || facts?.sourcedIndustryFacts?.length || 0;
  const interviewComplete = Boolean(args.interviewComplete);

  const claims: EvidenceClaimPlan[] = [];
  const unsupported: string[] = [];
  const missing: string[] = [];
  const reasons: string[] = [];

  if (args.contentPromise.requiresFirsthand) {
    const ok = interviewComplete;
    claims.push({
      claim: "Firsthand experience / lessons",
      evidenceRequired: "Approved merchant interview answers",
      approvedSourceAvailable: ok,
      firsthandRequired: true,
      currentDataRequired: false,
      technicalKnowledgeRequired: false
    });
    if (!ok) {
      unsupported.push("firsthand_experience");
      missing.push("Approved firsthand merchant experience");
      reasons.push("Firsthand promise lacks approved merchant interview answers.");
    }
  }

  if (args.contentPromise.requiresVerifiedNumbers) {
    const ok = Boolean(args.hasVerifiedPrices) || externalFacts > 0;
    claims.push({
      claim: "Cost / pricing / margin figures",
      evidenceRequired: "Current verified numbers or labeled calculation framework",
      approvedSourceAvailable: ok,
      firsthandRequired: false,
      currentDataRequired: true,
      technicalKnowledgeRequired: false
    });
    if (!ok) {
      unsupported.push("cost_pricing");
      missing.push("Verified cost/pricing data or explicit calculation framework");
      reasons.push("Cost/pricing promise lacks verified numbers.");
    }
  }

  if (args.contentPromise.requiresComparisonCriteria) {
    const outlineText = (args.outline || []).join(" ");
    const hasCriteria = /\b(durability|cost|detail|feel|wash|turnaround|criteria|compare|trade-?off)\b/i.test(
      `${outlineText} ${args.readerQuestion || ""}`
    );
    claims.push({
      claim: "Comparison criteria for each option",
      evidenceRequired: "Defined criteria + adequate evidence per option",
      approvedSourceAvailable: hasCriteria,
      firsthandRequired: false,
      currentDataRequired: false,
      technicalKnowledgeRequired: args.contentPromise.requiresTechnicalKnowledge
    });
    if (!hasCriteria) {
      unsupported.push("comparison_criteria");
      missing.push("Defined comparison criteria in outline/reader question");
      reasons.push("Comparison promise lacks defined criteria.");
    }
  }

  if (args.contentPromise.requiresActionableSteps) {
    const outlineText = (args.outline || []).join(" ");
    const hasSteps = /\b(ask|step|checklist|question|verify|measure|decide|compare|choose)\b/i.test(
      `${outlineText} ${args.readerQuestion || ""}`
    );
    claims.push({
      claim: "Actionable how-to steps / decision points",
      evidenceRequired: "Concrete steps, conditions, and exceptions",
      approvedSourceAvailable: hasSteps,
      firsthandRequired: false,
      currentDataRequired: false,
      technicalKnowledgeRequired: false
    });
    if (!hasSteps) {
      unsupported.push("actionable_steps");
      missing.push("Concrete steps / decision points");
      reasons.push("How-to promise lacks actionable outline detail.");
    }
  }

  if (args.contentPromise.requiresTechnicalKnowledge) {
    const serviceKnowledge = [...(facts?.businessFacts || []), ...(facts?.legendsFacts || [])]
      .join(" ")
      .match(/\b(dtf|uv dtf|embroidery|screen print|gang sheet|transfer|heat press)\b/i);
    const ok =
      Boolean(args.hasTechnicalFacts) ||
      productFacts > 0 ||
      externalFacts > 0 ||
      Boolean(serviceKnowledge);
    claims.push({
      claim: "Technical production guidance",
      evidenceRequired: "Approved product/service knowledge",
      approvedSourceAvailable: ok,
      firsthandRequired: false,
      currentDataRequired: false,
      technicalKnowledgeRequired: true
    });
    if (!ok) {
      unsupported.push("technical_knowledge");
      missing.push("Approved technical product/service knowledge");
      reasons.push("Technical promise lacks approved product/service knowledge.");
    }
  }

  if (args.contentPromise.requiresLocalRelevance) {
    const ok = Boolean(args.hasLocalFacts) || businessFacts > 0;
    claims.push({
      claim: "Genuine local commercial relevance",
      evidenceRequired: "Local buyer decision context (not just a city name)",
      approvedSourceAvailable: ok,
      firsthandRequired: false,
      currentDataRequired: false,
      technicalKnowledgeRequired: false
    });
    // Local commercial can proceed with business location facts + a clear buyer decision —
    // but location alone is not enough for firsthand/cost promises.
    if (!ok) {
      unsupported.push("local_relevance");
      missing.push("Local relevance beyond generic advice");
      reasons.push("Local commercial promise lacks local context.");
    }
  }

  // Business facts alone cannot fulfill subject-matter evidence
  if (
    businessFacts > 0 &&
    (args.contentPromise.requiresFirsthand || args.contentPromise.requiresVerifiedNumbers) &&
    unsupported.length
  ) {
    reasons.push("Location/services/turnaround facts cannot substitute for subject-matter evidence.");
  }

  const required = claims.length || 1;
  const satisfied = claims.filter(c => c.approvedSourceAvailable).length;
  const confidence = Number((satisfied / required).toFixed(4));
  const supportsCentralPromise = unsupported.length === 0;

  return {
    claims,
    unsupportedSections: unsupported,
    confidence,
    supportsCentralPromise,
    missingEvidence: missing,
    reasons
  };
}
