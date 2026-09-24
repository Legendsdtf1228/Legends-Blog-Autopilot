export type RolloutMode = "paused" | "observe" | "draft_only" | "shadow_auto" | "auto_publish";

export interface FrequencyLimits {
  maxArticlesPerCycle: number;
  maxPublishedPerRolling7Days: number;
  minHoursBetweenPublishes: number;
}

export interface PromotionThresholds {
  minConsecutiveReviewedDrafts: number;
  minMerchantApprovalRate: number;
  minShadowAutoDays: number;
}

export interface KillSwitchState {
  paused: boolean;
  reason: string | null;
  recoveryStep: string | null;
  triggeredAt: string | null;
}

export const DEFAULT_FREQUENCY_LIMITS: FrequencyLimits = {
  maxArticlesPerCycle: 1,
  maxPublishedPerRolling7Days: 5,
  minHoursBetweenPublishes: 18
};

export const DEFAULT_PROMOTION_THRESHOLDS: PromotionThresholds = {
  minConsecutiveReviewedDrafts: 30,
  minMerchantApprovalRate: 0.9,
  minShadowAutoDays: 14
};

export function canRunResearch(mode: RolloutMode): boolean {
  return mode !== "paused";
}

export function canGenerateArticles(mode: RolloutMode): boolean {
  return mode === "draft_only" || mode === "shadow_auto" || mode === "auto_publish";
}

export function canAutoPublish(mode: RolloutMode): boolean {
  return mode === "auto_publish";
}

export function recordsShadowDecision(mode: RolloutMode): boolean {
  return mode === "shadow_auto";
}

export function promotionAllowsAutoPublish(args: {
  consecutiveReviewedDrafts: number;
  merchantApprovalRate: number;
  shadowAutoDays: number;
  thresholds?: PromotionThresholds;
}): { ok: boolean; reasons: string[] } {
  const t = args.thresholds ?? DEFAULT_PROMOTION_THRESHOLDS;
  const reasons: string[] = [];
  if (args.consecutiveReviewedDrafts < t.minConsecutiveReviewedDrafts) {
    reasons.push(`Need ${t.minConsecutiveReviewedDrafts} consecutive reviewed drafts (have ${args.consecutiveReviewedDrafts}).`);
  }
  if (args.merchantApprovalRate < t.minMerchantApprovalRate) {
    reasons.push(`Need ${Math.round(t.minMerchantApprovalRate * 100)}% merchant approval rate (have ${Math.round(args.merchantApprovalRate * 100)}%).`);
  }
  if (args.shadowAutoDays < t.minShadowAutoDays) {
    reasons.push(`Need ${t.minShadowAutoDays} days of SHADOW_AUTO (have ${args.shadowAutoDays}).`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function killSwitchFromCondition(kind: string): KillSwitchState {
  const map: Record<string, { reason: string; recovery: string }> = {
    duplicate_shopify_create: {
      reason: "Duplicate Shopify article creation detected.",
      recovery: "Inspect Shopify blog posts and local article links, then clear the kill switch after confirming no duplicates."
    },
    incomplete_inventory: {
      reason: "Content inventory sync was incomplete.",
      recovery: "Restore full local/Shopify inventory access, then clear the kill switch."
    },
    malformed_provider_data: {
      reason: "A research provider returned malformed data.",
      recovery: "Disable the bad provider or fix credentials, then clear the kill switch."
    },
    fact_source_failure: {
      reason: "Required fact sources failed.",
      recovery: "Restore Shopify/product fact access and approved business facts, then clear the kill switch."
    },
    link_validation_failures: {
      reason: "Internal link validation failed repeatedly.",
      recovery: "Fix broken storefront URLs, then clear the kill switch."
    },
    quality_gate_parse_failure: {
      reason: "Quality-gate parsing failed.",
      recovery: "Inspect the latest cycle evidence report, fix the generator output contract, then clear the kill switch."
    },
    ambiguous_shopify_persistence: {
      reason: "Shopify article persistence was ambiguous.",
      recovery: "Use Link existing Shopify article recovery, confirm IDs, then clear the kill switch."
    },
    frequency_limit: {
      reason: "Daily or weekly publishing limits were exceeded.",
      recovery: "Wait for the rolling window to free capacity or adjust limits intentionally, then clear the kill switch."
    },
    consecutive_failures: {
      reason: "Consecutive article failures exceeded the configured threshold.",
      recovery: "Review failed jobs/articles, fix root cause, then clear the kill switch."
    }
  };
  const entry = map[kind] || {
    reason: `Autopilot paused: ${kind}`,
    recovery: "Inspect diagnostics and clear the kill switch after remediation."
  };
  return {
    paused: true,
    reason: entry.reason,
    recoveryStep: entry.recovery,
    triggeredAt: new Date().toISOString()
  };
}
