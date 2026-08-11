/**
 * M4 SourceEvidence attachment — explicit allowlist + required scope (fail closed).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SOURCE_EVIDENCE_ATTACHMENT_TYPES,
  allowedSourceTypesForClaimAttachment,
  isKnownSourceEvidenceAttachmentType,
  sourceEvidenceMayAttachToClaim,
  sourceEvidenceProcessScopeAllows,
  sourceEvidenceGeographicScopeAllows,
  KNOWLEDGE_EVALUATION_VERSION,
  type ClaimClass
} from "../src/research/index.js";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function baseSrc(partial: Partial<Parameters<typeof sourceEvidenceMayAttachToClaim>[0]> = {}) {
  return {
    id: "ev:test",
    summary: "Manufacturer specifies 300 DPI at final print size for apparel DTF transfers",
    sourceType: "manufacturer_documentation",
    approvalState: "APPROVED",
    publicUsageAllowed: true,
    evidenceRole: "technical_reference" as const,
    processSurface: "apparel_dtf" as const,
    geographicScope: "national" as const,
    ...partial
  };
}

test("M4 attachment: evaluation version pin reflects source-evidence allowlist", () => {
  assert.equal(KNOWLEDGE_EVALUATION_VERSION, "knowledgeEval.v1.2.source-evidence-allowlist");
});

test("M4 attachment: unknown source type cannot attach", () => {
  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc({ sourceType: "future_partner_feed" }),
    "technical",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /unknown|unlisted|allowlist/i);
  assert.equal(isKnownSourceEvidenceAttachmentType("future_partner_feed"), false);
});

test("M4 attachment: misspelled authoritative type cannot attach", () => {
  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc({ sourceType: "authoritative_technical_sourc" }),
    "technical",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /unknown|unlisted|allowlist/i);
});

test("M4 attachment: customer-question evidence remains demand-only", () => {
  const src = baseSrc({
    sourceType: "active_first_party_customer_evidence",
    evidenceRole: "customer_question",
    summary: "Customers ask what DPI artwork needs for apparel DTF"
  });
  const technical = sourceEvidenceMayAttachToClaim(src, "technical", "apparel_dtf", "national", NOW);
  assert.equal(technical.ok, false);
  assert.match(technical.reason, /demand/i);

  // Type is allowlisted for general_educational, but role remains demand-only framing.
  const educational = sourceEvidenceMayAttachToClaim(src, "general_educational", "apparel_dtf", "national", NOW);
  // Still needs process scope for apparel-specific educational claim surface
  assert.equal(educational.ok, true, educational.reason);
});

test("M4 attachment: each allowed source type is limited to its intended claim classes", () => {
  const intended: Record<(typeof SOURCE_EVIDENCE_ATTACHMENT_TYPES)[number], ClaimClass[]> = {
    manufacturer_documentation: [
      "technical",
      "safety_compliance",
      "product_behavior",
      "price_cost",
      "turnaround",
      "merchant_policy",
      "time_sensitive",
      "comparison_recommendation",
      "general_educational"
    ],
    authoritative_technical_source: [
      "technical",
      "safety_compliance",
      "product_behavior",
      "price_cost",
      "turnaround",
      "merchant_policy",
      "time_sensitive",
      "comparison_recommendation",
      "local_claim",
      "general_educational"
    ],
    public_government_standards: [
      "technical",
      "safety_compliance",
      "product_behavior",
      "comparison_recommendation",
      "general_educational"
    ],
    approved_merchant_firsthand: [
      "product_behavior",
      "price_cost",
      "turnaround",
      "merchant_policy",
      "time_sensitive",
      "merchant_experience",
      "customer_result",
      "local_claim",
      "comparison_recommendation",
      "general_educational"
    ],
    approved_business_fact_or_policy: [
      "price_cost",
      "turnaround",
      "merchant_policy",
      "time_sensitive",
      "local_claim",
      "comparison_recommendation",
      "general_educational"
    ],
    active_first_party_customer_evidence: [
      "customer_result",
      "local_claim",
      "general_educational"
    ]
  };

  for (const type of SOURCE_EVIDENCE_ATTACHMENT_TYPES) {
    const expected = new Set(intended[type]);
    for (const claimClass of Object.keys(intended).length
      ? ([
          "technical",
          "safety_compliance",
          "product_behavior",
          "price_cost",
          "turnaround",
          "merchant_policy",
          "time_sensitive",
          "merchant_experience",
          "customer_result",
          "local_claim",
          "comparison_recommendation",
          "general_educational"
        ] as ClaimClass[])
      : []) {
      const allowed = allowedSourceTypesForClaimAttachment(claimClass).has(type);
      assert.equal(
        allowed,
        expected.has(claimClass),
        `${type} vs ${claimClass}: expected ${expected.has(claimClass)} got ${allowed}`
      );
    }
  }

  // Merchant firsthand must not be allowlisted for technical/safety.
  assert.equal(allowedSourceTypesForClaimAttachment("technical").has("approved_merchant_firsthand"), false);
  assert.equal(allowedSourceTypesForClaimAttachment("safety_compliance").has("approved_business_fact_or_policy"), false);
});

test("M4 attachment: future source type requires an explicit policy decision", () => {
  assert.equal(SOURCE_EVIDENCE_ATTACHMENT_TYPES.includes("future_partner_feed" as never), false);
  assert.equal(isKnownSourceEvidenceAttachmentType("future_partner_feed"), false);
  // Policy surface is the allowlist helpers — unknown types never attach without updating them.
  const anyClaim: ClaimClass[] = [
    "technical",
    "general_educational",
    "price_cost",
    "merchant_experience"
  ];
  for (const claimClass of anyClaim) {
    assert.equal(allowedSourceTypesForClaimAttachment(claimClass).has("future_partner_feed" as never), false);
  }
});

test("M4 attachment: manufacturer evidence with matching apparel-DTF scope attaches", () => {
  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc(),
    "technical",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, true, attach.reason);
});

test("M4 attachment: authoritative evidence with missing process scope does not attach to apparel-DTF", () => {
  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc({
      sourceType: "authoritative_technical_source",
      processSurface: undefined
    }),
    "technical",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /missing required processSurface/i);
});

test("M4 attachment: UV DTF evidence cannot support apparel DTF", () => {
  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc({ processSurface: "uv_dtf_hard_surface" }),
    "technical",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /mismatch|UV|process/i);

  const scope = sourceEvidenceProcessScopeAllows("uv_dtf_hard_surface", "apparel_dtf", "technical");
  assert.equal(scope.ok, false);
});

test("M4 attachment: missing geography cannot support a local claim", () => {
  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc({
      sourceType: "approved_business_fact_or_policy",
      evidenceRole: "factual_answer",
      processSurface: "apparel_dtf",
      geographicScope: undefined,
      summary: "Local Warner Robins Friday pickup windows for spirit shirts"
    }),
    "local_claim",
    "apparel_dtf",
    "local",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /missing required geographicScope/i);
});

test("M4 attachment: local evidence cannot become national evidence", () => {
  const geo = sourceEvidenceGeographicScopeAllows("local", "national", "general_educational");
  assert.equal(geo.ok, false);

  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc({
      sourceType: "approved_business_fact_or_policy",
      evidenceRole: "factual_answer",
      geographicScope: "local",
      processSurface: "apparel_dtf"
    }),
    "general_educational",
    "apparel_dtf",
    "national",
    NOW
  );
  assert.equal(attach.ok, false);
  assert.match(attach.reason, /local|national|geographic/i);
});

test("M4 attachment: unspecified process/geo cannot satisfy specific claims", () => {
  assert.equal(
    sourceEvidenceProcessScopeAllows("unspecified", "apparel_dtf", "technical").ok,
    false
  );
  assert.equal(
    sourceEvidenceGeographicScopeAllows("unspecified", "local", "local_claim").ok,
    false
  );
});

test("M4 attachment: explicit general scope works only for process-independent claims", () => {
  const specific = sourceEvidenceProcessScopeAllows("general", "apparel_dtf", "technical");
  assert.equal(specific.ok, false);

  const independent = sourceEvidenceProcessScopeAllows("general", "general", "general_educational");
  assert.equal(independent.ok, true, independent.reason);

  const attach = sourceEvidenceMayAttachToClaim(
    baseSrc({
      sourceType: "approved_business_fact_or_policy",
      evidenceRole: "factual_answer",
      processSurface: "general",
      geographicScope: "national",
      summary: "General educational overview of print-shop planning vocabulary"
    }),
    "general_educational",
    "general",
    "national",
    NOW
  );
  assert.equal(attach.ok, true, attach.reason);
});
