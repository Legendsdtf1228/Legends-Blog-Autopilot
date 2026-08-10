/**
 * Persistence for OpportunityClusters (M3).
 * Transactional rebuild with advisory lock; preserves audit history.
 */
import type { Db } from "../db.js";
import {
  SEMANTIC_CLUSTERING_VERSION,
  type ClusterReviewCandidate,
  type OpportunityCluster
} from "./opportunityCluster.js";
import {
  clusterReaderTasksSemantically,
  type SemanticClusteringResult
} from "./semanticClustering.js";
import type { ClusterableReaderTask } from "./opportunityCluster.js";
import type { ReaderTask } from "./readerTask.js";

export interface PersistClusteringResult {
  clusteringVersion: string;
  inserted: number;
  updated: number;
  unchanged: number;
  superseded: number;
  activeClusterCount: number;
  reviewCandidateCount: number;
  conflictPairCount: number;
  unassignedTaskCount: number;
  runId: number | null;
}

async function writeClusterAudit(
  client: { query: Db["query"] },
  args: {
    clusterId: string;
    action: string;
    actor: string;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO opportunity_cluster_audits(cluster_id, action, actor, detail)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [args.clusterId, args.action, args.actor, JSON.stringify(args.detail || {})]
  );
}

export async function loadClusterableReaderTasks(db: Db): Promise<ClusterableReaderTask[]> {
  const { rows } = await db.query<{
    id: string;
    payload: ReaderTask;
    normalization_status: string;
    demand_status: string;
    evidence_ids: string[] | null;
    approved_evidence_count: string;
    revoked_evidence_count: string;
  }>(
    `SELECT
       rt.id,
       rt.payload,
       rt.normalization_status,
       rt.demand_status,
       COALESCE(
         (SELECT array_agg(sert.source_evidence_id ORDER BY sert.source_evidence_id)
          FROM source_evidence_reader_tasks sert
          WHERE sert.reader_task_id = rt.id),
         ARRAY[]::text[]
       ) AS evidence_ids,
       (
         SELECT count(*)::text FROM source_evidence_reader_tasks sert
         JOIN source_evidence se ON se.id = sert.source_evidence_id
         WHERE sert.reader_task_id = rt.id
           AND se.approval_state = 'APPROVED'
           AND se.public_usage_allowed = true
       ) AS approved_evidence_count,
       (
         SELECT count(*)::text FROM source_evidence_reader_tasks sert
         JOIN source_evidence se ON se.id = sert.source_evidence_id
         WHERE sert.reader_task_id = rt.id
           AND se.approval_state = 'REVOKED'
       ) AS revoked_evidence_count
     FROM reader_tasks rt
     WHERE rt.normalization_status = 'accepted'
     ORDER BY rt.id`
  );

  return rows.map(row => {
    const task = row.payload;
    const approvedCount = Number(row.approved_evidence_count || 0);
    const revokedCount = Number(row.revoked_evidence_count || 0);
    const inactive =
      task.freshness === "stale" ||
      (revokedCount > 0 && approvedCount === 0) ||
      task.demandEvidence.status === "inferred_seed";
    let inactiveReason: string | undefined;
    if (task.freshness === "stale") inactiveReason = "stale evidence";
    else if (revokedCount > 0 && approvedCount === 0) inactiveReason = "supporting evidence revoked";
    else if (task.demandEvidence.status === "inferred_seed") inactiveReason = "inferred/seed demand only";

    return {
      task,
      supportingSourceEvidenceIds: row.evidence_ids || [],
      hasActiveApprovedEvidence: approvedCount > 0,
      inactive,
      inactiveReason
    };
  });
}

export async function persistSemanticClustering(
  db: Db,
  args: {
    inputs?: ClusterableReaderTask[];
    actor?: string;
    result?: SemanticClusteringResult;
  } = {}
): Promise<PersistClusteringResult & { result: SemanticClusteringResult }> {
  const actor = args.actor || "system:m3-clustering";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Serialize concurrent clustering rebuilds.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('m3_semantic_clustering'))`);

    const snapshot = args.inputs
      ? args.inputs
      : await (async () => {
          const { rows } = await client.query<{
            id: string;
            payload: ReaderTask;
            evidence_ids: string[] | null;
            approved_evidence_count: string;
            revoked_evidence_count: string;
          }>(
            `SELECT
               rt.id,
               rt.payload,
               COALESCE(
                 (SELECT array_agg(sert.source_evidence_id ORDER BY sert.source_evidence_id)
                  FROM source_evidence_reader_tasks sert
                  WHERE sert.reader_task_id = rt.id),
                 ARRAY[]::text[]
               ) AS evidence_ids,
               (
                 SELECT count(*)::text FROM source_evidence_reader_tasks sert
                 JOIN source_evidence se ON se.id = sert.source_evidence_id
                 WHERE sert.reader_task_id = rt.id
                   AND se.approval_state = 'APPROVED'
                   AND se.public_usage_allowed = true
               ) AS approved_evidence_count,
               (
                 SELECT count(*)::text FROM source_evidence_reader_tasks sert
                 JOIN source_evidence se ON se.id = sert.source_evidence_id
                 WHERE sert.reader_task_id = rt.id
                   AND se.approval_state = 'REVOKED'
               ) AS revoked_evidence_count
             FROM reader_tasks rt
             WHERE rt.normalization_status = 'accepted'
             ORDER BY rt.id`
          );
          return rows.map(row => {
            const task = row.payload;
            const approvedCount = Number(row.approved_evidence_count || 0);
            const revokedCount = Number(row.revoked_evidence_count || 0);
            const inactive =
              task.freshness === "stale" ||
              (revokedCount > 0 && approvedCount === 0) ||
              task.demandEvidence.status === "inferred_seed";
            return {
              task,
              supportingSourceEvidenceIds: row.evidence_ids || [],
              hasActiveApprovedEvidence: approvedCount > 0,
              inactive,
              inactiveReason: inactive
                ? task.freshness === "stale"
                  ? "stale evidence"
                  : revokedCount > 0 && approvedCount === 0
                    ? "supporting evidence revoked"
                    : "inferred/seed demand only"
                : undefined
            } satisfies ClusterableReaderTask;
          });
        })();

    const result = args.result || clusterReaderTasksSemantically(snapshot);

    const { rows: existingRows } = await client.query<{
      id: string;
      material_hash: string;
      status: string;
      member_ids: string[];
    }>(
      `SELECT id, material_hash, status,
              COALESCE(
                (SELECT array_agg(m.reader_task_id ORDER BY m.reader_task_id)
                 FROM opportunity_cluster_members m WHERE m.cluster_id = c.id AND m.active = true),
                ARRAY[]::text[]
              ) AS member_ids
       FROM opportunity_clusters c
       FOR UPDATE`
    );
    const existingById = new Map(existingRows.map(r => [r.id, r]));
    const activeExisting = existingRows.filter(r => r.status === "active" || r.status === "needs_review");
    const nextIds = new Set(result.clusters.map(c => c.id));

    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    let superseded = 0;

    // Supersede active clusters that disappeared (split/membership change → new ids).
    for (const old of activeExisting) {
      if (!nextIds.has(old.id)) {
        await client.query(
          `UPDATE opportunity_clusters
           SET status='superseded', updated_at=now()
           WHERE id=$1 AND status IN ('active','needs_review')`,
          [old.id]
        );
        await client.query(
          `UPDATE opportunity_cluster_members SET active=false, left_at=now()
           WHERE cluster_id=$1 AND active=true`,
          [old.id]
        );
        await writeClusterAudit(client, {
          clusterId: old.id,
          action: "SUPERSEDE",
          actor,
          detail: { reason: "membership_or_fingerprint_changed", previousMembers: old.member_ids }
        });
        superseded += 1;
      }
    }

    for (const cluster of result.clusters) {
      const existing = existingById.get(cluster.id);
      if (existing && existing.material_hash === cluster.materialHash && (existing.status === "active" || existing.status === "needs_review")) {
        unchanged += 1;
        continue;
      }

      if (!existing) {
        await client.query(
          `INSERT INTO opportunity_clusters(
             id, canonical_reader_task_id, semantic_fingerprint, clustering_version,
             status, canonical_audience, canonical_situation, canonical_problem,
             canonical_question, canonical_decision, canonical_intent, canonical_desired_outcome,
             merged_evidence_summary, similarity_explanation, merge_confidence,
             requires_manual_review, demand_status, confidence, wording_variants,
             conflicts, supporting_evidence_ids, payload, material_hash, schema_version,
             created_at, updated_at
           ) VALUES (
             $1,$2,$3,$4,
             $5,$6,$7,$8,
             $9,$10,$11,$12,
             $13,$14,$15,
             $16,$17,$18,$19::jsonb,
             $20::jsonb,$21::jsonb,$22::jsonb,$23,$24,
             now(),now()
           )`,
          [
            cluster.id,
            cluster.canonicalReaderTaskId,
            cluster.semanticFingerprint,
            cluster.clusteringVersion,
            cluster.status,
            cluster.canonicalAudience,
            cluster.canonicalSituation,
            cluster.canonicalProblem,
            cluster.canonicalQuestion,
            cluster.canonicalDecision,
            cluster.canonicalIntent,
            cluster.canonicalDesiredOutcome,
            cluster.mergedEvidenceSummary,
            cluster.similarityExplanation,
            cluster.mergeConfidence,
            cluster.requiresManualReview,
            cluster.demandStatus,
            cluster.confidence,
            JSON.stringify(cluster.wordingVariants),
            JSON.stringify(cluster.conflicts),
            JSON.stringify(cluster.supportingSourceEvidenceIds),
            JSON.stringify(cluster),
            cluster.materialHash,
            cluster.schemaVersion
          ]
        );
        inserted += 1;
        await writeClusterAudit(client, {
          clusterId: cluster.id,
          action: "CREATE",
          actor,
          detail: {
            members: cluster.memberReaderTaskIds,
            canonical: cluster.canonicalReaderTaskId,
            explanation: cluster.similarityExplanation
          }
        });
      } else {
        await client.query(
          `UPDATE opportunity_clusters SET
             canonical_reader_task_id=$2,
             semantic_fingerprint=$3,
             clustering_version=$4,
             status=$5,
             canonical_audience=$6,
             canonical_situation=$7,
             canonical_problem=$8,
             canonical_question=$9,
             canonical_decision=$10,
             canonical_intent=$11,
             canonical_desired_outcome=$12,
             merged_evidence_summary=$13,
             similarity_explanation=$14,
             merge_confidence=$15,
             requires_manual_review=$16,
             demand_status=$17,
             confidence=$18,
             wording_variants=$19::jsonb,
             conflicts=$20::jsonb,
             supporting_evidence_ids=$21::jsonb,
             payload=$22::jsonb,
             material_hash=$23,
             schema_version=$24,
             updated_at=now()
           WHERE id=$1`,
          [
            cluster.id,
            cluster.canonicalReaderTaskId,
            cluster.semanticFingerprint,
            cluster.clusteringVersion,
            cluster.status,
            cluster.canonicalAudience,
            cluster.canonicalSituation,
            cluster.canonicalProblem,
            cluster.canonicalQuestion,
            cluster.canonicalDecision,
            cluster.canonicalIntent,
            cluster.canonicalDesiredOutcome,
            cluster.mergedEvidenceSummary,
            cluster.similarityExplanation,
            cluster.mergeConfidence,
            cluster.requiresManualReview,
            cluster.demandStatus,
            cluster.confidence,
            JSON.stringify(cluster.wordingVariants),
            JSON.stringify(cluster.conflicts),
            JSON.stringify(cluster.supportingSourceEvidenceIds),
            JSON.stringify(cluster),
            cluster.materialHash,
            cluster.schemaVersion
          ]
        );
        updated += 1;
        await writeClusterAudit(client, {
          clusterId: cluster.id,
          action: existing.status === "superseded" ? "REACTIVATE" : "UPDATE",
          actor,
          detail: {
            members: cluster.memberReaderTaskIds,
            canonical: cluster.canonicalReaderTaskId,
            previousStatus: existing.status
          }
        });
      }

      // Refresh memberships for this cluster.
      await client.query(
        `UPDATE opportunity_cluster_members SET active=false, left_at=now()
         WHERE cluster_id=$1 AND active=true
           AND NOT (reader_task_id = ANY($2::text[]))`,
        [cluster.id, cluster.memberReaderTaskIds]
      );

      for (const memberId of cluster.memberReaderTaskIds) {
        const item = snapshot.find(s => s.task.id === memberId);
        const isCanonical = memberId === cluster.canonicalReaderTaskId;
        const joinReason =
          cluster.memberReaderTaskIds.length === 1
            ? "singleton"
            : isCanonical
              ? "selected as canonical"
              : `merged with canonical ${cluster.canonicalReaderTaskId}`;

        await client.query(
          `INSERT INTO opportunity_cluster_members(
             cluster_id, reader_task_id, semantic_fingerprint, join_reason,
             is_canonical, active, clustering_version, created_at
           ) VALUES ($1,$2,$3,$4,$5,true,$6,now())
           ON CONFLICT (cluster_id, reader_task_id) DO UPDATE SET
             semantic_fingerprint=EXCLUDED.semantic_fingerprint,
             join_reason=EXCLUDED.join_reason,
             is_canonical=EXCLUDED.is_canonical,
             active=true,
             left_at=NULL,
             clustering_version=EXCLUDED.clustering_version`,
          [
            cluster.id,
            memberId,
            item?.task.semanticFingerprint || "",
            joinReason,
            isCanonical,
            cluster.clusteringVersion
          ]
        );

        await client.query(
          `INSERT INTO reader_task_cluster_history(
             reader_task_id, cluster_id, action, is_canonical, clustering_version, detail
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
          [
            memberId,
            cluster.id,
            existing && existing.material_hash === cluster.materialHash ? "RETAIN" : "ASSIGN",
            isCanonical,
            cluster.clusteringVersion,
            JSON.stringify({ joinReason })
          ]
        );
      }

      // Evidence links
      await client.query(`DELETE FROM opportunity_cluster_evidence WHERE cluster_id=$1`, [cluster.id]);
      for (const evidenceId of cluster.supportingSourceEvidenceIds) {
        await client.query(
          `INSERT INTO opportunity_cluster_evidence(cluster_id, source_evidence_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [cluster.id, evidenceId]
        );
      }
    }

    // Persist review candidates for admin visibility.
    await client.query(`DELETE FROM opportunity_cluster_review_candidates WHERE clustering_version=$1`, [
      result.clusteringVersion
    ]);
    for (const review of result.reviewCandidates) {
      await client.query(
        `INSERT INTO opportunity_cluster_review_candidates(
           left_reader_task_id, right_reader_task_id, similarity_score,
           explanation, reasons, clustering_version
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          review.leftTaskId,
          review.rightTaskId,
          review.similarityScore,
          review.explanation,
          JSON.stringify(review.reasons),
          result.clusteringVersion
        ]
      );
    }

    const { rows: runRows } = await client.query<{ id: string }>(
      `INSERT INTO clustering_runs(
         clustering_version, inserted_count, updated_count, unchanged_count, superseded_count,
         active_cluster_count, review_candidate_count, conflict_pair_count, unassigned_task_count,
         detail
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING id::text`,
      [
        result.clusteringVersion,
        inserted,
        updated,
        unchanged,
        superseded,
        result.clusters.length,
        result.reviewCandidates.length,
        result.conflictPairs.length,
        result.unassignedTaskIds.length,
        JSON.stringify({
          inactiveTaskIds: result.inactiveTaskIds,
          unassignedTaskIds: result.unassignedTaskIds,
          actor
        })
      ]
    );

    await client.query("COMMIT");
    return {
      clusteringVersion: result.clusteringVersion,
      inserted,
      updated,
      unchanged,
      superseded,
      activeClusterCount: result.clusters.length,
      reviewCandidateCount: result.reviewCandidates.length,
      conflictPairCount: result.conflictPairs.length,
      unassignedTaskCount: result.unassignedTaskIds.length,
      runId: runRows[0] ? Number(runRows[0].id) : null,
      result
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function runSemanticReaderTaskClustering(
  db: Db,
  actor = "system:m3-clustering"
): Promise<PersistClusteringResult & { result: SemanticClusteringResult }> {
  return persistSemanticClustering(db, { actor });
}

export interface ClusterHealth {
  clusteringVersion: string;
  activeClusterCount: number;
  singletonClusterCount: number;
  multiTaskClusterCount: number;
  needsReviewClusterCount: number;
  reviewCandidateCount: number;
  conflictPairCount: number;
  unassignedTaskCount: number;
  lastClusteringRunAt: string | null;
  lastClusteringRun: {
    inserted: number;
    updated: number;
    unchanged: number;
    superseded: number;
  } | null;
  sampleClusters: Array<{
    id: string;
    status: string;
    memberCount: number;
    canonicalReaderTaskId: string;
    mergeConfidence: number;
    requiresManualReview: boolean;
    similarityExplanation: string;
  }>;
}

export async function getClusterHealth(db: Db): Promise<ClusterHealth> {
  const { rows: counts } = await db.query<{
    active: string;
    singleton: string;
    multi: string;
    review: string;
  }>(
    `SELECT
       count(*) FILTER (WHERE status IN ('active','needs_review'))::text AS active,
       count(*) FILTER (
         WHERE status IN ('active','needs_review')
           AND (
             SELECT count(*) FROM opportunity_cluster_members m
             WHERE m.cluster_id = opportunity_clusters.id AND m.active = true
           ) = 1
       )::text AS singleton,
       count(*) FILTER (
         WHERE status IN ('active','needs_review')
           AND (
             SELECT count(*) FROM opportunity_cluster_members m
             WHERE m.cluster_id = opportunity_clusters.id AND m.active = true
           ) > 1
       )::text AS multi,
       count(*) FILTER (WHERE status='needs_review' OR requires_manual_review=true)::text AS review
     FROM opportunity_clusters`
  );

  const { rows: reviewRows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM opportunity_cluster_review_candidates`
  );

  const { rows: conflictRows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM opportunity_clusters c,
            LATERAL jsonb_array_elements(c.conflicts) e
     WHERE c.status IN ('active','needs_review')`
  );

  const { rows: unassigned } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM reader_tasks rt
     WHERE rt.normalization_status='accepted'
       AND NOT EXISTS (
         SELECT 1 FROM opportunity_cluster_members m
         WHERE m.reader_task_id = rt.id AND m.active = true
       )
       AND COALESCE(rt.payload->>'freshness','') <> 'stale'
       AND COALESCE(rt.demand_status,'') <> 'inferred_seed'`
  );

  const { rows: lastRun } = await db.query<{
    created_at: string;
    inserted_count: number;
    updated_count: number;
    unchanged_count: number;
    superseded_count: number;
    clustering_version: string;
  }>(
    `SELECT created_at, inserted_count, updated_count, unchanged_count, superseded_count, clustering_version
     FROM clustering_runs
     ORDER BY created_at DESC
     LIMIT 1`
  );

  const { rows: samples } = await db.query<{
    id: string;
    status: string;
    canonical_reader_task_id: string;
    merge_confidence: number;
    requires_manual_review: boolean;
    similarity_explanation: string;
    member_count: string;
  }>(
    `SELECT c.id, c.status, c.canonical_reader_task_id, c.merge_confidence,
            c.requires_manual_review, c.similarity_explanation,
            (
              SELECT count(*)::text FROM opportunity_cluster_members m
              WHERE m.cluster_id=c.id AND m.active=true
            ) AS member_count
     FROM opportunity_clusters c
     WHERE c.status IN ('active','needs_review')
     ORDER BY (SELECT count(*) FROM opportunity_cluster_members m WHERE m.cluster_id=c.id AND m.active=true) DESC, c.id
     LIMIT 8`
  );

  return {
    clusteringVersion: lastRun[0]?.clustering_version || SEMANTIC_CLUSTERING_VERSION,
    activeClusterCount: Number(counts[0]?.active || 0),
    singletonClusterCount: Number(counts[0]?.singleton || 0),
    multiTaskClusterCount: Number(counts[0]?.multi || 0),
    needsReviewClusterCount: Number(counts[0]?.review || 0),
    reviewCandidateCount: Number(reviewRows[0]?.n || 0),
    conflictPairCount: Number(conflictRows[0]?.n || 0),
    unassignedTaskCount: Number(unassigned[0]?.n || 0),
    lastClusteringRunAt: lastRun[0]?.created_at || null,
    lastClusteringRun: lastRun[0]
      ? {
          inserted: lastRun[0].inserted_count,
          updated: lastRun[0].updated_count,
          unchanged: lastRun[0].unchanged_count,
          superseded: lastRun[0].superseded_count
        }
      : null,
    sampleClusters: samples.map(s => ({
      id: s.id,
      status: s.status,
      memberCount: Number(s.member_count),
      canonicalReaderTaskId: s.canonical_reader_task_id,
      mergeConfidence: Number(s.merge_confidence),
      requiresManualReview: s.requires_manual_review,
      similarityExplanation: s.similarity_explanation
    }))
  };
}

export async function getClusterTrace(db: Db, clusterId: string): Promise<{
  cluster: OpportunityCluster | null;
  members: Array<{ readerTaskId: string; joinReason: string; isCanonical: boolean; active: boolean }>;
  evidenceIds: string[];
  audits: Array<{ action: string; actor: string; createdAt: string; detail: Record<string, unknown> }>;
}> {
  const { rows } = await db.query<{ payload: OpportunityCluster }>(
    `SELECT payload FROM opportunity_clusters WHERE id=$1`,
    [clusterId]
  );
  const { rows: members } = await db.query<{
    reader_task_id: string;
    join_reason: string;
    is_canonical: boolean;
    active: boolean;
  }>(
    `SELECT reader_task_id, join_reason, is_canonical, active
     FROM opportunity_cluster_members WHERE cluster_id=$1
     ORDER BY is_canonical DESC, reader_task_id`,
    [clusterId]
  );
  const { rows: evidence } = await db.query<{ source_evidence_id: string }>(
    `SELECT source_evidence_id FROM opportunity_cluster_evidence WHERE cluster_id=$1 ORDER BY source_evidence_id`,
    [clusterId]
  );
  const { rows: audits } = await db.query<{
    action: string;
    actor: string;
    created_at: string;
    detail: Record<string, unknown>;
  }>(
    `SELECT action, actor, created_at, detail FROM opportunity_cluster_audits
     WHERE cluster_id=$1 ORDER BY created_at ASC`,
    [clusterId]
  );

  return {
    cluster: rows[0]?.payload || null,
    members: members.map(m => ({
      readerTaskId: m.reader_task_id,
      joinReason: m.join_reason,
      isCanonical: m.is_canonical,
      active: m.active
    })),
    evidenceIds: evidence.map(e => e.source_evidence_id),
    audits: audits.map(a => ({
      action: a.action,
      actor: a.actor,
      createdAt: a.created_at,
      detail: a.detail
    }))
  };
}

export type { ClusterReviewCandidate };
