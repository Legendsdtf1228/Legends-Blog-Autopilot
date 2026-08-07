/**
 * Quarantine known failed rollout drafts so they never count toward promotion.
 */
import type { Db } from "../db.js";
import { updateArticle } from "../db.js";
import {
  isQuarantinedArticle,
  QUARANTINED_ARTICLE_TITLES,
  QUARANTINED_PRIMARY_KEYWORDS
} from "./semanticIntent.js";
import type { TopicDecision } from "./types.js";

export function countsTowardRolloutDraft(args: {
  title: string;
  primaryKeyword?: string;
  decision?: TopicDecision | string | null;
  status?: string | null;
  countsTowardRolloutFlag?: boolean | null;
}): boolean {
  if (args.countsTowardRolloutFlag === false) return false;
  if (args.decision === "REJECTED") return false;
  if (args.status === "archived" || args.status === "failed" || args.status === "rejected") return false;
  if (isQuarantinedArticle(args.title, args.primaryKeyword)) return false;
  return true;
}

export function quarantineRejectionMessage(title: string, primaryKeyword?: string): string {
  return [
    "REJECTED: Article failed semantic-intent / editorial quality standards.",
    `Title: ${title}`,
    primaryKeyword ? `Keyword: ${primaryKeyword}` : null,
    "Excluded from the 30-draft rollout requirement."
  ]
    .filter(Boolean)
    .join(" ");
}

/** Mark matching local articles archived + REJECTED so they cannot inflate promotion progress. */
export async function quarantineFailedRolloutArticles(db: Db): Promise<Array<{ id: number; title: string }>> {
  const { rows } = await db.query<{ id: string; title: string; primary_keyword: string; status: string }>(
    `SELECT id, title, primary_keyword, status FROM articles
     WHERE status NOT IN ('archived')
       AND (
         lower(title) = ANY($1::text[])
         OR lower(primary_keyword) = ANY($2::text[])
       )`,
    [
      QUARANTINED_ARTICLE_TITLES.map(t => t.toLowerCase()),
      QUARANTINED_PRIMARY_KEYWORDS.map(k => k.toLowerCase())
    ]
  );

  const quarantined: Array<{ id: number; title: string }> = [];
  for (const row of rows) {
    const id = Number(row.id);
    await updateArticle(db, id, {
      status: "archived",
      generationError: quarantineRejectionMessage(row.title, row.primary_keyword),
      lastError: "REJECTED — excluded from rollout drafts",
      generationSettings: {
        decision: "REJECTED",
        countsTowardRollout: false,
        quarantined: true,
        rejectionReasons: [
          "Incoherent search intent",
          "Audience/purpose drift",
          "Template substitution",
          "Weak internal product links",
          "Technical accuracy (UV DTF)",
          "Insufficient unique insight"
        ]
      }
    });
    quarantined.push({ id, title: row.title });
  }
  return quarantined;
}
