import type { Db } from "../db.js";
import { isQuarantinedOpportunity } from "./quarantine.js";
import type {
  ArticleBrief,
  EvidenceReport,
  MerchantInterview,
  ResearchCycleResult,
  ResearchOpportunity,
  ResearchSignal
} from "./types.js";
import type { UsageRecord } from "./rotation.js";

export interface SavedResearchCycle {
  id: number;
  collectedAt: string;
  missingProviders: ResearchCycleResult["missingProviders"];
  signalCount: number;
}

export async function saveResearchCycle(
  db: Db,
  result: ResearchCycleResult
): Promise<SavedResearchCycle> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO research_cycles(collected_at, missing_providers, signal_count)
       VALUES ($1::timestamptz, $2::jsonb, $3) RETURNING id`,
      [result.collectedAt, JSON.stringify(result.missingProviders), result.signals.length]
    );
    const cycleId = Number(rows[0]!.id);

    for (const signal of result.signals) {
      await client.query(
        `INSERT INTO research_signals(cycle_id, provider, collected_at, keyword, payload)
         VALUES ($1,$2,$3::timestamptz,$4,$5::jsonb)`,
        [cycleId, signal.provider, signal.collectedAt, signal.keyword, JSON.stringify(signal)]
      );
    }

    for (const opportunity of result.opportunities) {
      await client.query(
        `INSERT INTO research_opportunities(id, cycle_id, payload, status, reserved_by, reserved_until, updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6::timestamptz,now())
         ON CONFLICT (id) DO UPDATE SET
           cycle_id=EXCLUDED.cycle_id,
           payload=EXCLUDED.payload,
           status=CASE
             WHEN research_opportunities.status IN ('reserved','approved','used') THEN research_opportunities.status
             ELSE EXCLUDED.status
           END,
           updated_at=now()`,
        [
          opportunity.id,
          cycleId,
          JSON.stringify(opportunity),
          opportunity.status,
          opportunity.reservedBy ?? null,
          opportunity.reservedUntil ?? null
        ]
      );
    }

    await client.query("COMMIT");
    return {
      id: cycleId,
      collectedAt: result.collectedAt,
      missingProviders: result.missingProviders,
      signalCount: result.signals.length
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listOpportunities(db: Db, limit = 40): Promise<ResearchOpportunity[]> {
  const { rows } = await db.query<{ payload: ResearchOpportunity; status: string; reserved_by: string | null; reserved_until: string | null }>(
    `SELECT payload, status, reserved_by, reserved_until
     FROM research_opportunities
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    ...r.payload,
    status: r.status as ResearchOpportunity["status"],
    reservedBy: r.reserved_by,
    reservedUntil: r.reserved_until
  }));
}

export async function getOpportunity(db: Db, id: string): Promise<ResearchOpportunity | null> {
  const { rows } = await db.query<{ payload: ResearchOpportunity; status: string; reserved_by: string | null; reserved_until: string | null }>(
    `SELECT payload, status, reserved_by, reserved_until FROM research_opportunities WHERE id=$1`,
    [id]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0].payload,
    status: rows[0].status as ResearchOpportunity["status"],
    reservedBy: rows[0].reserved_by,
    reservedUntil: rows[0].reserved_until
  };
}

/** Atomically reserve an opportunity so two workers cannot claim the same one. */
export async function reserveOpportunity(
  db: Db,
  opportunityId: string,
  workerId: string,
  ttlSeconds = 900
): Promise<ResearchOpportunity | null> {
  const existing = await getOpportunity(db, opportunityId);
  if (!existing) return null;
  if (
    existing.status === "rejected" ||
    existing.decision === "REJECTED" ||
    isQuarantinedOpportunity(existing)
  ) {
    return null;
  }

  const { rows } = await db.query<{ payload: ResearchOpportunity; status: string; reserved_by: string | null; reserved_until: string | null }>(
    `UPDATE research_opportunities
     SET status='reserved',
         reserved_by=$2,
         reserved_until=now() + ($3 || ' seconds')::interval,
         updated_at=now()
     WHERE id=$1
       AND status NOT IN ('rejected','used','approved')
       AND (
         status='suggested'
         OR (status='reserved' AND (reserved_until IS NULL OR reserved_until < now()))
         OR (status='reserved' AND reserved_by=$2)
       )
       AND COALESCE(payload->>'decision','') <> 'REJECTED'
     RETURNING payload, status, reserved_by, reserved_until`,
    [opportunityId, workerId, String(ttlSeconds)]
  );
  if (!rows[0]) return null;
  if (isQuarantinedOpportunity(rows[0].payload)) {
    await markOpportunityStatus(db, opportunityId, "rejected");
    return null;
  }
  return {
    ...rows[0].payload,
    status: "reserved",
    reservedBy: rows[0].reserved_by,
    reservedUntil: rows[0].reserved_until
  };
}

export async function releaseOpportunity(db: Db, opportunityId: string, workerId: string): Promise<void> {
  await db.query(
    `UPDATE research_opportunities
     SET status='suggested', reserved_by=NULL, reserved_until=NULL, updated_at=now()
     WHERE id=$1 AND reserved_by=$2 AND status='reserved'`,
    [opportunityId, workerId]
  );
}

export async function markOpportunityStatus(
  db: Db,
  opportunityId: string,
  status: ResearchOpportunity["status"]
): Promise<void> {
  await db.query(
    `UPDATE research_opportunities SET status=$2, updated_at=now() WHERE id=$1`,
    [opportunityId, status]
  );
}

export async function saveBrief(db: Db, brief: ArticleBrief): Promise<ArticleBrief> {
  const { rows } = await db.query<{ id: string; created_at: string; updated_at: string }>(
    `INSERT INTO article_briefs(opportunity_id, payload, status)
     VALUES ($1,$2::jsonb,$3)
     RETURNING id, created_at, updated_at`,
    [brief.opportunityId, JSON.stringify(brief), brief.status]
  );
  return {
    ...brief,
    id: Number(rows[0]!.id),
    createdAt: rows[0]!.created_at,
    updatedAt: rows[0]!.updated_at
  };
}

export async function getBrief(db: Db, id: number): Promise<ArticleBrief | null> {
  const { rows } = await db.query<{ id: string; payload: ArticleBrief; status: string; article_id: string | null; created_at: string; updated_at: string }>(
    `SELECT id, payload, status, article_id, created_at, updated_at FROM article_briefs WHERE id=$1`,
    [id]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0].payload,
    id: Number(rows[0].id),
    status: rows[0].status as ArticleBrief["status"],
    createdAt: rows[0].created_at,
    updatedAt: rows[0].updated_at
  };
}

export async function updateBrief(db: Db, id: number, brief: ArticleBrief): Promise<ArticleBrief> {
  const { rows } = await db.query<{ id: string; created_at: string; updated_at: string }>(
    `UPDATE article_briefs
     SET payload=$2::jsonb, status=$3, updated_at=now()
     WHERE id=$1
     RETURNING id, created_at, updated_at`,
    [id, JSON.stringify({ ...brief, id }), brief.status]
  );
  return {
    ...brief,
    id: Number(rows[0]!.id),
    createdAt: rows[0]!.created_at,
    updatedAt: rows[0]!.updated_at
  };
}

export async function attachBriefArticle(db: Db, briefId: number, articleId: number): Promise<void> {
  await db.query(
    `UPDATE article_briefs SET article_id=$2, status='generated', updated_at=now() WHERE id=$1`,
    [briefId, articleId]
  );
}

export async function saveInterview(db: Db, interview: MerchantInterview): Promise<MerchantInterview> {
  if (interview.id) {
    const { rows } = await db.query<{ id: string; updated_at: string }>(
      `UPDATE merchant_interviews
       SET payload=$2::jsonb, completed=$3, updated_at=now()
       WHERE id=$1 RETURNING id, updated_at`,
      [interview.id, JSON.stringify(interview), interview.completed]
    );
    return { ...interview, id: Number(rows[0]!.id), updatedAt: rows[0]!.updated_at };
  }
  const { rows } = await db.query<{ id: string; updated_at: string }>(
    `INSERT INTO merchant_interviews(brief_id, payload, completed)
     VALUES ($1,$2::jsonb,$3) RETURNING id, updated_at`,
    [interview.briefId, JSON.stringify(interview), interview.completed]
  );
  return { ...interview, id: Number(rows[0]!.id), updatedAt: rows[0]!.updated_at };
}

export async function getInterviewForBrief(db: Db, briefId: number): Promise<MerchantInterview | null> {
  const { rows } = await db.query<{ id: string; payload: MerchantInterview; completed: boolean; updated_at: string }>(
    `SELECT id, payload, completed, updated_at FROM merchant_interviews WHERE brief_id=$1 ORDER BY id DESC LIMIT 1`,
    [briefId]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0].payload,
    id: Number(rows[0].id),
    completed: rows[0].completed,
    updatedAt: rows[0].updated_at
  };
}

export async function recordPillarUsage(db: Db, usage: UsageRecord & { primaryKeyword?: string; articleId?: number | null }): Promise<void> {
  await db.query(
    `INSERT INTO pillar_usage(pillar, subcategory, audience, format, primary_keyword, article_id, used_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz)`,
    [
      usage.pillar,
      usage.subcategory,
      usage.audience,
      usage.format,
      usage.primaryKeyword ?? "",
      usage.articleId ?? null,
      usage.usedAt
    ]
  );
}

export async function listPillarUsage(db: Db, limit = 60): Promise<UsageRecord[]> {
  const { rows } = await db.query<{
    pillar: UsageRecord["pillar"];
    subcategory: string;
    audience: UsageRecord["audience"];
    format: UsageRecord["format"];
    used_at: string;
  }>(
    `SELECT pillar, subcategory, audience, format, used_at
     FROM pillar_usage
     ORDER BY used_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    pillar: r.pillar,
    subcategory: r.subcategory,
    audience: r.audience,
    format: r.format,
    usedAt: r.used_at
  }));
}

export async function saveEvidenceReport(
  db: Db,
  articleId: number,
  briefId: number | null,
  report: EvidenceReport
): Promise<void> {
  await db.query(
    `INSERT INTO evidence_reports(article_id, brief_id, payload)
     VALUES ($1,$2,$3::jsonb)`,
    [articleId, briefId, JSON.stringify(report)]
  );
}

export async function getEvidenceReportForArticle(db: Db, articleId: number): Promise<EvidenceReport | null> {
  const { rows } = await db.query<{ payload: EvidenceReport }>(
    `SELECT payload FROM evidence_reports WHERE article_id=$1 ORDER BY id DESC LIMIT 1`,
    [articleId]
  );
  return rows[0]?.payload ?? null;
}

export async function latestCycleMeta(db: Db): Promise<SavedResearchCycle | null> {
  const { rows } = await db.query<{
    id: string;
    collected_at: string;
    missing_providers: ResearchCycleResult["missingProviders"];
    signal_count: number;
  }>(
    `SELECT id, collected_at, missing_providers, signal_count
     FROM research_cycles ORDER BY id DESC LIMIT 1`
  );
  if (!rows[0]) return null;
  return {
    id: Number(rows[0].id),
    collectedAt: rows[0].collected_at,
    missingProviders: rows[0].missing_providers,
    signalCount: rows[0].signal_count
  };
}

export type { ResearchSignal };
