import pg from "pg";
import { createHash } from "node:crypto";
import type { OwnerConsoleRecord } from "@workspace/db";

const { Pool } = pg;
type Row = Record<string, unknown>;
type OwnerKind = "pipeline" | "research" | "knowledge" | "question" | "calendar" | "activity";
type Queryable = Pick<pg.Pool, "query">;

let pool: pg.Pool | undefined;
const getPool = (): pg.Pool | undefined => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return undefined;
  pool ??= new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
    max: 5,
  });
  return pool;
};

const asObject = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : value == null ? fallback : String(value);
const strArray = (value: unknown): string[] => asArray(value).map((item) => text(item)).filter(Boolean);
const iso = (value: unknown): string => {
  if (!value) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
};
const record = (kind: OwnerKind, id: string, payload: Row, at?: unknown): OwnerConsoleRecord => {
  const date = at ? new Date(String(at)) : new Date();
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return {
    id,
    kind,
    payload,
    isDevelopmentFixture: false,
    createdAt: validDate,
    updatedAt: validDate,
  } as OwnerConsoleRecord;
};
const detailParts = (row: Row) => ({
  id: text(row.id),
  payload: asObject(row.payload),
  updatedAt: row.updated_at,
});

async function tableNames(db: Queryable): Promise<Set<string>> {
  const { rows } = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
  );
  return new Set(rows.map((row) => row.table_name));
}

function mapCluster(row: Row, budget: Row | undefined, task: Row | undefined): Row {
  const payload = asObject(row.payload);
  const budgetPayload = asObject(budget?.payload);
  const taskPayload = asObject(task?.payload);
  const readiness = asObject(budgetPayload.evidenceReadiness);
  const evidenceStatus = text(readiness.status, text(budget?.readiness_status, "unavailable"));
  const question = text(payload.canonicalQuestion, text(taskPayload.actualQuestion, text(row.canonical_question, "Reader question unavailable")));
  const audience = text(payload.canonicalAudience, text(taskPayload.audience, text(row.canonical_audience, "Unspecified audience")));
  const reasons = strArray(readiness.blockingReasons);
  return {
    id: text(row.id),
    status: text(row.status, "needs_review"),
    canonicalQuestion: question,
    audience,
    decision: evidenceStatus === "ready" ? "draft_only" : evidenceStatus === "needs_merchant_input" ? "awaiting_owner_input" : "hold_for_evidence",
    evidenceStatus,
    confidence: Number(taskPayload.confidenceScore ?? payload.mergeConfidence ?? row.merge_confidence ?? 0),
    lastEvaluated: iso(budget?.updated_at ?? row.updated_at),
    supportingEvidence: strArray(payload.supportingSourceEvidenceIds ?? row.supporting_evidence_ids),
    reviewReason: reasons.join("; ") || (row.requires_manual_review ? text(payload.similarityExplanation, "Cluster requires manual review.") : null),
    isDevelopmentFixture: false,
  };
}

function mapPipeline(args: {
  id: string;
  title: string;
  stage: string;
  category: string;
  audience: string;
  decision: string;
  evidenceStatus: string;
  nextAction: string;
  blockedReason?: string | null;
  scheduledDate?: string | null;
  readerQuestion: string;
  questionProvenance: string;
  situation: string;
  problem: string;
  desiredOutcome: string;
  constraints: string[];
  outline: string[];
  evidenceBudget: string;
  approvedFacts: string[];
  blockedClaims: string[];
  contradictions: string[];
  activity?: Row[];
}): Row {
  return {
    ...args,
    activity: args.activity ?? [],
    isDevelopmentFixture: false,
  };
}

async function listM5Records(db: Queryable, kind: OwnerKind): Promise<OwnerConsoleRecord[]> {
  const tables = await tableNames(db);
  const results: OwnerConsoleRecord[] = [];

  if (kind === "research" && tables.has("opportunity_clusters")) {
    const budgetJoin = tables.has("cluster_evidence_budgets")
      ? "LEFT JOIN cluster_evidence_budgets b ON b.cluster_id=c.id"
      : "";
    const taskJoin = tables.has("reader_tasks")
      ? "LEFT JOIN reader_tasks rt ON rt.id=c.canonical_reader_task_id"
      : "";
    const budgetPayload = tables.has("cluster_evidence_budgets") ? "b.payload" : "NULL::jsonb";
    const budgetUpdated = tables.has("cluster_evidence_budgets") ? "b.updated_at" : "NULL::timestamptz";
    const taskPayload = tables.has("reader_tasks") ? "rt.payload" : "NULL::jsonb";
    const { rows } = await db.query<Row>(
      `SELECT c.*, ${budgetPayload} AS budget_payload, ${budgetUpdated} AS budget_updated_at,
              ${taskPayload} AS task_payload
       FROM opportunity_clusters c
       ${budgetJoin}
       ${taskJoin}
       WHERE c.status IN ('active','needs_review') ORDER BY c.updated_at DESC`,
    );
    for (const row of rows) {
      results.push(record("research", text(row.id), mapCluster(row, {
        payload: row.budget_payload,
        updated_at: row.budget_updated_at,
      }, { payload: row.task_payload }), row.updated_at));
    }
    if (tables.has("opportunity_cluster_evidence") && tables.has("source_evidence")) {
      const { rows: evidenceRows } = await db.query<Row>(
        `SELECT oce.cluster_id, se.id, se.evidence_summary, se.approval_state,
                se.public_usage_allowed
         FROM opportunity_cluster_evidence oce
         JOIN source_evidence se ON se.id=oce.source_evidence_id
         ORDER BY oce.cluster_id, se.id`,
      );
      const evidenceByCluster = new Map<string, string[]>();
      for (const evidence of evidenceRows) {
        const clusterId = text(evidence.cluster_id);
        const status = evidence.approval_state === "APPROVED" && evidence.public_usage_allowed === true
          ? "approved for public use"
          : text(evidence.approval_state, "pending approval").toLowerCase();
        const summary = `${text(evidence.evidence_summary, text(evidence.id))} (${status})`;
        evidenceByCluster.set(clusterId, [...(evidenceByCluster.get(clusterId) ?? []), summary]);
      }
      for (const item of results) {
        if (item.kind !== "research") continue;
        const evidence = evidenceByCluster.get(item.id);
        if (evidence?.length) item.payload = { ...item.payload, supportingEvidence: evidence };
      }
    }
  }

  if (kind === "knowledge" && tables.has("knowledge_entries")) {
    const { rows } = await db.query<Row>(
      `SELECT payload, id, updated_at FROM knowledge_entries ORDER BY updated_at DESC`,
    );
    const claims = tables.has("knowledge_claims")
      ? (await db.query<Row>("SELECT cluster_id, payload FROM knowledge_claims")).rows
      : [];
    for (const row of rows) {
      const entry = asObject(row.payload);
      const scope = asObject(entry.scope);
      const id = text(entry.id, text(row.id));
      const supportedBy = claims.filter((claim) => {
        const claimPayload = asObject(claim.payload);
        return strArray(claimPayload.supportingKnowledgeIds).includes(id);
      });
      results.push(record("knowledge", id, {
        id,
        title: text(entry.exactApprovedFact, text(entry.normalizedClaim, "Knowledge entry")),
        category: text(entry.knowledgeClass, "Unclassified"),
        approvalState: text(entry.approvalState, "PENDING_APPROVAL").toLowerCase(),
        sourceType: text(entry.sourceType, "unknown"),
        scope: [
          text(scope.geographic),
          text(scope.processSurface),
          ...strArray(scope.audiences),
          ...strArray(scope.products),
          text(scope.applicableNotes),
        ].filter(Boolean).join("; ") || "unspecified",
        freshness: text(entry.approvalState) === "STALE" ? "stale" : entry.effectiveTo && new Date(String(entry.effectiveTo)) < new Date() ? "expired" : "current",
        publicUse: entry.publicUsageAllowed === true && entry.approvalState === "APPROVED" ? "allowed" : "blocked",
        revision: Number(text(entry.revisionId).match(/(\d+)$/)?.[1] ?? 1),
        supports: supportedBy.map((claim) => {
          const claimPayload = asObject(claim.payload);
          return `${text(claim.cluster_id)}: ${text(claimPayload.normalizedClaim, "claim support")}`;
        }),
        contradictions: strArray(entry.contradictions),
        isDevelopmentFixture: false,
      }, row.updated_at));
    }
  }

  if (kind === "question" && tables.has("merchant_interview_packets") && tables.has("merchant_interview_questions")) {
    const answersExist = tables.has("merchant_interview_answers");
    const answerJoin = answersExist
      ? "LEFT JOIN merchant_interview_answers a ON a.packet_id=p.id AND a.question_id=q.id"
      : "";
    const answerSelection = answersExist
      ? ", a.answer_text, a.approval_state AS answer_state"
      : ", NULL::text AS answer_text, NULL::text AS answer_state";
    const { rows } = await db.query<Row>(
      `SELECT p.id AS packet_id, p.payload AS packet_payload, p.completion_status,
              q.id AS question_id, q.prompt, q.payload AS question_payload
              ${answerSelection}
       FROM merchant_interview_packets p
       JOIN merchant_interview_questions q ON q.packet_id=p.id
       ${answerJoin}
       WHERE p.completion_status IN ('open','answered_pending_approval')
       ORDER BY p.updated_at DESC, q.created_at`,
    );
    for (const row of rows) {
      const q = asObject(row.question_payload);
      const packet = asObject(row.packet_payload);
      const requiredScope = text(q.requiredScope, "Confirm the applicable product, geography, and effective date.");
      const id = text(row.question_id);
      results.push(record("question", id, {
        id,
        packetId: text(row.packet_id),
        question: text(row.prompt, text(q.prompt, "Merchant interview question")),
        missing: "Owner-confirmed firsthand information and scope.",
        why: text(packet.reusableWhy, "Owner input is pending review and is not approved knowledge."),
        affects: strArray(packet.affectedClusterIds),
        scopeRequired: requiredScope,
        publicUse: "Blocked until the resulting knowledge is separately reviewed and approved.",
        status: row.answer_state === "PENDING_APPROVAL" || row.completion_status === "answered_pending_approval" ? "answer_pending_review" : "awaiting_answer",
        knowledgeClass: text(packet.knowledgeClass, text(row.knowledge_class, "general_authoritative_education")),
        isDevelopmentFixture: false,
      }, row.updated_at));
    }
  }

  if (kind === "pipeline") {
    const articles = tables.has("articles")
      ? (await db.query<Row>("SELECT * FROM articles ORDER BY updated_at DESC")).rows
      : [];
    const opportunities = tables.has("research_opportunities")
      ? (await db.query<Row>("SELECT id, payload, status, updated_at FROM research_opportunities ORDER BY updated_at DESC")).rows
      : [];
    const briefs = tables.has("article_briefs")
      ? (await db.query<Row>("SELECT id, opportunity_id, payload, status, article_id, created_at, updated_at FROM article_briefs ORDER BY updated_at DESC")).rows
      : [];
    const budgets = tables.has("cluster_evidence_budgets")
      ? (await db.query<Row>("SELECT cluster_id, payload FROM cluster_evidence_budgets")).rows
      : [];
    const clusters = tables.has("opportunity_clusters")
      ? (await db.query<Row>("SELECT id, payload, canonical_reader_task_id, canonical_question, canonical_audience, status, updated_at FROM opportunity_clusters WHERE status IN ('active','needs_review')")).rows
      : [];
    const opportunityMap = new Map(opportunities.map((item) => [text(item.id), asObject(item.payload)]));
    const articleMap = new Map(articles.map((item) => [text(item.id), item]));
    const briefIds = new Set<string>();

    const fromBrief = (briefRow: Row) => {
      const brief = asObject(briefRow.payload);
      const opportunity = opportunityMap.get(text(briefRow.opportunity_id)) ?? {};
      const article = articleMap.get(text(briefRow.article_id)) ?? {};
      const clusterId = text(brief.clusterId, text(opportunity.clusterId, text(asObject(opportunity.cluster).id)));
      const budget = budgets.find((item) => text(item.cluster_id) === clusterId);
      const budgetPayload = asObject(budget?.payload);
      const readiness = asObject(budgetPayload.evidenceReadiness);
      const evidenceStatus = text(readiness.status, "unavailable");
      const question = text(brief.readerQuestion, text(opportunity.readerQuestion, text(brief.proposedTitle, "Brief awaiting review")));
      const blockers = [...strArray(brief.failedGates), ...strArray(budgetPayload.prohibitedClaims)];
      const id = `m5-brief-${text(briefRow.id)}`;
      briefIds.add(text(briefRow.article_id));
      return mapPipeline({
        id,
        title: text(article.title, text(brief.proposedTitle, text(opportunity.proposedTitle, question))),
        stage: text(article.status, text(briefRow.status, "research_review")),
        category: text(brief.pillar, text(asObject(asObject(opportunity.cluster).pillar).id, "Uncategorized")),
        audience: text(brief.targetAudienceLabel, text(brief.audience, "Unspecified audience")),
        decision: text(brief.decision, evidenceStatus === "needs_merchant_input" ? "needs_owner_input" : "hold_for_evidence"),
        evidenceStatus,
        nextAction: blockers.length ? "Review evidence and resolve blocked claims" : "Review brief before any article work",
        blockedReason: blockers.join("; ") || null,
        scheduledDate: article.scheduled_for ? iso(article.scheduled_for) : null,
        readerQuestion: question,
        questionProvenance: text(brief.readerQuestionProvenance, "M5 article brief"),
        situation: text(asObject(brief.factSheet).businessFacts && strArray(asObject(brief.factSheet).businessFacts).join("; "), text(brief.targetAudienceLabel, "See brief context.")),
        problem: question,
        desiredOutcome: text(brief.conversionPath, "A scoped, evidence-backed draft for owner review."),
        constraints: [...strArray(brief.failedGates), ...strArray(brief.factSheet && asObject(brief.factSheet).reviewFlags), "Publishing and automatic approval are not available in the owner console."],
        outline: strArray(brief.proposedOutline),
        evidenceBudget: text(asObject(budgetPayload.evidenceReadiness).summary, "Evidence budget unavailable."),
        approvedFacts: strArray(budgetPayload.approvedFacts),
        blockedClaims: [...strArray(budgetPayload.unsupportedClaims), ...strArray(budgetPayload.prohibitedClaims)],
        contradictions: strArray(budgetPayload.conflictingClaims),
      });
    };
    for (const brief of briefs) results.push(record("pipeline", `m5-brief-${text(brief.id)}`, fromBrief(brief), brief.updated_at));

    const briefOpportunityIds = new Set(briefs.map((item) => text(item.opportunity_id)));
    for (const opportunityRow of opportunities) {
      if (briefOpportunityIds.has(text(opportunityRow.id))) continue;
      const opportunity = asObject(opportunityRow.payload);
      const id = `m5-opportunity-${text(opportunityRow.id)}`;
      const question = text(opportunity.readerQuestion, text(opportunity.proposedTitle, "Research opportunity"));
      const relatedCluster = clusters.find((cluster) => text(asObject(cluster.payload).researchOpportunityId) === text(opportunityRow.id));
      const budget = budgets.find((item) => text(item.cluster_id) === text(asObject(relatedCluster?.payload).id));
      const budgetPayload = asObject(budget?.payload);
      results.push(record("pipeline", id, mapPipeline({
        id,
        title: text(opportunity.proposedTitle, question),
        stage: text(opportunityRow.status, "research_review"),
        category: text(asObject(opportunity.cluster).pillar, "Uncategorized"),
        audience: text(asObject(opportunity.cluster).audience, "Unspecified audience"),
        decision: text(opportunity.decision, "hold_for_evidence"),
        evidenceStatus: text(asObject(budgetPayload.evidenceReadiness).status, "unavailable"),
        nextAction: "Review research and source evidence before drafting",
        blockedReason: strArray(opportunity.failedGates).join("; ") || null,
        readerQuestion: question,
        questionProvenance: text(opportunity.readerQuestionProvenance, "M5 research opportunity"),
        situation: text(asObject(opportunity.cluster).audience, "Reader context unavailable."),
        problem: question,
        desiredOutcome: "A bounded brief based on reviewed evidence.",
        constraints: [...strArray(opportunity.failedGates), "Publishing remains outside the owner console."],
        outline: strArray(opportunity.proposedOutline),
        evidenceBudget: text(asObject(budgetPayload.evidenceReadiness).summary, "No linked evidence budget."),
        approvedFacts: strArray(budgetPayload.approvedFacts),
        blockedClaims: [...strArray(budgetPayload.unsupportedClaims), ...strArray(budgetPayload.prohibitedClaims)],
        contradictions: strArray(budgetPayload.conflictingClaims),
      }), opportunityRow.updated_at));
    }
    for (const article of articles) {
      if (briefIds.has(text(article.id))) continue;
      const id = `m5-article-${text(article.id)}`;
      const settings = asObject(article.generation_settings);
      results.push(record("pipeline", id, mapPipeline({
        id,
        title: text(article.title, "Untitled article"),
        stage: text(article.status, "draft"),
        category: text(settings.pillar, "Article"),
        audience: text(settings.targetAudience, "Unspecified audience"),
        decision: "owner_review",
        evidenceStatus: "unavailable",
        nextAction: "Review saved article; source evidence details unavailable.",
        blockedReason: "No linked M5 evidence budget was found.",
        scheduledDate: article.scheduled_for ? iso(article.scheduled_for) : null,
        readerQuestion: text(article.title, "Saved M5 article"),
        questionProvenance: "M5 articles table",
        situation: text(article.excerpt, "Article record from M5."),
        problem: text(article.title),
        desiredOutcome: "Owner review only.",
        constraints: ["The owner console does not generate, approve, or publish articles."],
        outline: [],
        evidenceBudget: "No linked evidence budget was found.",
        approvedFacts: [],
        blockedClaims: [],
        contradictions: [],
      }), article.updated_at));
    }
  }

  if (kind === "calendar" && tables.has("articles")) {
    const { rows } = await db.query<Row>(
      `SELECT id, title, status, scheduled_for FROM articles
       WHERE scheduled_for IS NOT NULL ORDER BY scheduled_for ASC`,
    );
    for (const row of rows) {
      results.push(record("calendar", `m5-calendar-${text(row.id)}`, {
        id: `m5-calendar-${text(row.id)}`,
        date: iso(row.scheduled_for).slice(0, 10),
        title: text(row.title, "Scheduled M5 article"),
        status: text(row.status),
        detail: "Read-only M5 schedule entry. Production remains paused in this owner console.",
        productionPaused: true,
      }, row.scheduled_for));
    }
  }

  if (kind === "activity") {
    if (tables.has("audit_events")) {
      const { rows } = await db.query<Row>(
        "SELECT id, actor, action, detail, created_at FROM audit_events ORDER BY created_at DESC LIMIT 100",
      );
      for (const row of rows) {
        results.push(record("activity", `m5-audit-${text(row.id)}`, {
          id: `m5-audit-${text(row.id)}`,
          time: iso(row.created_at),
          kind: text(row.action),
          summary: text(row.action).replaceAll("_", " "),
          detail: JSON.stringify(asObject(row.detail)),
          needsAction: /fail|error|review|pending/i.test(text(row.action)),
          actor: text(row.actor),
        }, row.created_at));
      }
    }
    if (tables.has("knowledge_audit_events")) {
      const { rows } = await db.query<Row>(
        "SELECT id, actor, action, detail, created_at FROM knowledge_audit_events ORDER BY created_at DESC LIMIT 100",
      );
      for (const row of rows) {
        results.push(record("activity", `m5-knowledge-audit-${text(row.id)}`, {
          id: `m5-knowledge-audit-${text(row.id)}`,
          time: iso(row.created_at),
          kind: `knowledge_${text(row.action).toLowerCase()}`,
          summary: `Knowledge ${text(row.action).toLowerCase()}`,
          detail: "M5 knowledge audit event; approval decisions remain authoritative in M5.",
          needsAction: /pending|revise|stale/i.test(text(row.action)),
          actor: text(row.actor),
        }, row.created_at));
      }
    }
  }
  return results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export async function readM5OwnerRecords(kind: OwnerKind): Promise<{
  schemaPresent: boolean;
  hasDomainData: boolean;
  records: OwnerConsoleRecord[];
}> {
  const db = getPool();
  if (!db) return { schemaPresent: false, hasDomainData: false, records: [] };
  const tables = await tableNames(db);
  const schemaPresent = [
    "articles", "research_opportunities", "article_briefs", "reader_tasks",
    "opportunity_clusters", "knowledge_entries", "merchant_interview_packets",
  ].some((table) => tables.has(table));
  if (!schemaPresent) return { schemaPresent: false, hasDomainData: false, records: [] };
  const records = await listM5Records(db, kind);
  const domainTables = [
    "articles", "research_opportunities", "article_briefs", "reader_tasks",
    "opportunity_clusters", "knowledge_entries", "merchant_interview_packets",
  ].filter((table) => tables.has(table));
  let hasDomainData = records.length > 0;
  if (!hasDomainData) {
    for (const table of domainTables) {
      const { rows } = await db.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ${table} LIMIT 1) AS exists`,
      );
      if (rows[0]?.exists) {
        hasDomainData = true;
        break;
      }
    }
  }
  return { schemaPresent, hasDomainData, records };
}

export async function answerM5InterviewQuestion(input: {
  questionId: string;
  answer: string;
  scope: string;
  effectiveDate: string;
}): Promise<void> {
  const db = getPool();
  if (!db) throw new Error("M5_DATABASE_UNAVAILABLE");
  const tables = await tableNames(db);
  if (!tables.has("merchant_interview_packets") || !tables.has("merchant_interview_questions")) {
    throw new Error("QUESTION_NOT_FOUND");
  }
  const { rows } = await db.query<Row>(
    `SELECT p.id AS packet_id, p.knowledge_class, p.completion_status
     FROM merchant_interview_questions q
     JOIN merchant_interview_packets p ON p.id=q.packet_id
     WHERE q.id=$1`,
    [input.questionId],
  );
  const question = rows[0];
  if (!question) throw new Error("QUESTION_NOT_FOUND");
  if (question.completion_status !== "open") throw new Error("QUESTION_NOT_ANSWERABLE");
  await submitInterviewAnswerAsPendingKnowledge(db, {
    packetId: text(question.packet_id),
    questionId: input.questionId,
    answerText: input.answer,
    knowledgeClass: text(question.knowledge_class) || "general_authoritative_education",
    sourceReference: `merchant-interview:${text(question.packet_id)}:${input.questionId}`,
    actor: "owner-console",
    scope: {
      applicableNotes: `${input.scope}; effective date: ${input.effectiveDate}`,
    },
  });
}

type PendingKnowledgeEntry = Row & {
  id: string;
  knowledgeClass: string;
  normalizedClaim: string;
  exactApprovedFact: string;
  scope: Row;
  sourceType: string;
  sourceReference: string;
  provenance: string;
  approvalState: string;
  approvedBy: null;
  approvedAt: null;
  approvalMethod: null;
  contentHash: string;
  revisionId: string;
  publicUsageAllowed: false;
  usageScope: string;
  firsthand: true;
  confidence: string;
  effectiveFrom: null;
  effectiveTo: null;
  freshnessPolicyDays: null;
  contradictions: string[];
  revokedAt: null;
  revokedBy: null;
  revokeReason: null;
  schemaVersion: string;
  pipelineVersions: Row;
  materialHash: string;
};

const knowledgePipelineVersions = {
  provider: "provider.v2.approved-faq-and-seed-brainstorm",
  normalization: "normalization.v1.source-evidence-to-reader-task",
  clustering: "clustering.v1.semantic-reader-task",
  knowledgeRegistry: "knowledge.v1.approved-claim-budget",
  titleGeneration: "title.v2.provenance-aware-balanced",
  decisionPolicy: "decision.v1.auto-only-generation",
  briefSchema: "brief.v3.canonical-reader-task",
  generationPrompt: "generation.v1.writer-json",
  verificationRubric: "verification.v1.quality-gates",
  readerTaskSchema: "readerTask.v1",
};

function sha1(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildPendingKnowledgeEntry(args: {
  knowledgeClass: string;
  normalizedClaim: string;
  exactApprovedFact: string;
  scope?: Partial<{
    geographic: string;
    processSurface: string;
    audiences: string[];
    products: string[];
    exclusions: string[];
    applicableNotes: string;
  }>;
  sourceType: string;
  sourceReference: string;
  provenance: string;
  firsthand: boolean;
  publicUsageAllowed: boolean;
  usageScope: string;
  confidence: string;
  approvalState: string;
  templateExample?: boolean;
}): PendingKnowledgeEntry {
  const scope = {
    geographic: args.scope?.geographic || "unspecified",
    processSurface: args.scope?.processSurface || "unspecified",
    audiences: args.scope?.audiences || [],
    products: args.scope?.products || [],
    exclusions: args.scope?.exclusions || [],
    applicableNotes: args.scope?.applicableNotes || "",
  };
  const content = {
    knowledgeClass: args.knowledgeClass,
    normalizedClaim: args.normalizedClaim.trim(),
    exactApprovedFact: args.exactApprovedFact.trim(),
    scope: {
      geographic: scope.geographic,
      processSurface: scope.processSurface,
      audiences: [...scope.audiences].map((value) => value.trim()).sort(),
      products: [...scope.products].map((value) => value.trim()).sort(),
      exclusions: [...scope.exclusions].map((value) => value.trim()).sort(),
      applicableNotes: scope.applicableNotes.trim(),
    },
    sourceType: args.sourceType,
    sourceReference: args.sourceReference.trim(),
    effectiveFrom: null,
    effectiveTo: null,
    freshnessPolicyDays: null,
    firsthand: args.firsthand === true,
    publicUsageAllowed: args.publicUsageAllowed === true,
    usageScope: args.usageScope.trim(),
  };
  const contentHash = sha256(content);
  const id = sha1(`${args.knowledgeClass}|${content.sourceReference.toLowerCase()}`).slice(0, 24);
  const revisionId = sha1(`${id}|${contentHash}`).slice(0, 24);
  const partial: Row = {
    id,
    knowledgeClass: content.knowledgeClass,
    normalizedClaim: content.normalizedClaim,
    exactApprovedFact: content.exactApprovedFact,
    scope,
    sourceType: content.sourceType,
    sourceReference: content.sourceReference,
    provenance: args.provenance,
    approvalState: args.approvalState,
    approvedBy: null,
    approvedAt: null,
    approvalMethod: null,
    contentHash,
    revisionId,
    publicUsageAllowed: false,
    usageScope: "",
    firsthand: true,
    confidence: args.confidence || "unknown",
    effectiveFrom: null,
    effectiveTo: null,
    freshnessPolicyDays: null,
    contradictions: [],
    revokedAt: null,
    revokedBy: null,
    revokeReason: null,
    schemaVersion: "knowledgeEntry.v1",
    templateExample: args.templateExample === true,
  };
  const materialHash = sha256({
    id: partial.id,
    knowledgeClass: partial.knowledgeClass,
    normalizedClaim: partial.normalizedClaim,
    exactApprovedFact: partial.exactApprovedFact,
    scope: partial.scope,
    sourceType: partial.sourceType,
    sourceReference: partial.sourceReference,
    approvalState: partial.approvalState,
    approvedBy: partial.approvedBy,
    approvedAt: partial.approvedAt,
    approvalMethod: partial.approvalMethod,
    contentHash: partial.contentHash,
    revisionId: partial.revisionId,
    publicUsageAllowed: partial.publicUsageAllowed,
    usageScope: partial.usageScope,
    firsthand: partial.firsthand,
    confidence: partial.confidence,
    effectiveFrom: partial.effectiveFrom,
    effectiveTo: partial.effectiveTo,
    freshnessPolicyDays: partial.freshnessPolicyDays,
    contradictions: [],
    revokedAt: partial.revokedAt,
    revokeReason: partial.revokeReason,
  });
  return {
    ...partial,
    pipelineVersions: {
      stampedAt: new Date().toISOString(),
      versions: knowledgePipelineVersions,
      milestone: "M4",
    },
    materialHash,
  } as unknown as PendingKnowledgeEntry;
}

async function upsertPendingKnowledge(
  db: pg.Pool,
  args: Parameters<typeof buildPendingKnowledgeEntry>[0] & { actor: string },
): Promise<{ entry: PendingKnowledgeEntry; outcome: "inserted" | "updated" | "unchanged" }> {
  const built = buildPendingKnowledgeEntry(args);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ payload: PendingKnowledgeEntry; material_hash: string }>(
      "SELECT payload, material_hash FROM knowledge_entries WHERE id=$1 FOR UPDATE",
      [built.id],
    );
    if (!rows.length) {
      await client.query(
        `INSERT INTO knowledge_entries(
           id, knowledge_class, normalized_claim, exact_approved_fact, scope, source_type,
           source_reference, provenance, approval_state, approved_by, approved_at, approval_method,
           content_hash, revision_id, public_usage_allowed, usage_scope, firsthand, confidence,
           effective_from, effective_to, freshness_policy_days, contradictions,
           revoked_at, revoked_by, revoke_reason, schema_version, pipeline_versions,
           material_hash, payload
         ) VALUES (
           $1,$2,$3,$4,$5::jsonb,$6,
           $7,$8,$9,$10,$11,$12,
           $13,$14,$15,$16,$17,$18,
           $19,$20,$21,$22::jsonb,
           $23,$24,$25,$26,$27::jsonb,
           $28,$29::jsonb
         )`,
        [
          built.id, built.knowledgeClass, built.normalizedClaim, built.exactApprovedFact,
          JSON.stringify(built.scope), built.sourceType, built.sourceReference, built.provenance,
          built.approvalState, built.approvedBy, built.approvedAt, built.approvalMethod,
          built.contentHash, built.revisionId, built.publicUsageAllowed, built.usageScope,
          built.firsthand, built.confidence, built.effectiveFrom, built.effectiveTo,
          built.freshnessPolicyDays, JSON.stringify(built.contradictions), built.revokedAt,
          built.revokedBy, built.revokeReason, built.schemaVersion,
          JSON.stringify(built.pipelineVersions), built.materialHash, JSON.stringify(built),
        ],
      );
      await client.query(
        `INSERT INTO knowledge_entry_revisions(revision_id, entry_id, content_hash, payload)
         VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (revision_id) DO NOTHING`,
        [built.revisionId, built.id, built.contentHash, JSON.stringify(built)],
      );
      await client.query(
        `INSERT INTO knowledge_audit_events(entry_id, action, actor, detail)
         VALUES ($1,'CREATE',$2,$3::jsonb)`,
        [built.id, args.actor, JSON.stringify({ contentHash: built.contentHash, revisionId: built.revisionId })],
      );
      await client.query("COMMIT");
      return { entry: built, outcome: "inserted" };
    }

    const existing = rows[0]!.payload;
    if (existing.contentHash === built.contentHash && existing.materialHash === built.materialHash) {
      await client.query("COMMIT");
      return { entry: existing, outcome: "unchanged" };
    }

    // M5 reviseKnowledgeContent semantics: stable entry id, new current
    // revision, pending approval, no approval identity, and preserved history.
    const revised = {
      ...built,
      id: existing.id,
      revisionId: sha1(`${existing.id}|${built.contentHash}`).slice(0, 24),
      contradictions: existing.contradictions || [],
      templateExample: existing.templateExample === true,
      pipelineVersions: {
        stampedAt: new Date().toISOString(),
        versions: knowledgePipelineVersions,
        milestone: "M4",
      },
    } as PendingKnowledgeEntry;
    revised.materialHash = sha256({
      id: revised.id,
      knowledgeClass: revised.knowledgeClass,
      normalizedClaim: revised.normalizedClaim,
      exactApprovedFact: revised.exactApprovedFact,
      scope: revised.scope,
      sourceType: revised.sourceType,
      sourceReference: revised.sourceReference,
      approvalState: "PENDING_APPROVAL",
      approvedBy: null,
      approvedAt: null,
      approvalMethod: null,
      contentHash: revised.contentHash,
      revisionId: revised.revisionId,
      publicUsageAllowed: false,
      usageScope: "",
      firsthand: true,
      confidence: revised.confidence,
      effectiveFrom: null,
      effectiveTo: null,
      freshnessPolicyDays: null,
      contradictions: [...revised.contradictions].sort(),
      revokedAt: null,
      revokeReason: null,
    });
    await client.query(
      `UPDATE knowledge_entries SET
         knowledge_class=$2, normalized_claim=$3, exact_approved_fact=$4,
         scope=$5::jsonb, source_type=$6, provenance=$7,
         approval_state='PENDING_APPROVAL', approved_by=NULL, approved_at=NULL, approval_method=NULL,
         content_hash=$8, revision_id=$9, public_usage_allowed=false, usage_scope='',
         firsthand=true, confidence=$10, effective_from=NULL, effective_to=NULL,
         freshness_policy_days=NULL, contradictions=$11::jsonb,
         schema_version=$12, pipeline_versions=$13::jsonb, material_hash=$14,
         payload=$15::jsonb, updated_at=now()
       WHERE id=$1`,
      [
        revised.id, revised.knowledgeClass, revised.normalizedClaim, revised.exactApprovedFact,
        JSON.stringify(revised.scope), revised.sourceType, revised.provenance,
        revised.contentHash, revised.revisionId, revised.confidence,
        JSON.stringify(revised.contradictions), revised.schemaVersion,
        JSON.stringify(revised.pipelineVersions), revised.materialHash, JSON.stringify(revised),
      ],
    );
    await client.query(
      `INSERT INTO knowledge_entry_revisions(revision_id, entry_id, content_hash, payload)
       VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (revision_id) DO NOTHING`,
      [revised.revisionId, revised.id, revised.contentHash, JSON.stringify(revised)],
    );
    await client.query(
      `UPDATE knowledge_approvals SET invalidated_at=now(), invalidation_reason='content_changed'
       WHERE entry_id=$1 AND content_hash=$2 AND invalidated_at IS NULL`,
      [existing.id, existing.contentHash],
    );
    await client.query(
      `INSERT INTO knowledge_audit_events(entry_id, action, actor, detail)
       VALUES ($1,'REVISE_INVALIDATE_APPROVAL',$2,$3::jsonb)`,
      [revised.id, args.actor, JSON.stringify({
        previousContentHash: existing.contentHash,
        contentHash: revised.contentHash,
        previousRevisionId: existing.revisionId,
        revisionId: revised.revisionId,
      })],
    );
    await client.query("COMMIT");
    return { entry: revised, outcome: "updated" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function submitInterviewAnswerAsPendingKnowledge(
  db: pg.Pool,
  args: {
    packetId: string;
    questionId: string;
    answerText: string;
    knowledgeClass: string;
    sourceReference: string;
    actor: string;
    scope?: Parameters<typeof buildPendingKnowledgeEntry>[0]["scope"];
  },
): Promise<void> {
  const result = await upsertPendingKnowledge(db, {
    knowledgeClass: args.knowledgeClass,
    normalizedClaim: `Interview answer for question ${args.questionId}`,
    exactApprovedFact: args.answerText.trim(),
    scope: args.scope,
    sourceType: "approved_merchant_firsthand",
    sourceReference: args.sourceReference,
    provenance: `merchant_interview_packet:${args.packetId}`,
    firsthand: true,
    publicUsageAllowed: false,
    usageScope: "",
    confidence: "unknown",
    approvalState: "PENDING_APPROVAL",
    actor: args.actor,
  });
  // Defensive invariant even for an idempotent retry of an older entry.
  if (result.entry.approvalState !== "PENDING_APPROVAL" || result.entry.publicUsageAllowed !== false) {
    throw new Error("PENDING_KNOWLEDGE_INVARIANT_FAILED");
  }
  await db.query(
    `INSERT INTO merchant_interview_answers(packet_id, question_id, entry_id, revision_id, answer_text, approval_state)
     VALUES ($1,$2,$3,$4,$5,'PENDING_APPROVAL')
     ON CONFLICT (packet_id, question_id) DO UPDATE SET
       entry_id=EXCLUDED.entry_id, revision_id=EXCLUDED.revision_id,
       answer_text=EXCLUDED.answer_text, approval_state='PENDING_APPROVAL', updated_at=now()`,
    [args.packetId, args.questionId, result.entry.id, result.entry.revisionId, args.answerText.trim()],
  );
  await db.query(
    `UPDATE merchant_interview_packets
     SET completion_status='answered_pending_approval', updated_at=now()
     WHERE id=$1`,
    [args.packetId],
  );
}

export async function getM5RolloutReadout(): Promise<{
  available: boolean;
  operatingMode: "draft_only";
  rolloutMode: string;
  productionPaused: boolean;
  reviewedDrafts: number;
  requiredDrafts: number;
  published: number;
  target: number;
}> {
  const db = getPool();
  if (!db) return { available: false, operatingMode: "draft_only", rolloutMode: "paused", productionPaused: true, reviewedDrafts: 0, requiredDrafts: 0, published: 0, target: 0 };
  const tables = await tableNames(db);
  if (!tables.has("app_settings")) {
    return { available: false, operatingMode: "draft_only", rolloutMode: "paused", productionPaused: true, reviewedDrafts: 0, requiredDrafts: 0, published: 0, target: 0 };
  }
  const { rows } = await db.query<Row>("SELECT value FROM app_settings WHERE singleton=true LIMIT 1");
  if (!rows[0]) return { available: false, operatingMode: "draft_only", rolloutMode: "paused", productionPaused: true, reviewedDrafts: 0, requiredDrafts: 0, published: 0, target: 0 };
  const settings = asObject(rows[0].value);
  const mode = text(settings.rolloutMode);
  const killSwitch = asObject(settings.killSwitch);
  const progress = asObject(settings.promotionProgress);
  const thresholds = asObject(settings.promotionThresholds);
  const hasReviewedCount = (typeof progress.consecutiveReviewedDrafts === "number" &&
    Number.isFinite(progress.consecutiveReviewedDrafts)) ||
    tables.has("audit_events");
  // UI values are locked regardless of M5 mode. Read authoritative fields only
  // to determine whether reporting is available, never to enable a capability.
  const available = ["paused", "observe", "draft_only", "shadow_auto", "auto_publish"].includes(mode) &&
    typeof killSwitch.paused === "boolean" &&
    typeof thresholds.minConsecutiveReviewedDrafts === "number" &&
    Number.isFinite(thresholds.minConsecutiveReviewedDrafts) &&
    hasReviewedCount &&
    tables.has("articles");
  const { rows: countedDrafts } = tables.has("audit_events")
    ? await db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM audit_events WHERE action='rollout_draft_counted'",
      )
    : { rows: [] };
  const { rows: publishedRows } = tables.has("articles")
    ? await db.query<{ n: string }>("SELECT count(*)::text AS n FROM articles WHERE status='published'")
    : { rows: [] };
  return {
    available,
    operatingMode: "draft_only",
    rolloutMode: available ? mode : "paused",
    productionPaused: true,
    reviewedDrafts: available ? Number(progress.consecutiveReviewedDrafts ?? countedDrafts[0]?.n ?? 0) : 0,
    requiredDrafts: available ? Number(thresholds.minConsecutiveReviewedDrafts ?? 0) : 0,
    published: available ? Number(publishedRows[0]?.n ?? 0) : 0,
    target: available ? Number(thresholds.minConsecutiveReviewedDrafts ?? 0) : 0,
  };
}

export async function hasM5DomainData(): Promise<boolean> {
  const db = getPool();
  if (!db) return false;
  const tables = await tableNames(db);
  for (const table of [
    "articles", "research_opportunities", "article_briefs", "reader_tasks",
    "opportunity_clusters", "knowledge_entries", "merchant_interview_packets",
  ]) {
    if (!tables.has(table)) continue;
    const { rows } = await db.query<{ present: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM ${table} LIMIT 1) AS present`,
    );
    if (rows[0]?.present) return true;
  }
  return false;
}