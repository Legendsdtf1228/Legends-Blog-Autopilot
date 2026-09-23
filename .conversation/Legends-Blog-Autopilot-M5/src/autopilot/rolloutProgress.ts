/**
 * Authoritative advancement of promotionProgress.consecutiveReviewedDrafts.
 * All merchant-review → rollout counting must go through recordReviewedDraftForRollout.
 *
 * Concurrency: one encompassing transaction with:
 * - FOR UPDATE lock on app_settings
 * - unique partial index on audit_events(article_id) WHERE action='rollout_draft_counted'
 * - atomic JSONB counter increment
 * - audit insert in the same transaction (rolls back together on failure)
 */
import type { Db } from "../db.js";
import { mergeSettings } from "../defaults.js";
import { qualityGatesPassed } from "../research/quality.js";
import {
  isEligibleForRolloutProgress,
  type RolloutEligibilityInput
} from "../research/quarantine.js";
import type { EvidenceReport } from "../research/types.js";
import type { Settings } from "../types.js";

export const ROLLOUT_COUNTED_ACTION = "rollout_draft_counted";

export async function articleAlreadyCountedTowardRollout(db: Db, articleId: number): Promise<boolean> {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events
     WHERE article_id=$1 AND action=$2`,
    [articleId, ROLLOUT_COUNTED_ACTION]
  );
  return Number(rows[0]?.n || 0) > 0;
}

export function eligibilityInputFromArticle(args: {
  title: string;
  primaryKeyword?: string;
  status?: string | null;
  generationSettings?: Record<string, unknown> | null;
  evidencePresent: boolean;
  qualityGatesOk: boolean;
  merchantApproved: boolean;
}): RolloutEligibilityInput {
  const gs = args.generationSettings || {};
  return {
    title: args.title,
    primaryKeyword: args.primaryKeyword,
    status: args.status,
    decision: typeof gs.decision === "string" ? gs.decision : null,
    countsTowardRolloutFlag:
      typeof gs.countsTowardRollout === "boolean" ? gs.countsTowardRollout : null,
    quarantined: gs.quarantined === true,
    evidencePresent: args.evidencePresent,
    qualityGatesPassed: args.qualityGatesOk,
    merchantApproved: args.merchantApproved
  };
}

export interface RecordReviewedDraftOptions {
  actor?: string;
  requireMerchantApproval?: boolean;
  /** @internal Test-only: throw after lock/eligibility, before commit — proves rollback. */
  _testThrowBeforeCommit?: boolean;
}

/**
 * Record a merchant-reviewed draft against the 30-draft promotion counter.
 * Idempotent and concurrency-safe per article_id.
 */
export async function recordReviewedDraftForRollout(
  db: Db,
  articleId: number,
  opts?: RecordReviewedDraftOptions
): Promise<{
  counted: boolean;
  consecutiveReviewedDrafts: number;
  reasons: string[];
  alreadyCounted: boolean;
}> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Serialize counter updates across workers
    const settingsRes = await client.query<{ value: Partial<Settings> }>(
      "SELECT value FROM app_settings WHERE singleton=true FOR UPDATE"
    );
    const settings = mergeSettings(settingsRes.rows[0]?.value);
    const currentCount = settings.promotionProgress.consecutiveReviewedDrafts;

    const countedRes = await client.query<{ id: string }>(
      `SELECT id FROM audit_events
       WHERE article_id=$1 AND action=$2
       FOR UPDATE`,
      [articleId, ROLLOUT_COUNTED_ACTION]
    );
    if (countedRes.rows[0]) {
      await client.query("COMMIT");
      return {
        counted: false,
        consecutiveReviewedDrafts: currentCount,
        reasons: ["Article already counted toward rollout progress (idempotent)."],
        alreadyCounted: true
      };
    }

    const articleRes = await client.query<{
      id: string;
      title: string;
      primary_keyword: string;
      status: string;
      generation_settings: Record<string, unknown> | null;
    }>(
      `SELECT id, title, primary_keyword, status, generation_settings
       FROM articles WHERE id=$1 FOR UPDATE`,
      [articleId]
    );
    const articleRow = articleRes.rows[0];
    if (!articleRow) {
      await client.query("ROLLBACK");
      return {
        counted: false,
        consecutiveReviewedDrafts: currentCount,
        reasons: ["Article not found."],
        alreadyCounted: false
      };
    }

    // Evidence lookup (same connection; no nested transaction)
    const evidenceRes = await client.query<{ payload: unknown }>(
      `SELECT payload FROM evidence_reports
       WHERE article_id=$1
       ORDER BY created_at DESC LIMIT 1`,
      [articleId]
    );
    const evidence = evidenceRes.rows[0]?.payload
      ? (evidenceRes.rows[0].payload as EvidenceReport)
      : null;
    const qualityOk = evidence ? qualityGatesPassed(evidence) : false;
    const requireApproval = opts?.requireMerchantApproval !== false;
    const merchantApproved =
      !requireApproval ||
      articleRow.status === "ready" ||
      articleRow.status === "scheduled" ||
      articleRow.status === "published";

    const eligibility = isEligibleForRolloutProgress(
      eligibilityInputFromArticle({
        title: articleRow.title,
        primaryKeyword: articleRow.primary_keyword,
        status: articleRow.status,
        generationSettings: articleRow.generation_settings,
        evidencePresent: Boolean(evidence),
        qualityGatesOk: qualityOk,
        merchantApproved
      })
    );

    if (!eligibility.ok) {
      await client.query(
        `INSERT INTO audit_events(actor, action, article_id, job_id, detail)
         VALUES ($1,$2,$3,NULL,$4::jsonb)`,
        [
          opts?.actor || "system",
          "rollout_draft_not_counted",
          articleId,
          JSON.stringify({ reasons: eligibility.reasons })
        ]
      );
      await client.query("COMMIT");
      return {
        counted: false,
        consecutiveReviewedDrafts: currentCount,
        reasons: eligibility.reasons,
        alreadyCounted: false
      };
    }

    // Atomic JSONB increment under the settings row lock
    const incRes = await client.query<{ next_count: number }>(
      `UPDATE app_settings
       SET value = jsonb_set(
             jsonb_set(
               value,
               '{draftOnlyMode}',
               to_jsonb(
                 CASE
                   WHEN COALESCE(value->>'rolloutMode','') = 'auto_publish'
                     THEN COALESCE((value->>'draftOnlyMode')::boolean, true)
                   ELSE true
                 END
               )
             ),
             '{promotionProgress,consecutiveReviewedDrafts}',
             to_jsonb(
               COALESCE((value->'promotionProgress'->>'consecutiveReviewedDrafts')::int, 0) + 1
             )
           ),
           updated_at = now()
       WHERE singleton = true
       RETURNING (value->'promotionProgress'->>'consecutiveReviewedDrafts')::int AS next_count`
    );
    const nextCount = Number(incRes.rows[0]?.next_count ?? currentCount + 1);

    await client.query(
      `INSERT INTO audit_events(actor, action, article_id, job_id, detail)
       VALUES ($1,$2,$3,NULL,$4::jsonb)`,
      [
        opts?.actor || "system",
        ROLLOUT_COUNTED_ACTION,
        articleId,
        JSON.stringify({
          consecutiveReviewedDrafts: nextCount,
          title: articleRow.title,
          primaryKeyword: articleRow.primary_keyword
        })
      ]
    );

    if (opts?._testThrowBeforeCommit) {
      throw new Error("TEST_ROLLOUT_ROLLBACK");
    }

    await client.query("COMMIT");
    return {
      counted: true,
      consecutiveReviewedDrafts: nextCount,
      reasons: [],
      alreadyCounted: false
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore rollback errors */
    }
    const code = (error as { code?: string })?.code;
    // Unique violation on rollout_draft_counted → concurrent winner already counted
    if (code === "23505") {
      const settings = mergeSettings(
        (await db.query<{ value: Partial<Settings> }>(
          "SELECT value FROM app_settings WHERE singleton=true"
        )).rows[0]?.value
      );
      return {
        counted: false,
        consecutiveReviewedDrafts: settings.promotionProgress.consecutiveReviewedDrafts,
        reasons: ["Article already counted toward rollout progress (idempotent)."],
        alreadyCounted: true
      };
    }
    if ((error as Error)?.message === "TEST_ROLLOUT_ROLLBACK") {
      const settings = mergeSettings(
        (await db.query<{ value: Partial<Settings> }>(
          "SELECT value FROM app_settings WHERE singleton=true"
        )).rows[0]?.value
      );
      return {
        counted: false,
        consecutiveReviewedDrafts: settings.promotionProgress.consecutiveReviewedDrafts,
        reasons: ["Rolled back test injection; counter unchanged."],
        alreadyCounted: false
      };
    }
    throw error;
  } finally {
    client.release();
  }
}
