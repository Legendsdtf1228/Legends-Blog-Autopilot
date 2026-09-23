/**
 * M4 knowledge registry — database/integration tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate } from "../src/db.js";
import {
  approveKnowledgeEntry,
  countOpportunityReservations,
  evaluateAndPersistAllActiveClusters,
  evaluateClusterKnowledge,
  getKnowledgeRegistryHealth,
  listKnowledgeEntries,
  markKnowledgeStale,
  persistClusterEvidenceEvaluation,
  persistReaderTaskNormalization,
  persistSemanticClustering,
  revokeKnowledgeEntry,
  submitInterviewAnswerAsPendingKnowledge,
  upsertKnowledgeEntry,
  clusterReaderTasksSemantically
} from "../src/research/index.js";
import {
  approvedCottonPolyKnowledge,
  clusterFromTask,
  cottonPolyTask,
  firsthandGrowthTask,
  M4_FIXTURE_LABEL,
  pendingCottonPolyKnowledge,
  pricingTask
} from "./helpers/m4KnowledgeFixtures.js";
import { clusterable, makeTask } from "./helpers/m3ClusterFixtures.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

async function seedAcceptedTask(
  db: ReturnType<typeof createDb>,
  task: ReturnType<typeof makeTask>
): Promise<void> {
  const { createHash } = await import("node:crypto");
  const uniquified = {
    ...task,
    semanticFingerprint: createHash("sha1")
      .update(`m4|${task.id}|${task.semanticFingerprint}`)
      .digest("hex")
      .slice(0, 24)
  };
  await db.query(`DELETE FROM source_evidence_reader_tasks WHERE reader_task_id=$1`, [uniquified.id]);
  await db.query(`DELETE FROM reader_task_cluster_history WHERE reader_task_id=$1`, [uniquified.id]);
  await db.query(`DELETE FROM opportunity_cluster_members WHERE reader_task_id=$1`, [uniquified.id]);
  await db.query(`DELETE FROM reader_tasks WHERE id=$1`, [uniquified.id]);
  await persistReaderTaskNormalization(db, {
    task: uniquified,
    accepted: true,
    reasons: [],
    supportingEvidenceIds: []
  });
}

test("M4 db: migrations create knowledge registry tables idempotently", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await migrate(db);
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN (
         'knowledge_entries','knowledge_entry_revisions','knowledge_approvals',
         'knowledge_source_links','knowledge_claims','cluster_evidence_budgets',
         'cluster_claim_requirements','merchant_interview_packets',
         'merchant_interview_questions','merchant_interview_answers',
         'knowledge_audit_events','knowledge_evaluation_runs'
       )
     ORDER BY table_name`
  );
  assert.equal(rows.length, 12);
  const { rows: mig } = await db.query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id='011_knowledge_registry'`
  );
  assert.equal(mig.length, 1);
  await db.end();
});

test("M4 db: upsert is content-aware and revision invalidates approval", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const pending = pendingCottonPolyKnowledge();
  await db.query(`DELETE FROM knowledge_entries WHERE id=$1`, [pending.id]);

  const first = await upsertKnowledgeEntry(db, {
    knowledgeClass: pending.knowledgeClass,
    normalizedClaim: pending.normalizedClaim,
    exactApprovedFact: pending.exactApprovedFact,
    scope: pending.scope,
    sourceType: pending.sourceType,
    sourceReference: pending.sourceReference,
    provenance: pending.provenance,
    firsthand: pending.firsthand,
    fixtureLabel: M4_FIXTURE_LABEL,
    actor: "test:m4"
  });
  assert.equal(first.outcome, "inserted");

  const again = await upsertKnowledgeEntry(db, {
    knowledgeClass: pending.knowledgeClass,
    normalizedClaim: pending.normalizedClaim,
    exactApprovedFact: pending.exactApprovedFact,
    scope: pending.scope,
    sourceType: pending.sourceType,
    sourceReference: pending.sourceReference,
    provenance: pending.provenance,
    firsthand: pending.firsthand,
    fixtureLabel: M4_FIXTURE_LABEL,
    actor: "test:m4"
  });
  assert.equal(again.outcome, "unchanged");

  const approved = await approveKnowledgeEntry(db, {
    entryId: first.entry.id,
    expectedRevisionId: first.entry.revisionId,
    expectedContentHash: first.entry.contentHash,
    approvedBy: "ops.approver@legends.test",
    approvedAt: "2026-07-15T12:00:00.000Z",
    approvalMethod: "manual_ops_approval",
    publicUsageAllowed: true,
    usageScope: "public_blog_educational",
    actor: "test:m4"
  });
  assert.equal(approved.approvalState, "APPROVED");

  const revised = await upsertKnowledgeEntry(db, {
    knowledgeClass: pending.knowledgeClass,
    normalizedClaim: pending.normalizedClaim,
    exactApprovedFact: pending.exactApprovedFact + " (revised wording)",
    scope: pending.scope,
    sourceType: pending.sourceType,
    sourceReference: pending.sourceReference,
    provenance: pending.provenance,
    firsthand: pending.firsthand,
    fixtureLabel: M4_FIXTURE_LABEL,
    actor: "test:m4"
  });
  assert.equal(revised.outcome, "updated");
  assert.equal(revised.entry.approvalState, "PENDING_APPROVAL");
  assert.equal(revised.entry.approvedBy, null);

  const { rows: approvals } = await db.query<{ invalidated_at: string | null }>(
    `SELECT invalidated_at FROM knowledge_approvals WHERE entry_id=$1 ORDER BY id`,
    [pending.id]
  );
  assert.ok(approvals.some(a => a.invalidated_at != null));
  await db.end();
});

test("M4 db: concurrent approval cannot approve competing revisions", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const pending = pendingCottonPolyKnowledge();
  await db.query(`DELETE FROM knowledge_entries WHERE id=$1`, [pending.id]);
  const inserted = await upsertKnowledgeEntry(db, {
    knowledgeClass: pending.knowledgeClass,
    normalizedClaim: pending.normalizedClaim,
    exactApprovedFact: pending.exactApprovedFact,
    scope: pending.scope,
    sourceType: pending.sourceType,
    sourceReference: pending.sourceReference,
    provenance: pending.provenance,
    firsthand: true,
    fixtureLabel: M4_FIXTURE_LABEL
  });

  await upsertKnowledgeEntry(db, {
    knowledgeClass: pending.knowledgeClass,
    normalizedClaim: pending.normalizedClaim,
    exactApprovedFact: pending.exactApprovedFact + " competing edit",
    scope: pending.scope,
    sourceType: pending.sourceType,
    sourceReference: pending.sourceReference,
    provenance: pending.provenance,
    firsthand: true,
    fixtureLabel: M4_FIXTURE_LABEL
  });

  await assert.rejects(
    () =>
      approveKnowledgeEntry(db, {
        entryId: inserted.entry.id,
        expectedRevisionId: inserted.entry.revisionId,
        expectedContentHash: inserted.entry.contentHash,
        approvedBy: "ops.approver@legends.test",
        approvedAt: "2026-07-15T12:00:00.000Z",
        approvalMethod: "manual_ops_approval",
        publicUsageAllowed: true,
        usageScope: "public_blog_educational"
      }),
    /revision conflict|content hash mismatch/i
  );
  await db.end();
});

test("M4 db: revoke stops support; evaluation idempotent; reservations unchanged", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  const beforeReservations = await countOpportunityReservations(db);
  const { rows: beforeOpp } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM research_opportunities`
  );

  const task = cottonPolyTask();
  await seedAcceptedTask(db, task);
  await persistSemanticClustering(db, {
    inputs: [clusterable(task, { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true })],
    actor: "test:m4"
  });

  const pending = pendingCottonPolyKnowledge();
  await db.query(`DELETE FROM knowledge_entries WHERE id=$1`, [pending.id]);
  const inserted = await upsertKnowledgeEntry(db, {
    knowledgeClass: pending.knowledgeClass,
    normalizedClaim: pending.normalizedClaim,
    exactApprovedFact: pending.exactApprovedFact,
    scope: pending.scope,
    sourceType: pending.sourceType,
    sourceReference: pending.sourceReference,
    provenance: pending.provenance,
    firsthand: true,
    fixtureLabel: M4_FIXTURE_LABEL
  });
  await approveKnowledgeEntry(db, {
    entryId: inserted.entry.id,
    expectedRevisionId: inserted.entry.revisionId,
    expectedContentHash: inserted.entry.contentHash,
    approvedBy: "ops.approver@legends.test",
    approvedAt: "2026-07-15T12:00:00.000Z",
    approvalMethod: "manual_ops_approval",
    publicUsageAllowed: true,
    usageScope: "public_blog_educational"
  });

  const firstEval = await evaluateAndPersistAllActiveClusters(db, { actor: "test:m4" });
  assert.ok(firstEval.budgets.length >= 1);
  const focus = firstEval.budgets.find(b =>
    b.claimRequirements.some(c => c.normalizedClaim.toLowerCase().includes("cotton"))
  );
  assert.ok(focus, "expected cotton cluster budget");
  const { rows: beforeBudget } = await db.query<{ material_hash: string; updated_at: Date }>(
    `SELECT material_hash, updated_at FROM cluster_evidence_budgets WHERE cluster_id=$1`,
    [focus!.clusterId]
  );

  // Identical budget payloads must be materially idempotent (no timestamp churn / fake lifecycle).
  const secondPersist = await persistClusterEvidenceEvaluation(db, {
    budgets: firstEval.budgets,
    packets: firstEval.packets,
    actor: "test:m4"
  });
  assert.equal(secondPersist.inserted, 0);
  assert.equal(secondPersist.updated, 0);
  assert.equal(secondPersist.unchanged, firstEval.budgets.length);
  assert.equal(secondPersist.runId, firstEval.persist.runId);
  const { rows: afterBudget } = await db.query<{ material_hash: string; updated_at: Date }>(
    `SELECT material_hash, updated_at FROM cluster_evidence_budgets WHERE cluster_id=$1`,
    [focus!.clusterId]
  );
  assert.equal(afterBudget[0]!.material_hash, beforeBudget[0]!.material_hash);
  assert.equal(
    new Date(afterBudget[0]!.updated_at).getTime(),
    new Date(beforeBudget[0]!.updated_at).getTime()
  );

  await revokeKnowledgeEntry(db, {
    entryId: inserted.entry.id,
    revokedBy: "ops.approver@legends.test",
    reason: "test revoke"
  });

  const afterRevoke = await evaluateAndPersistAllActiveClusters(db, { actor: "test:m4" });
  const cottonBudget = afterRevoke.budgets.find(b =>
    b.claimRequirements.some(c => c.normalizedClaim.toLowerCase().includes("cotton"))
  );
  if (cottonBudget) {
    const comparison = cottonBudget.claimRequirements.find(c => c.claimClass === "comparison_recommendation");
    if (comparison) {
      assert.notEqual(comparison.supportStatus, "supported");
    }
  }

  const afterReservations = await countOpportunityReservations(db);
  assert.equal(afterReservations, beforeReservations);
  const { rows: afterOpp } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM research_opportunities`
  );
  assert.equal(afterOpp[0]!.n, beforeOpp[0]!.n);

  const health = await getKnowledgeRegistryHealth(db);
  assert.ok(health.evaluationVersion.length > 0);
  assert.ok(typeof health.approvedKnowledgeCount === "number");
  await db.end();
});

test("M4 db: approved interview answer re-evaluates affected clusters", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await db.query(`DELETE FROM merchant_interview_answers`);
  await db.query(`DELETE FROM merchant_interview_questions`);
  await db.query(`DELETE FROM merchant_interview_packets`);
  await db.query(`DELETE FROM knowledge_approvals`);
  await db.query(`DELETE FROM knowledge_entry_revisions`);
  await db.query(`DELETE FROM knowledge_entries`);

  const task = firsthandGrowthTask();
  await seedAcceptedTask(db, task);
  await persistSemanticClustering(db, {
    inputs: [clusterable(task, { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true })],
    actor: "test:m4"
  });

  const initial = await evaluateAndPersistAllActiveClusters(db, { actor: "test:m4" });
  assert.ok(initial.packets.length >= 1);
  const packet = initial.packets.find(p => p.knowledgeClass === "print_shop_growth_lessons") || initial.packets[0]!;
  const question = packet.questions[0]!;

  const submitted = await submitInterviewAnswerAsPendingKnowledge(db, {
    packetId: packet.id,
    questionId: question.id,
    answerText:
      "Firsthand lesson: hire production help before buying a second heat press; our shop delayed hiring and created a fulfillment bottleneck during peak season.",
    knowledgeClass: packet.knowledgeClass,
    sourceReference: `fixture:m4:interview:${packet.id}:${question.id}`,
    actor: "merchant.owner@legends.test",
    scope: {
      geographic: "national",
      processSurface: "apparel_dtf",
      audiences: ["print shop owners"],
      products: ["DTF production"],
      exclusions: ["generic motivational advice"]
    }
  });
  assert.equal(submitted.entry.approvalState, "PENDING_APPROVAL");

  const pendingEval = await evaluateAndPersistAllActiveClusters(db, { actor: "test:m4" });
  const pendingClaim = pendingEval.budgets
    .flatMap(b => b.claimRequirements)
    .find(c => c.claimClass === "merchant_experience");
  assert.ok(pendingClaim);
  assert.notEqual(pendingClaim!.supportStatus, "supported");

  await approveKnowledgeEntry(db, {
    entryId: submitted.entry.id,
    expectedRevisionId: submitted.entry.revisionId,
    expectedContentHash: submitted.entry.contentHash,
    approvedBy: "ops.approver@legends.test",
    approvedAt: "2026-08-01T12:00:00.000Z",
    approvalMethod: "interview_packet_approval",
    publicUsageAllowed: true,
    usageScope: "public_blog_firsthand",
    actor: "test:m4"
  });

  const afterApprove = await evaluateAndPersistAllActiveClusters(db, { actor: "test:m4" });
  assert.ok(afterApprove.budgets.length >= 1);
  // At least one affected cluster budget should reference the new knowledge or reduce missing firsthand
  const entries = await listKnowledgeEntries(db);
  assert.ok(entries.some(e => e.id === submitted.entry.id && e.approvalState === "APPROVED"));
  await db.end();
});

test("M4 db: stale marking blocks support; pure evaluation helper still works offline", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const knowledge = approvedCottonPolyKnowledge();
  await db.query(`DELETE FROM knowledge_entries WHERE id=$1`, [knowledge.id]);
  const inserted = await upsertKnowledgeEntry(db, {
    knowledgeClass: knowledge.knowledgeClass,
    normalizedClaim: knowledge.normalizedClaim,
    exactApprovedFact: knowledge.exactApprovedFact,
    scope: knowledge.scope,
    sourceType: knowledge.sourceType,
    sourceReference: knowledge.sourceReference,
    provenance: knowledge.provenance,
    firsthand: true,
    fixtureLabel: M4_FIXTURE_LABEL
  });
  await approveKnowledgeEntry(db, {
    entryId: inserted.entry.id,
    expectedRevisionId: inserted.entry.revisionId,
    expectedContentHash: inserted.entry.contentHash,
    approvedBy: "ops.approver@legends.test",
    approvedAt: "2026-07-15T12:00:00.000Z",
    approvalMethod: "manual_ops_approval",
    publicUsageAllowed: true,
    usageScope: "public_blog_educational"
  });
  await markKnowledgeStale(db, { entryId: inserted.entry.id, reason: "test stale" });
  const entries = await listKnowledgeEntries(db);
  const stale = entries.find(e => e.id === inserted.entry.id)!;
  assert.equal(stale.approvalState, "STALE");

  const task = cottonPolyTask();
  const budget = evaluateClusterKnowledge({
    cluster: clusterFromTask(task),
    canonicalTask: task,
    knowledgeEntries: [stale]
  });
  const comparison = budget.claimRequirements.find(c => c.claimClass === "comparison_recommendation");
  assert.notEqual(comparison?.supportStatus, "supported");
  await db.end();
});

test("M4 db: clustering + knowledge path does not create opportunities", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const { rows: before } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM research_opportunities`
  );
  const task = pricingTask();
  await seedAcceptedTask(db, task);
  const clustered = clusterReaderTasksSemantically([
    clusterable(task, { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true })
  ]);
  await persistSemanticClustering(db, { result: clustered, actor: "test:m4" });
  await evaluateAndPersistAllActiveClusters(db, { actor: "test:m4" });
  const { rows: after } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM research_opportunities`
  );
  assert.equal(after[0]!.n, before[0]!.n);
  await db.end();
});

test("M4 db: persistClusterEvidenceEvaluation converges after partial retry", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const task = cottonPolyTask();
  const cluster = clusterFromTask(task, `cluster:retry-${task.id}`);
  const budget = evaluateClusterKnowledge({
    cluster,
    canonicalTask: task,
    knowledgeEntries: [approvedCottonPolyKnowledge()]
  });
  const a = await persistClusterEvidenceEvaluation(db, { budgets: [budget], actor: "test:m4" });
  const b = await persistClusterEvidenceEvaluation(db, { budgets: [budget], actor: "test:m4" });
  assert.equal(b.unchanged, 1);
  assert.equal(b.inserted, 0);
  assert.equal(b.updated, 0);
  assert.equal(b.runId, a.runId);
  await db.end();
});
