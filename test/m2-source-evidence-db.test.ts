/**
 * M2 database tests: migrations, uniqueness, transactions, reservation isolation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createDb, migrate } from "../src/db.js";
import {
  countOpportunityReservations,
  DEFAULT_APPROVED_FAQ_PATH,
  getSourceIngestionHealth,
  persistSourceEvidenceBatch,
  runSourceEvidenceIngestion,
  stampSourceEvidence
} from "../src/research/index.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

test("M2 db: idempotent migrations create source_evidence and reader_tasks", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await migrate(db);
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('source_evidence','reader_tasks','source_evidence_reader_tasks','source_ingestion_runs','reader_task_rejections')
     ORDER BY table_name`
  );
  assert.equal(rows.length, 5);
  const { rows: mig } = await db.query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id='008_source_evidence_reader_tasks'`
  );
  assert.equal(mig.length, 1);
  await db.end();
});

test("M2 db: unique provider/source_reference and retry idempotency", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const evidence = stampSourceEvidence({
    provider: "approved_customer_faq_import",
    providerVersion: "approved_faq.v1",
    sourceType: "approved_customer_faq",
    sourceReference: `faq:db-idempotency-${Date.now()}`,
    collectedAt: new Date().toISOString(),
    periodStart: null,
    periodEnd: new Date().toISOString(),
    geographicRelevance: "Middle Georgia",
    normalizedProblem: "Unsure which decoration method fits a school deadline",
    normalizedQuestion: "Which decoration method should we use for 40 spirit shirts before Friday?",
    evidenceSummary: "approved FAQ",
    metrics: {},
    confidence: "high",
    freshness: "fresh",
    provenance: { description: "approved FAQ; no PII" },
    audienceHint: "Middle Georgia school spirit coordinators",
    situationHint: "Ordering about 40 spirit shirts before Friday kickoff",
    decisionHint: "choose a decoration method and place the order",
    desiredOutcomeHint: "shirts arrive on time"
  });
  const first = await persistSourceEvidenceBatch(db, [evidence]);
  assert.equal(first.inserted, 1);
  const second = await persistSourceEvidenceBatch(db, [{ ...evidence, evidenceSummary: "approved FAQ updated summary" }]);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 1);
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM source_evidence WHERE provider=$1 AND source_reference=$2`,
    [evidence.provider, evidence.sourceReference]
  );
  assert.equal(Number(rows[0]!.n), 1);
  await db.end();
});

test("M2 db: full ingestion persists tasks and does not alter opportunity reservations", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);

  const reservedBefore = await countOpportunityReservations(db);
  const marker = `m2-reserved-${Date.now()}`;
  await db.query(
    `INSERT INTO research_opportunities(id, payload, status, reserved_by, reserved_until)
     VALUES ($1, $2::jsonb, 'reserved', 'test-worker', now() + interval '15 minutes')
     ON CONFLICT (id) DO UPDATE SET status='reserved', reserved_by='test-worker', reserved_until=now() + interval '15 minutes'`,
    [marker, JSON.stringify({ id: marker, decision: "DRAFT_ONLY", proposedTitle: "Legacy reserved fixture" })]
  );
  const reservedMid = await countOpportunityReservations(db);
  assert.ok(reservedMid >= reservedBefore + 1);

  const result = await runSourceEvidenceIngestion(db, {
    approvedFaqPath: join(process.cwd(), DEFAULT_APPROVED_FAQ_PATH),
    includeSeedBrainstorm: true,
    seedKeywords: ["embroidery vs DTF for work shirts"],
    region: "Middle Georgia"
  });
  assert.ok(result.readerTasksAccepted >= 1, JSON.stringify(result));
  assert.ok(result.persisted.inserted + result.persisted.updated >= 1);

  // Retry ingestion — idempotent
  const retry = await runSourceEvidenceIngestion(db, {
    approvedFaqPath: join(process.cwd(), DEFAULT_APPROVED_FAQ_PATH),
    includeSeedBrainstorm: false,
    region: "Middle Georgia"
  });
  assert.equal(retry.persisted.inserted, 0);

  const reservedAfter = await countOpportunityReservations(db);
  assert.equal(reservedAfter, reservedMid, "M2 ingestion must not clear or change existing reservations");

  const { rows: legacy } = await db.query<{ status: string; reserved_by: string | null }>(
    `SELECT status, reserved_by FROM research_opportunities WHERE id=$1`,
    [marker]
  );
  assert.equal(legacy[0]?.status, "reserved");
  assert.equal(legacy[0]?.reserved_by, "test-worker");

  const health = await getSourceIngestionHealth(db);
  assert.ok(health.providers.some(p => p.provider === "approved_customer_faq_import"));
  assert.ok(health.sourceCountByType.some(s => s.sourceType === "approved_customer_faq" && s.count >= 1));
  assert.ok(health.acceptedReaderTaskCount >= 1);

  await db.query(`DELETE FROM research_opportunities WHERE id=$1`, [marker]);
  await db.end();
});

test("M2 db: existing opportunity payloads remain readable after migration", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const id = `legacy-readable-${Date.now()}`;
  await db.query(
    `INSERT INTO research_opportunities(id, payload, status)
     VALUES ($1, $2::jsonb, 'suggested')
     ON CONFLICT (id) DO NOTHING`,
    [id, JSON.stringify({ id, proposedTitle: "Legacy title", decision: "DRAFT_ONLY", cluster: { primaryKeyword: "x" } })]
  );
  const { rows } = await db.query<{ payload: { proposedTitle: string; decision: string } }>(
    `SELECT payload FROM research_opportunities WHERE id=$1`,
    [id]
  );
  assert.equal(rows[0]?.payload.proposedTitle, "Legacy title");
  assert.equal(rows[0]?.payload.decision, "DRAFT_ONLY");
  await db.query(`DELETE FROM research_opportunities WHERE id=$1`, [id]);
  await db.end();
});
