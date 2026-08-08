/**
 * Rollout eligibility + rejection of unsupported opportunities.
 * Feature-based — no exact-title production quarantines.
 */
import type { Db } from "../db.js";
import { recordAudit, updateArticle } from "../db.js";
import { evaluatePreGeneration } from "./editorialControls.js";
import { isIncoherentSearchIntent, isQuarantinedArticle } from "./semanticIntent.js";
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
  contentPromiseFulfilled?: boolean;
  requiredMerchantCorrection?: boolean;
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
    merchantApproved: true,
    contentPromiseFulfilled: true,
    requiredMerchantCorrection: false
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
    reasons.push("article framing fails content-promise / coherence gates");
  }
  if (args.evidencePresent === false) reasons.push("required evidence is missing");
  if (args.qualityGatesPassed === false) reasons.push("quality/editorial gates did not pass");
  if (args.merchantApproved === false) reasons.push("merchant review did not approve it");
  if (args.contentPromiseFulfilled === false) reasons.push("content promise was not fulfilled");
  if (args.requiredMerchantCorrection === true) {
    reasons.push("required article-specific merchant correction");
  }
  return { ok: reasons.length === 0, reasons };
}

export function quarantineRejectionMessage(title: string, primaryKeyword?: string): string {
  return [
    "REJECTED: Article failed generalized editorial quality standards.",
    `Title: ${title}`,
    primaryKeyword ? `Keyword: ${primaryKeyword}` : null,
    "Excluded from the 30-draft rollout requirement."
  ]
    .filter(Boolean)
    .join(" ");
}

function opportunityFailsFeatureGates(payload: {
  proposedTitle?: string;
  cluster?: { primaryKeyword?: string; format?: string; intent?: string; pillar?: string };
  decision?: string;
  readerQuestion?: string;
  proposedOutline?: string[];
}): boolean {
  const title = payload.proposedTitle || "";
  const keyword = payload.cluster?.primaryKeyword || "";
  if (!keyword && !title) return false;
  if (payload.decision === "REJECTED") return true;
  if (isIncoherentSearchIntent(keyword)) return true;
  if (isQuarantinedArticle(title, keyword)) return true;
  // Hard-reject only incoherent content-promise framing at reserve time.
  // Missing evidence / depth gaps are handled by editorial decisions
  // (NEEDS_MERCHANT_INPUT / DRAFT_ONLY), not by blocking reservation.
  const evaled = evaluatePreGeneration({
    primaryKeyword: keyword || title,
    proposedTitle: title || keyword,
    readerQuestion: payload.readerQuestion,
    outline: payload.proposedOutline,
    format: payload.cluster?.format,
    intent: payload.cluster?.intent,
    pillar: payload.cluster?.pillar,
    disableAutoRefine: true
  });
  if (evaled.decision !== "REJECTED") return false;
  return evaled.reasons.some(r =>
    /incoherent|does not represent a specific real-world search question|story keyword framed|Audience\/purpose drift/i.test(r)
  );
}

/** Archive articles already marked REJECTED / incoherent so they cannot inflate rollout. */
export async function quarantineFailedRolloutArticles(db: Db): Promise<Array<{ id: number; title: string }>> {
  const { rows } = await db.query<{
    id: string;
    title: string;
    primary_keyword: string;
    status: string;
    generation_settings: Record<string, unknown> | null;
  }>(
    `SELECT id, title, primary_keyword, status, generation_settings FROM articles
     WHERE status NOT IN ('archived')
       AND (
         COALESCE(generation_settings->>'decision','') = 'REJECTED'
         OR COALESCE(generation_settings->>'quarantined','') = 'true'
         OR COALESCE(generation_settings->>'countsTowardRollout','') = 'false'
       )`
  );

  const quarantined: Array<{ id: number; title: string }> = [];
  for (const row of rows) {
    // Also catch feature-failed drafts that slipped through with draft status
    if (
      row.generation_settings?.decision !== "REJECTED" &&
      !isQuarantinedArticle(row.title, row.primary_keyword)
    ) {
      continue;
    }
    const id = Number(row.id);
    await updateArticle(db, id, {
      status: "archived",
      generationError: quarantineRejectionMessage(row.title, row.primary_keyword),
      lastError: "REJECTED — excluded from rollout drafts",
      generationSettings: {
        ...(row.generation_settings || {}),
        decision: "REJECTED",
        countsTowardRollout: false,
        quarantined: true
      }
    });
    quarantined.push({ id, title: row.title });
  }

  // Feature-scan recent drafts for incoherent framing (no exact-title list)
  const { rows: drafts } = await db.query<{
    id: string;
    title: string;
    primary_keyword: string;
    generation_settings: Record<string, unknown> | null;
  }>(
    `SELECT id, title, primary_keyword, generation_settings FROM articles
     WHERE status IN ('draft','ready','generating')
     ORDER BY updated_at DESC LIMIT 100`
  );
  for (const row of drafts) {
    if (!isQuarantinedArticle(row.title, row.primary_keyword)) continue;
    if (quarantined.some(q => q.id === Number(row.id))) continue;
    const id = Number(row.id);
    await updateArticle(db, id, {
      status: "archived",
      generationError: quarantineRejectionMessage(row.title, row.primary_keyword),
      lastError: "REJECTED — incoherent content promise",
      generationSettings: {
        ...(row.generation_settings || {}),
        decision: "REJECTED",
        countsTowardRollout: false,
        quarantined: true
      }
    });
    quarantined.push({ id, title: row.title });
  }

  return quarantined;
}

/** Reject stored opportunities that fail feature-based content-promise gates. */
export async function quarantineFailedRolloutOpportunities(db: Db): Promise<Array<{ id: string; title: string }>> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    payload: {
      proposedTitle?: string;
      cluster?: { primaryKeyword?: string; format?: string; intent?: string; pillar?: string };
      decision?: string;
      decisionReasons?: string[];
      readerQuestion?: string;
      proposedOutline?: string[];
    };
  }>(
    `SELECT id, status, payload FROM research_opportunities
     WHERE status IN ('suggested','reserved','approved')`
  );

  const rejected: Array<{ id: string; title: string }> = [];
  for (const row of rows) {
    if (!opportunityFailsFeatureGates(row.payload)) continue;
    const title = row.payload.proposedTitle || row.payload.cluster?.primaryKeyword || row.id;
    const nextPayload = {
      ...row.payload,
      decision: "REJECTED" as const,
      decisionReasons: [
        ...(row.payload.decisionReasons || []),
        "Failed generalized content-promise / evidence / depth gates — cannot reserve or generate."
      ],
      status: "rejected" as const,
      failedGates: ["content_promise", "evidence_budget", "depth"]
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
      action: "opportunity_rejected_feature_gates",
      detail: {
        opportunityId: row.id,
        previousStatus: row.status,
        title,
        keyword: row.payload.cluster?.primaryKeyword,
        reason: "Feature-based editorial gates rejected this opportunity."
      }
    });
    rejected.push({ id: row.id, title });
  }
  return rejected;
}

export function isQuarantinedOpportunity(payload: {
  proposedTitle?: string;
  cluster?: { primaryKeyword?: string; format?: string; intent?: string; pillar?: string };
  decision?: string;
  status?: string;
  readerQuestion?: string;
  proposedOutline?: string[];
}): boolean {
  if (payload.decision === "REJECTED" || payload.status === "rejected") return true;
  return opportunityFailsFeatureGates(payload);
}
