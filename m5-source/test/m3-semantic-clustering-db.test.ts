/**
 * M3 DB lifecycle: persistence, idempotency, concurrency, revocation, split/merge.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate } from "../src/db.js";
import {
  countOpportunityReservations,
  getClusterHealth,
  getClusterTrace,
  persistReaderTaskNormalization,
  persistSemanticClustering,
  runSemanticReaderTaskClustering,
  SEMANTIC_CLUSTERING_VERSION
} from "../src/research/index.js";
import {
  clusterable,
  cottonPolyDuplicatePair,
  makeTask,
  schoolVsBrandCottonTasks
} from "./helpers/m3ClusterFixtures.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

async function seedAcceptedTask(
  db: ReturnType<typeof createDb>,
  item: ReturnType<typeof clusterable>
): Promise<void> {
  const { createHash } = await import("node:crypto");
  const task = {
    ...item.task,
    // Keep comparison fields intact; uniquify fingerprint for DB uniqueness across tests.
    semanticFingerprint: createHash("sha1")
      .update(`${item.task.id}|${item.task.semanticFingerprint}`)
      .digest("hex")
      .slice(0, 24)
  };
  await db.query(`DELETE FROM source_evidence_reader_tasks WHERE reader_task_id=$1`, [task.id]);
  await db.query(`DELETE FROM reader_task_cluster_history WHERE reader_task_id=$1`, [task.id]);
  await db.query(`DELETE FROM opportunity_cluster_members WHERE reader_task_id=$1`, [task.id]);
  await db.query(`DELETE FROM reader_tasks WHERE id=$1`, [task.id]);
  await persistReaderTaskNormalization(db, {
    task,
    accepted: true,
    reasons: [],
    supportingEvidenceIds: item.supportingSourceEvidenceIds
  });
}

test("M3 db: migrations create opportunity cluster tables", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await migrate(db);
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN (
         'opportunity_clusters','opportunity_cluster_members','opportunity_cluster_evidence',
         'opportunity_cluster_audits','reader_task_cluster_history',
         'opportunity_cluster_review_candidates','clustering_runs'
       )
     ORDER BY table_name`
  );
  assert.equal(rows.length, 7);
  const { rows: mig } = await db.query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id='010_opportunity_clusters'`
  );
  assert.equal(mig.length, 1);
  await db.end();
});

test("M3 db: idempotent unchanged rerun does not rewrite timestamps", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const inputs = cottonPolyDuplicatePair().map((item, idx) =>
    clusterable(
      makeTask({
        ...item.task,
        id: `rt:idem-${idx}-${item.task.id.replace("rt:", "")}`
      }),
      { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
    )
  );
  for (const item of inputs) await seedAcceptedTask(db, item);

  const first = await persistSemanticClustering(db, { inputs, actor: "test:idem-1" });
  assert.ok(first.result.clusters.length >= 1);
  assert.ok(first.inserted + first.updated + first.unchanged >= 1);
  const clusterId = first.result.clusters[0]!.id;
  const { rows: before } = await db.query<{ updated_at: Date }>(
    `SELECT updated_at FROM opportunity_clusters WHERE id=$1`,
    [clusterId]
  );

  const second = await persistSemanticClustering(db, { inputs, actor: "test:idem-2" });
  assert.equal(second.inserted, 0);
  assert.equal(second.unchanged, first.activeClusterCount);
  assert.equal(second.updated, 0);

  const { rows: after } = await db.query<{ updated_at: Date }>(
    `SELECT updated_at FROM opportunity_clusters WHERE id=$1`,
    [clusterId]
  );
  assert.equal(new Date(after[0]!.updated_at).getTime(), new Date(before[0]!.updated_at).getTime());

  const { rows: clusterCount } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM opportunity_clusters WHERE id=$1 AND status IN ('active','needs_review')`,
    [clusterId]
  );
  assert.equal(Number(clusterCount[0]!.n), 1);
  await db.end();
});

test("M3 db: merge then split supersedes old cluster and preserves audits", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const pair = cottonPolyDuplicatePair().map((item, idx) =>
    clusterable(
      makeTask({
        ...item.task,
        id: `rt:split-${idx}-${item.task.id.replace("rt:", "")}`
      }),
      { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
    )
  );
  for (const item of pair) await seedAcceptedTask(db, item);

  const merged = await persistSemanticClustering(db, { inputs: pair, actor: "test:merge" });
  assert.equal(merged.result.clusters.length, 1);
  const mergedId = merged.result.clusters[0]!.id;

  // Change one task's decision/audience so they must split.
  const splitInputs = [
    pair[0]!,
    clusterable(
      makeTask({
        id: pair[1]!.task.id,
        audience: "Clothing brand owners building retail merchandise lines",
        situation: "Choosing fabric for ongoing retail merchandise production",
        problem: "Need a fabric that matches brand hand-feel for retail shelves",
        actualQuestion: "Should a clothing brand choose cotton or polyester for retail merchandise shirts?",
        decisionOrAction: "choose cotton or polyester fabric for retail merchandise blanks",
        desiredOutcome: "Consistent retail hand-feel across restocks",
        constraints: ["retail shelf standards"],
        searchIntent: "commercial",
        semanticFingerprint: undefined
      }),
      { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
    )
  ];
  // Update stored payload for second task with unique fingerprint
  const { createHash } = await import("node:crypto");
  const splitTask = {
    ...splitInputs[1]!.task,
    semanticFingerprint: createHash("sha1")
      .update(`${splitInputs[1]!.task.id}|${splitInputs[1]!.task.semanticFingerprint}`)
      .digest("hex")
      .slice(0, 24)
  };
  await persistReaderTaskNormalization(db, {
    task: splitTask,
    accepted: true,
    reasons: [],
    supportingEvidenceIds: []
  });
  splitInputs[1] = clusterable(splitTask, {
    supportingSourceEvidenceIds: [],
    hasActiveApprovedEvidence: true
  });

  const split = await persistSemanticClustering(db, { inputs: splitInputs, actor: "test:split" });
  assert.ok(split.result.clusters.length >= 2);
  assert.ok(split.superseded >= 1);

  const { rows: old } = await db.query<{ status: string }>(
    `SELECT status FROM opportunity_clusters WHERE id=$1`,
    [mergedId]
  );
  assert.equal(old[0]?.status, "superseded");

  const { rows: audits } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM opportunity_cluster_audits WHERE cluster_id=$1`,
    [mergedId]
  );
  assert.ok(Number(audits[0]!.n) >= 2, "CREATE + SUPERSEDE audits retained");
  await db.end();
});

test("M3 db: evidence revocation inactivates tasks and removes them from active clusters", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const task = makeTask({
    id: "rt:revoke-cluster",
    audience: "New clothing-brand owners preparing first blank orders",
    situation: "Choosing blanks for a catalog launch",
    problem: "Unsure which fabric fits print quality",
    actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
    decisionOrAction: "choose cotton or polyester fabric blanks for the catalog",
    desiredOutcome: "Retail-ready blanks",
    freshness: "fresh"
  });
  const evidenceId = `ev-revoke-${Math.random().toString(36).slice(2, 8)}`;
  await db.query(`DELETE FROM source_evidence_reader_tasks WHERE reader_task_id=$1`, [task.id]);
  await db.query(`DELETE FROM reader_tasks WHERE id=$1`, [task.id]);
  await db.query(
    `INSERT INTO source_evidence(
       id, provider, provider_version, source_type, source_reference,
       collected_at, normalized_problem, normalized_question, evidence_summary,
       metrics, confidence, freshness, provenance, payload, schema_version,
       approval_state, public_usage_allowed, content_hash
     ) VALUES (
       $1,'test','t.v1','approved_customer_faq',$2,
       now(),$3,$4,'summary',
       '{}'::jsonb,'high','fresh','{}'::jsonb,'{}'::jsonb,'sourceEvidence.v1',
       'APPROVED', true, $5
     )
     ON CONFLICT (id) DO UPDATE SET approval_state='APPROVED', public_usage_allowed=true`,
    [
      evidenceId,
      `ref:${evidenceId}`,
      task.problem,
      task.actualQuestion,
      "a".repeat(64)
    ]
  );
  await persistReaderTaskNormalization(db, {
    task,
    accepted: true,
    reasons: [],
    supportingEvidenceIds: [evidenceId]
  });

  const before = await persistSemanticClustering(db, {
    inputs: [clusterable(task, { supportingSourceEvidenceIds: [evidenceId], hasActiveApprovedEvidence: true })],
    actor: "test:pre-revoke"
  });
  assert.equal(before.result.clusters.length, 1);

  await db.query(
    `UPDATE source_evidence SET approval_state='REVOKED', public_usage_allowed=false WHERE id=$1`,
    [evidenceId]
  );

  const loaded = await (await import("../src/research/opportunityClusterStore.js")).loadClusterableReaderTasks(db);
  const loadedTask = loaded.find(t => t.task.id === task.id);
  assert.ok(loadedTask, "revoked-evidence task should still load");
  assert.equal(loadedTask!.inactive, true);
  assert.match(loadedTask!.inactiveReason || "", /revoked/i);

  const after = await persistSemanticClustering(db, {
    inputs: [loadedTask!],
    actor: "test:post-revoke"
  });
  assert.ok(after.result.inactiveTaskIds.includes(task.id));
  assert.ok(after.result.clusters.every(c => !c.memberReaderTaskIds.includes(task.id)));
  await db.end();
});

test("M3 db: stale evidence tasks excluded from active clustering", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const stale = clusterable(
    makeTask({
      id: "rt:stale-cluster",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing blanks years ago",
      problem: "Historical fabric question",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing historically?",
      decisionOrAction: "choose cotton or polyester fabric blanks historically",
      desiredOutcome: "Historical note only",
      freshness: "stale"
    }),
    { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
  );
  await seedAcceptedTask(db, stale);
  const result = await persistSemanticClustering(db, { inputs: [stale], actor: "test:stale" });
  assert.ok(result.result.inactiveTaskIds.includes(stale.task.id));
  assert.equal(result.result.clusters.length, 0);
  await db.end();
});

test("M3 db: concurrent clustering cannot create duplicate active clusters", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const inputs = cottonPolyDuplicatePair().map((item, idx) =>
    clusterable(
      makeTask({
        ...item.task,
        id: `rt:conc-${idx}-${item.task.id.replace("rt:", "")}`
      }),
      { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
    )
  );
  for (const item of inputs) await seedAcceptedTask(db, item);

  const [a, b] = await Promise.all([
    persistSemanticClustering(db, { inputs, actor: "test:conc-a" }),
    persistSemanticClustering(db, { inputs, actor: "test:conc-b" })
  ]);
  assert.equal(a.result.clusters[0]!.id, b.result.clusters[0]!.id);

  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM opportunity_clusters
     WHERE id=$1 AND status IN ('active','needs_review')`,
    [a.result.clusters[0]!.id]
  );
  assert.equal(Number(rows[0]!.n), 1);
  await db.end();
});

test("M3 db: clustering does not alter opportunity reservations", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const marker = `m3-reserved-${Date.now()}`;
  await db.query(
    `INSERT INTO research_opportunities(id, payload, status, reserved_by, reserved_until)
     VALUES ($1, $2::jsonb, 'reserved', 'test-worker', now() + interval '15 minutes')
     ON CONFLICT (id) DO UPDATE SET status='reserved', reserved_by='test-worker', reserved_until=now() + interval '15 minutes'`,
    [marker, JSON.stringify({ id: marker, decision: "DRAFT_ONLY", proposedTitle: "Legacy reserved" })]
  );
  const before = await countOpportunityReservations(db);
  const inputs = schoolVsBrandCottonTasks().map((item, idx) =>
    clusterable(
      makeTask({
        ...item.task,
        id: `rt:res-${idx}-${item.task.id.replace("rt:", "")}`
      }),
      { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
    )
  );
  for (const item of inputs) await seedAcceptedTask(db, item);
  await persistSemanticClustering(db, { inputs, actor: "test:reservations" });
  const after = await countOpportunityReservations(db);
  assert.equal(after, before);

  const health = await getClusterHealth(db);
  assert.equal(health.clusteringVersion, SEMANTIC_CLUSTERING_VERSION);
  assert.ok(health.activeClusterCount >= 2);

  const sampleId = health.sampleClusters[0]?.id;
  if (sampleId) {
    const trace = await getClusterTrace(db, sampleId);
    assert.ok(trace.cluster);
    assert.ok(trace.members.length >= 1);
    assert.ok(trace.audits.length >= 1);
  }

  await db.query(`DELETE FROM research_opportunities WHERE id=$1`, [marker]);
  await db.end();
});

test("M3 db: content-change invalidation path yields new fingerprints and supersession", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const original = clusterable(
    makeTask({
      id: "rt:content-change",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing blanks for a catalog launch",
      problem: "Unsure which fabric fits",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
      decisionOrAction: "choose cotton or polyester fabric blanks for the catalog",
      desiredOutcome: "Retail-ready blanks"
    }),
    { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
  );
  await seedAcceptedTask(db, original);
  const first = await persistSemanticClustering(db, { inputs: [original], actor: "test:cc-1" });
  const firstId = first.result.clusters[0]!.id;

  const changed = clusterable(
    makeTask({
      id: "rt:content-change",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing decoration method instead of fabric",
      problem: "Unsure whether DTF or screen printing fits the catalog",
      actualQuestion: "Should I choose DTF or screen printing for the catalog shirts?",
      decisionOrAction: "choose DTF or screen printing as the decoration method",
      desiredOutcome: "Reliable decoration quality"
    }),
    { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true }
  );
  const changedTask = {
    ...changed.task,
    semanticFingerprint: (await import("node:crypto")).createHash("sha1")
      .update(`${changed.task.id}|${changed.task.semanticFingerprint}`)
      .digest("hex")
      .slice(0, 24)
  };
  await persistReaderTaskNormalization(db, {
    task: changedTask,
    accepted: true,
    reasons: [],
    supportingEvidenceIds: []
  });
  const second = await persistSemanticClustering(db, {
    inputs: [clusterable(changedTask, { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true })],
    actor: "test:cc-2"
  });
  assert.notEqual(second.result.clusters[0]!.id, firstId);
  assert.ok(second.superseded >= 1);
  await db.end();
});
