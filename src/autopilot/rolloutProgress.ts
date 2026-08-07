/**
 * Authoritative advancement of promotionProgress.consecutiveReviewedDrafts.
 * All merchant-review → rollout counting must go through recordReviewedDraftForRollout.
 */
import type { Db } from "../db.js";
import { getArticle, getSettings, recordAudit, saveSettings } from "../db.js";
import { getEvidenceReportForArticle } from "../research/store.js";
import { qualityGatesPassed } from "../research/quality.js";
import {
  isEligibleForRolloutProgress,
  type RolloutEligibilityInput
} from "../research/quarantine.js";

const ROLLOUT_COUNTED_ACTION = "rollout_draft_counted";

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

/**
 * Record a merchant-reviewed draft against the 30-draft promotion counter.
 * Idempotent per article_id via audit_events.
 */
export async function recordReviewedDraftForRollout(
  db: Db,
  articleId: number,
  opts?: { actor?: string; requireMerchantApproval?: boolean }
): Promise<{
  counted: boolean;
  consecutiveReviewedDrafts: number;
  reasons: string[];
  alreadyCounted: boolean;
}> {
  const article = await getArticle(db, articleId);
  if (!article) {
    return {
      counted: false,
      consecutiveReviewedDrafts: 0,
      reasons: ["Article not found."],
      alreadyCounted: false
    };
  }

  const settings = await getSettings(db);
  const alreadyCounted = await articleAlreadyCountedTowardRollout(db, articleId);
  if (alreadyCounted) {
    return {
      counted: false,
      consecutiveReviewedDrafts: settings.promotionProgress.consecutiveReviewedDrafts,
      reasons: ["Article already counted toward rollout progress (idempotent)."],
      alreadyCounted: true
    };
  }

  const evidence = await getEvidenceReportForArticle(db, articleId);
  const qualityOk = evidence ? qualityGatesPassed(evidence) : false;
  const requireApproval = opts?.requireMerchantApproval !== false;
  const merchantApproved =
    !requireApproval ||
    article.status === "ready" ||
    article.status === "scheduled" ||
    article.status === "published";

  const eligibility = isEligibleForRolloutProgress(
    eligibilityInputFromArticle({
      title: article.title,
      primaryKeyword: article.primaryKeyword,
      status: article.status,
      generationSettings: article.generationSettings,
      evidencePresent: Boolean(evidence),
      qualityGatesOk: qualityOk,
      merchantApproved
    })
  );

  if (!eligibility.ok) {
    await recordAudit(db, {
      actor: opts?.actor || "system",
      action: "rollout_draft_not_counted",
      articleId,
      detail: { reasons: eligibility.reasons }
    });
    return {
      counted: false,
      consecutiveReviewedDrafts: settings.promotionProgress.consecutiveReviewedDrafts,
      reasons: eligibility.reasons,
      alreadyCounted: false
    };
  }

  const nextCount = settings.promotionProgress.consecutiveReviewedDrafts + 1;
  await saveSettings(db, {
    ...settings,
    // Keep production paused / draft_only unless merchant explicitly changed it.
    draftOnlyMode: settings.rolloutMode === "auto_publish" ? settings.draftOnlyMode : true,
    promotionProgress: {
      ...settings.promotionProgress,
      consecutiveReviewedDrafts: nextCount
    }
  });

  await recordAudit(db, {
    actor: opts?.actor || "system",
    action: ROLLOUT_COUNTED_ACTION,
    articleId,
    detail: {
      consecutiveReviewedDrafts: nextCount,
      title: article.title,
      primaryKeyword: article.primaryKeyword
    }
  });

  return {
    counted: true,
    consecutiveReviewedDrafts: nextCount,
    reasons: [],
    alreadyCounted: false
  };
}

export { ROLLOUT_COUNTED_ACTION };
