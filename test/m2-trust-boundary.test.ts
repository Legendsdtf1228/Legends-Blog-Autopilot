/**
 * M2 trust-boundary tests: approval authority, provenance, revocation, idempotency.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, migrate } from "../src/db.js";
import {
  approvePendingSourceEvidence,
  approvedFaqImportProvider,
  computeEvidenceContentHash,
  invalidateApprovalIfContentChanged,
  isValidatedDemandReaderTask,
  normalizeSourceEvidenceToReaderTask,
  pendingFaqTemplateProvider,
  persistSourceEvidenceBatch,
  readerTaskMayBecomeAutoEligible,
  revokeSourceEvidenceApproval,
  runSourceEvidenceIngestion,
  sourceEvidenceDemandStatus,
  stampSourceEvidence,
  validateEvidenceApproval,
  DEFAULT_PENDING_FAQ_TEMPLATE_PATH
} from "../src/research/index.js";
import { buildExplicitlyApprovedFaqRecord } from "./helpers/approvedFaqFixture.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

test("M2 trust: missing approvedBy is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-no-by-"));
  const path = join(dir, "x.json");
  const row = buildExplicitlyApprovedFaqRecord({ id: "faq:no-by", approvedBy: null as unknown as string });
  delete (row as { approvedBy?: string | null }).approvedBy;
  await writeFile(path, JSON.stringify([row]), "utf8");
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(result.evidence.length, 0);
  assert.ok(result.rejected.some(r => r.reasons.some(x => /approvedBy/i.test(x))));
});

test("M2 trust: missing approvedAt is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-no-at-"));
  const path = join(dir, "x.json");
  const row = buildExplicitlyApprovedFaqRecord({ id: "faq:no-at" });
  delete (row as { approvedAt?: string | null }).approvedAt;
  await writeFile(path, JSON.stringify([row]), "utf8");
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(result.evidence.length, 0);
  assert.ok(result.rejected.some(r => r.reasons.some(x => /approvedAt/i.test(x))));
});

test("M2 trust: importer never defaults merchant approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-merchant-default-"));
  const path = join(dir, "x.json");
  await writeFile(
    path,
    JSON.stringify([
      {
        id: "faq:legacy-shape",
        audience: "Middle Georgia school spirit coordinators",
        situation: "Ordering about 40 spirit shirts before a Friday kickoff with a fixed budget",
        problem: "Unsure whether DTF transfers or screen printing will hit the deadline",
        question: "Which decoration method should we use for 40 spirit shirts before Friday kickoff?",
        decisionOrAction: "choose DTF or screen printing and place the order this week",
        desiredOutcome: "Shirts arrive on time with acceptable durability for game day",
        evidenceSummary: "legacy record without approval fields"
      }
    ]),
    "utf8"
  );
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(result.evidence.length, 0);
  assert.ok(!result.rejected.some(r => r.reasons.some(x => /defaulted|merchant/i.test(x) && /assigned/i.test(x))));
  assert.ok(result.rejected.some(r => r.reasons.some(x => /approvedBy|approvalState|APPROVED/i.test(x))));
  assert.ok(
    result.rejected.every(r => !r.reasons.some(x => /default.*merchant/i.test(x))),
    "must not invent merchant default"
  );
});

test("M2 trust: generic approvedBy=merchant is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-generic-merchant-"));
  const path = join(dir, "x.json");
  await writeFile(
    path,
    JSON.stringify([buildExplicitlyApprovedFaqRecord({ id: "faq:generic-merchant", approvedBy: "merchant" })]),
    "utf8"
  );
  const result = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(result.evidence.length, 0);
  assert.ok(result.rejected.some(r => r.reasons.some(x => /explicit identity|merchant/i.test(x))));
});

test("M2 trust: pending examples cannot create accepted ReaderTasks", async () => {
  const pending = await pendingFaqTemplateProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    pendingFaqPath: join(process.cwd(), DEFAULT_PENDING_FAQ_TEMPLATE_PATH)
  });
  assert.ok(pending.evidence.length >= 1);
  const result = normalizeSourceEvidenceToReaderTask([pending.evidence[0]!]);
  assert.equal(result.accepted, false);
  assert.equal(result.task?.demandEvidence.status, "unavailable");
  assert.equal(result.task?.confidence, "low");
  assert.equal(isValidatedDemandReaderTask(result.task!), false);
  assert.equal(readerTaskMayBecomeAutoEligible(result.task!), false);
  assert.equal(sourceEvidenceDemandStatus(pending.evidence[0]!), "unavailable");
});

test("M2 trust: agent-generated fixtures cannot become observed demand", async () => {
  const pending = await pendingFaqTemplateProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    pendingFaqPath: join(process.cwd(), DEFAULT_PENDING_FAQ_TEMPLATE_PATH)
  });
  for (const row of pending.evidence) {
    assert.notEqual(sourceEvidenceDemandStatus(row), "observed");
    assert.notEqual(sourceEvidenceDemandStatus(row), "verified");
    assert.equal(row.confidence, "unknown");
  }
});

test("M2 trust: future or malformed approval dates are rejected", () => {
  const future = validateEvidenceApproval(
    {
      approvalState: "APPROVED",
      approvedBy: "ops:test-approver@legends.local",
      approvedAt: "2099-01-01T00:00:00.000Z",
      approvalMethod: "manual_ops_approval",
      contentHash: "a".repeat(64),
      publicUsageAllowed: true,
      usageScope: "public_blog_editorial",
      revokedAt: null,
      revokedBy: null,
      revokeReason: null
    },
    { requireApproved: true, now: new Date("2026-02-10T12:00:00Z"), expectedContentHash: "a".repeat(64) }
  );
  assert.equal(future.ok, false);
  assert.ok(future.reasons.some(r => /future/i.test(r)));

  const malformed = validateEvidenceApproval(
    {
      approvalState: "APPROVED",
      approvedBy: "ops:test-approver@legends.local",
      approvedAt: "not-a-date",
      approvalMethod: "manual_ops_approval",
      contentHash: "a".repeat(64),
      publicUsageAllowed: true,
      usageScope: "public_blog_editorial",
      revokedAt: null,
      revokedBy: null,
      revokeReason: null
    },
    { requireApproved: true, now: new Date("2026-02-10T12:00:00Z"), expectedContentHash: "a".repeat(64) }
  );
  assert.equal(malformed.ok, false);
  assert.ok(malformed.reasons.some(r => /malformed/i.test(r)));
});

test("M2 trust: explicitly approved immutable record succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "faq-ok-"));
  const path = join(dir, "ok.json");
  const record = buildExplicitlyApprovedFaqRecord({ id: "faq:immutable-ok" });
  await writeFile(path, JSON.stringify([record]), "utf8");
  const collected = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  assert.equal(collected.evidence.length, 1);
  const normalized = normalizeSourceEvidenceToReaderTask(collected.evidence);
  assert.equal(normalized.accepted, true, normalized.reasons.join("; "));
  assert.equal(normalized.task!.demandEvidence.status, "observed");
  assert.equal(isValidatedDemandReaderTask(normalized.task!), true);
});

test("M2 trust: content hash mismatch rejects approval", () => {
  const result = validateEvidenceApproval(
    {
      approvalState: "APPROVED",
      approvedBy: "ops:test-approver@legends.local",
      approvedAt: "2026-02-01T12:00:00.000Z",
      approvalMethod: "manual_ops_approval",
      contentHash: "b".repeat(64),
      publicUsageAllowed: true,
      usageScope: "public_blog_editorial",
      revokedAt: null,
      revokedBy: null,
      revokeReason: null
    },
    { requireApproved: true, expectedContentHash: "a".repeat(64), now: new Date("2026-02-10T12:00:00Z") }
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some(r => /contentHash|re-approved/i.test(r)));
});

test("M2 trust: changed content invalidates prior approval; revoked cannot create active tasks", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  const pending = await pendingFaqTemplateProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    pendingFaqPath: join(process.cwd(), DEFAULT_PENDING_FAQ_TEMPLATE_PATH)
  });
  const template = pending.evidence[0]!;
  await persistSourceEvidenceBatch(db, [template]);

  const approved = await approvePendingSourceEvidence(db, {
    evidenceId: template.id,
    approvedBy: "merchant:owner@legendsdtf.example",
    approvalMethod: "merchant_admin_ui",
    usageScope: "public_blog_editorial",
    now: new Date("2026-02-10T15:00:00Z")
  });
  assert.equal(approved.ok, true, approved.reasons.join("; "));
  assert.equal(approved.evidence?.approval?.approvalState, "APPROVED");

  const { rows: auditRows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM evidence_approval_audits WHERE source_evidence_id=$1 AND action='APPROVE'`,
    [template.id]
  );
  assert.ok(Number(auditRows[0]!.n) >= 1);

  // Mutate payload content while leaving stale approval hash — then invalidate.
  const mutated = {
    ...approved.evidence!,
    evidenceSummary: "CHANGED SUMMARY after approval — must invalidate",
    normalizedQuestion: approved.evidence!.normalizedQuestion
  };
  const newHash = computeEvidenceContentHash({
    sourceReference: mutated.sourceReference,
    normalizedProblem: mutated.normalizedProblem,
    normalizedQuestion: mutated.normalizedQuestion,
    evidenceSummary: mutated.evidenceSummary,
    audienceHint: mutated.audienceHint,
    situationHint: mutated.situationHint,
    decisionHint: mutated.decisionHint,
    desiredOutcomeHint: mutated.desiredOutcomeHint,
    stakesHint: mutated.stakesHint,
    constraintsHint: mutated.constraintsHint,
    legendsRelevanceHint: mutated.legendsRelevanceHint,
    periodStart: mutated.periodStart,
    periodEnd: mutated.periodEnd,
    geographicRelevance: mutated.geographicRelevance,
    metrics: mutated.metrics
  });
  assert.notEqual(newHash, approved.evidence!.approval!.contentHash);

  await db.query(
    `UPDATE source_evidence SET
       evidence_summary=$2,
       payload=$3::jsonb
     WHERE id=$1`,
    [template.id, mutated.evidenceSummary, JSON.stringify({ ...mutated, approval: approved.evidence!.approval })]
  );

  const invalidated = await invalidateApprovalIfContentChanged(db, template.id);
  assert.equal(invalidated.invalidated, true);

  const { rows: after } = await db.query<{ approval_state: string; payload: { approval: { approvalState: string } } }>(
    `SELECT approval_state, payload FROM source_evidence WHERE id=$1`,
    [template.id]
  );
  assert.equal(after[0]!.approval_state, "PENDING_APPROVAL");

  // Re-approve then revoke
  const reapproved = await approvePendingSourceEvidence(db, {
    evidenceId: template.id,
    approvedBy: "merchant:owner@legendsdtf.example",
    approvalMethod: "merchant_admin_ui",
    usageScope: "public_blog_editorial",
    now: new Date("2026-02-11T15:00:00Z")
  });
  assert.equal(reapproved.ok, true, reapproved.reasons.join("; "));

  const revoked = await revokeSourceEvidenceApproval(db, {
    evidenceId: template.id,
    revokedBy: "merchant:owner@legendsdtf.example",
    reason: "no longer accurate"
  });
  assert.equal(revoked.ok, true);
  const norm = normalizeSourceEvidenceToReaderTask([revoked.evidence!]);
  assert.equal(norm.accepted, false);
  assert.ok(norm.reasons.some(r => /Revoked/i.test(r)));

  await db.end();
});

test("M2 trust: seed and pending evidence remain ineligible for AUTO", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const result = await runSourceEvidenceIngestion(db, {
    includePendingTemplates: true,
    includeSeedBrainstorm: true,
    seedKeywords: ["embroidery vs DTF for work shirts"],
    region: "Middle Georgia"
  });
  assert.equal(result.readerTasksAccepted, 0);
  assert.ok(result.readerTasksRejected >= 1);
  await db.end();
});

test("M2 trust: stamp without approval cannot claim observed demand", () => {
  const evidence = stampSourceEvidence({
    provider: "approved_customer_faq_import",
    providerVersion: "approved_faq.v1",
    sourceType: "approved_customer_faq",
    sourceReference: "faq:unapproved-claim",
    collectedAt: new Date().toISOString(),
    periodStart: null,
    periodEnd: new Date().toISOString(),
    geographicRelevance: "Middle Georgia",
    normalizedProblem: "Unsure which decoration method fits a school deadline",
    normalizedQuestion: "Which decoration method should we use for 40 spirit shirts before Friday?",
    evidenceSummary: "unapproved claim",
    metrics: {},
    confidence: "high",
    freshness: "fresh",
    provenance: { description: "attempted claim without structured approval" },
    approval: null,
    audienceHint: "Middle Georgia school spirit coordinators",
    situationHint: "Ordering about 40 spirit shirts before Friday kickoff",
    decisionHint: "choose a decoration method and place the order",
    desiredOutcomeHint: "shirts arrive on time"
  });
  assert.equal(sourceEvidenceDemandStatus(evidence), "unavailable");
  const norm = normalizeSourceEvidenceToReaderTask([evidence]);
  assert.equal(norm.accepted, false);
});
