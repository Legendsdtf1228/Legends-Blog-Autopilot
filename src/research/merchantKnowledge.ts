/**
 * Structured merchant knowledge base: approved firsthand facts with provenance.
 * Reused across articles; never invent experience, numbers, policies, or recommendations.
 */
import type { Db } from "../db.js";
import type { ContentPromiseClass } from "./contentPromise.js";
import type { MerchantInterview } from "./types.js";

export interface MerchantKnowledgeFact {
  id?: number;
  topicClass: ContentPromiseClass | string;
  question: string;
  answer: string;
  sourceBriefId: number | null;
  approvedAt: string;
  approvedBy: string;
  reusable: boolean;
}

export async function ensureMerchantKnowledgeTable(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS merchant_knowledge (
    id BIGSERIAL PRIMARY KEY,
    topic_class TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    source_brief_id BIGINT,
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_by TEXT NOT NULL DEFAULT 'merchant',
    reusable BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.query(
    "CREATE INDEX IF NOT EXISTS merchant_knowledge_class_idx ON merchant_knowledge(topic_class)"
  );
}

/** Persist approved interview answers into the reusable knowledge base. */
export async function storeApprovedInterviewKnowledge(
  db: Db,
  args: {
    interview: MerchantInterview;
    topicClass: string;
    briefId: number;
    approvedBy?: string;
  }
): Promise<MerchantKnowledgeFact[]> {
  await ensureMerchantKnowledgeTable(db);
  if (!args.interview.completed) return [];
  const stored: MerchantKnowledgeFact[] = [];
  const approvedAt = new Date().toISOString();
  const approvedBy = args.approvedBy || "merchant";
  for (const q of args.interview.questions) {
    if (!q.answer || q.answer.trim().length < 8) continue;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO merchant_knowledge(topic_class, question, answer, source_brief_id, approved_at, approved_by, reusable)
       VALUES ($1,$2,$3,$4,$5::timestamptz,$6,TRUE)
       RETURNING id`,
      [args.topicClass, q.question, q.answer.trim(), args.briefId, approvedAt, approvedBy]
    );
    stored.push({
      id: Number(rows[0]!.id),
      topicClass: args.topicClass,
      question: q.question,
      answer: q.answer.trim(),
      sourceBriefId: args.briefId,
      approvedAt,
      approvedBy,
      reusable: true
    });
  }
  return stored;
}

/** Load reusable approved facts for a content-promise class (newest first). */
export async function loadMerchantKnowledge(
  db: Db,
  topicClass?: string,
  limit = 40
): Promise<MerchantKnowledgeFact[]> {
  await ensureMerchantKnowledgeTable(db);
  const { rows } = topicClass
    ? await db.query<{
        id: string;
        topic_class: string;
        question: string;
        answer: string;
        source_brief_id: string | null;
        approved_at: string;
        approved_by: string;
        reusable: boolean;
      }>(
        `SELECT id, topic_class, question, answer, source_brief_id, approved_at, approved_by, reusable
         FROM merchant_knowledge
         WHERE reusable=TRUE AND topic_class=$1
         ORDER BY approved_at DESC LIMIT $2`,
        [topicClass, limit]
      )
    : await db.query<{
        id: string;
        topic_class: string;
        question: string;
        answer: string;
        source_brief_id: string | null;
        approved_at: string;
        approved_by: string;
        reusable: boolean;
      }>(
        `SELECT id, topic_class, question, answer, source_brief_id, approved_at, approved_by, reusable
         FROM merchant_knowledge
         WHERE reusable=TRUE
         ORDER BY approved_at DESC LIMIT $1`,
        [limit]
      );

  return rows.map(r => ({
    id: Number(r.id),
    topicClass: r.topic_class,
    question: r.question,
    answer: r.answer,
    sourceBriefId: r.source_brief_id ? Number(r.source_brief_id) : null,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
    reusable: r.reusable
  }));
}

export function knowledgeFactsAsLockedFacts(facts: MerchantKnowledgeFact[]): string[] {
  return facts.map(
    f =>
      `Approved merchant knowledge (${f.topicClass}, ${f.approvedAt.slice(0, 10)}, via ${f.approvedBy}): Q: ${f.question} A: ${f.answer}`
  );
}
