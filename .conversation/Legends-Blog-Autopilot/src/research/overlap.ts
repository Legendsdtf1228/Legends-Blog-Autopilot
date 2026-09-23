import { jaccard } from "./cluster.js";
import type { InventorySource, KeywordCluster, OverlapMatch } from "./types.js";

export interface ExistingArticleRef {
  id: number | null;
  title: string;
  handle: string;
  status: string;
  primaryKeyword?: string;
  topicFingerprint?: string;
  excerpt?: string;
  source?: InventorySource;
  shopifyArticleId?: string | null;
  url?: string | null;
}

export function overlapScore(cluster: KeywordCluster, existing: ExistingArticleRef): OverlapMatch {
  const parts = [
    jaccard(cluster.primaryKeyword, existing.primaryKeyword || existing.title),
    jaccard(cluster.primaryKeyword, existing.topicFingerprint || ""),
    jaccard(cluster.primaryKeyword, existing.title),
    jaccard(`${cluster.primaryKeyword} ${cluster.secondaryKeywords.join(" ")}`, `${existing.title} ${existing.excerpt || ""}`)
  ];
  const score = Math.max(...parts, 0);
  return {
    articleId: existing.id,
    title: existing.title,
    handle: existing.handle,
    status: existing.status,
    score: Number(score.toFixed(4)),
    reason: score >= 0.72
      ? "Substantially same keyword/intent as existing content"
      : score >= 0.45
        ? "Related topic; verify distinct question"
        : "Low overlap",
    source: existing.source,
    shopifyArticleId: existing.shopifyArticleId ?? null,
    url: existing.url ?? null
  };
}

export function findClosestOverlap(
  cluster: KeywordCluster,
  existing: ExistingArticleRef[]
): OverlapMatch | null {
  if (!existing.length) return null;
  let best: OverlapMatch | null = null;
  for (const article of existing) {
    const match = overlapScore(cluster, article);
    if (!best || match.score > best.score) best = match;
  }
  return best;
}

export function isRejectedByOverlap(match: OverlapMatch | null, threshold: number): boolean {
  return Boolean(match && match.score >= threshold);
}
