import type { ArticleFormatId, AudienceId, ContentPillarId, PillarBalance } from "./types.js";
import { CONTENT_PILLARS, DEFAULT_PILLAR_BALANCE } from "./pillars.js";

export interface UsageRecord {
  pillar: ContentPillarId;
  subcategory: string;
  audience: AudienceId;
  format: ArticleFormatId;
  usedAt: string;
}

export function pillarUsageShare(usage: UsageRecord[]): Record<ContentPillarId, number> {
  const counts = Object.fromEntries(CONTENT_PILLARS.map(p => [p.id, 0])) as Record<ContentPillarId, number>;
  for (const u of usage) counts[u.pillar] = (counts[u.pillar] || 0) + 1;
  const total = Math.max(usage.length, 1);
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v / total])) as Record<ContentPillarId, number>;
}

/** Prefer underused pillars relative to configured balance. Higher = more needed. */
export function pillarRotationBonus(
  pillar: ContentPillarId,
  usage: UsageRecord[],
  balance: PillarBalance = DEFAULT_PILLAR_BALANCE
): number {
  const share = pillarUsageShare(usage);
  const target = balance[pillar] ?? 0.1;
  const actual = share[pillar] ?? 0;
  const deficit = target - actual;
  return Math.max(0, Math.min(1, 0.5 + deficit));
}

export function recentlyUsed(
  usage: UsageRecord[],
  key: "pillar" | "audience" | "format" | "subcategory",
  value: string,
  withinLast = 3
): boolean {
  return usage.slice(0, withinLast).some(u => String(u[key]) === value);
}

export function pickRotatedAudience(
  candidates: AudienceId[],
  usage: UsageRecord[]
): AudienceId {
  for (const c of candidates) {
    if (!recentlyUsed(usage, "audience", c, 2)) return c;
  }
  return candidates[0]!;
}

export function pickRotatedFormat(
  candidates: ArticleFormatId[],
  usage: UsageRecord[]
): ArticleFormatId {
  for (const c of candidates) {
    if (!recentlyUsed(usage, "format", c, 2)) return c;
  }
  return candidates[0]!;
}

export function avoidRepeatedDtfBias(
  pillar: ContentPillarId,
  usage: UsageRecord[]
): number {
  const recentDtf = usage.slice(0, 5).filter(u => u.pillar === "dtf_education").length;
  if (pillar === "dtf_education" && recentDtf >= 3) return -0.25;
  if (pillar !== "dtf_education" && recentDtf >= 3) return 0.15;
  return 0;
}
