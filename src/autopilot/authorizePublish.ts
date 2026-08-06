import type { Db } from "../db.js";
import { getArticle, getSettings } from "../db.js";
import { getBrief, getEvidenceReportForArticle } from "../research/store.js";
import { blocksAutoPublish, qualityGatesPassed } from "../research/quality.js";
import type { ArticleBrief, EvidenceReport } from "../research/types.js";
import type { ArticleRecord, Settings } from "../types.js";
import { canPublishUnderFrequencyLimits } from "./frequency.js";
import { promotionAllowsAutoPublish } from "./rollout.js";

export interface PublishAuthorizationInput {
  db: Db;
  settings?: Settings;
  articleId: number;
  brief?: ArticleBrief | null;
  evidence?: EvidenceReport | null;
  /** When true, evaluate would-publish without requiring rolloutMode === auto_publish (SHADOW_AUTO). */
  shadowEvaluation?: boolean;
  /** Skip DB frequency query when caller already checked. */
  frequencyOk?: boolean;
  frequencyReason?: string;
}

export interface PublishAuthorizationResult {
  /** True only when automatic Shopify create/update may proceed right now. */
  ok: boolean;
  /** True when article + settings + frequency would allow publish under AUTO_PUBLISH. */
  wouldPublish: boolean;
  articleReady: boolean;
  settingsReady: boolean;
  frequencyReady: boolean;
  reasons: string[];
}

function isResearchPipelineArticle(article: ArticleRecord): boolean {
  if (article.source === "research") return true;
  const gs = article.generationSettings || {};
  return Boolean(gs.briefId || gs.researchPipeline || gs.opportunityId);
}

export function evaluateArticlePublishReadiness(args: {
  article: ArticleRecord;
  brief: ArticleBrief | null;
  evidence: EvidenceReport | null;
}): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!isResearchPipelineArticle(args.article)) {
    reasons.push("Article did not originate from the gated research pipeline.");
  }
  if (!args.brief) {
    reasons.push("Linked research brief is missing.");
  } else {
    if (args.brief.decision !== "AUTO_ELIGIBLE") {
      reasons.push(`Brief decision is ${args.brief.decision}, not AUTO_ELIGIBLE.`);
    }
    if (!args.brief.automaticPublishingEligible) {
      reasons.push("Brief automaticPublishingEligible is false.");
    }
    if (args.brief.failedGates?.length) {
      reasons.push(`Unresolved failed gates: ${args.brief.failedGates.join(", ")}.`);
    }
  }
  if (!args.evidence) {
    reasons.push("Evidence report is missing.");
  } else {
    if (!qualityGatesPassed(args.evidence)) {
      reasons.push("Quality gates did not pass.");
    }
    if (blocksAutoPublish(args.evidence)) {
      reasons.push("Evidence report blocks automatic publication.");
    }
    const majorCritical = [
      ...(args.evidence.qualityGateResults || []).filter(g => !g.ok && (g.severity === "critical" || g.severity === "major")),
      ...(args.evidence.editorialFindings || []).filter(f => f.severity === "critical" || f.severity === "major")
    ];
    if (majorCritical.length) {
      reasons.push(`Critical/major findings present (${majorCritical.length}).`);
    }
    if (args.evidence.decision && args.evidence.decision !== "AUTO_ELIGIBLE") {
      reasons.push(`Evidence decision is ${args.evidence.decision}, not AUTO_ELIGIBLE.`);
    }
  }
  return { ready: reasons.length === 0, reasons };
}

export function evaluateSettingsPublishReadiness(settings: Settings): { ready: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!settings.enabled) reasons.push("Autopilot enabled is false.");
  if (settings.draftOnlyMode) reasons.push("draftOnlyMode is true.");
  if (settings.killSwitch.paused) {
    reasons.push(`Kill switch paused: ${settings.killSwitch.reason || "paused"}.`);
  }
  if (!settings.promotionProgress.autoPublishExplicitlyActivated) {
    reasons.push("autoPublishExplicitlyActivated is false.");
  }
  const promotion = promotionAllowsAutoPublish({
    consecutiveReviewedDrafts: settings.promotionProgress.consecutiveReviewedDrafts,
    merchantApprovalRate: settings.promotionProgress.merchantApprovalRate,
    shadowAutoDays: settings.promotionProgress.shadowAutoDays,
    thresholds: settings.promotionThresholds
  });
  if (!promotion.ok) reasons.push(...promotion.reasons);
  return { ready: reasons.length === 0, reasons };
}

/**
 * Fail-closed authorization used immediately before every automatic Shopify create/update.
 * Manual merchant publication is a separate workflow and should not call this.
 */
export async function authorizeAutomaticPublication(
  args: PublishAuthorizationInput
): Promise<PublishAuthorizationResult> {
  const settings = args.settings ?? (await getSettings(args.db));
  const article = await getArticle(args.db, args.articleId);
  const reasons: string[] = [];

  if (!article) {
    return {
      ok: false,
      wouldPublish: false,
      articleReady: false,
      settingsReady: false,
      frequencyReady: false,
      reasons: [`Article ${args.articleId} not found.`]
    };
  }

  let brief = args.brief ?? null;
  if (!brief) {
    const briefId = Number((article.generationSettings as { briefId?: number } | null)?.briefId || 0);
    if (briefId) brief = await getBrief(args.db, briefId);
  }

  let evidence = args.evidence ?? null;
  if (!evidence) evidence = await getEvidenceReportForArticle(args.db, args.articleId);

  const articleEval = evaluateArticlePublishReadiness({ article, brief, evidence });
  const settingsEval = evaluateSettingsPublishReadiness(settings);

  let frequencyReady = args.frequencyOk ?? false;
  let frequencyReason = args.frequencyReason;
  if (args.frequencyOk === undefined) {
    const freq = await canPublishUnderFrequencyLimits(args.db, settings);
    frequencyReady = freq.ok;
    frequencyReason = freq.reason;
  }
  if (!frequencyReady) reasons.push(frequencyReason || "Frequency limits block publication.");

  reasons.push(...articleEval.reasons, ...settingsEval.reasons);

  const modeIsAuto = settings.rolloutMode === "auto_publish";
  if (!modeIsAuto && !args.shadowEvaluation) {
    reasons.push(`rolloutMode is ${settings.rolloutMode}, not auto_publish.`);
  }

  const articleReady = articleEval.ready;
  const settingsReady = settingsEval.ready;
  const wouldPublish = articleReady && settingsReady && frequencyReady;
  const ok = wouldPublish && modeIsAuto && !args.shadowEvaluation;

  if (args.shadowEvaluation && !modeIsAuto) {
    // Shadow path: do not treat mode mismatch as a would-publish blocker beyond settings readiness.
  }

  return {
    ok,
    wouldPublish,
    articleReady,
    settingsReady,
    frequencyReady,
    reasons: reasons.length ? [...new Set(reasons)] : ["All automatic publication safety checks passed."]
  };
}
