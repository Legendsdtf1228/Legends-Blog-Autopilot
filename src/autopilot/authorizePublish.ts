import type { Db } from "../db.js";
import { getArticle, getSettings } from "../db.js";
import { getBrief, getEvidenceReportForArticle, getInterviewForBrief } from "../research/store.js";
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
  /**
   * SHADOW_AUTO: simulate eligibility as though publication mode were AUTO_PUBLISH.
   * Never authorizes a live Shopify write (`ok` stays false).
   * Ignores live draftOnlyMode / shadow rollout mode / activation checkbox.
   */
  shadowEvaluation?: boolean;
  /** Skip DB frequency query when caller already checked. */
  frequencyOk?: boolean;
  frequencyReason?: string;
}

export interface PublishAuthorizationResult {
  /** True only when automatic Shopify create/update may proceed right now. Always false in shadow. */
  ok: boolean;
  /** True when simulated AUTO_PUBLISH requirements pass (shadow) or live requirements pass. */
  wouldPublish: boolean;
  articleReady: boolean;
  settingsReady: boolean;
  frequencyReady: boolean;
  promotionReady: boolean;
  /** Categorized reasons for audit / dashboard. */
  articleReasons: string[];
  promotionReasons: string[];
  frequencyReasons: string[];
  livePublicationReasons: string[];
  /** Flat union of blockers (and success note when empty). */
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
  interviewApproved?: boolean;
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
    if (args.brief.requiresInterview && !args.interviewApproved) {
      reasons.push("Required merchant interview is not approved.");
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

export function evaluatePromotionReadiness(settings: Settings): { ready: boolean; reasons: string[] } {
  const result = promotionAllowsAutoPublish({
    consecutiveReviewedDrafts: settings.promotionProgress.consecutiveReviewedDrafts,
    merchantApprovalRate: settings.promotionProgress.merchantApprovalRate,
    shadowAutoDays: settings.promotionProgress.shadowAutoDays,
    thresholds: settings.promotionThresholds
  });
  return { ready: result.ok, reasons: result.reasons };
}

/**
 * Live AUTO_PUBLISH settings readiness (includes draftOnly + activation).
 * Prefer evaluateShadowSettingsReadiness for SHADOW_AUTO simulation.
 */
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
  if (settings.rolloutMode !== "auto_publish") {
    reasons.push(`rolloutMode is ${settings.rolloutMode}, not auto_publish.`);
  }
  const promotion = evaluatePromotionReadiness(settings);
  if (!promotion.ready) reasons.push(...promotion.reasons);
  return { ready: reasons.length === 0, reasons };
}

/**
 * SHADOW_AUTO simulated settings: treat mode as AUTO_PUBLISH for evaluation.
 * Ignores draftOnlyMode (required while shadowing) and the final activation checkbox.
 * Still requires enabled, kill switch clear, and promotion thresholds.
 */
export function evaluateShadowSettingsReadiness(settings: Settings): {
  ready: boolean;
  reasons: string[];
  promotionReasons: string[];
} {
  const reasons: string[] = [];
  if (!settings.enabled) reasons.push("Autopilot enabled is false.");
  if (settings.killSwitch.paused) {
    reasons.push(`Kill switch paused: ${settings.killSwitch.reason || "paused"}.`);
  }
  const promotion = evaluatePromotionReadiness(settings);
  if (!promotion.ready) reasons.push(...promotion.reasons);
  return { ready: reasons.length === 0, reasons, promotionReasons: promotion.reasons };
}

/**
 * Fail-closed authorization used immediately before every automatic Shopify create/update.
 * Manual merchant publication is a separate workflow and should not call this.
 *
 * Shadow evaluation never sets ok=true; wouldPublish may be true when simulated AUTO_PUBLISH
 * requirements pass (excluding live draftOnlyMode and activation checkbox).
 */
export async function authorizeAutomaticPublication(
  args: PublishAuthorizationInput
): Promise<PublishAuthorizationResult> {
  const settings = args.settings ?? (await getSettings(args.db));
  const shadow = Boolean(args.shadowEvaluation);
  const article = await getArticle(args.db, args.articleId);

  const empty = (extra: string[]): PublishAuthorizationResult => ({
    ok: false,
    wouldPublish: false,
    articleReady: false,
    settingsReady: false,
    frequencyReady: false,
    promotionReady: false,
    articleReasons: extra,
    promotionReasons: [],
    frequencyReasons: [],
    livePublicationReasons: shadow
      ? ["SHADOW_AUTO never authorizes live Shopify publication."]
      : extra,
    reasons: extra
  });

  if (!article) {
    return empty([`Article ${args.articleId} not found.`]);
  }

  let brief = args.brief ?? null;
  if (!brief) {
    const briefId = Number((article.generationSettings as { briefId?: number } | null)?.briefId || 0);
    if (briefId) brief = await getBrief(args.db, briefId);
  }

  let evidence = args.evidence ?? null;
  if (!evidence) evidence = await getEvidenceReportForArticle(args.db, args.articleId);

  let interviewApproved = false;
  if (brief?.requiresInterview && brief.id) {
    const interview = await getInterviewForBrief(args.db, brief.id);
    interviewApproved = Boolean(interview?.completed);
  } else if (brief && !brief.requiresInterview) {
    interviewApproved = true;
  }

  const articleEval = evaluateArticlePublishReadiness({
    article,
    brief,
    evidence,
    interviewApproved
  });

  const promotionEval = evaluatePromotionReadiness(settings);
  const shadowSettingsEval = evaluateShadowSettingsReadiness(settings);
  const liveSettingsEval = evaluateSettingsPublishReadiness(settings);

  let frequencyReady = args.frequencyOk ?? false;
  const frequencyReasons: string[] = [];
  if (args.frequencyOk === undefined) {
    const freq = await canPublishUnderFrequencyLimits(args.db, settings);
    frequencyReady = freq.ok;
    if (!freq.ok) frequencyReasons.push(freq.reason || "Frequency limits block publication.");
  } else if (!args.frequencyOk) {
    frequencyReasons.push(args.frequencyReason || "Frequency limits block publication.");
  }

  const articleReady = articleEval.ready;
  const promotionReady = promotionEval.ready;
  const settingsReady = shadow ? shadowSettingsEval.ready : liveSettingsEval.ready;

  const livePublicationReasons: string[] = [];
  if (shadow) {
    livePublicationReasons.push("SHADOW_AUTO never authorizes live Shopify publication (ok=false).");
    if (settings.draftOnlyMode) {
      livePublicationReasons.push("Live draftOnlyMode=true (expected in SHADOW_AUTO; ignored for wouldPublish simulation).");
    }
    if (settings.rolloutMode === "shadow_auto") {
      livePublicationReasons.push("Live rolloutMode=shadow_auto (simulated as AUTO_PUBLISH for wouldPublish).");
    }
    if (!settings.promotionProgress.autoPublishExplicitlyActivated) {
      livePublicationReasons.push("Explicit AUTO_PUBLISH activation checkbox not set (excluded from shadow wouldPublish simulation).");
    }
  } else {
    livePublicationReasons.push(...liveSettingsEval.reasons);
    if (settings.rolloutMode !== "auto_publish") {
      // already included in liveSettingsEval
    }
  }

  const wouldPublish = articleReady && settingsReady && frequencyReady && promotionReady;
  // Live publish requires full live settings (including draftOnly=false, activation, mode).
  const ok = !shadow && wouldPublish && liveSettingsEval.ready && settings.rolloutMode === "auto_publish";

  const reasons = [
    ...articleEval.reasons,
    ...(shadow ? shadowSettingsEval.reasons : liveSettingsEval.reasons.filter(r =>
      // avoid duplicating promotion lines already listed
      !promotionEval.reasons.includes(r)
    )),
    ...(!shadow ? [] : []),
    ...(!promotionReady ? promotionEval.reasons : []),
    ...frequencyReasons,
    ...(shadow ? livePublicationReasons : []),
    ...(!shadow && !ok && liveSettingsEval.reasons.length === 0 && !wouldPublish ? ["Automatic publication blocked."] : [])
  ];

  // Deduplicate while preserving order
  const unique = [...new Set(reasons)];
  if (unique.length === 0) {
    unique.push(shadow
      ? "Shadow simulation: all AUTO_PUBLISH requirements passed (live publish still blocked)."
      : "All automatic publication safety checks passed.");
  }

  return {
    ok,
    wouldPublish,
    articleReady,
    settingsReady,
    frequencyReady,
    promotionReady,
    articleReasons: articleEval.reasons,
    promotionReasons: promotionEval.reasons,
    frequencyReasons,
    livePublicationReasons: shadow
      ? livePublicationReasons
      : (ok ? [] : liveSettingsEval.reasons),
    reasons: unique
  };
}
