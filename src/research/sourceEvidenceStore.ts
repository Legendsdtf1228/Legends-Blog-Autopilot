/**
 * Persistence for SourceEvidence and ReaderTask (M2).
 * Idempotent upserts; does not touch research_opportunities reservations.
 */
import type { Db } from "../db.js";
import type { ReaderTask } from "./readerTask.js";
import type { SourceEvidence } from "./sourceEvidence.js";
import { READER_TASK_SCHEMA_VERSION } from "./normalizeReaderTask.js";

export interface PersistEvidenceResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

export async function persistSourceEvidenceBatch(
  db: Db,
  evidence: SourceEvidence[]
): Promise<PersistEvidenceResult> {
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const row of evidence) {
      const existing = await client.query<{ id: string; source_reference: string }>(
        `SELECT id, source_reference FROM source_evidence
         WHERE provider=$1 AND source_reference=$2
         FOR UPDATE`,
        [row.provider, row.sourceReference]
      );
      if (!existing.rows[0]) {
        await client.query(
          `INSERT INTO source_evidence(
             id, provider, provider_version, source_type, source_reference,
             collected_at, period_start, period_end, geographic_relevance,
             normalized_problem, normalized_question, evidence_summary,
             metrics, confidence, freshness, provenance, payload,
             schema_version, created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,$5,
             $6::timestamptz,$7::timestamptz,$8::timestamptz,$9,
             $10,$11,$12,
             $13::jsonb,$14,$15,$16::jsonb,$17::jsonb,
             $18,now(),now()
           )`,
          [
            row.id,
            row.provider,
            row.providerVersion,
            row.sourceType,
            row.sourceReference,
            row.collectedAt,
            row.periodStart,
            row.periodEnd,
            row.geographicRelevance,
            row.normalizedProblem,
            row.normalizedQuestion,
            row.evidenceSummary,
            JSON.stringify(row.metrics || {}),
            row.confidence,
            row.freshness,
            JSON.stringify(row.provenance),
            JSON.stringify(row),
            row.schemaVersion
          ]
        );
        inserted += 1;
      } else {
        await client.query(
          `UPDATE source_evidence SET
             provider_version=$3,
             source_type=$4,
             collected_at=$5::timestamptz,
             period_start=$6::timestamptz,
             period_end=$7::timestamptz,
             geographic_relevance=$8,
             normalized_problem=$9,
             normalized_question=$10,
             evidence_summary=$11,
             metrics=$12::jsonb,
             confidence=$13,
             freshness=$14,
             provenance=$15::jsonb,
             payload=$16::jsonb,
             schema_version=$17,
             updated_at=now()
           WHERE provider=$1 AND source_reference=$2`,
          [
            row.provider,
            row.sourceReference,
            row.providerVersion,
            row.sourceType,
            row.collectedAt,
            row.periodStart,
            row.periodEnd,
            row.geographicRelevance,
            row.normalizedProblem,
            row.normalizedQuestion,
            row.evidenceSummary,
            JSON.stringify(row.metrics || {}),
            row.confidence,
            row.freshness,
            JSON.stringify(row.provenance),
            JSON.stringify(row),
            row.schemaVersion
          ]
        );
        updated += 1;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return { inserted, updated, unchanged };
}

export async function persistReaderTaskNormalization(
  db: Db,
  args: {
    task: ReaderTask | null;
    accepted: boolean;
    reasons: string[];
    supportingEvidenceIds: string[];
  }
): Promise<{ taskId: string | null }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (!args.task) {
      // Store rejection telemetry without a task row when coherence failed hard.
      await client.query(
        `INSERT INTO reader_task_rejections(reasons, supporting_evidence_ids, detail, created_at)
         VALUES ($1::jsonb, $2::jsonb, $3::jsonb, now())`,
        [
          JSON.stringify(args.reasons),
          JSON.stringify(args.supportingEvidenceIds),
          JSON.stringify({ accepted: false })
        ]
      );
      await client.query("COMMIT");
      return { taskId: null };
    }

    const status = args.accepted ? "accepted" : "rejected";
    await client.query(
      `INSERT INTO reader_tasks(
         id, payload, semantic_fingerprint, demand_status,
         normalization_status, rejection_reasons, schema_version, created_at, updated_at
       ) VALUES ($1,$2::jsonb,$3,$4,$5,$6::jsonb,$7,now(),now())
       ON CONFLICT (id) DO UPDATE SET
         payload=EXCLUDED.payload,
         demand_status=EXCLUDED.demand_status,
         normalization_status=EXCLUDED.normalization_status,
         rejection_reasons=EXCLUDED.rejection_reasons,
         schema_version=EXCLUDED.schema_version,
         updated_at=now()`,
      [
        args.task.id,
        JSON.stringify({ ...args.task, schemaVersion: READER_TASK_SCHEMA_VERSION }),
        args.task.semanticFingerprint,
        args.task.demandEvidence.status,
        status,
        JSON.stringify(args.reasons),
        READER_TASK_SCHEMA_VERSION
      ]
    );

    for (const evidenceId of args.supportingEvidenceIds) {
      await client.query(
        `INSERT INTO source_evidence_reader_tasks(source_evidence_id, reader_task_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [evidenceId, args.task.id]
      );
    }

    if (!args.accepted) {
      await client.query(
        `INSERT INTO reader_task_rejections(reasons, supporting_evidence_ids, detail, created_at)
         VALUES ($1::jsonb, $2::jsonb, $3::jsonb, now())`,
        [
          JSON.stringify(args.reasons),
          JSON.stringify(args.supportingEvidenceIds),
          JSON.stringify({ taskId: args.task.id, accepted: false })
        ]
      );
    }

    await client.query("COMMIT");
    return { taskId: args.task.id };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordSourceIngestionRun(
  db: Db,
  args: {
    provider: string;
    available: boolean;
    reason?: string;
    collectedAt: string;
    insertedCount: number;
    updatedCount: number;
    rejectedCount: number;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO source_ingestion_runs(
       provider, available, reason, collected_at,
       inserted_count, updated_count, rejected_count, detail
     ) VALUES ($1,$2,$3,$4::timestamptz,$5,$6,$7,$8::jsonb)`,
    [
      args.provider,
      args.available,
      args.reason ?? null,
      args.collectedAt,
      args.insertedCount,
      args.updatedCount,
      args.rejectedCount,
      JSON.stringify(args.detail || {})
    ]
  );
}

export interface SourceIngestionHealth {
  providers: Array<{
    provider: string;
    available: boolean;
    reason: string | null;
    lastCollectedAt: string | null;
  }>;
  sourceCountByType: Array<{ sourceType: string; count: number }>;
  readerTaskCount: number;
  acceptedReaderTaskCount: number;
  rejectedNormalizationCount: number;
  recentRejectionReasons: Array<{ reason: string; count: number }>;
}

export async function getSourceIngestionHealth(db: Db): Promise<SourceIngestionHealth> {
  const { rows: providerRows } = await db.query<{
    provider: string;
    available: boolean;
    reason: string | null;
    collected_at: string;
  }>(
    `SELECT DISTINCT ON (provider)
       provider, available, reason, collected_at
     FROM source_ingestion_runs
     ORDER BY provider, collected_at DESC`
  );

  const { rows: typeRows } = await db.query<{ source_type: string; count: string }>(
    `SELECT source_type, count(*)::text AS count FROM source_evidence GROUP BY source_type ORDER BY source_type`
  );

  const { rows: taskCountRows } = await db.query<{ n: string; accepted: string }>(
    `SELECT
       count(*)::text AS n,
       count(*) FILTER (WHERE normalization_status='accepted')::text AS accepted
     FROM reader_tasks`
  );

  const { rows: rejectionCount } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM reader_task_rejections`
  );

  const { rows: reasonRows } = await db.query<{ reason: string; count: string }>(
    `SELECT reason, count(*)::text AS count FROM (
       SELECT jsonb_array_elements_text(reasons) AS reason
       FROM reader_task_rejections
       ORDER BY created_at DESC
       LIMIT 200
     ) t
     GROUP BY reason
     ORDER BY count(*) DESC
     LIMIT 8`
  );

  return {
    providers: providerRows.map(r => ({
      provider: r.provider,
      available: r.available,
      reason: r.reason,
      lastCollectedAt: r.collected_at
    })),
    sourceCountByType: typeRows.map(r => ({
      sourceType: r.source_type,
      count: Number(r.count)
    })),
    readerTaskCount: Number(taskCountRows[0]?.n || 0),
    acceptedReaderTaskCount: Number(taskCountRows[0]?.accepted || 0),
    rejectedNormalizationCount: Number(rejectionCount[0]?.n || 0),
    recentRejectionReasons: reasonRows.map(r => ({
      reason: r.reason,
      count: Number(r.count)
    }))
  };
}

export async function listSourceEvidence(db: Db, limit = 50): Promise<SourceEvidence[]> {
  const { rows } = await db.query<{ payload: SourceEvidence }>(
    `SELECT payload FROM source_evidence ORDER BY collected_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(r => r.payload);
}

export async function countOpportunityReservations(db: Db): Promise<number> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM research_opportunities WHERE status='reserved'`
  );
  return Number(rows[0]?.n || 0);
}
