/**
 * Quarantine known failed rollout drafts / opportunities so they never count
 * toward promotion and cannot be reserved or generated.
 */
import type { Db } from "../db.js";
import { recordAudit, updateArticle } from "../db.js";
import {
  isQuarantinedArticle,
  QUARANTINED_ARTICLE_TITLES,
  QUARANTINED_PRIMARY_KEYWORDS
} from "./semanticIntent.js";
import type { TopicDecision } from "./types.js";

export interface RolloutEligibilityInput {
  title: string;
  primaryKeyword?: string;
  decision?: TopicDecision | string | null;
  status?: string | null;
  countsTowardRolloutFlag?: boolean | null;
  quarantined?: boolean;
  evidencePresent?: boolean;
  qualityGatesPassed?: boolean;
  merchantApproved?: boolean;
}

export function countsTowardRolloutDraft(args: {
  title: string;
  primaryKeyword?: string;
  decision?: TopicDecision | string | null;
  status?: string | null;
  countsTowardRolloutFlag?: boolean | null;
}): boolean {
  return isEligibleForRolloutProgress({
    ...args,
    evidencePresent: true,
    qualityGatesPassed: true,
    merchantApproved: true
  }).ok;
}

/** Authoritative eligibility for advancing consecutiveReviewedDrafts. */
export function isEligibleForRolloutProgress(args: RolloutEligibilityInput): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (args.decision === "REJECTED") reasons.push("decision is REJECTED");
  if (args.status === "archived" || args.status === "failed" || args.status === "rejected") {
    reasons.push(`status is ${args.status}`);
  }
  if (args.countsTowardRolloutFlag === false) reasons.push("countsTowardRollout is false");
  if (args.quarantined || isQuarantinedArticle(args.title, args.primaryKeyword)) {
    reasons.push("article is quarantined");
  }
  if (args.evidencePresent === false) reasons.push("required evidence is missing");
  if (args.qualityGatesPassed === false) reasons.push("quality/editorial gates did not pass");
  if (args.merchantApproved === false) reasons.push("merchant review did not approve it");
  return { ok: reasons.length === 0, reasons };
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

function opportunityMatchesQuarantine(payload: {
  proposedTitle?: string;
  cluster?: { primaryKeyword?: string };
}): boolean {
  const title = payload.proposedTitle || "";
  const keyword = payload.cluster?.primaryKeyword || "";
  return isQuarantinedArticle(title, keyword);
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

/**
 * Mark stored opportunities with quarantined title/keyword as REJECTED,
 * clear reservations, and audit the reason so they cannot be reserved/generated.
 */
export async function quarantineFailedRolloutOpportunities(db: Db): Promise<Array<{ id: string; title: string }>> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    payload: {
      proposedTitle?: string;
      cluster?: { primaryKeyword?: string };
      decision?: string;
      decisionReasons?: string[];
    };
  }>(
    `SELECT id, status, payload FROM research_opportunities
     WHERE status IN ('suggested','reserved','approved')`
  );

  const rejected: Array<{ id: string; title: string }> = [];
  for (const row of rows) {
    if (!opportunityMatchesQuarantine(row.payload)) continue;
    const title = row.payload.proposedTitle || row.payload.cluster?.primaryKeyword || row.id;
    const nextPayload = {
      ...row.payload,
      decision: "REJECTED" as const,
      decisionReasons: [
        ...(row.payload.decisionReasons || []),
        "Quarantined incoherent topic — cannot reserve or generate."
      ],
      status: "rejected" as const,
      failedGates: ["quarantined_article", "incoherent_search_intent"]
    };
    await db.query(
      `UPDATE research_opportunities
       SET status='rejected',
           payload=$2::jsonb,
           reserved_by=NULL,
           reserved_until=NULL,
           updated_at=now()
       WHERE id=$1`,
      [row.id, JSON.stringify(nextPayload)]
    );
    await recordAudit(db, {
      actor: "system",
      action: "opportunity_quarantined_rejected",
      detail: {
        opportunityId: row.id,
        previousStatus: row.status,
        title,
        keyword: row.payload.cluster?.primaryKeyword,
        reason: "Quarantined title/keyword cannot be reserved or generated."
      }
    });
    rejected.push({ id: row.id, title });
  }
  return rejected;
}

/** True when an opportunity payload must not be reserved or generated. */
export function isQuarantinedOpportunity(payload: {
  proposedTitle?: string;
  cluster?: { primaryKeyword?: string };
  decision?: string;
  status?: string;
}): boolean {
  if (payload.decision === "REJECTED" || payload.status === "rejected") return true;
  return opportunityMatchesQuarantine(payload);
}
