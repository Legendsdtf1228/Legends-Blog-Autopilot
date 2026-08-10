/**
 * M2 SourceEvidence → ReaderTask normalization integration tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  approvedFaqImportProvider,
  buildSemanticFingerprint,
  DEFAULT_APPROVED_FAQ_PATH,
  isValidatedDemandReaderTask,
  normalizeSourceEvidenceToReaderTask,
  readerTaskMayBecomeAutoEligible,
  seedBrainstormEvidenceProvider,
  stampSourceEvidence
} from "../src/research/index.js";

test("M2 normalize: coherent approved FAQ becomes accepted ReaderTask", async () => {
  const collected = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-01T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: join(process.cwd(), DEFAULT_APPROVED_FAQ_PATH)
  });
  const spirit = collected.evidence.find(e => e.sourceReference.includes("spirit-shirt"));
  assert.ok(spirit);
  const result = normalizeSourceEvidenceToReaderTask([spirit!]);
  assert.equal(result.accepted, true, result.reasons.join("; "));
  assert.ok(result.task);
  assert.equal(isValidatedDemandReaderTask(result.task!), true);
  assert.equal(readerTaskMayBecomeAutoEligible(result.task!), true);
  assert.equal(result.task!.demandEvidence.status, "observed");
  assert.ok(result.task!.pipelineVersions);
  assert.equal(result.task!.pipelineVersions!.milestone, "M2");
  assert.match(result.statement, /needs to/i);
});

test("M2 normalize: generic buyers-should-know input is rejected", () => {
  const evidence = stampSourceEvidence({
    provider: "manual",
    providerVersion: "m.v1",
    sourceType: "manually_approved_import",
    sourceReference: "manual:generic",
    collectedAt: new Date().toISOString(),
    periodStart: null,
    periodEnd: null,
    geographicRelevance: null,
    normalizedProblem: "People want embroidery information",
    normalizedQuestion: "What should buyers know about embroidery?",
    evidenceSummary: "generic",
    metrics: {},
    confidence: "low",
    freshness: "fresh",
    provenance: { description: "manual import without PII" },
    audienceHint: "buyers",
    situationHint: "general interest",
    decisionHint: "learn more",
    desiredOutcomeHint: "information"
  });
  const result = normalizeSourceEvidenceToReaderTask([evidence]);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.some(r => /generic|Question|Audience|know about/i.test(r)));
});

test("M2 normalize: taxonomy leakage is rejected", () => {
  const evidence = stampSourceEvidence({
    provider: "manual",
    providerVersion: "m.v1",
    sourceType: "manually_approved_import",
    sourceReference: "manual:taxonomy",
    collectedAt: new Date().toISOString(),
    periodStart: null,
    periodEnd: null,
    geographicRelevance: null,
    normalizedProblem: "Unclear subcategory fit for production education",
    normalizedQuestion: "What should production education buyers know about the content pillar?",
    evidenceSummary: "taxonomy leak",
    metrics: {},
    confidence: "low",
    freshness: "fresh",
    provenance: { description: "manual import without PII" },
    audienceHint: "production education buyers",
    situationHint: "choosing a method from the seed catalog",
    decisionHint: "pick a subcategory",
    desiredOutcomeHint: "aligned pillar language"
  });
  const result = normalizeSourceEvidenceToReaderTask([evidence]);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.some(r => /Taxonomy|Audience|Question/i.test(r)));
});

test("M2 normalize: missing decision/action is rejected", () => {
  const evidence = stampSourceEvidence({
    provider: "manual",
    providerVersion: "m.v1",
    sourceType: "approved_support_question",
    sourceReference: "support:no-decision",
    collectedAt: new Date().toISOString(),
    periodStart: null,
    periodEnd: new Date().toISOString(),
    geographicRelevance: "Middle Georgia",
    normalizedProblem: "Unsure how to prepare artwork for a chest print",
    normalizedQuestion: "How should I evaluate logo resolution for DTF at the final print size before I order?",
    evidenceSummary: "support note",
    metrics: {},
    confidence: "high",
    freshness: "fresh",
    provenance: { description: "approved support question; no PII" },
    audienceHint: "New clothing-brand owners preparing first DTF orders",
    situationHint: "Uploading logo artwork for a first gang sheet",
    decisionHint: "",
    desiredOutcomeHint: "A print-ready file that stays sharp"
  });
  const result = normalizeSourceEvidenceToReaderTask([evidence]);
  assert.equal(result.accepted, false);
  assert.ok(result.reasons.some(r => /decision|action/i.test(r)));
});

test("M2 normalize: semantic fingerprint is stable", () => {
  const a = buildSemanticFingerprint({
    audience: "Middle Georgia school spirit coordinators",
    actualQuestion: "Which decoration method should we use for 40 spirit shirts before Friday?",
    decisionOrAction: "choose DTF or screen printing and place the order this week",
    situation: "Ordering about 40 spirit shirts before a Friday kickoff"
  });
  const b = buildSemanticFingerprint({
    audience: "Middle Georgia school spirit coordinators",
    actualQuestion: "Which decoration method should we use for 40 spirit shirts before Friday?",
    decisionOrAction: "choose DTF or screen printing and place the order this week",
    situation: "Ordering about 40 spirit shirts before a Friday kickoff"
  });
  assert.equal(a, b);
  assert.equal(a.length, 24);
});

test("M2 normalize: multiple evidence rows with same question support one task without M3 clustering", async () => {
  const collected = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-01T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: join(process.cwd(), DEFAULT_APPROVED_FAQ_PATH)
  });
  const base = collected.evidence.find(e => e.sourceReference.includes("artwork-dpi"));
  assert.ok(base);
  const duplicateSupport = stampSourceEvidence({
    ...base!,
    id: undefined,
    sourceReference: "faq:artwork-dpi-output-size-2026-01-support-mirror",
    evidenceSummary: "Second approved support note confirming the same customer question."
  });
  const result = normalizeSourceEvidenceToReaderTask([base!, duplicateSupport]);
  assert.equal(result.accepted, true, result.reasons.join("; "));
  assert.equal(result.supportingEvidenceIds.length, 2);
  assert.equal(result.task!.evidenceAvailable.length, 2);
});

test("M2 normalize: seed-only task cannot qualify as validated demand or AUTO input", async () => {
  const seeds = await seedBrainstormEvidenceProvider.collect({
    collectedAt: new Date(),
    region: "Middle Georgia",
    env: {},
    seedKeywords: ["cotton vs polyester shirts for custom printing"]
  });
  const result = normalizeSourceEvidenceToReaderTask(seeds.evidence);
  assert.equal(result.accepted, false);
  assert.ok(result.task);
  assert.equal(result.task!.demandEvidence.status, "inferred_seed");
  assert.equal(isValidatedDemandReaderTask(result.task!), false);
  assert.equal(readerTaskMayBecomeAutoEligible(result.task!), false);
  assert.ok(result.reasons.some(r => /Seed-only/i.test(r)));
});
