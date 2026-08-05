import pg from "pg";
import type { Settings, Job, GeneratedArticle } from "./types.js";
import { defaultSettings } from "./defaults.js";

const { Pool } = pg;
export type Db = pg.Pool;

export function createDb(connectionString: string): Db {
  return new Pool({ connectionString, ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false }, max: 5 });
}

export async function migrate(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS publish_jobs (
      id bigserial PRIMARY KEY,
      slot_key text NOT NULL UNIQUE,
      scheduled_for timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','published','failed','skipped')),
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      article jsonb,
      shopify_article_id text,
      shopify_url text,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS publish_jobs_due_idx ON publish_jobs(status, next_attempt_at, scheduled_for);
    INSERT INTO app_settings(singleton, value) VALUES (true, $1::jsonb) ON CONFLICT (singleton) DO NOTHING;
  `, [JSON.stringify(defaultSettings)]);
}

export async function getSettings(db: Db): Promise<Settings> {
  const { rows } = await db.query<{value: Settings}>("SELECT value FROM app_settings WHERE singleton=true");
  return rows[0]?.value ?? defaultSettings;
}

export async function saveSettings(db: Db, settings: Settings): Promise<void> {
  await db.query("UPDATE app_settings SET value=$1::jsonb, updated_at=now() WHERE singleton=true", [JSON.stringify(settings)]);
}

export async function insertSlot(db: Db, slotKey: string, scheduledFor: Date): Promise<void> {
  await db.query("INSERT INTO publish_jobs(slot_key, scheduled_for) VALUES($1,$2) ON CONFLICT(slot_key) DO NOTHING", [slotKey, scheduledFor]);
}

export async function insertManualJob(db: Db): Promise<void> {
  await db.query("INSERT INTO publish_jobs(slot_key, scheduled_for) VALUES($1,now())", [`manual:${crypto.randomUUID()}`]);
}

export async function claimJob(db: Db): Promise<Job | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<Job>(`
      SELECT id, slot_key, scheduled_for, status, attempts FROM publish_jobs
      WHERE status IN ('pending','failed') AND next_attempt_at <= now() AND scheduled_for <= now()
        AND attempts < 4
      ORDER BY scheduled_for ASC FOR UPDATE SKIP LOCKED LIMIT 1
    `);
    const job = rows[0];
    if (!job) { await client.query("COMMIT"); return null; }
    await client.query("UPDATE publish_jobs SET status='running', attempts=attempts+1, started_at=now(), updated_at=now() WHERE id=$1", [job.id]);
    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function recentTopicContext(db: Db): Promise<string[]> {
  const { rows } = await db.query<{article: GeneratedArticle}>("SELECT article FROM publish_jobs WHERE article IS NOT NULL ORDER BY created_at DESC LIMIT 90");
  return rows.map(row => `${row.article.title} [${row.article.topicFingerprint}]`);
}

export async function finishJob(db: Db, id: number, article: GeneratedArticle, shopifyId: string, url: string): Promise<void> {
  await db.query("UPDATE publish_jobs SET status='published', article=$2::jsonb, shopify_article_id=$3, shopify_url=$4, completed_at=now(), updated_at=now(), error=NULL WHERE id=$1", [id, JSON.stringify(article), shopifyId, url]);
}

export async function failJob(db: Db, id: number, article: GeneratedArticle | null, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await db.query(`UPDATE publish_jobs SET status='failed', article=COALESCE($2::jsonb,article), error=$3,
    next_attempt_at=now() + (interval '15 minutes' * power(2, GREATEST(attempts-1,0))), updated_at=now() WHERE id=$1`,
    [id, article ? JSON.stringify(article) : null, message.slice(0, 4000)]);
}

export async function listJobs(db: Db, limit = 50) {
  const { rows } = await db.query("SELECT * FROM publish_jobs ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows;
}
