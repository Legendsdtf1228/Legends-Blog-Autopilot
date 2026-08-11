/**
 * M4 claim-safety corrections — freshness, technical authority, SourceEvidence hardening.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assessKnowledgeFreshness,
  claimClassAllowsSource,
  claimRequiresExplicitFreshness,
  evaluateClusterKnowledge,
  sourceEvidenceMayAttachToClaim,
  KNOWLEDGE_EVALUATION_VERSION
} from "../src/research/index.js";
import {
  approvedCottonPolyKnowledge,
  clusterFromTask,
  cottonPolyTask,
  firsthandGrowthTask,
  futureEffectivePolicy,
  manufacturerDpiDocumentation,
  manufacturerDpiUvOnly,
  merchantObservationProductBehavior,
  merchantOpinionTechnicalDpi,
  oldApprovedPriceWithoutFreshnessPolicy,
  pricingTask,
  pricingWithNumbers,
  shopPolicyAsSafetyClaim,
  turnaroundPolicyKnowledge,
  turnaroundPolicyTask,
  turnaroundWithoutFreshnessMetadata
} from "./helpers/m4KnowledgeFixtures.js";
import { makeTask } from "./helpers/m3ClusterFixtures.js";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function dpiTask() {
  return makeTask({
    id: "rt:m4-corr-dpi",
    audience: "Apparel designers preparing logo files",
    situation: "Exporting a logo for apparel DTF at final print size",
    problem: "Unsure about resolution requirements",
    actualQuestion: "What DPI should my artwork use at final print size for apparel DTF?",
    decisionOrAction: "set artwork resolution for apparel DTF print size",
    desiredOutcome: "Print-ready artwork without pixelation",
    searchIntent: "informational"
  });
}

function safetyTask() {
  return makeTask({
    id: "rt:m4-corr-safety",
    audience: "DTF shop operators reviewing wash guidance",
    situation: "Publishing wash and cure compliance guidance for apparel DTF",
    problem: "Need authoritative safety/compliance wash guidance",
    actualQuestion: "What wash and cure safety compliance guidance applies to apparel DTF garments?",
    decisionOrAction: "state wash and cure safety compliance guidance for apparel DTF",
    desiredOutcome: "Accurate safety/compliance wash guidance",
    searchIntent: "informational"
  });
}

test("M4 correction: evaluation version pin reflects claim-safety", () => {
  assert.equal(KNOWLEDGE_EVALUATION_VERSION, "knowledgeEval.v1.1.claim-safety");
  assert.equal(claimRequiresExplicitFreshness("price_cost"), true);
  assert.equal(claimRequiresExplicitFreshness("turnaround"), true);
  assert.equal(claimRequiresExplicitFreshness("merchant_policy"), true);
  assert.equal(claimRequiresExplicitFreshness("general_educational"), false);
});

test("M4 correction: old approved price without freshness policy is blocked", () => {
  const task = pricingTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [oldApprovedPriceWithoutFreshnessPolicy()],
    now: NOW
  });
  const price = budget.claimRequirements.find(c => c.claimClass === "price_cost");
  assert.ok(price);
  assert.notEqual(price!.supportStatus, "supported");
  assert.equal(price!.safeToState, false);
  assert.match(price!.explanation, /freshness|UNKNOWN/i);
});

test("M4 correction: current pricing with explicit valid window succeeds", () => {
  const task = pricingTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [pricingWithNumbers()],
    now: NOW
  });
  const price = budget.claimRequirements.find(c => c.claimClass === "price_cost");
  assert.equal(price?.supportStatus, "supported", price?.explanation);
  assert.equal(price?.safeToState, true);
});

test("M4 correction: expired pricing is stale", () => {
  const expired = pricingWithNumbers();
  const staleEntry = {
    ...expired,
    effectiveTo: "2026-07-15T00:00:00.000Z",
    freshnessPolicyDays: 30
  };
  const assessment = assessKnowledgeFreshness(staleEntry, NOW, { timeSensitive: true });
  assert.equal(assessment.status, "stale");

  const task = pricingTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [staleEntry],
    now: NOW
  });
  const price = budget.claimRequirements.find(c => c.claimClass === "price_cost");
  assert.equal(price?.supportStatus, "stale", price?.explanation);
});

test("M4 correction: future-effective policy is blocked until effective", () => {
  const task = turnaroundPolicyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [futureEffectivePolicy()],
    now: NOW
  });
  const policy = budget.claimRequirements.find(
    c => c.claimClass === "merchant_policy" || c.claimClass === "turnaround"
  );
  assert.ok(policy);
  assert.notEqual(policy!.supportStatus, "supported");
  assert.match(policy!.explanation, /not yet effective|future|freshness|UNKNOWN/i);
});

test("M4 correction: current turnaround without freshness metadata is blocked", () => {
  const task = turnaroundPolicyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [turnaroundWithoutFreshnessMetadata()],
    now: NOW
  });
  const turnaround = budget.claimRequirements.find(c => c.claimClass === "turnaround");
  assert.ok(turnaround);
  assert.notEqual(turnaround!.supportStatus, "supported");
  assert.match(turnaround!.explanation, /freshness|UNKNOWN/i);
});

test("M4 correction: timeless educational knowledge usable without price-style freshness window", () => {
  const task = cottonPolyTask();
  const knowledge = approvedCottonPolyKnowledge();
  assert.equal(knowledge.freshnessPolicyDays, null);
  assert.equal(knowledge.effectiveFrom, null);
  const assessment = assessKnowledgeFreshness(knowledge, NOW, { timeSensitive: false });
  assert.equal(assessment.status, "fresh");

  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [knowledge],
    now: NOW
  });
  const comparison = budget.claimRequirements.find(c => c.claimClass === "comparison_recommendation");
  assert.equal(comparison?.supportStatus, "supported", comparison?.explanation);
});

test("M4 correction: identical evaluation is idempotent until freshness boundary crosses", () => {
  const task = pricingTask();
  const knowledge = pricingWithNumbers();
  const t1 = new Date("2026-08-10T12:00:00.000Z");
  const t2 = new Date("2026-08-11T12:00:00.000Z");
  const beforeBoundary = new Date("2026-10-28T12:00:00.000Z"); // still within 120d from 2026-07-01
  const afterBoundary = new Date("2026-11-01T12:00:00.000Z"); // beyond 120d window

  const a = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [knowledge],
    now: t1
  });
  const b = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [knowledge],
    now: t2
  });
  assert.equal(a.materialHash, b.materialHash);

  const mid = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [knowledge],
    now: beforeBoundary
  });
  const priceMid = mid.claimRequirements.find(c => c.claimClass === "price_cost");
  assert.equal(priceMid?.supportStatus, "supported", priceMid?.explanation);

  const late = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [knowledge],
    now: afterBoundary
  });
  const priceLate = late.claimRequirements.find(c => c.claimClass === "price_cost");
  assert.equal(priceLate?.supportStatus, "stale", priceLate?.explanation);
  assert.notEqual(mid.materialHash, late.materialHash);

  const lateAgain = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [knowledge],
    now: afterBoundary
  });
  assert.equal(late.materialHash, lateAgain.materialHash);
});

test("M4 correction: approved merchant opinion cannot fully support a technical specification", () => {
  const allow = claimClassAllowsSource("technical", merchantOpinionTechnicalDpi());
  assert.equal(allow.ok, false);

  const task = dpiTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [merchantOpinionTechnicalDpi()],
    now: NOW
  });
  const technical = budget.claimRequirements.find(c => c.claimClass === "technical");
  assert.ok(technical);
  assert.notEqual(technical!.supportStatus, "supported");
  assert.match(technical!.explanation, /merchant|authoritative|technical specification/i);
});

test("M4 correction: approved shop policy cannot establish a safety requirement", () => {
  const allow = claimClassAllowsSource("safety_compliance", shopPolicyAsSafetyClaim());
  assert.equal(allow.ok, false);

  const task = safetyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [shopPolicyAsSafetyClaim()],
    now: NOW
  });
  const safety = budget.claimRequirements.find(c => c.claimClass === "safety_compliance");
  assert.ok(safety);
  assert.notEqual(safety!.supportStatus, "supported");
  assert.match(safety!.explanation, /safety|authoritative|standards|policy/i);
});

test("M4 correction: manufacturer documentation with matching process scope succeeds", () => {
  const task = dpiTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [manufacturerDpiDocumentation()],
    now: NOW
  });
  const technical = budget.claimRequirements.find(c => c.claimClass === "technical");
  assert.equal(technical?.supportStatus, "supported", technical?.explanation);
  assert.equal(technical?.safeToState, true);
});

test("M4 correction: authoritative evidence with mismatched process scope fails", () => {
  const task = dpiTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [manufacturerDpiUvOnly()],
    now: NOW
  });
  const technical = budget.claimRequirements.find(c => c.claimClass === "technical");
  assert.ok(technical);
  assert.notEqual(technical!.supportStatus, "supported");
  assert.ok(!technical!.supportingKnowledgeIds.includes(manufacturerDpiUvOnly().id));
});

test("M4 correction: merchant observation can support a narrowly qualified firsthand claim", () => {
  const task = firsthandGrowthTask();
  const firsthandFact = {
    ...merchantObservationProductBehavior(),
    knowledgeClass: "print_shop_growth_lessons" as const,
    normalizedClaim: "Firsthand print-shop growth lesson about equipment and hiring sequence",
    exactApprovedFact:
      "Firsthand lesson from running our print shop: hire production help before buying a second heat press; in our shop we have observed fulfillment bottlenecks when growth outpaces staffing."
  };
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [firsthandFact],
    now: NOW
  });
  const exp = budget.claimRequirements.find(c => c.claimClass === "merchant_experience");
  assert.ok(exp);
  assert.equal(exp!.supportStatus, "supported", exp!.explanation);
});

test("M4 correction: merchant observation plus authoritative evidence preserves experience vs general fact", () => {
  const task = dpiTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [merchantObservationProductBehavior(), manufacturerDpiDocumentation()],
    now: NOW
  });
  const technical = budget.claimRequirements.find(c => c.claimClass === "technical");
  assert.equal(technical?.supportStatus, "supported", technical?.explanation);
  assert.ok(technical!.supportingKnowledgeIds.includes(manufacturerDpiDocumentation().id));
  assert.ok(!technical!.supportingKnowledgeIds.includes(merchantObservationProductBehavior().id));

  // Observation alone on product behavior remains qualified, not general technical fact
  const fabricTask = cottonPolyTask();
  const productBudget = evaluateClusterKnowledge({
    cluster: clusterFromTask(fabricTask, "cluster:obs-product"),
    canonicalTask: fabricTask,
    knowledgeEntries: [merchantObservationProductBehavior()],
    now: NOW
  });
  const productBehavior = productBudget.claimRequirements.find(c => c.claimClass === "product_behavior");
  // cotton/poly task may not always derive product_behavior; technical must not be fully supported by observation
  const tech = productBudget.claimRequirements.find(c => c.claimClass === "technical");
  if (tech) {
    assert.notEqual(tech.supportStatus, "supported");
  }
  if (productBehavior) {
    assert.notEqual(productBehavior.supportStatus, "supported");
    assert.equal(productBehavior.qualificationRequired, true);
  }
});

test("M4 correction: customer-question SourceEvidence cannot partially support technical claims", () => {
  const task = dpiTask();
  const attach = sourceEvidenceMayAttachToClaim(
    {
      id: "ev:customer-q-dpi",
      summary: "Customers ask what DPI artwork needs for apparel DTF logos",
      sourceType: "active_first_party_customer_evidence",
      approvalState: "APPROVED",
      publicUsageAllowed: true,
      evidenceRole: "customer_question",
      processSurface: "apparel_dtf",
      geographicScope: "national"
    },
    "technical",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /demand|not factual|technical/i);

  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [],
    sourceEvidence: [
      {
        id: "ev:customer-q-dpi",
        summary: "Customers ask what DPI artwork needs for apparel DTF at final print size",
        sourceType: "active_first_party_customer_evidence",
        approvalState: "APPROVED",
        publicUsageAllowed: true,
        evidenceRole: "customer_question",
        processSurface: "apparel_dtf",
        geographicScope: "national"
      }
    ],
    now: NOW
  });
  const technical = budget.claimRequirements.find(c => c.claimClass === "technical");
  assert.ok(technical);
  assert.notEqual(technical!.supportStatus, "partially_supported");
  assert.notEqual(technical!.supportStatus, "supported");
  assert.ok(!technical!.supportingSourceEvidenceIds.includes("ev:customer-q-dpi"));
});

test("M4 correction: time-sensitive SourceEvidence without freshness cannot attach", () => {
  const attach = sourceEvidenceMayAttachToClaim(
    {
      id: "ev:price-faq",
      summary: "Approved FAQ answer stating $200 sample-run pricing for apparel DTF",
      sourceType: "approved_business_fact_or_policy",
      approvalState: "APPROVED",
      publicUsageAllowed: true,
      evidenceRole: "factual_answer",
      processSurface: "apparel_dtf",
      geographicScope: "national"
      // missing freshness metadata
    },
    "price_cost",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /freshness|effective|UNKNOWN|window/i);
});
