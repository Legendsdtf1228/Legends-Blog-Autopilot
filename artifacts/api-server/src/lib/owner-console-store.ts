import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ownerConsoleAnswersTable,
  ownerConsoleRecordsTable,
  ownerConsoleSettingsTable,
} from "@workspace/db";
import type { OwnerConsoleRecord } from "@workspace/db";
import {
  answerM5InterviewQuestion,
  hasM5DomainData,
  readM5OwnerRecords,
} from "./m5-owner-console-gateway";

type RecordKind =
  | "pipeline"
  | "research"
  | "knowledge"
  | "question"
  | "calendar"
  | "activity";

const developmentOnly = () => process.env.NODE_ENV === "development";

const dayOffset = (days: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const defaultSettings = {
  operatingMode: "draft_only",
  frequency: "weekly",
  days: ["Tuesday"],
  categories: ["Artwork preparation", "Ordering"],
  geography: "US",
  tone: "practical",
  depth: "standard",
  shopifyBlog: "Disabled",
  notifications: true,
  emergencyPause: true,
  lockedModes: [
    "draft_only",
    "production_paused",
    "publishing_disabled",
    "auto_publish_disabled",
  ],
};

function fixtureRecords(): Array<{
  id: string;
  kind: RecordKind;
  payload: Record<string, unknown>;
  isDevelopmentFixture: true;
}> {
  const now = new Date();
  const time = now.toISOString();

  const firstPipeline = {
    id: "fixture-pipeline-artwork-prep",
    title: "What should a buyer check before submitting transfer artwork?",
    stage: "research_review",
    category: "Artwork preparation",
    audience: "Small business owners",
    decision: "hold_for_evidence",
    evidenceStatus: "needs_review",
    nextAction: "Review source evidence before drafting",
    blockedReason: "No approved source evidence is attached.",
    scheduledDate: null,
    isDevelopmentFixture: true,
  };
  const secondPipeline = {
    id: "fixture-pipeline-ordering-scope",
    title: "Which details affect a custom transfer order?",
    stage: "waiting_on_logan",
    category: "Ordering",
    audience: "First-time buyers",
    decision: "needs_owner_input",
    evidenceStatus: "not_started",
    nextAction: "Answer the scope question before writing",
    blockedReason: "The owner has not confirmed the applicable scope.",
    scheduledDate: null,
    isDevelopmentFixture: true,
  };
  const thirdPipeline = {
    id: "fixture-pipeline-transfer-storage",
    title: "What should a care guide cover for a DTF transfer?",
    stage: "research_review",
    category: "Care and use",
    audience: "Small business owners",
    decision: "hold_for_evidence",
    evidenceStatus: "insufficient",
    nextAction: "Find approved evidence for any public claim",
    blockedReason: "No approved facts are available in this fixture.",
    scheduledDate: null,
    isDevelopmentFixture: true,
  };
  const activity = (id: string, summary: string, detail: string, offset: number) => ({
    id,
    time: new Date(now.getTime() - offset * 60_000).toISOString(),
    kind: "development_fixture",
    summary: `[Development fixture] ${summary}`,
    detail,
    needsAction: true,
  });

  return [
    {
      id: firstPipeline.id,
      kind: "pipeline",
      isDevelopmentFixture: true,
      payload: {
        ...firstPipeline,
        readerQuestion:
          "What decisions should a buyer make before submitting transfer artwork?",
        questionProvenance:
          "Development fixture; no live ReaderTask provenance is connected.",
        situation:
          "This preview has no connected source collection or production data.",
        problem:
          "The item has no reviewed evidence, so public claims are blocked.",
        desiredOutcome:
          "A bounded owner-reviewable brief based only on approved evidence.",
        constraints: [
          "No facts are approved in this fixture.",
          "Production publishing remains disabled.",
        ],
        outline: [
          "Define the reader's decision",
          "Identify evidence needed for each claim",
          "Stop before making unsupported recommendations",
        ],
        evidenceBudget: "No approved facts; public claims are blocked.",
        approvedFacts: [],
        blockedClaims: [
          "Exact production settings, timings, care instructions, and material compatibility without approved source evidence.",
        ],
        contradictions: [],
        activity: [
          activity(
            "fixture-activity-artwork",
            "Artwork-preparation question added for review",
            "No source evidence has been approved for this development fixture.",
            4,
          ),
        ],
      },
    },
    {
      id: secondPipeline.id,
      kind: "pipeline",
      isDevelopmentFixture: true,
      payload: {
        ...secondPipeline,
        readerQuestion:
          "Which order details should be confirmed before making a recommendation?",
        questionProvenance:
          "Development fixture; waiting for owner scope and research provenance.",
        situation: "The current preview contains no connected merchant records.",
        problem:
          "The scope of the answer is not confirmed by the owner.",
        desiredOutcome:
          "A scoped question that can be reviewed before it informs a draft.",
        constraints: [
          "An owner answer is pending review, not automatic approval.",
          "Publishing is disabled.",
        ],
        outline: [
          "Confirm the reader's situation",
          "Record the owner's scope",
          "Keep public use blocked until review",
        ],
        evidenceBudget: "No approved facts; owner input alone is not evidence approval.",
        approvedFacts: [],
        blockedClaims: [
          "Order-specific promises without an approved source and confirmed scope.",
        ],
        contradictions: [],
        activity: [],
      },
    },
    {
      id: thirdPipeline.id,
      kind: "pipeline",
      isDevelopmentFixture: true,
      payload: {
        ...thirdPipeline,
        readerQuestion:
          "What questions should a transfer-care guide answer?",
        questionProvenance:
          "Development fixture; no connected research cluster is attached.",
        situation: "The preview has no evidence records to evaluate.",
        problem:
          "A care recommendation could become a public claim without support.",
        desiredOutcome:
          "A draft outline that leaves unsupported claims blocked.",
        constraints: [
          "No source evidence is available.",
          "No publishing or eligibility override exists.",
        ],
        outline: [
          "List the reader's care questions",
          "Locate approved evidence",
          "Leave unsupported claims out of the draft",
        ],
        evidenceBudget: "No approved facts; source review required.",
        approvedFacts: [],
        blockedClaims: [
          "Care directions or durability claims without approved evidence.",
        ],
        contradictions: [],
        activity: [],
      },
    },
    {
      id: "fixture-research-artwork-question",
      kind: "research",
      isDevelopmentFixture: true,
      payload: {
        id: "fixture-research-artwork-question",
        status: "requires_review",
        canonicalQuestion:
          "What should a buyer check before submitting transfer artwork?",
        audience: "First-time buyers",
        decision: "hold_for_evidence",
        evidenceStatus: "none",
        confidence: 0,
        lastEvaluated: time,
        supportingEvidence: [],
        reviewReason:
          "No source evidence is connected to this development fixture.",
        isDevelopmentFixture: true,
      },
    },
    {
      id: "fixture-research-order-scope",
      kind: "research",
      isDevelopmentFixture: true,
      payload: {
        id: "fixture-research-order-scope",
        status: "active",
        canonicalQuestion:
          "Which details affect a custom transfer order?",
        audience: "Small business owners",
        decision: "awaiting_owner_input",
        evidenceStatus: "not_started",
        confidence: 0,
        lastEvaluated: time,
        supportingEvidence: [],
        reviewReason:
          "Owner scope is not confirmed; this cluster is not eligible for drafting.",
        isDevelopmentFixture: true,
      },
    },
    {
      id: "fixture-knowledge-evidence-review",
      kind: "knowledge",
      isDevelopmentFixture: true,
      payload: {
        id: "fixture-knowledge-evidence-review",
        title: "Source evidence awaiting review",
        category: "Source evidence",
        approvalState: "pending_review",
        sourceType: "development fixture",
        scope: "unassigned",
        freshness: "unknown",
        publicUse: "blocked",
        revision: 0,
        supports: [],
        contradictions: [],
        isDevelopmentFixture: true,
      },
    },
    {
      id: "fixture-knowledge-owner-input",
      kind: "knowledge",
      isDevelopmentFixture: true,
      payload: {
        id: "fixture-knowledge-owner-input",
        title: "Owner input requires review",
        category: "Merchant knowledge",
        approvalState: "pending_review",
        sourceType: "development fixture",
        scope: "unassigned",
        freshness: "unknown",
        publicUse: "blocked",
        revision: 0,
        supports: [],
        contradictions: [],
        isDevelopmentFixture: true,
      },
    },
    {
      id: "fixture-question-order-scope",
      kind: "question",
      isDevelopmentFixture: true,
      payload: {
        id: "fixture-question-order-scope",
        question:
          "Which order scope and effective date should apply to turnaround estimates?",
        missing: "An owner-confirmed value, scope, and effective date.",
        why:
          "A time-sensitive estimate must not become a public claim without current, scoped approval.",
        affects: [
          "Turnaround-related drafts",
          "Public-use eligibility",
        ],
        scopeRequired: "Confirm product, region, and effective date.",
        publicUse: "Blocked until separately reviewed and approved.",
        status: "awaiting_answer",
        isDevelopmentFixture: true,
      },
    },
    {
      id: "fixture-calendar-research-review",
      kind: "calendar",
      isDevelopmentFixture: true,
      payload: {
        id: "fixture-calendar-research-review",
        date: dayOffset(2),
        title: "Research review — draft-only",
        status: "blocked",
        detail:
          "Development review reminder only. No article is scheduled or eligible to publish.",
        productionPaused: true,
      },
    },
    {
      id: "fixture-calendar-owner-review",
      kind: "calendar",
      isDevelopmentFixture: true,
      payload: {
        id: "fixture-calendar-owner-review",
        date: dayOffset(7),
        title: "Owner scope review — draft-only",
        status: "needs_owner_input",
        detail:
          "A review reminder only. Production remains paused and auto-publishing is unavailable.",
        productionPaused: true,
      },
    },
    {
      id: "fixture-activity-start",
      kind: "activity",
      isDevelopmentFixture: true,
      payload: activity(
        "fixture-activity-start",
        "Owner console initialized in draft-only mode",
        "Development-only sample state. No production data or publishing connection is used.",
        1,
      ),
    },
    {
      id: "fixture-activity-evidence",
      kind: "activity",
      isDevelopmentFixture: true,
      payload: activity(
        "fixture-activity-evidence",
        "Evidence review is required",
        "Sample claims remain blocked until the existing evidence and approval rules allow them.",
        12,
      ),
    },
  ];
}

export async function ensureDevelopmentFixtures(): Promise<void> {
  if (!developmentOnly()) return;
  if (await hasM5DomainData()) return;

  const existing = await db
    .select({ id: ownerConsoleRecordsTable.id })
    .from(ownerConsoleRecordsTable)
    .limit(1);
  if (existing.length > 0) return;

  const otherApplicationTables = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN (
          'owner_console_records',
          'owner_console_answers',
          'owner_console_settings'
        )
    ) AS has_other_application_tables
  `);
  if (otherApplicationTables.rows[0]?.has_other_application_tables) return;

  await db
    .insert(ownerConsoleRecordsTable)
    .values(fixtureRecords())
    .onConflictDoNothing();
}

export async function listOwnerConsoleRecords(
  kind: RecordKind,
): Promise<OwnerConsoleRecord[]> {
  const m5 = await readM5OwnerRecords(kind);
  if (m5.hasDomainData) return m5.records;
  if (!developmentOnly()) return [];
  await ensureDevelopmentFixtures();
  return db
    .select()
    .from(ownerConsoleRecordsTable)
    .where(eq(ownerConsoleRecordsTable.kind, kind))
    .orderBy(desc(ownerConsoleRecordsTable.updatedAt));
}

export async function getOwnerConsoleRecord(
  id: string,
  kind: RecordKind,
): Promise<OwnerConsoleRecord | undefined> {
  const records = await listOwnerConsoleRecords(kind);
  return records.find((record) => record.id === id);
}

export async function getOwnerConsoleSettings(): Promise<Record<string, unknown>> {
  const [stored] = await db
    .select()
    .from(ownerConsoleSettingsTable)
    .where(eq(ownerConsoleSettingsTable.id, 1))
    .limit(1);
  if (stored) return { ...stored.payload, operatingMode: "draft_only", emergencyPause: true };

  return defaultSettings;
}

export async function saveOwnerConsoleSettings(
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const current = await getOwnerConsoleSettings();
  const next = { ...current, ...patch, operatingMode: "draft_only", emergencyPause: true };
  await db
    .insert(ownerConsoleSettingsTable)
    .values({ id: 1, payload: next })
    .onConflictDoUpdate({
      target: ownerConsoleSettingsTable.id,
      set: { payload: next },
    });
  return next;
}

export async function saveOwnerAnswer(input: {
  questionId: string;
  answer: string;
  scope: string;
  effectiveDate: string;
  publicUsePermission: boolean;
}): Promise<void> {
  if (await hasM5DomainData()) {
    await answerM5InterviewQuestion({
      questionId: input.questionId,
      answer: input.answer,
      scope: input.scope,
      effectiveDate: input.effectiveDate,
    });
    return;
  }
  if (!developmentOnly()) throw new Error("QUESTION_NOT_FOUND");
  await ensureDevelopmentFixtures();
  await db.transaction(async (tx) => {
    const [question] = await tx
      .select()
      .from(ownerConsoleRecordsTable)
      .where(
        and(
          eq(ownerConsoleRecordsTable.id, input.questionId),
          eq(ownerConsoleRecordsTable.kind, "question"),
        ),
      )
      .limit(1);
    if (!question) throw new Error("QUESTION_NOT_FOUND");
    if (question.payload.status !== "awaiting_answer") {
      throw new Error("QUESTION_NOT_ANSWERABLE");
    }

    try {
      await tx.insert(ownerConsoleAnswersTable).values({
        id: randomUUID(),
        questionId: input.questionId,
        answer: input.answer,
        scope: input.scope,
        effectiveDate: input.effectiveDate,
        publicUsePermission: false,
        status: "pending_review",
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new Error("QUESTION_NOT_ANSWERABLE");
      }
      throw error;
    }

    await tx
      .update(ownerConsoleRecordsTable)
      .set({
        payload: { ...question.payload, status: "answer_pending_review" },
      })
      .where(eq(ownerConsoleRecordsTable.id, input.questionId));

    const eventId = randomUUID();
    await tx.insert(ownerConsoleRecordsTable).values({
      id: eventId,
      kind: "activity",
      isDevelopmentFixture: false,
      payload: {
        id: eventId,
        time: new Date().toISOString(),
        kind: "owner_input",
        summary: "Owner answer saved for review",
        detail:
          "Saved as pending review. This does not approve knowledge or permit public use.",
        needsAction: true,
      },
    });
  });
}

export async function addOwnerActivity(
  kind: string,
  summary: string,
  detail: string,
): Promise<void> {
  const id = randomUUID();
  await db.insert(ownerConsoleRecordsTable).values({
    id,
    kind: "activity",
    isDevelopmentFixture: false,
    payload: {
      id,
      time: new Date().toISOString(),
      kind,
      summary,
      detail,
      needsAction: false,
    },
  });
}