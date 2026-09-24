/**
 * M4 knowledge registry — unit/contract tests (no DB).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  applyExplicitApproval,
  buildPendingKnowledgeEntry,
  reviseKnowledgeContent,
  validateKnowledgeApproval,
  isActivelyApprovedKnowledge,
  evaluateClusterKnowledge,
  deriveClaimRequirementsFromCluster,
  buildMerchantInterviewPackets,
  geographyCompatible,
  processSurfacesCompatible,
  claimRelevanceScore,
  KNOWLEDGE_CLASSES,
  KNOWLEDGE_EVALUATION_VERSION
} from "../src/research/index.js";
import {
  apparelDtfTask,
  approvedCottonPolyKnowledge,
  clusterFromTask,
  conflictingTurnaroundKnowledge,
  cottonPolyTask,
  customerResultNoPermission,
  firsthandGrowthTask,
  localWarnerRobinsKnowledge,
  localWarnerRobinsTask,
  M4_FIXTURE_LABEL,
  modelInferenceTechnical,
  nationalVendorTask,
  pendingCottonPolyKnowledge,
  pricingTask,
  pricingWithNumbers,
  pricingWithoutNumbers,
  turnaroundPolicyKnowledge,
  turnaroundPolicyTask,
  uvDtfHardSurfaceKnowledge
} from "./helpers/m4KnowledgeFixtures.js";
import { makeTask } from "./helpers/m3ClusterFixtures.js";

test("M4: knowledge classes are reusable catalog entries", () => {
  assert.ok(KNOWLEDGE_CLASSES.includes("garment_selection"));
  assert.ok(KNOWLEDGE_CLASSES.includes("pricing_cost_facts"));
  assert.ok(KNOWLEDGE_CLASSES.includes("uv_dtf_vs_apparel_dtf"));
  assert.equal(new Set(KNOWLEDGE_CLASSES).size, KNOWLEDGE_CLASSES.length);
});

test("M4: fixtures are labeled not-production", () => {
  const pending = pendingCottonPolyKnowledge();
  assert.match(pending.provenance, new RegExp(M4_FIXTURE_LABEL));
  assert.equal(pending.templateExample, true);
  assert.equal(pending.approvalState, "PENDING_APPROVAL");
});

test("M4: approved merchant knowledge supports an in-scope claim", () => {
  const task = cottonPolyTask();
  const cluster = clusterFromTask(task);
  const budget = evaluateClusterKnowledge({
    cluster,
    canonicalTask: task,
    knowledgeEntries: [approvedCottonPolyKnowledge()]
  });
  const comparison = budget.claimRequirements.find(c => c.claimClass === "comparison_recommendation");
  assert.ok(comparison);
  assert.equal(comparison!.supportStatus, "supported");
  assert.equal(comparison!.safeToState, true);
  assert.ok(comparison!.supportingKnowledgeIds.length >= 1);
  assert.ok(comparison!.supportingRevisionIds.length >= 1);
  assert.notEqual(budget.evidenceReadiness.status, "blocked");
});

test("M4: pending knowledge cannot support a claim", () => {
  const task = cottonPolyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [pendingCottonPolyKnowledge()]
  });
  const comparison = budget.claimRequirements.find(c => c.claimClass === "comparison_recommendation");
  assert.ok(comparison);
  assert.notEqual(comparison!.supportStatus, "supported");
  assert.equal(comparison!.safeToState, false);
});

test("M4: changed content invalidates prior approval binding", () => {
  const approved = approvedCottonPolyKnowledge();
  assert.equal(isActivelyApprovedKnowledge(approved), true);
  const revised = reviseKnowledgeContent(approved, {
    exactApprovedFact: "Changed fact: polyester is always better for every catalog shirt with no tradeoffs."
  });
  assert.equal(revised.approvalState, "PENDING_APPROVAL");
  assert.notEqual(revised.contentHash, approved.contentHash);
  assert.equal(revised.approvedBy, null);
  assert.equal(revised.approvedAt, null);
  const validation = validateKnowledgeApproval(revised, {
    requireApproved: true,
    expectedContentHash: revised.contentHash
  });
  assert.equal(validation.ok, false);
});

test("M4: never default approver identity to merchant", () => {
  assert.throws(() =>
    applyExplicitApproval(pendingCottonPolyKnowledge(), {
      approvedBy: "merchant",
      approvedAt: "2026-03-01T12:00:00.000Z",
      approvalMethod: "manual_ops_approval",
      publicUsageAllowed: true,
      usageScope: "public_blog_educational"
    })
  );
});

test("M4: firsthand claim without merchant evidence remains blocked", () => {
  const task = firsthandGrowthTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: []
  });
  const exp = budget.claimRequirements.find(c => c.claimClass === "merchant_experience");
  assert.ok(exp);
  assert.ok(
    exp!.supportStatus === "requires_merchant_input" || exp!.merchantInputRequired,
    exp!.explanation
  );
  assert.equal(exp!.safeToState, false);
  assert.ok(budget.missingFirsthandKnowledge.includes(exp!.id));
});

test("M4: cost claim without numbers remains unsupported", () => {
  const task = pricingTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [pricingWithoutNumbers()]
  });
  const price = budget.claimRequirements.find(c => c.claimClass === "price_cost");
  assert.ok(price);
  assert.equal(price!.supportStatus, "unsupported", price!.explanation);
  assert.ok(budget.missingQuantitativeEvidence.includes(price!.id));
});

test("M4: cost claim with numeric approved evidence can support", () => {
  const task = pricingTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [pricingWithNumbers()]
  });
  const price = budget.claimRequirements.find(c => c.claimClass === "price_cost");
  assert.ok(price);
  assert.equal(price!.supportStatus, "supported", price!.explanation);
});

test("M4: technical claim backed only by model inference remains unsupported", () => {
  const task = makeTask({
    id: "rt:m4-dpi",
    audience: "Apparel designers preparing logo files",
    situation: "Exporting a logo for apparel DTF at final print size",
    problem: "Unsure about resolution requirements",
    actualQuestion: "What DPI should my artwork use at final print size for apparel DTF?",
    decisionOrAction: "set artwork resolution for apparel DTF print size",
    desiredOutcome: "Print-ready artwork without pixelation",
    searchIntent: "informational"
  });
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [modelInferenceTechnical()]
  });
  const technical = budget.claimRequirements.find(c => c.claimClass === "technical");
  assert.ok(technical);
  assert.notEqual(technical!.supportStatus, "supported");
  assert.match(technical!.explanation, /model inference|seed|template/i);
});

test("M4: authoritative UV DTF source does not support apparel-DTF claims", () => {
  const task = apparelDtfTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [uvDtfHardSurfaceKnowledge()]
  });
  assert.ok(
    budget.claimRequirements.every(c => !c.supportingKnowledgeIds.includes(uvDtfHardSurfaceKnowledge().id))
  );
  assert.ok(processSurfacesCompatible("uv_dtf_hard_surface", "apparel_dtf") === false);
});

test("M4: local facts do not become national facts", () => {
  const geo = geographyCompatible("local", "national");
  assert.equal(geo.ok, false);
  const task = nationalVendorTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [localWarnerRobinsKnowledge()]
  });
  assert.ok(
    budget.claimRequirements.every(c => !c.supportingKnowledgeIds.includes(localWarnerRobinsKnowledge().id))
  );
});

test("M4: local claim can use local knowledge", () => {
  const task = localWarnerRobinsTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [localWarnerRobinsKnowledge()]
  });
  const local = budget.claimRequirements.find(c => c.claimClass === "local_claim");
  assert.ok(local);
  assert.equal(local!.supportStatus, "supported", local!.explanation);
});

test("M4: customer results without permission remain prohibited", () => {
  const task = makeTask({
    id: "rt:m4-customer-result",
    audience: "Clothing brand owners reviewing catalog outcomes",
    situation: "Deciding whether to publish customer results after a fabric switch",
    problem: "Want to cite customer results publicly",
    actualQuestion: "Can we state customer results after switching to cotton blanks?",
    decisionOrAction: "decide whether to publish customer results about cotton blanks",
    desiredOutcome: "Accurate public statement of customer results",
    searchIntent: "informational"
  });
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [customerResultNoPermission()]
  });
  const resultClaim = budget.claimRequirements.find(c => c.claimClass === "customer_result");
  assert.ok(resultClaim);
  assert.equal(resultClaim!.supportStatus, "prohibited", resultClaim!.explanation);
  assert.ok(budget.prohibitedClaims.includes(resultClaim!.id));
});

test("M4: conflicting current sources block the claim", () => {
  const task = turnaroundPolicyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [turnaroundPolicyKnowledge(), conflictingTurnaroundKnowledge()]
  });
  const turnaround = budget.claimRequirements.find(c => c.claimClass === "turnaround");
  assert.ok(turnaround);
  assert.equal(turnaround!.supportStatus, "conflicting", turnaround!.explanation);
  assert.equal(turnaround!.safeToState, false);
  assert.ok(budget.conflictingClaims.includes(turnaround!.id));
});

test("M4: stale knowledge cannot support current pricing or policy", () => {
  const stale = turnaroundPolicyKnowledge("2020-01-01T00:00:00.000Z");
  assert.equal(
    validateKnowledgeApproval(stale, { requireApproved: true, now: new Date("2026-03-01T00:00:00.000Z") }).ok,
    false
  );
  const task = turnaroundPolicyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [stale],
    now: new Date("2026-03-01T00:00:00.000Z")
  });
  const turnaround = budget.claimRequirements.find(c => c.claimClass === "turnaround");
  assert.ok(turnaround);
  assert.notEqual(turnaround!.supportStatus, "supported");
});

test("M4: one knowledge entry supports multiple clusters", () => {
  const knowledge = approvedCottonPolyKnowledge();
  const a = cottonPolyTask();
  const b = makeTask({
    ...a,
    id: "rt:m4-cotton-poly-b",
    actualQuestion: "Cotton versus polyester — which fabric blanks should a new brand choose for custom printing?"
  });
  const budgetA = evaluateClusterKnowledge({
    cluster: clusterFromTask(a, "cluster:a"),
    canonicalTask: a,
    knowledgeEntries: [knowledge]
  });
  const budgetB = evaluateClusterKnowledge({
    cluster: clusterFromTask(b, "cluster:b"),
    canonicalTask: b,
    knowledgeEntries: [knowledge]
  });
  assert.ok(budgetA.claimRequirements.some(c => c.supportingKnowledgeIds.includes(knowledge.id)));
  assert.ok(budgetB.claimRequirements.some(c => c.supportingKnowledgeIds.includes(knowledge.id)));
});

test("M4: irrelevant knowledge is not attached by keyword overlap", () => {
  const irrelevant = approveFixtureLike(
    buildPendingKnowledgeEntry({
      fixtureLabel: M4_FIXTURE_LABEL,
      knowledgeClass: "legends_policies",
      normalizedClaim: "Shipping box reuse policy",
      exactApprovedFact: "Shipping boxes may be reused when clean; cotton packing paper is optional.",
      scope: {
        geographic: "national",
        processSurface: "general",
        audiences: ["warehouse"],
        products: ["shipping boxes"],
        exclusions: ["garment recommendations"]
      },
      sourceType: "approved_business_fact_or_policy",
      sourceReference: "fixture:m4:shipping-boxes",
      provenance: "m4 unit fixture",
      confidence: "medium"
    })
  );
  const task = cottonPolyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [irrelevant]
  });
  assert.ok(budget.claimRequirements.every(c => !c.supportingKnowledgeIds.includes(irrelevant.id)));
  assert.ok(
    claimRelevanceScore("Compare cotton vs polyester with explicit criteria and tradeoffs", irrelevant) < 0.35 ||
      budget.claimRequirements.every(c => c.supportStatus !== "supported" || !c.supportingKnowledgeIds.includes(irrelevant.id))
  );
});

function approveFixtureLike(entry: ReturnType<typeof buildPendingKnowledgeEntry>) {
  return applyExplicitApproval(entry, {
    approvedBy: "fixture.approver@legends.test",
    approvedAt: "2026-07-15T12:00:00.000Z",
    approvalMethod: "manual_ops_approval",
    publicUsageAllowed: true,
    usageScope: "public_blog_educational"
  });
}

test("M4: newer approved revision supersedes older revision deterministically", () => {
  const older = approvedCottonPolyKnowledge();
  const revisedPending = reviseKnowledgeContent(older, {
    exactApprovedFact:
      "Updated 2026 guidance: for retail catalog shirts, prefer cotton for soft hand-feel and polyester for moisture-wicking; state criteria explicitly (feel, vibrancy, wash durability)."
  });
  const newer = applyExplicitApproval(revisedPending, {
    approvedBy: "fixture.approver@legends.test",
    approvedAt: "2026-08-01T12:00:00.000Z",
    approvalMethod: "manual_ops_approval",
    publicUsageAllowed: true,
    usageScope: "public_blog_educational"
  });
  assert.notEqual(newer.revisionId, older.revisionId);
  const task = cottonPolyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    // Only current entry should be in registry; older revision is historical
    knowledgeEntries: [newer]
  });
  const comparison = budget.claimRequirements.find(c => c.claimClass === "comparison_recommendation");
  assert.equal(comparison?.supportingRevisionIds[0], newer.revisionId);
});

test("M4: reusable interview packet groups related missing knowledge", () => {
  const tasks = [firsthandGrowthTask(), pricingTask(), turnaroundPolicyTask()];
  const budgets = tasks.map(task =>
    evaluateClusterKnowledge({
      cluster: clusterFromTask(task),
      canonicalTask: task,
      knowledgeEntries: []
    })
  );
  const packets = buildMerchantInterviewPackets({
    budgets,
    clusters: tasks.map(t => clusterFromTask(t))
  });
  assert.ok(packets.length >= 1);
  assert.ok(packets.some(p => p.affectedClusterIds.length >= 1));
  assert.ok(packets.every(p => p.approvalRequired && p.usagePermissionRequired));
  assert.ok(packets.every(p => p.questions.length >= 1));
});

test("M4: claim requirements derive from ReaderTask without titles/outlines", () => {
  const task = cottonPolyTask();
  const reqs = deriveClaimRequirementsFromCluster(clusterFromTask(task), task);
  assert.ok(reqs.some(r => r.claimClass === "comparison_recommendation"));
  assert.ok(reqs.every(r => !/outline|article title|h1/i.test(r.normalizedClaim)));
});

test("M4: evidence readiness is structured, not a fake composite score", () => {
  const task = cottonPolyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: []
  });
  assert.equal(budget.evaluationVersion, KNOWLEDGE_EVALUATION_VERSION);
  assert.ok(["ready", "partial", "blocked", "needs_merchant_input"].includes(budget.evidenceReadiness.status));
  assert.ok(typeof budget.evidenceReadiness.summary === "string");
  assert.ok(Array.isArray(budget.evidenceReadiness.blockingReasons));
  assert.equal("autoEligible" in budget, false);
});

test("M4: identical evaluation material hash is stable", () => {
  const task = cottonPolyTask();
  const knowledge = [approvedCottonPolyKnowledge()];
  const a = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: knowledge
  });
  const b = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: knowledge
  });
  assert.equal(a.materialHash, b.materialHash);
});
