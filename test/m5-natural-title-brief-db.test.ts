/**
 * M5 DB: natural title / intent-native brief persistence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate } from "../src/db.js";
import {
  countOpportunityReservations,
  generateTitlesForActiveClusters,
  getNaturalTitleHealth,
  persistNaturalTitleAndBrief,
  persistReaderTaskNormalization,
  persistSemanticClustering
} from "../src/research/index.js";
import { cottonPolyTask } from "./helpers/m4KnowledgeFixtures.js";
import { clusterable } from "./helpers/m3ClusterFixtures.js";
import { createHash } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

test("M5 db: migrations create natural title / brief tables", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  await migrate(db);
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('natural_title_proposals','intent_native_briefs','title_generation_runs')
     ORDER BY table_name`
  );
  assert.equal(rows.length, 3);
  const { rows: mig } = await db.query<{ id: string }>(
    `SELECT id FROM schema_migrations WHERE id='012_natural_title_briefs'`
  );
  assert.equal(mig.length, 1);
  await db.end();
});

test("M5 db: persist title/brief is idempotent; reservations unchanged", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const before = await countOpportunityReservations(db);
  const { rows: beforeOpp } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM research_opportunities`
  );

  const task = {
    ...cottonPolyTask(),
    id: "rt:m5-db-cotton",
    semanticFingerprint: createHash("sha1").update("m5-db-cotton").digest("hex").slice(0, 24)
  };
  await db.query(`DELETE FROM reader_tasks WHERE id=$1`, [task.id]);
  await persistReaderTaskNormalization(db, {
    task,
    accepted: true,
    reasons: [],
    supportingEvidenceIds: []
  });
  await persistSemanticClustering(db, {
    inputs: [clusterable(task, { supportingSourceEvidenceIds: [], hasActiveApprovedEvidence: true })],
    actor: "test:m5"
  });

  const first = await persistNaturalTitleAndBrief(db, { task, actor: "test:m5" });
  assert.ok(first.title.title.length > 8);
  assert.equal(first.title.bannedTemplate, false);
  const second = await persistNaturalTitleAndBrief(db, { task, actor: "test:m5" });
  assert.equal(second.outcome, "unchanged");
  assert.equal(second.title.materialHash, first.title.materialHash);

  const health = await getNaturalTitleHealth(db);
  assert.ok(health.titleProposalCount >= 1);
  assert.ok(health.intentNativeBriefCount >= 1);

  const gen = await generateTitlesForActiveClusters(db, { actor: "test:m5" });
  assert.ok(gen.generated + gen.unchanged >= 1);

  assert.equal(await countOpportunityReservations(db), before);
  const { rows: afterOpp } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM research_opportunities`
  );
  assert.equal(afterOpp[0]!.n, beforeOpp[0]!.n);
  await db.end();
});
