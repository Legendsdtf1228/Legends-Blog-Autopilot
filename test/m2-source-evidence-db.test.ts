/**
 * M2 database tests: migrations, uniqueness, content-aware upserts, reservation isolation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, migrate } from "../src/db.js";
import {
  countOpportunityReservations,
  DEFAULT_APPROVED_FAQ_PATH,
  getSourceIngestionHealth,
  persistSourceEvidenceBatch,
  runSourceEvidenceIngestion,
  approvedFaqImportProvider
} from "../src/research/index.js";
import { buildExplicitlyApprovedFaqRecord } from "./helpers/approvedFaqFixture.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

async function writeApprovedTempFile(records = [buildExplicitlyApprovedFaqRecord({ id: `faq:db-${Date.now()}` })]) {
  const dir = await mkdtemp(join(tmpdir(), "faq-db-"));
  const path = join(dir, "approved.json");
  await writeFile(path, JSON.stringify(records), "utf8");
  return path;
}

test("M2 db: idempotent migrations create source_evidence and reader_tasks", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await migrate(db);
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN (
         'source_evidence','reader_tasks','source_evidence_reader_tasks',
         'source_ingestion_runs','reader_task_rejections','evidence_approval_audits'
       )
     ORDER BY table_name`
  );
  assert.equal(rows.length, 6);
  const { rows: mig } = await db.query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id IN ('008_source_evidence_reader_tasks','009_evidence_approval_authority')`
  );
  assert.equal(mig.length, 2);
  await db.end();
});

test("M2 db: unique provider/source_reference and content-aware upsert accounting", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const path = await writeApprovedTempFile([
    buildExplicitlyApprovedFaqRecord({ id: `faq:db-idempotency-${Date.now()}` })
  ]);
  const collected = await approvedFaqImportProvider.collect({
    collectedAt: new Date("2026-02-10T12:00:00Z"),
    region: "Middle Georgia",
    env: {},
    approvedFaqPath: path
  });
  const evidence = collected.evidence[0]!;
  const first = await persistSourceEvidenceBatch(db, [evidence]);
  assert.equal(first.inserted, 1);
  assert.equal(first.updated, 0);
  assert.equal(first.unchanged, 0);

  const { rows: before } = await db.query<{ updated_at: Date }>(
    `SELECT updated_at FROM source_evidence WHERE provider=$1 AND source_reference=$2`,
    [evidence.provider, evidence.sourceReference]
  );
  const updatedAtBefore = before[0]!.updated_at;

  const identical = await persistSourceEvidenceBatch(db, [evidence]);
  assert.equal(identical.inserted, 0);
  assert.equal(identical.updated, 0);
  assert.equal(identical.unchanged, 1);

  const { rows: afterIdentical } = await db.query<{ updated_at: Date }>(
    `SELECT updated_at FROM source_evidence WHERE provider=$1 AND source_reference=$2`,
    [evidence.provider, evidence.sourceReference]
  );
  assert.equal(
    new Date(afterIdentical[0]!.updated_at).getTime(),
    new Date(updatedAtBefore).getTime(),
    "identical retry must not rewrite updated_at"
  );

  const changed = await persistSourceEvidenceBatch(db, [
    {
      ...evidence,
      evidenceSummary: "approved FAQ updated summary for material change",
      approval: {
        ...evidence.approval!,
        contentHash: evidence.approval!.contentHash
      }
    }
  ]);
  assert.equal(changed.inserted, 0);
  assert.equal(changed.updated, 1);
  assert.equal(changed.unchanged, 0);

  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM source_evidence WHERE provider=$1 AND source_reference=$2`,
    [evidence.provider, evidence.sourceReference]
  );
  assert.equal(Number(rows[0]!.n), 1);
  await db.end();
});

test("M2 db: empty production approved path accepts zero tasks; pending templates do not create accepted tasks", async () => {
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

  const emptyResult = await runSourceEvidenceIngestion(db, {
    approvedFaqPath: join(process.cwd(), DEFAULT_APPROVED_FAQ_PATH),
    includeSeedBrainstorm: true,
    includePendingTemplates: true,
    seedKeywords: ["embroidery vs DTF for work shirts"],
    region: "Middle Georgia"
  });
  assert.equal(emptyResult.readerTasksAccepted, 0, JSON.stringify(emptyResult));
  assert.ok(emptyResult.readerTasksRejected >= 1);

  const approvedPath = await writeApprovedTempFile([
    buildExplicitlyApprovedFaqRecord({ id: `faq:live-path-${Date.now()}` })
  ]);
  const approvedResult = await runSourceEvidenceIngestion(db, {
    approvedFaqPath: approvedPath,
    includeSeedBrainstorm: false,
    includePendingTemplates: false,
    region: "Middle Georgia"
  });
  assert.equal(approvedResult.readerTasksAccepted, 1, JSON.stringify(approvedResult));

  const retry = await runSourceEvidenceIngestion(db, {
    approvedFaqPath: approvedPath,
    includeSeedBrainstorm: false,
    region: "Middle Georgia"
  });
  assert.equal(retry.persisted.inserted, 0);
  assert.equal(retry.persisted.unchanged, 1);
  assert.equal(retry.persisted.updated, 0);

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
  assert.ok(typeof health.approvedEvidenceCount === "number");
  assert.ok(typeof health.pendingApprovalCount === "number");
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
