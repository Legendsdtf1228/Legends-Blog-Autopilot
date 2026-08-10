/**
 * M2 provider contract tests for SourceEvidence ingestion.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  approvedFaqImportProvider,
  seedBrainstormEvidenceProvider,
  validateSourceEvidence,
  stampSourceEvidence,
  sourceEvidenceDemandStatus,
  isSeedBrainstormEvidence,
  DEFAULT_APPROVED_FAQ_PATH
} from "../src/research/index.js";
import { defaultSettings } from "../src/defaults.js";

test("M2 contract: approved FAQ provider loads real first-party file (not seeds)", async () => {
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-01T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: join(process.cwd(), DEFAULT_APPROVED_FAQ_PATH)
  });
  assert.equal(result.available, true, result.reason);
  assert.ok(result.evidence.length >= 2, "expected approved FAQ records");
  for (const row of result.evidence) {
    assert.equal(row.sourceType, "approved_customer_faq");
    assert.equal(row.provider, "approved_customer_faq_import");
    assert.equal(row.schemaVersion, "sourceEvidence.v1");
    assert.equal(row.pipelineVersions.milestone, "M2");
    assert.notEqual(row.sourceType, "seed_brainstorm");
    assert.equal(isSeedBrainstormEvidence(row), false);
    assert.equal(sourceEvidenceDemandStatus(row), "observed");
    assert.ok(row.provenance.description.includes("no customer PII"));
    assert.ok(row.normalizedQuestion.length >= 12);
  }
});

test("M2 contract: unavailable approved FAQ path reports honestly", async () => {
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date(),
    region: "Middle Georgia",
    env: { APPROVED_FAQ_IMPORT_PATH: "/tmp/does-not-exist-approved-faq.json" }
  });
  assert.equal(result.available, false);
  assert.equal(result.evidence.length, 0);
  assert.match(result.reason || "", /unavailable/i);
});

test("M2 contract: malformed FAQ records are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-malformed-"));
  const path = join(dir, "bad.json");
  await writeFile(
    path,
    JSON.stringify([
      { id: "ok", audience: "Middle Georgia school spirit coordinators", situation: "ordering shirts before kickoff weekend", problem: "unsure which decoration method fits the deadline", question: "Which decoration method should we use for 40 spirit shirts before Friday?", decisionOrAction: "choose a decoration method and order", desiredOutcome: "on-time shirts", evidenceSummary: "approved" },
      { notAnId: true },
      "string-row"
    ]),
    "utf8"
  );
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date(),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(result.available, true);
  assert.ok(result.rejected.length >= 2);
  assert.ok(result.evidence.length >= 1);
});

test("M2 contract: duplicate source references in one batch are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-dup-"));
  const path = join(dir, "dup.json");
  const row = {
    id: "faq:dup-1",
    audience: "Middle Georgia school spirit coordinators",
    situation: "ordering shirts before kickoff weekend",
    problem: "unsure which decoration method fits the deadline",
    question: "Which decoration method should we use for 40 spirit shirts before Friday?",
    decisionOrAction: "choose a decoration method and order",
    desiredOutcome: "on-time shirts",
    evidenceSummary: "approved"
  };
  await writeFile(path, JSON.stringify([row, row]), "utf8");
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date(),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(result.evidence.length, 1);
  assert.ok(result.rejected.some(r => r.reasons.some(x => /duplicate/i.test(x))));
});

test("M2 contract: stale evidence is structurally valid but marked stale", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-stale-"));
  const path = join(dir, "stale.json");
  await writeFile(
    path,
    JSON.stringify([
      {
        id: "faq:stale-1",
        audience: "Middle Georgia school spirit coordinators",
        situation: "ordering shirts before kickoff weekend",
        problem: "unsure which decoration method fits the deadline",
        question: "Which decoration method should we use for 40 spirit shirts before Friday?",
        decisionOrAction: "choose a decoration method and order",
        desiredOutcome: "on-time shirts",
        evidenceSummary: "approved historical FAQ",
        periodStart: "2020-01-01",
        periodEnd: "2020-06-01"
      }
    ]),
    "utf8"
  );
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-01T00:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]!.freshness, "stale");
});

test("M2 contract: privacy-safe provenance rejects PII patterns", () => {
  const bad = stampSourceEvidence({
    provider: "test",
    providerVersion: "t.v1",
    sourceType: "manually_approved_import",
    sourceReference: "manual:1",
    collectedAt: new Date().toISOString(),
    periodStart: null,
    periodEnd: null,
    geographicRelevance: null,
    normalizedProblem: "Customer needs help choosing a printer for a team order",
    normalizedQuestion: "How should a local team choose a custom shirt printer?",
    evidenceSummary: "Contact Jane Doe at jane.doe@example.com for details",
    metrics: {},
    confidence: "medium",
    freshness: "fresh",
    provenance: { description: "Call +1 478-555-0100 about the order" }
  });
  const validation = validateSourceEvidence(bad);
  assert.equal(validation.ok, false);
  assert.ok(validation.reasons.some(r => /PII/i.test(r)));
});

test("M2 contract: seed brainstorm is inferred_seed and brainstorm-only", async () => {
  const result = await seedBrainstormEvidenceProvider.collect({
    collectedAt: new Date(),
    region: "Middle Georgia",
    env: {},
    seedKeywords: ["embroidery vs DTF for work shirts"]
  });
  assert.equal(result.available, true);
  assert.equal(result.evidence.length, 1);
  const row = result.evidence[0]!;
  assert.equal(row.sourceType, "seed_brainstorm");
  assert.equal(row.provenance.brainstormOnly, true);
  assert.equal(sourceEvidenceDemandStatus(row), "inferred_seed");
  assert.deepEqual(row.metrics, {});
});

test("M2 contract: evidence with unknown demand metrics stays observed without invented volume", async () => {
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date(),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: join(process.cwd(), DEFAULT_APPROVED_FAQ_PATH)
  });
  const row = result.evidence[0]!;
  assert.ok(!("volume" in row.metrics) || row.metrics.volume == null);
  assert.equal(sourceEvidenceDemandStatus(row), "observed");
});

test("M2 contract: production remains paused", () => {
  assert.equal(defaultSettings.enabled, false);
  assert.equal(defaultSettings.rolloutMode, "draft_only");
  assert.equal(defaultSettings.draftOnlyMode, true);
});
