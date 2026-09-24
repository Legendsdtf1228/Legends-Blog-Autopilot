/**
 * M4 fixtures — clearly labeled NOT production-approved knowledge.
 * These cannot masquerade as production registry rows without explicit approval fields.
 */
import { createPipelineVersionStamp } from "../../src/research/versioning.js";
import {
  applyExplicitApproval,
  buildPendingKnowledgeEntry
} from "../../src/research/knowledgeBuilders.js";
import type { KnowledgeEntry } from "../../src/research/knowledgeRegistry.js";
import { createHash } from "node:crypto";
import type { OpportunityCluster } from "../../src/research/opportunityCluster.js";
import type { ReaderTask } from "../../src/research/readerTask.js";
import { OPPORTUNITY_CLUSTER_SCHEMA_VERSION, SEMANTIC_CLUSTERING_VERSION } from "../../src/research/opportunityCluster.js";
import { makeTask } from "./m3ClusterFixtures.js";

export const M4_FIXTURE_LABEL = "m4-test-corpus-not-production";

export function clusterFromTask(task: ReaderTask, id = `cluster:${task.id}`): OpportunityCluster {
  return {
    id,
    canonicalReaderTaskId: task.id,
    semanticFingerprint: task.semanticFingerprint,
    clusteringVersion: SEMANTIC_CLUSTERING_VERSION,
    status: "active",
    memberReaderTaskIds: [task.id],
    supportingSourceEvidenceIds: [`ev:${task.id}`],
    canonicalAudience: task.audience,
    canonicalSituation: task.situation,
    canonicalProblem: task.problem,
    canonicalQuestion: task.actualQuestion,
    canonicalDecision: task.decisionOrAction,
    canonicalIntent: task.searchIntent,
    canonicalDesiredOutcome: task.desiredOutcome,
    mergedEvidenceSummary: "fixture cluster",
    similarityExplanation: "singleton fixture cluster",
    mergeConfidence: 1,
    requiresManualReview: false,
    demandStatus: "observed",
    confidence: task.confidence,
    wordingVariants: [task.actualQuestion],
    conflicts: [],
    schemaVersion: OPPORTUNITY_CLUSTER_SCHEMA_VERSION,
    pipelineVersions: createPipelineVersionStamp("M3"),
    materialHash: createHash("sha256").update(`fixture-cluster|${id}`).digest("hex")
  };
}

export function cottonPolyTask(): ReaderTask {
  return makeTask({
    id: "rt:m4-cotton-poly",
    audience: "New clothing-brand owners preparing first blank orders",
    situation: "Choosing blanks for a small custom-print catalog launch",
    problem: "Unsure whether cotton or polyester blanks fit print quality and customer feel",
    actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
    decisionOrAction: "choose cotton or polyester fabric blanks for the first catalog run",
    desiredOutcome: "Blanks that print cleanly and feel right for retail customers",
    constraints: ["first catalog", "retail feel"],
    searchIntent: "commercial"
  });
}

export function firsthandGrowthTask(): ReaderTask {
  return makeTask({
    id: "rt:m4-firsthand-growth",
    audience: "Print shop owners seeking firsthand growth lessons",
    situation: "Scaling a small DTF shop after the first profitable year",
    problem: "Need honest lessons from running a print shop, not generic advice",
    actualQuestion: "What firsthand lessons matter when growing a DTF print shop?",
    decisionOrAction: "apply firsthand print-shop growth lessons to the next hiring and equipment plan",
    desiredOutcome: "Avoid common growth mistakes with firsthand operator guidance",
    searchIntent: "informational"
  });
}

export function pricingTask(): ReaderTask {
  return makeTask({
    id: "rt:m4-pricing",
    audience: "New clothing-brand owners budgeting first DTF orders",
    situation: "Setting a budget for a 48-piece catalog sample run",
    problem: "Unsure what price and cost assumptions to use",
    actualQuestion: "What price and cost should I budget for a 48-piece DTF sample run?",
    decisionOrAction: "set a numeric budget for the 48-piece DTF sample run",
    desiredOutcome: "A usable cost range before placing the order",
    searchIntent: "commercial"
  });
}

export function localWarnerRobinsTask(): ReaderTask {
  return makeTask({
    id: "rt:m4-local-wr",
    audience: "Middle Georgia school spirit coordinators in Warner Robins",
    situation: "Ordering local spirit wear near Warner Robins before Friday",
    problem: "Need a local printer who can hit Friday kickoff",
    actualQuestion: "Where should a Warner Robins school order local spirit shirts before Friday?",
    decisionOrAction: "choose a local Middle Georgia printer for Friday spirit shirts",
    desiredOutcome: "Local shirts arrive before kickoff",
    constraints: ["Friday deadline", "Warner Robins"],
    searchIntent: "local"
  });
}

export function nationalVendorTask(): ReaderTask {
  return makeTask({
    id: "rt:m4-national-vendor",
    audience: "US clothing brands comparing national decoration vendors",
    situation: "Selecting a national fulfillment partner for ongoing restocks",
    problem: "Need a nationwide-capable vendor, not a local-only shop",
    actualQuestion: "Which national decoration vendor should a US brand use for restocks?",
    decisionOrAction: "choose a national decoration vendor for US-wide restocks",
    desiredOutcome: "Reliable national restock capacity",
    searchIntent: "commercial"
  });
}

export function apparelDtfTask(): ReaderTask {
  return makeTask({
    id: "rt:m4-apparel-dtf",
    audience: "Small gift-shop owners adding custom apparel",
    situation: "Adding custom t-shirts beside the gift assortment",
    problem: "Unsure whether DTF transfers are right for apparel decoration",
    actualQuestion: "Should I use DTF transfers for custom apparel shirts?",
    decisionOrAction: "choose DTF transfers for apparel shirt decoration",
    desiredOutcome: "Soft durable prints on shirts",
    searchIntent: "commercial"
  });
}

export function turnaroundPolicyTask(): ReaderTask {
  return makeTask({
    id: "rt:m4-turnaround",
    audience: "School spirit coordinators planning Friday delivery",
    situation: "Confirming production and shipping policy before placing an order",
    problem: "Unsure about turnaround and production-day policy",
    actualQuestion: "What turnaround and production policy applies before a Friday deadline?",
    decisionOrAction: "confirm turnaround and production policy before ordering",
    desiredOutcome: "Know whether Friday is realistic under current policy",
    constraints: ["Friday deadline"],
    searchIntent: "commercial"
  });
}

/** Pending garment comparison fact — fixture, not production. */
export function pendingCottonPolyKnowledge(): KnowledgeEntry {
  return buildPendingKnowledgeEntry({
    fixtureLabel: M4_FIXTURE_LABEL,
    knowledgeClass: "garment_selection",
    normalizedClaim: "Cotton vs polyester blanks for custom retail catalog printing",
    exactApprovedFact:
      "For retail catalog shirts, choose cotton when soft hand-feel is the priority and polyester when moisture-wicking durability matters; tradeoff criteria are feel, print vibrancy, and wash durability.",
    scope: {
      geographic: "national",
      processSurface: "apparel_dtf",
      audiences: ["clothing-brand owners"],
      products: ["shirts", "blanks"],
      exclusions: ["UV DTF hard-surface", "tumblers"]
    },
    sourceType: "approved_merchant_firsthand",
    sourceReference: "fixture:m4:cotton-poly-comparison",
    provenance: "m4 unit fixture",
    firsthand: true,
    publicUsageAllowed: false,
    usageScope: "",
    confidence: "high"
  });
}

export function approveFixture(entry: KnowledgeEntry, who = "fixture.approver@legends.test"): KnowledgeEntry {
  return applyExplicitApproval(entry, {
    approvedBy: who,
    // Keep within typical freshness windows relative to the 2026 test "today".
    approvedAt: "2026-07-15T12:00:00.000Z",
    approvalMethod: "manual_ops_approval",
    publicUsageAllowed: true,
    usageScope: "public_blog_educational"
  });
}

export function approvedCottonPolyKnowledge(): KnowledgeEntry {
  return approveFixture(pendingCottonPolyKnowledge());
}

export function uvDtfHardSurfaceKnowledge(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "uv_dtf_vs_apparel_dtf",
      normalizedClaim: "UV DTF curing for hard-surface tumblers",
      exactApprovedFact:
        "UV DTF for hard-surface tumblers requires UV curing on non-textile substrates and is not an apparel DTF garment process.",
      scope: {
        geographic: "national",
        processSurface: "uv_dtf_hard_surface",
        audiences: ["gift-shop owners"],
        products: ["tumblers"],
        exclusions: ["apparel shirts", "textile DTF"]
      },
      sourceType: "manufacturer_documentation",
      sourceReference: "fixture:m4:uv-dtf-tumbler",
      provenance: "m4 unit fixture",
      firsthand: false,
      confidence: "high"
    })
  );
}

export function localWarnerRobinsKnowledge(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "local_customer_needs",
      normalizedClaim: "Warner Robins local spirit shirt Friday pickup",
      exactApprovedFact:
        "In Warner Robins / Middle Georgia, local spirit coordinators often need Friday game-day pickup windows that national ship-to-school timelines cannot guarantee.",
      scope: {
        geographic: "local",
        processSurface: "apparel_dtf",
        audiences: ["school spirit coordinators"],
        products: ["spirit shirts"],
        exclusions: ["national restock programs"]
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:local-wr-friday",
      provenance: "m4 unit fixture",
      firsthand: false,
      confidence: "medium",
      effectiveFrom: "2026-06-01T00:00:00.000Z",
      freshnessPolicyDays: 365
    })
  );
}

export function pricingWithoutNumbers(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "pricing_cost_facts",
      normalizedClaim: "DTF sample run pricing guidance",
      exactApprovedFact: "Sample runs are affordable for most new brands depending on complexity.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["clothing-brand owners"],
        products: ["DTF transfers"],
        exclusions: []
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:pricing-no-numbers",
      provenance: "m4 unit fixture",
      confidence: "low"
    })
  );
}

export function pricingWithNumbers(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "pricing_cost_facts",
      normalizedClaim: "DTF 48-piece sample run cost range",
      exactApprovedFact:
        "A 48-piece apparel DTF sample run commonly budgets $180-$320 in transfer cost before blanks, assuming single-location artwork and standard film; confirm current quote.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["clothing-brand owners"],
        products: ["DTF transfers"],
        exclusions: ["contract screen-print pricing"]
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:pricing-with-numbers",
      provenance: "m4 unit fixture",
      confidence: "medium",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      freshnessPolicyDays: 120
    })
  );
}

export function modelInferenceTechnical(): KnowledgeEntry {
  return buildPendingKnowledgeEntry({
    fixtureLabel: M4_FIXTURE_LABEL,
    knowledgeClass: "technical_specifications",
    normalizedClaim: "Artwork DPI for apparel DTF",
    exactApprovedFact: "Model suggests 300 DPI at final print size is usually enough for apparel DTF.",
    scope: {
      geographic: "national",
      processSurface: "apparel_dtf",
      audiences: ["designers"],
      products: ["artwork"],
      exclusions: []
    },
    sourceType: "model_inference",
    sourceReference: "fixture:m4:model-dpi",
    provenance: "m4 unit fixture — model inference only",
    confidence: "low",
    approvalState: "PENDING_APPROVAL"
  });
}

export function customerResultNoPermission(): KnowledgeEntry {
  const pending = buildPendingKnowledgeEntry({
    fixtureLabel: M4_FIXTURE_LABEL,
    knowledgeClass: "print_shop_growth_lessons",
    normalizedClaim: "Customer result after switching to cotton blanks",
    exactApprovedFact: "Our customers reported fewer returns after switching catalog shirts to cotton blanks.",
    scope: {
      geographic: "national",
      processSurface: "apparel_dtf",
      audiences: ["clothing-brand owners"],
      products: ["shirts"],
      exclusions: []
    },
    sourceType: "active_first_party_customer_evidence",
    sourceReference: "fixture:m4:customer-result-no-permission",
    provenance: "m4 unit fixture",
    firsthand: false,
    publicUsageAllowed: false,
    usageScope: "",
    confidence: "medium"
  });
  // Force APPROVED-looking state without usage permission — builders would demote; construct manually for test.
  return {
    ...pending,
    approvalState: "APPROVED",
    approvedBy: "fixture.approver@legends.test",
    approvedAt: "2026-07-15T12:00:00.000Z",
    approvalMethod: "manual_ops_approval",
    publicUsageAllowed: false,
    usageScope: "internal_only"
  };
}

export function turnaroundPolicyKnowledge(effectiveTo?: string | null): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "fulfillment_turnaround",
      normalizedClaim: "Standard production turnaround before Friday deadlines",
      exactApprovedFact:
        "Standard apparel DTF production runs Monday through Friday; rush Friday delivery requires approval by Wednesday noon under current policy.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["school spirit coordinators"],
        products: ["spirit shirts"],
        exclusions: ["same-day guarantees"]
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:turnaround-policy",
      provenance: "m4 unit fixture",
      confidence: "high",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      effectiveTo: effectiveTo === undefined ? null : effectiveTo,
      freshnessPolicyDays: 120
    })
  );
}

export function conflictingTurnaroundKnowledge(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "fulfillment_turnaround",
      normalizedClaim: "Standard production turnaround before Friday deadlines",
      exactApprovedFact:
        "We never offer Friday delivery for apparel DTF spirit shirts; all Friday requests are declined under current policy.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["school spirit coordinators"],
        products: ["spirit shirts"],
        exclusions: []
      },
      sourceType: "approved_merchant_firsthand",
      sourceReference: "fixture:m4:turnaround-conflict",
      provenance: "m4 unit fixture conflicting",
      firsthand: true,
      confidence: "medium",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      freshnessPolicyDays: 120
    })
  );
}

/** Approved price with numbers but no freshness policy — must not support time-sensitive claims. */
export function oldApprovedPriceWithoutFreshnessPolicy(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "pricing_cost_facts",
      normalizedClaim: "DTF 48-piece sample run cost range",
      exactApprovedFact:
        "A 48-piece apparel DTF sample run commonly budgets $180-$320 in transfer cost before blanks.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["clothing-brand owners"],
        products: ["DTF transfers"],
        exclusions: []
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:pricing-no-freshness",
      provenance: "m4 correction fixture — missing freshness metadata",
      confidence: "medium"
      // intentionally no effectiveFrom / freshnessPolicyDays / effectiveTo
    })
  );
}

/** Current turnaround approved but missing freshness metadata. */
export function turnaroundWithoutFreshnessMetadata(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "fulfillment_turnaround",
      normalizedClaim: "Standard production turnaround before Friday deadlines",
      exactApprovedFact:
        "Standard apparel DTF production runs Monday through Friday; rush Friday delivery requires approval by Wednesday noon under current policy.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["school spirit coordinators"],
        products: ["spirit shirts"],
        exclusions: ["same-day guarantees"]
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:turnaround-no-freshness",
      provenance: "m4 correction fixture — missing freshness metadata",
      confidence: "high"
    })
  );
}

export function futureEffectivePolicy(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "legends_policies",
      normalizedClaim: "Production day policy before Friday deadlines",
      exactApprovedFact:
        "Updated policy: apparel DTF production runs Tuesday through Saturday starting next season.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["school spirit coordinators"],
        products: ["spirit shirts"],
        exclusions: []
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:policy-future-effective",
      provenance: "m4 correction fixture — future effectiveFrom",
      confidence: "high",
      effectiveFrom: "2027-01-01T00:00:00.000Z",
      freshnessPolicyDays: 180
    })
  );
}

export function merchantOpinionTechnicalDpi(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "technical_specifications",
      normalizedClaim: "Artwork DPI for apparel DTF",
      exactApprovedFact: "We think 300 DPI at final print size is enough for apparel DTF logos.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["designers"],
        products: ["artwork"],
        exclusions: []
      },
      sourceType: "approved_merchant_firsthand",
      sourceReference: "fixture:m4:merchant-dpi-opinion",
      provenance: "m4 correction fixture — merchant opinion not technical authority",
      firsthand: true,
      confidence: "medium"
    })
  );
}

export function shopPolicyAsSafetyClaim(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "legends_policies",
      normalizedClaim: "Wash and cure safety requirement for apparel DTF",
      exactApprovedFact: "Shop policy requires customers to wash garments inside-out; we treat this as a safety rule.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["customers"],
        products: ["apparel DTF"],
        exclusions: []
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:policy-as-safety",
      provenance: "m4 correction fixture — policy is not safety authority",
      confidence: "medium",
      effectiveFrom: "2026-07-01T00:00:00.000Z",
      freshnessPolicyDays: 365
    })
  );
}

export function manufacturerDpiDocumentation(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "technical_specifications",
      normalizedClaim: "Artwork DPI for apparel DTF at final print size",
      exactApprovedFact:
        "Manufacturer documentation specifies a minimum of 300 DPI at final print size for apparel DTF transfers.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["designers"],
        products: ["artwork", "DTF transfers"],
        exclusions: ["UV DTF hard-surface"]
      },
      sourceType: "manufacturer_documentation",
      sourceReference: "fixture:m4:mfr-dpi-apparel",
      provenance: "m4 correction fixture — manufacturer documentation",
      confidence: "high"
    })
  );
}

export function manufacturerDpiUvOnly(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "technical_specifications",
      normalizedClaim: "Artwork DPI for UV DTF hard-surface",
      exactApprovedFact:
        "Manufacturer UV DTF documentation specifies 400 DPI for hard-surface tumbler artwork at final size.",
      scope: {
        geographic: "national",
        processSurface: "uv_dtf_hard_surface",
        audiences: ["designers"],
        products: ["tumblers"],
        exclusions: ["apparel DTF"]
      },
      sourceType: "manufacturer_documentation",
      sourceReference: "fixture:m4:mfr-dpi-uv",
      provenance: "m4 correction fixture — UV scope only",
      confidence: "high"
    })
  );
}

export function merchantObservationProductBehavior(): KnowledgeEntry {
  return approveFixture(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "dtf_shop_operations",
      normalizedClaim: "Observed cotton blank print hand-feel in our shop",
      exactApprovedFact:
        "In our shop we have observed that cotton blanks print with a softer hand-feel than polyester under the same apparel DTF settings.",
      scope: {
        geographic: "national",
        processSurface: "apparel_dtf",
        audiences: ["print shop owners"],
        products: ["cotton blanks", "polyester blanks"],
        exclusions: ["general manufacturer specification"]
      },
      sourceType: "approved_merchant_firsthand",
      sourceReference: "fixture:m4:merchant-observation-handfeel",
      provenance: "m4 correction fixture — scoped observation",
      firsthand: true,
      confidence: "medium"
    })
  );
}
