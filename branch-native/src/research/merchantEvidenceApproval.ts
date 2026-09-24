/**
 * Merchant approval workflow for pending SourceEvidence (M2).
 * Approval is stored as authoritative structured columns + audit events.
 * Content changes invalidate prior approval until re-approved.
 */
import type { Db } from "../db.js";
import { recordAudit } from "../db.js";
import {
  computeEvidenceContentHash,
  validateEvidenceApproval,
  type EvidenceApprovalMethod,
  type EvidenceApprovalRecord
} from "./evidenceApproval.js";
import { materialEvidenceFingerprint, type SourceEvidence } from "./sourceEvidence.js";

export interface ApproveEvidenceArgs {
  evidenceId: string;
  approvedBy: string;
  approvalMethod: Exclude<EvidenceApprovalMethod, "fixture_template">;
  usageScope: string;
  publicUsageAllowed?: boolean;
  now?: Date;
  actor?: string;
}

export interface ApproveEvidenceResult {
  ok: boolean;
  reasons: string[];
  evidence?: SourceEvidence;
}

function loadPayload(row: { payload: SourceEvidence }): SourceEvidence {
  return {
    ...row.payload,
    approval: row.payload.approval ?? null
  };
}

export async function approvePendingSourceEvidence(
  db: Db,
  args: ApproveEvidenceArgs
): Promise<ApproveEvidenceResult> {
  const now = args.now ?? new Date();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id: string;
      payload: SourceEvidence;
      content_hash: string | null;
      approval_state: string;
    }>(
      `SELECT id, payload, content_hash, approval_state
       FROM source_evidence WHERE id=$1 FOR UPDATE`,
      [args.evidenceId]
    );
    const row = rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["evidence not found"] };
    }

    const evidence = loadPayload(row);
    if (evidence.approval?.approvalState === "REVOKED") {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["revoked evidence must be re-imported before approval"] };
    }

    const contentHash = computeEvidenceContentHash({
      sourceReference: evidence.sourceReference,
      normalizedProblem: evidence.normalizedProblem,
      normalizedQuestion: evidence.normalizedQuestion,
      evidenceSummary: evidence.evidenceSummary,
      audienceHint: evidence.audienceHint,
      situationHint: evidence.situationHint,
      decisionHint: evidence.decisionHint,
      desiredOutcomeHint: evidence.desiredOutcomeHint,
      stakesHint: evidence.stakesHint,
      constraintsHint: evidence.constraintsHint,
      legendsRelevanceHint: evidence.legendsRelevanceHint,
      periodStart: evidence.periodStart,
      periodEnd: evidence.periodEnd,
      geographicRelevance: evidence.geographicRelevance,
      metrics: evidence.metrics
    });

    const approval: EvidenceApprovalRecord = {
      approvalState: "APPROVED",
      approvedBy: args.approvedBy.trim(),
      approvedAt: now.toISOString(),
      approvalMethod: args.approvalMethod,
      contentHash,
      publicUsageAllowed: args.publicUsageAllowed !== false,
      usageScope: args.usageScope.trim(),
      revokedAt: null,
      revokedBy: null,
      revokeReason: null
    };

    const validation = validateEvidenceApproval(approval, {
      requireApproved: true,
      periodStart: evidence.periodStart,
      periodEnd: evidence.periodEnd,
      now,
      expectedContentHash: contentHash
    });
    if (!validation.ok) {
      await client.query("ROLLBACK");
      return { ok: false, reasons: validation.reasons };
    }

    const updated: SourceEvidence = {
      ...evidence,
      sourceType:
        evidence.sourceType === "pending_faq_template" ? "approved_customer_faq" : evidence.sourceType,
      confidence: "high",
      approval,
      provenance: {
        ...evidence.provenance,
        approvedBy: approval.approvedBy!,
        approvedAt: approval.approvedAt!,
        approvalMethod: approval.approvalMethod!,
        contentHash,
        publicUsageAllowed: true,
        usageScope: approval.usageScope,
        templateExample: false,
        description: evidence.provenance.description.includes("Pending")
          ? `Merchant-approved customer FAQ (${evidence.sourceReference}); no customer PII retained.`
          : evidence.provenance.description
      }
    };
    const materialHash = materialEvidenceFingerprint(updated);

    await client.query(
      `UPDATE source_evidence SET
         source_type=$2,
         confidence=$3,
         approval_state=$4,
         approved_by=$5,
         approved_at=$6::timestamptz,
         approval_method=$7,
         content_hash=$8,
         public_usage_allowed=$9,
         usage_scope=$10,
         revoked_at=NULL,
         revoked_by=NULL,
         revoke_reason=NULL,
         provenance=$11::jsonb,
         payload=$12::jsonb,
         material_hash=$13,
         updated_at=now()
       WHERE id=$1`,
      [
        args.evidenceId,
        updated.sourceType,
        updated.confidence,
        approval.approvalState,
        approval.approvedBy,
        approval.approvedAt,
        approval.approvalMethod,
        approval.contentHash,
        approval.publicUsageAllowed,
        approval.usageScope,
        JSON.stringify(updated.provenance),
        JSON.stringify(updated),
        materialHash
      ]
    );

    await client.query(
      `INSERT INTO evidence_approval_audits(
         source_evidence_id, action, actor, approved_by, approved_at,
         approval_method, content_hash, usage_scope, public_usage_allowed, detail
       ) VALUES ($1,'APPROVE',$2,$3,$4::timestamptz,$5,$6,$7,$8,$9::jsonb)`,
      [
        args.evidenceId,
        args.actor || args.approvedBy,
        approval.approvedBy,
        approval.approvedAt,
        approval.approvalMethod,
        approval.contentHash,
        approval.usageScope,
        approval.publicUsageAllowed,
        JSON.stringify({ previousState: row.approval_state })
      ]
    );

    await client.query("COMMIT");

    await recordAudit(db, {
      actor: args.actor || args.approvedBy,
      action: "evidence.approve",
      detail: {
        evidenceId: args.evidenceId,
        contentHash,
        approvalMethod: approval.approvalMethod,
        usageScope: approval.usageScope
      }
    });

    return { ok: true, reasons: [], evidence: updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSourceEvidenceApproval(
  db: Db,
  args: {
    evidenceId: string;
    revokedBy: string;
    reason: string;
    now?: Date;
    actor?: string;
  }
): Promise<ApproveEvidenceResult> {
  const now = args.now ?? new Date();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string; payload: SourceEvidence; approval_state: string }>(
      `SELECT id, payload, approval_state FROM source_evidence WHERE id=$1 FOR UPDATE`,
      [args.evidenceId]
    );
    const row = rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, reasons: ["evidence not found"] };
    }

    const evidence = loadPayload(row);
    const priorHash = evidence.approval?.contentHash || evidence.provenance.contentHash || null;
    const approval: EvidenceApprovalRecord = {
      approvalState: "REVOKED",
      approvedBy: evidence.approval?.approvedBy ?? null,
      approvedAt: evidence.approval?.approvedAt ?? null,
      approvalMethod: evidence.approval?.approvalMethod ?? null,
      contentHash: priorHash || "",
      publicUsageAllowed: false,
      usageScope: evidence.approval?.usageScope || evidence.provenance.usageScope || "",
      revokedAt: now.toISOString(),
      revokedBy: args.revokedBy.trim(),
      revokeReason: args.reason.trim()
    };

    const updated: SourceEvidence = {
      ...evidence,
      confidence: "unknown",
      approval,
      provenance: {
        ...evidence.provenance,
        publicUsageAllowed: false
      }
    };
    const materialHash = materialEvidenceFingerprint(updated);

    await client.query(
      `UPDATE source_evidence SET
         approval_state='REVOKED',
         public_usage_allowed=false,
         revoked_at=$2::timestamptz,
         revoked_by=$3,
         revoke_reason=$4,
         confidence='unknown',
         provenance=$5::jsonb,
         payload=$6::jsonb,
         material_hash=$7,
         updated_at=now()
       WHERE id=$1`,
      [
        args.evidenceId,
        approval.revokedAt,
        approval.revokedBy,
        approval.revokeReason,
        JSON.stringify(updated.provenance),
        JSON.stringify(updated),
        materialHash
      ]
    );

    await client.query(
      `INSERT INTO evidence_approval_audits(
         source_evidence_id, action, actor, approved_by, approved_at,
         approval_method, content_hash, usage_scope, public_usage_allowed, detail
       ) VALUES ($1,'REVOKE',$2,$3,$4::timestamptz,$5,$6,$7,false,$8::jsonb)`,
      [
        args.evidenceId,
        args.actor || args.revokedBy,
        approval.approvedBy,
        approval.approvedAt,
        approval.approvalMethod,
        priorHash,
        approval.usageScope,
        JSON.stringify({ reason: args.reason, previousState: row.approval_state })
      ]
    );

    await client.query("COMMIT");

    await recordAudit(db, {
      actor: args.actor || args.revokedBy,
      action: "evidence.revoke",
      detail: { evidenceId: args.evidenceId, reason: args.reason }
    });

    return { ok: true, reasons: [], evidence: updated };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * If stored content no longer matches the approval content hash, invalidate APPROVED → PENDING.
 */
export async function invalidateApprovalIfContentChanged(
  db: Db,
  evidenceId: string,
  actor = "system:content-hash-check"
): Promise<{ invalidated: boolean; reasons: string[] }> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{
      id: string;
      payload: SourceEvidence;
      approval_state: string;
      content_hash: string | null;
    }>(
      `SELECT id, payload, approval_state, content_hash FROM source_evidence WHERE id=$1 FOR UPDATE`,
      [evidenceId]
    );
    const row = rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return { invalidated: false, reasons: ["evidence not found"] };
    }
    if (row.approval_state !== "APPROVED") {
      await client.query("ROLLBACK");
      return { invalidated: false, reasons: ["not currently APPROVED"] };
    }

    const evidence = loadPayload(row);
    const currentHash = computeEvidenceContentHash({
      sourceReference: evidence.sourceReference,
      normalizedProblem: evidence.normalizedProblem,
      normalizedQuestion: evidence.normalizedQuestion,
      evidenceSummary: evidence.evidenceSummary,
      audienceHint: evidence.audienceHint,
      situationHint: evidence.situationHint,
      decisionHint: evidence.decisionHint,
      desiredOutcomeHint: evidence.desiredOutcomeHint,
      stakesHint: evidence.stakesHint,
      constraintsHint: evidence.constraintsHint,
      legendsRelevanceHint: evidence.legendsRelevanceHint,
      periodStart: evidence.periodStart,
      periodEnd: evidence.periodEnd,
      geographicRelevance: evidence.geographicRelevance,
      metrics: evidence.metrics
    });

    if (row.content_hash && row.content_hash === currentHash) {
      await client.query("ROLLBACK");
      return { invalidated: false, reasons: [] };
    }

    const approval: EvidenceApprovalRecord = {
      approvalState: "PENDING_APPROVAL",
      approvedBy: null,
      approvedAt: null,
      approvalMethod: null,
      contentHash: currentHash,
      publicUsageAllowed: false,
      usageScope: "reapproval_required",
      revokedAt: null,
      revokedBy: null,
      revokeReason: null
    };
    const updated: SourceEvidence = {
      ...evidence,
      confidence: "unknown",
      approval,
      provenance: {
        ...evidence.provenance,
        approvedBy: undefined,
        approvedAt: undefined,
        publicUsageAllowed: false,
        contentHash: currentHash,
        usageScope: "reapproval_required",
        description: `${evidence.provenance.description} [approval invalidated: content changed]`
      }
    };
    const materialHash = materialEvidenceFingerprint(updated);

    await client.query(
      `UPDATE source_evidence SET
         approval_state='PENDING_APPROVAL',
         approved_by=NULL,
         approved_at=NULL,
         approval_method=NULL,
         content_hash=$2,
         public_usage_allowed=false,
         usage_scope='reapproval_required',
         confidence='unknown',
         provenance=$3::jsonb,
         payload=$4::jsonb,
         material_hash=$5,
         updated_at=now()
       WHERE id=$1`,
      [evidenceId, currentHash, JSON.stringify(updated.provenance), JSON.stringify(updated), materialHash]
    );

    await client.query(
      `INSERT INTO evidence_approval_audits(
         source_evidence_id, action, actor, content_hash, usage_scope, public_usage_allowed, detail
       ) VALUES ($1,'INVALIDATE',$2,$3,'reapproval_required',false,$4::jsonb)`,
      [
        evidenceId,
        actor,
        currentHash,
        JSON.stringify({ previousHash: row.content_hash, reason: "content_hash_mismatch" })
      ]
    );

    await client.query("COMMIT");

    await recordAudit(db, {
      actor,
      action: "evidence.approval_invalidated",
      detail: { evidenceId, previousHash: row.content_hash, currentHash }
    });

    return { invalidated: true, reasons: ["content changed; prior approval invalidated"] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
