/**
 * Persistence for knowledge registry, evaluations, and interview packets (M4).
 * Additive; does not mutate legacy opportunities or reservations.
 */
import { createHash } from "node:crypto";
import type { Db } from "../db.js";
import {
  applyExplicitApproval,
  buildPendingKnowledgeEntry,
  reviseKnowledgeContent,
  type BuildKnowledgeArgs
} from "./knowledgeBuilders.js";
import { isActivelyApprovedKnowledge } from "./knowledgeApproval.js";
import {
  evaluateClusterKnowledge,
  type ActiveSourceEvidenceStub
} from "./knowledgeEvaluation.js";
import {
  KNOWLEDGE_EVALUATION_VERSION,
  materialKnowledgeHash,
  type KnowledgeApprovalMethod,
  type KnowledgeEntry,
  type ClusterEvidenceBudgetM4,
  type MerchantInterviewPacket
} from "./knowledgeRegistry.js";
import { buildMerchantInterviewPackets } from "./merchantInterviewPackets.js";
import type { OpportunityCluster } from "./opportunityCluster.js";
import type { ReaderTask } from "./readerTask.js";
import { createPipelineVersionStamp } from "./versioning.js";

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function writeKnowledgeAudit(
  client: { query: Db["query"] },
  args: {
    entryId: string | null;
    action: string;
    actor: string;
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO knowledge_audit_events(entry_id, action, actor, detail)
     VALUES ($1,$2,$3,$4::jsonb)`,
    [args.entryId, args.action, args.actor, JSON.stringify(args.detail || {})]
  );
}

function rowToEntry(payload: KnowledgeEntry): KnowledgeEntry {
  return payload;
}

export async function upsertKnowledgeEntry(
  db: Db,
  args: BuildKnowledgeArgs & { actor?: string }
): Promise<{ entry: KnowledgeEntry; outcome: "inserted" | "updated" | "unchanged" }> {
  const actor = args.actor || "system:m4-knowledge";
  const built = buildPendingKnowledgeEntry(args);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: KnowledgeEntry; material_hash: string }>(
      `SELECT payload, material_hash FROM knowledge_entries WHERE id=$1 FOR UPDATE`,
      [built.id]
    );
    if (!rows.length) {
      await client.query(
        `INSERT INTO knowledge_entries(
           id, knowledge_class, normalized_claim, exact_approved_fact, scope, source_type,
           source_reference, provenance, approval_state, approved_by, approved_at, approval_method,
           content_hash, revision_id, public_usage_allowed, usage_scope, firsthand, confidence,
           effective_from, effective_to, freshness_policy_days, contradictions,
           revoked_at, revoked_by, revoke_reason, schema_version, pipeline_versions,
           material_hash, payload
         ) VALUES (
           $1,$2,$3,$4,$5::jsonb,$6,
           $7,$8,$9,$10,$11,$12,
           $13,$14,$15,$16,$17,$18,
           $19,$20,$21,$22::jsonb,
           $23,$24,$25,$26,$27::jsonb,
           $28,$29::jsonb
         )`,
        [
          built.id,
          built.knowledgeClass,
          built.normalizedClaim,
          built.exactApprovedFact,
          JSON.stringify(built.scope),
          built.sourceType,
          built.sourceReference,
          built.provenance,
          built.approvalState,
          built.approvedBy,
          built.approvedAt,
          built.approvalMethod,
          built.contentHash,
          built.revisionId,
          built.publicUsageAllowed,
          built.usageScope,
          built.firsthand,
          built.confidence,
          built.effectiveFrom,
          built.effectiveTo,
          built.freshnessPolicyDays,
          JSON.stringify(built.contradictions),
          built.revokedAt,
          built.revokedBy,
          built.revokeReason,
          built.schemaVersion,
          JSON.stringify(built.pipelineVersions),
          built.materialHash,
          JSON.stringify(built)
        ]
      );
      await client.query(
        `INSERT INTO knowledge_entry_revisions(revision_id, entry_id, content_hash, payload)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (revision_id) DO NOTHING`,
        [built.revisionId, built.id, built.contentHash, JSON.stringify(built)]
      );
      await writeKnowledgeAudit(client, {
        entryId: built.id,
        action: "CREATE",
        actor,
        detail: { contentHash: built.contentHash, revisionId: built.revisionId }
      });
      await client.query("COMMIT");
      return { entry: built, outcome: "inserted" };
    }

    const existing = rowToEntry(rows[0]!.payload);
    if (existing.contentHash === built.contentHash && existing.materialHash === built.materialHash) {
      await client.query("COMMIT");
      return { entry: existing, outcome: "unchanged" };
    }

    // Content change → new revision; invalidate prior approval
    const revised = reviseKnowledgeContent(existing, {
      normalizedClaim: built.normalizedClaim,
      exactApprovedFact: built.exactApprovedFact,
      scope: built.scope,
      sourceType: built.sourceType,
      firsthand: built.firsthand,
      publicUsageAllowed: built.publicUsageAllowed,
      usageScope: built.usageScope,
      confidence: built.confidence,
      effectiveFrom: built.effectiveFrom,
      effectiveTo: built.effectiveTo,
      freshnessPolicyDays: built.freshnessPolicyDays
    });

    await client.query(
      `UPDATE knowledge_entries SET
         knowledge_class=$2,
         normalized_claim=$3,
         exact_approved_fact=$4,
         scope=$5::jsonb,
         source_type=$6,
         provenance=$7,
         approval_state=$8,
         approved_by=NULL,
         approved_at=NULL,
         approval_method=NULL,
         content_hash=$9,
         revision_id=$10,
         public_usage_allowed=$11,
         usage_scope=$12,
         firsthand=$13,
         confidence=$14,
         effective_from=$15,
         effective_to=$16,
         freshness_policy_days=$17,
         contradictions=$18::jsonb,
         schema_version=$19,
         pipeline_versions=$20::jsonb,
         material_hash=$21,
         payload=$22::jsonb,
         updated_at=now()
       WHERE id=$1`,
      [
        revised.id,
        revised.knowledgeClass,
        revised.normalizedClaim,
        revised.exactApprovedFact,
        JSON.stringify(revised.scope),
        revised.sourceType,
        revised.provenance,
        revised.approvalState,
        revised.contentHash,
        revised.revisionId,
        revised.publicUsageAllowed,
        revised.usageScope,
        revised.firsthand,
        revised.confidence,
        revised.effectiveFrom,
        revised.effectiveTo,
        revised.freshnessPolicyDays,
        JSON.stringify(revised.contradictions),
        revised.schemaVersion,
        JSON.stringify(revised.pipelineVersions),
        revised.materialHash,
        JSON.stringify(revised)
      ]
    );
    await client.query(
      `INSERT INTO knowledge_entry_revisions(revision_id, entry_id, content_hash, payload)
       VALUES ($1,$2,$3,$4::jsonb)
       ON CONFLICT (revision_id) DO NOTHING`,
      [revised.revisionId, revised.id, revised.contentHash, JSON.stringify(revised)]
    );
    // Invalidate prior approval rows for old content hash
    await client.query(
      `UPDATE knowledge_approvals SET invalidated_at=now(), invalidation_reason='content_changed'
       WHERE entry_id=$1 AND content_hash=$2 AND invalidated_at IS NULL`,
      [existing.id, existing.contentHash]
    );
    await writeKnowledgeAudit(client, {
      entryId: revised.id,
      action: "REVISE_INVALIDATE_APPROVAL",
      actor,
      detail: {
        previousContentHash: existing.contentHash,
        contentHash: revised.contentHash,
        previousRevisionId: existing.revisionId,
        revisionId: revised.revisionId
      }
    });
    await client.query("COMMIT");
    return { entry: revised, outcome: "updated" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function approveKnowledgeEntry(
  db: Db,
  args: {
    entryId: string;
    expectedRevisionId: string;
    expectedContentHash: string;
    approvedBy: string;
    approvedAt: string;
    approvalMethod: KnowledgeApprovalMethod;
    publicUsageAllowed: boolean;
    usageScope: string;
    actor?: string;
  }
): Promise<KnowledgeEntry> {
  const actor = args.actor || args.approvedBy;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: KnowledgeEntry }>(
      `SELECT payload FROM knowledge_entries WHERE id=$1 FOR UPDATE`,
      [args.entryId]
    );
    if (!rows.length) throw new Error(`knowledge entry ${args.entryId} not found`);
    const current = rowToEntry(rows[0]!.payload);

    if (current.revisionId !== args.expectedRevisionId) {
      throw new Error("concurrent revision conflict: expectedRevisionId does not match current revision");
    }
    if (current.contentHash !== args.expectedContentHash) {
      throw new Error("content hash mismatch: cannot approve competing or stale content");
    }
    if (current.approvalState === "REVOKED") {
      throw new Error("revoked knowledge cannot be approved without a new revision");
    }
    if (
      current.approvalState === "APPROVED" &&
      current.contentHash === args.expectedContentHash &&
      current.revisionId === args.expectedRevisionId &&
      current.approvedBy === args.approvedBy.trim() &&
      current.approvedAt === args.approvedAt
    ) {
      await client.query("COMMIT");
      return current;
    }

    const approved = applyExplicitApproval(current, {
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      approvalMethod: args.approvalMethod,
      publicUsageAllowed: args.publicUsageAllowed,
      usageScope: args.usageScope
    });

    if (!isActivelyApprovedKnowledge(approved, approved.contentHash, new Date(args.approvedAt))) {
      throw new Error("approval validation failed after apply");
    }

    await client.query(
      `UPDATE knowledge_entries SET
         approval_state='APPROVED',
         approved_by=$2,
         approved_at=$3,
         approval_method=$4,
         public_usage_allowed=$5,
         usage_scope=$6,
         material_hash=$7,
         payload=$8::jsonb,
         pipeline_versions=$9::jsonb,
         updated_at=now()
       WHERE id=$1`,
      [
        approved.id,
        approved.approvedBy,
        approved.approvedAt,
        approved.approvalMethod,
        approved.publicUsageAllowed,
        approved.usageScope,
        approved.materialHash,
        JSON.stringify(approved),
        JSON.stringify(approved.pipelineVersions)
      ]
    );

    await client.query(
      `INSERT INTO knowledge_approvals(
         entry_id, revision_id, content_hash, approval_state, approved_by, approved_at,
         approval_method, public_usage_allowed, usage_scope, detail
       ) VALUES ($1,$2,$3,'APPROVED',$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (entry_id, revision_id, content_hash, approval_state, approved_at) DO NOTHING`,
      [
        approved.id,
        approved.revisionId,
        approved.contentHash,
        approved.approvedBy,
        approved.approvedAt,
        approved.approvalMethod,
        approved.publicUsageAllowed,
        approved.usageScope,
        JSON.stringify({ actor })
      ]
    );

    await writeKnowledgeAudit(client, {
      entryId: approved.id,
      action: "APPROVE",
      actor,
      detail: {
        revisionId: approved.revisionId,
        contentHash: approved.contentHash,
        approvedBy: approved.approvedBy
      }
    });

    await client.query("COMMIT");
    return approved;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeKnowledgeEntry(
  db: Db,
  args: { entryId: string; revokedBy: string; reason: string; actor?: string }
): Promise<KnowledgeEntry> {
  const actor = args.actor || args.revokedBy;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: KnowledgeEntry }>(
      `SELECT payload FROM knowledge_entries WHERE id=$1 FOR UPDATE`,
      [args.entryId]
    );
    if (!rows.length) throw new Error(`knowledge entry ${args.entryId} not found`);
    const current = rowToEntry(rows[0]!.payload);
    const now = new Date().toISOString();
    const partial: Omit<KnowledgeEntry, "materialHash" | "pipelineVersions"> = {
      ...current,
      approvalState: "REVOKED",
      revokedAt: now,
      revokedBy: args.revokedBy,
      revokeReason: args.reason
    };
    const revoked: KnowledgeEntry = {
      ...partial,
      pipelineVersions: createPipelineVersionStamp("M4"),
      materialHash: materialKnowledgeHash(partial)
    };
    await client.query(
      `UPDATE knowledge_entries SET
         approval_state='REVOKED',
         revoked_at=$2,
         revoked_by=$3,
         revoke_reason=$4,
         material_hash=$5,
         payload=$6::jsonb,
         pipeline_versions=$7::jsonb,
         updated_at=now()
       WHERE id=$1`,
      [
        revoked.id,
        revoked.revokedAt,
        revoked.revokedBy,
        revoked.revokeReason,
        revoked.materialHash,
        JSON.stringify(revoked),
        JSON.stringify(revoked.pipelineVersions)
      ]
    );
    await writeKnowledgeAudit(client, {
      entryId: revoked.id,
      action: "REVOKE",
      actor,
      detail: { reason: args.reason }
    });
    await client.query("COMMIT");
    return revoked;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markKnowledgeStale(
  db: Db,
  args: { entryId: string; actor?: string; reason?: string }
): Promise<KnowledgeEntry> {
  const actor = args.actor || "system:m4-stale";
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: KnowledgeEntry }>(
      `SELECT payload FROM knowledge_entries WHERE id=$1 FOR UPDATE`,
      [args.entryId]
    );
    if (!rows.length) throw new Error(`knowledge entry ${args.entryId} not found`);
    const current = rowToEntry(rows[0]!.payload);
    const partial: Omit<KnowledgeEntry, "materialHash" | "pipelineVersions"> = {
      ...current,
      approvalState: "STALE"
    };
    const stale: KnowledgeEntry = {
      ...partial,
      pipelineVersions: createPipelineVersionStamp("M4"),
      materialHash: materialKnowledgeHash(partial)
    };
    await client.query(
      `UPDATE knowledge_entries SET
         approval_state='STALE',
         material_hash=$2,
         payload=$3::jsonb,
         pipeline_versions=$4::jsonb,
         updated_at=now()
       WHERE id=$1`,
      [stale.id, stale.materialHash, JSON.stringify(stale), JSON.stringify(stale.pipelineVersions)]
    );
    await writeKnowledgeAudit(client, {
      entryId: stale.id,
      action: "MARK_STALE",
      actor,
      detail: { reason: args.reason || "freshness_policy" }
    });
    await client.query("COMMIT");
    return stale;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listKnowledgeEntries(db: Db): Promise<KnowledgeEntry[]> {
  const { rows } = await db.query<{ payload: KnowledgeEntry }>(
    `SELECT payload FROM knowledge_entries ORDER BY id`
  );
  return rows.map(r => rowToEntry(r.payload));
}

export async function loadActiveSourceEvidenceForCluster(
  db: Db,
  clusterId: string
): Promise<ActiveSourceEvidenceStub[]> {
  const { rows } = await db.query<{
    id: string;
    payload: { summary?: string; sourceType?: string; question?: string };
    approval_state: string;
    public_usage_allowed: boolean;
  }>(
    `SELECT se.id, se.payload, se.approval_state, se.public_usage_allowed
     FROM opportunity_cluster_evidence oce
     JOIN source_evidence se ON se.id = oce.source_evidence_id
     WHERE oce.cluster_id=$1
     ORDER BY se.id`,
    [clusterId]
  );
  return rows.map(r => ({
    id: r.id,
    summary: r.payload?.summary || r.payload?.question || "",
    sourceType: r.payload?.sourceType || "unknown",
    approvalState: r.approval_state,
    publicUsageAllowed: r.public_usage_allowed === true
  }));
}

export async function persistClusterEvidenceEvaluation(
  db: Db,
  args: {
    budgets: ClusterEvidenceBudgetM4[];
    packets?: MerchantInterviewPacket[];
    actor?: string;
    forceRunRecord?: boolean;
  }
): Promise<{
  inserted: number;
  updated: number;
  unchanged: number;
  runId: number | null;
  evaluationVersion: string;
}> {
  const actor = args.actor || "system:m4-eval";
  const client = await db.connect();
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(87241004)");

    for (const budget of args.budgets) {
      const { rows } = await client.query<{ material_hash: string }>(
        `SELECT material_hash FROM cluster_evidence_budgets WHERE cluster_id=$1 FOR UPDATE`,
        [budget.clusterId]
      );
      if (rows.length && rows[0]!.material_hash === budget.materialHash) {
        unchanged++;
        // Refresh claim rows only if missing (should exist); do not rewrite timestamps on budget
        continue;
      }

      await client.query(
        `INSERT INTO cluster_evidence_budgets(
           cluster_id, canonical_reader_task_id, evaluation_version, payload, material_hash,
           readiness_status, schema_version, pipeline_versions
         ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb)
         ON CONFLICT (cluster_id) DO UPDATE SET
           canonical_reader_task_id=EXCLUDED.canonical_reader_task_id,
           evaluation_version=EXCLUDED.evaluation_version,
           payload=EXCLUDED.payload,
           material_hash=EXCLUDED.material_hash,
           readiness_status=EXCLUDED.readiness_status,
           schema_version=EXCLUDED.schema_version,
           pipeline_versions=EXCLUDED.pipeline_versions,
           updated_at=now()`,
        [
          budget.clusterId,
          budget.canonicalReaderTaskId,
          budget.evaluationVersion,
          JSON.stringify(budget),
          budget.materialHash,
          budget.evidenceReadiness.status,
          budget.schemaVersion,
          JSON.stringify(budget.pipelineVersions)
        ]
      );

      // Replace claim requirements transactionally for this cluster
      await client.query(`DELETE FROM cluster_claim_requirements WHERE cluster_id=$1`, [budget.clusterId]);
      for (const claim of budget.claimRequirements) {
        await client.query(
          `INSERT INTO cluster_claim_requirements(
             id, cluster_id, claim_class, normalized_claim, support_status, payload, material_hash
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
          [
            claim.id,
            budget.clusterId,
            claim.claimClass,
            claim.normalizedClaim,
            claim.supportStatus,
            JSON.stringify(claim),
            hashJson({
              id: claim.id,
              supportStatus: claim.supportStatus,
              supportingRevisionIds: claim.supportingRevisionIds
            })
          ]
        );
        await client.query(
          `INSERT INTO knowledge_claims(id, cluster_id, claim_class, normalized_claim, payload)
           VALUES ($1,$2,$3,$4,$5::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             cluster_id=EXCLUDED.cluster_id,
             claim_class=EXCLUDED.claim_class,
             normalized_claim=EXCLUDED.normalized_claim,
             payload=EXCLUDED.payload,
             updated_at=now()`,
          [claim.id, budget.clusterId, claim.claimClass, claim.normalizedClaim, JSON.stringify(claim)]
        );
      }

      if (rows.length) updated++;
      else inserted++;

      await writeKnowledgeAudit(client, {
        entryId: null,
        action: rows.length ? "BUDGET_UPDATE" : "BUDGET_CREATE",
        actor,
        detail: { clusterId: budget.clusterId, materialHash: budget.materialHash }
      });
    }

    if (args.packets) {
      for (const packet of args.packets) {
        await client.query(
          `INSERT INTO merchant_interview_packets(
             id, knowledge_class, payload, material_hash, completion_status
           ) VALUES ($1,$2,$3::jsonb,$4,$5)
           ON CONFLICT (id) DO UPDATE SET
             payload=EXCLUDED.payload,
             material_hash=EXCLUDED.material_hash,
             completion_status=EXCLUDED.completion_status,
             updated_at=CASE
               WHEN merchant_interview_packets.material_hash = EXCLUDED.material_hash
                 AND merchant_interview_packets.completion_status = EXCLUDED.completion_status
               THEN merchant_interview_packets.updated_at
               ELSE now()
             END`,
          [
            packet.id,
            packet.knowledgeClass,
            JSON.stringify(packet),
            packet.materialHash,
            packet.completionStatus
          ]
        );
        for (const q of packet.questions) {
          await client.query(
            `INSERT INTO merchant_interview_questions(id, packet_id, prompt, payload)
             VALUES ($1,$2,$3,$4::jsonb)
             ON CONFLICT (id) DO UPDATE SET prompt=EXCLUDED.prompt, payload=EXCLUDED.payload`,
            [q.id, packet.id, q.prompt, JSON.stringify(q)]
          );
        }
      }
    }

    let runId: number | null = null;
    const materialRun = hashJson({
      budgets: args.budgets.map(b => b.materialHash).sort(),
      version: KNOWLEDGE_EVALUATION_VERSION
    });
    if (!args.forceRunRecord) {
      const { rows: prior } = await client.query<{ id: string }>(
        `SELECT id::text FROM knowledge_evaluation_runs
         WHERE material_hash=$1
         ORDER BY id DESC LIMIT 1`,
        [materialRun]
      );
      if (prior.length && inserted === 0 && updated === 0) {
        runId = Number(prior[0]!.id);
      }
    }
    if (runId == null) {
      const { rows: runRows } = await client.query<{ id: string }>(
        `INSERT INTO knowledge_evaluation_runs(
           evaluation_version, inserted_count, updated_count, unchanged_count,
           cluster_count, material_hash, detail
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
         RETURNING id::text`,
        [
          KNOWLEDGE_EVALUATION_VERSION,
          inserted,
          updated,
          unchanged,
          args.budgets.length,
          materialRun,
          JSON.stringify({ actor })
        ]
      );
      runId = Number(runRows[0]!.id);
    }

    await client.query("COMMIT");
    return {
      inserted,
      updated,
      unchanged,
      runId,
      evaluationVersion: KNOWLEDGE_EVALUATION_VERSION
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function evaluateAndPersistAllActiveClusters(
  db: Db,
  args: { actor?: string } = {}
): Promise<{
  budgets: ClusterEvidenceBudgetM4[];
  packets: MerchantInterviewPacket[];
  persist: Awaited<ReturnType<typeof persistClusterEvidenceEvaluation>>;
}> {
  const knowledgeEntries = await listKnowledgeEntries(db);
  const { rows: clusterRows } = await db.query<{ payload: OpportunityCluster }>(
    `SELECT payload FROM opportunity_clusters WHERE status IN ('active','needs_review') ORDER BY id`
  );
  const clusters = clusterRows.map(r => r.payload);
  const budgets: ClusterEvidenceBudgetM4[] = [];

  for (const cluster of clusters) {
    const { rows: taskRows } = await db.query<{ payload: ReaderTask }>(
      `SELECT payload FROM reader_tasks WHERE id=$1`,
      [cluster.canonicalReaderTaskId]
    );
    if (!taskRows.length) continue;
    const sourceEvidence = await loadActiveSourceEvidenceForCluster(db, cluster.id);
    budgets.push(
      evaluateClusterKnowledge({
        cluster,
        canonicalTask: taskRows[0]!.payload,
        knowledgeEntries,
        sourceEvidence
      })
    );
  }

  const packets = buildMerchantInterviewPackets({ budgets, clusters });
  const persist = await persistClusterEvidenceEvaluation(db, {
    budgets,
    packets,
    actor: args.actor
  });
  return { budgets, packets, persist };
}

export async function submitInterviewAnswerAsPendingKnowledge(
  db: Db,
  args: {
    packetId: string;
    questionId: string;
    answerText: string;
    knowledgeClass: KnowledgeEntry["knowledgeClass"];
    sourceReference: string;
    actor: string;
    scope?: BuildKnowledgeArgs["scope"];
  }
): Promise<{ entry: KnowledgeEntry; outcome: "inserted" | "updated" | "unchanged" }> {
  const result = await upsertKnowledgeEntry(db, {
    knowledgeClass: args.knowledgeClass,
    normalizedClaim: `Interview answer for question ${args.questionId}`,
    exactApprovedFact: args.answerText.trim(),
    scope: args.scope,
    sourceType: "approved_merchant_firsthand",
    sourceReference: args.sourceReference,
    provenance: `merchant_interview_packet:${args.packetId}`,
    firsthand: true,
    publicUsageAllowed: false,
    usageScope: "",
    confidence: "unknown",
    actor: args.actor,
    approvalState: "PENDING_APPROVAL"
  });

  await db.query(
    `INSERT INTO merchant_interview_answers(packet_id, question_id, entry_id, revision_id, answer_text, approval_state)
     VALUES ($1,$2,$3,$4,$5,'PENDING_APPROVAL')
     ON CONFLICT (packet_id, question_id) DO UPDATE SET
       entry_id=EXCLUDED.entry_id,
       revision_id=EXCLUDED.revision_id,
       answer_text=EXCLUDED.answer_text,
       approval_state='PENDING_APPROVAL',
       updated_at=now()`,
    [args.packetId, args.questionId, result.entry.id, result.entry.revisionId, args.answerText.trim()]
  );

  await db.query(
    `UPDATE merchant_interview_packets
     SET completion_status='answered_pending_approval', updated_at=now()
     WHERE id=$1`,
    [args.packetId]
  );

  return result;
}

export async function getKnowledgeRegistryHealth(db: Db): Promise<{
  evaluationVersion: string;
  approvedKnowledgeCount: number;
  pendingApprovalCount: number;
  rejectedRevokedInvalidatedStaleCount: number;
  knowledgeByClass: Array<{ knowledgeClass: string; count: number }>;
  knowledgeBySourceType: Array<{ sourceType: string; count: number }>;
  clustersWithBudgets: number;
  clustersMissingMerchantKnowledge: number;
  clustersMissingTechnicalEvidence: number;
  contradictionClaimCount: number;
  staleClaimCount: number;
  interviewPacketCount: number;
  openInterviewPacketCount: number;
  sampleClaimTraces: Array<{
    clusterId: string;
    claimId: string;
    claimClass: string;
    supportStatus: string;
    trace: string;
  }>;
  lastEvaluationRunAt: string | null;
}> {
  const { rows: stateRows } = await db.query<{ approval_state: string; n: string }>(
    `SELECT approval_state, count(*)::text AS n FROM knowledge_entries GROUP BY approval_state`
  );
  const counts = Object.fromEntries(stateRows.map(r => [r.approval_state, Number(r.n)]));
  const approvedKnowledgeCount = counts.APPROVED || 0;
  const pendingApprovalCount = counts.PENDING_APPROVAL || 0;
  const rejectedRevokedInvalidatedStaleCount =
    (counts.REJECTED || 0) + (counts.REVOKED || 0) + (counts.INVALIDATED || 0) + (counts.STALE || 0);

  const { rows: classRows } = await db.query<{ knowledge_class: string; n: string }>(
    `SELECT knowledge_class, count(*)::text AS n FROM knowledge_entries GROUP BY knowledge_class ORDER BY knowledge_class`
  );
  const { rows: sourceRows } = await db.query<{ source_type: string; n: string }>(
    `SELECT source_type, count(*)::text AS n FROM knowledge_entries GROUP BY source_type ORDER BY source_type`
  );

  const { rows: budgetRows } = await db.query<{
    n: string;
    missing_merchant: string;
    missing_tech: string;
  }>(
    `SELECT
       count(*)::text AS n,
       count(*) FILTER (
         WHERE readiness_status = 'needs_merchant_input'
            OR (payload->'missingFirsthandKnowledge') <> '[]'::jsonb
       )::text AS missing_merchant,
       count(*) FILTER (
         WHERE (payload->'missingTechnicalEvidence') <> '[]'::jsonb
       )::text AS missing_tech
     FROM cluster_evidence_budgets`
  );

  const { rows: claimAgg } = await db.query<{ conflicting: string; stale: string }>(
    `SELECT
       count(*) FILTER (WHERE support_status='conflicting')::text AS conflicting,
       count(*) FILTER (WHERE support_status='stale')::text AS stale
     FROM cluster_claim_requirements`
  );

  const { rows: packetRows } = await db.query<{ n: string; open_n: string }>(
    `SELECT
       count(*)::text AS n,
       count(*) FILTER (WHERE completion_status IN ('open','answered_pending_approval'))::text AS open_n
     FROM merchant_interview_packets`
  );

  const { rows: traceRows } = await db.query<{ payload: ClaimReqTrace }>(
    `SELECT payload FROM cluster_claim_requirements
     ORDER BY cluster_id, id
     LIMIT 12`
  );

  const { rows: runRows } = await db.query<{ created_at: string }>(
    `SELECT created_at FROM knowledge_evaluation_runs ORDER BY id DESC LIMIT 1`
  );

  return {
    evaluationVersion: KNOWLEDGE_EVALUATION_VERSION,
    approvedKnowledgeCount,
    pendingApprovalCount,
    rejectedRevokedInvalidatedStaleCount,
    knowledgeByClass: classRows.map(r => ({ knowledgeClass: r.knowledge_class, count: Number(r.n) })),
    knowledgeBySourceType: sourceRows.map(r => ({ sourceType: r.source_type, count: Number(r.n) })),
    clustersWithBudgets: Number(budgetRows[0]?.n || 0),
    clustersMissingMerchantKnowledge: Number(budgetRows[0]?.missing_merchant || 0),
    clustersMissingTechnicalEvidence: Number(budgetRows[0]?.missing_tech || 0),
    contradictionClaimCount: Number(claimAgg[0]?.conflicting || 0),
    staleClaimCount: Number(claimAgg[0]?.stale || 0),
    interviewPacketCount: Number(packetRows[0]?.n || 0),
    openInterviewPacketCount: Number(packetRows[0]?.open_n || 0),
    sampleClaimTraces: traceRows.map(r => {
      const c = r.payload;
      const evidence =
        c.supportingRevisionIds?.length
          ? `knowledge ${ (c.supportingKnowledgeIds || []).join(",") }@${(c.supportingRevisionIds || []).join(",")}`
          : (c.supportingSourceEvidenceIds || []).length
            ? `source ${(c.supportingSourceEvidenceIds || []).join(",")}`
            : "none";
      return {
        clusterId: c.clusterId,
        claimId: c.id,
        claimClass: c.claimClass,
        supportStatus: c.supportStatus,
        trace:
          `${evidence} → scope/freshness ${c.freshness} → approval/support ${c.supportStatus} → ` +
          `claim ${c.claimClass} → decision ${c.safeToState ? "safe_to_state" : "not_safe"} (${c.explanation})`
      };
    }),
    lastEvaluationRunAt: runRows[0]?.created_at || null
  };
}

interface ClaimReqTrace {
  id: string;
  clusterId: string;
  claimClass: string;
  supportStatus: string;
  freshness: string;
  safeToState: boolean;
  explanation: string;
  supportingKnowledgeIds?: string[];
  supportingRevisionIds?: string[];
  supportingSourceEvidenceIds?: string[];
}
