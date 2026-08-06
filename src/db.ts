import pg from "pg";
import type {
  ArticleContent,
  ArticleRecord,
  ArticleStatus,
  AuditEvent,
  GeneratedArticle,
  Job,
  OverviewStats,
  Settings
} from "./types.js";
import { defaultSettings, mergeSettings } from "./defaults.js";
import { fromGenerated } from "./content.js";

const { Pool } = pg;
export type Db = pg.Pool;

export function createDb(connectionString: string): Db {
  return new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
    max: 8
  });
}

function mapArticle(row: Record<string, unknown>): ArticleRecord {
  return {
    id: Number(row.id),
    status: row.status as ArticleStatus,
    title: String(row.title ?? ""),
    handle: String(row.handle ?? ""),
    excerpt: String(row.excerpt ?? ""),
    metaTitle: String(row.meta_title ?? ""),
    metaDescription: String(row.meta_description ?? ""),
    bodyHtml: String(row.body_html ?? ""),
    tags: Array.isArray(row.tags) ? row.tags as string[] : [],
    author: String(row.author ?? ""),
    featuredImageUrl: (row.featured_image_url as string | null) ?? null,
    featuredImageAlt: (row.featured_image_alt as string | null) ?? null,
    primaryKeyword: String(row.primary_keyword ?? ""),
    secondaryKeywords: Array.isArray(row.secondary_keywords) ? row.secondary_keywords as string[] : [],
    topicFingerprint: String(row.topic_fingerprint ?? ""),
    rationale: String(row.rationale ?? ""),
    scheduledFor: row.scheduled_for ? new Date(row.scheduled_for as string) : null,
    publishedAt: row.published_at ? new Date(row.published_at as string) : null,
    shopifyBlogId: (row.shopify_blog_id as string | null) ?? null,
    shopifyArticleId: (row.shopify_article_id as string | null) ?? null,
    shopifyHandle: (row.shopify_handle as string | null) ?? null,
    shopifyUrl: (row.shopify_url as string | null) ?? null,
    shopifyResponseStatus: (row.shopify_response_status as string | null) ?? null,
    generationError: (row.generation_error as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
    source: String(row.source ?? "manual"),
    merchantEdited: Boolean(row.merchant_edited),
    merchantEditedFields: Array.isArray(row.merchant_edited_fields) ? row.merchant_edited_fields as string[] : [],
    generationSettings: (row.generation_settings as Record<string, unknown> | null) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string)
  };
}

export async function migrate(db: Db): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS app_settings (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      value jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

    await client.query(`CREATE TABLE IF NOT EXISTS publish_jobs (
      id bigserial PRIMARY KEY,
      slot_key text NOT NULL UNIQUE,
      scheduled_for timestamptz NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','published','failed','skipped','cancelled')),
      attempts integer NOT NULL DEFAULT 0,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      started_at timestamptz,
      completed_at timestamptz,
      article jsonb,
      article_id bigint,
      shopify_article_id text,
      shopify_url text,
      shopify_blog_id text,
      shopify_response_status text,
      error text,
      idempotency_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

    // Forward-only additive columns for existing deployments
    await client.query(`ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS article_id bigint`);
    await client.query(`ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS shopify_blog_id text`);
    await client.query(`ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS shopify_response_status text`);
    await client.query(`ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS idempotency_key text`);

    // Relax old check constraint if present and recreate with cancelled
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE publish_jobs DROP CONSTRAINT IF EXISTS publish_jobs_status_check;
      EXCEPTION WHEN undefined_object THEN NULL;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE publish_jobs ADD CONSTRAINT publish_jobs_status_check
          CHECK (status IN ('pending','running','published','failed','skipped','cancelled'));
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query("CREATE INDEX IF NOT EXISTS publish_jobs_due_idx ON publish_jobs(status, next_attempt_at, scheduled_for)");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS publish_jobs_idempotency_uidx ON publish_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL");

    await client.query(`CREATE TABLE IF NOT EXISTS articles (
      id bigserial PRIMARY KEY,
      status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('idea','generating','draft','ready','scheduled','publishing','published','failed','archived')),
      title text NOT NULL DEFAULT '',
      handle text NOT NULL DEFAULT '',
      excerpt text NOT NULL DEFAULT '',
      meta_title text NOT NULL DEFAULT '',
      meta_description text NOT NULL DEFAULT '',
      body_html text NOT NULL DEFAULT '',
      tags text[] NOT NULL DEFAULT '{}',
      author text NOT NULL DEFAULT '',
      featured_image_url text,
      featured_image_alt text,
      primary_keyword text NOT NULL DEFAULT '',
      secondary_keywords text[] NOT NULL DEFAULT '{}',
      topic_fingerprint text NOT NULL DEFAULT '',
      rationale text NOT NULL DEFAULT '',
      scheduled_for timestamptz,
      published_at timestamptz,
      shopify_blog_id text,
      shopify_article_id text,
      shopify_handle text,
      shopify_url text,
      shopify_response_status text,
      generation_error text,
      last_error text,
      idempotency_key text,
      source text NOT NULL DEFAULT 'manual',
      merchant_edited boolean NOT NULL DEFAULT false,
      merchant_edited_fields text[] NOT NULL DEFAULT '{}',
      generation_settings jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);

    await client.query("CREATE INDEX IF NOT EXISTS articles_status_idx ON articles(status, updated_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS articles_scheduled_idx ON articles(status, scheduled_for)");
    await client.query("CREATE INDEX IF NOT EXISTS articles_search_idx ON articles USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(excerpt,'')))");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS articles_idempotency_uidx ON articles(idempotency_key) WHERE idempotency_key IS NOT NULL");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS articles_shopify_article_uidx ON articles(shopify_article_id) WHERE shopify_article_id IS NOT NULL");

    await client.query(`
      DO $$ BEGIN
        ALTER TABLE publish_jobs
          ADD CONSTRAINT publish_jobs_article_id_fkey
          FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS audit_events (
      id bigserial PRIMARY KEY,
      actor text NOT NULL,
      action text NOT NULL,
      article_id bigint REFERENCES articles(id) ON DELETE SET NULL,
      job_id bigint REFERENCES publish_jobs(id) ON DELETE SET NULL,
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query("CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events(created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS audit_events_article_idx ON audit_events(article_id, created_at DESC)");

    await client.query(`CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      shop text,
      user_label text NOT NULL,
      auth_mode text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query("CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at)");

    await client.query(
      "INSERT INTO app_settings(singleton, value) VALUES (true, $1::jsonb) ON CONFLICT (singleton) DO NOTHING",
      [JSON.stringify(defaultSettings)]
    );

    // Backfill articles from legacy publish_jobs.article JSON (non-destructive)
    await client.query(`
      INSERT INTO articles (
        status, title, handle, excerpt, meta_title, meta_description, body_html, tags, author,
        primary_keyword, topic_fingerprint, rationale, shopify_article_id, shopify_url,
        source, published_at, created_at, updated_at
      )
      SELECT
        CASE WHEN pj.status = 'published' THEN 'published'
             WHEN pj.status = 'failed' THEN 'failed'
             WHEN pj.status = 'running' THEN 'generating'
             ELSE 'draft' END,
        COALESCE(pj.article->>'title', 'Untitled'),
        COALESCE(pj.article->>'handle', 'untitled'),
        COALESCE(pj.article->>'summary', ''),
        COALESCE(pj.article->>'title', ''),
        COALESCE(pj.article->>'metaDescription', ''),
        COALESCE(pj.article->>'bodyHtml', ''),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(pj.article->'tags')), '{}'),
        'Legends DTF Prints',
        COALESCE(pj.article->>'primaryKeyword', ''),
        COALESCE(pj.article->>'topicFingerprint', ''),
        COALESCE(pj.article->>'rationale', ''),
        pj.shopify_article_id,
        pj.shopify_url,
        'legacy_job',
        pj.completed_at,
        pj.created_at,
        pj.updated_at
      FROM publish_jobs pj
      WHERE pj.article IS NOT NULL
        AND pj.article_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM articles a
          WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
             OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title' AND a.created_at = pj.created_at)
        )
    `);

    await client.query(`
      UPDATE publish_jobs pj
      SET article_id = a.id
      FROM articles a
      WHERE pj.article_id IS NULL
        AND pj.article IS NOT NULL
        AND (
          (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
          OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title')
        )
    `);

    await client.query(
      `INSERT INTO schema_migrations(id) VALUES ('001_initial'), ('002_articles_audit'), ('003_sessions')
       ON CONFLICT DO NOTHING`
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getSettings(db: Db): Promise<Settings> {
  const { rows } = await db.query<{ value: Partial<Settings> }>("SELECT value FROM app_settings WHERE singleton=true");
  return mergeSettings(rows[0]?.value);
}

export async function saveSettings(db: Db, settings: Settings): Promise<void> {
  await db.query(
    "UPDATE app_settings SET value=$1::jsonb, updated_at=now() WHERE singleton=true",
    [JSON.stringify(settings)]
  );
}

export async function recordAudit(db: Db, event: AuditEvent): Promise<void> {
  await db.query(
    `INSERT INTO audit_events(actor, action, article_id, job_id, detail)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [event.actor, event.action, event.articleId ?? null, event.jobId ?? null, JSON.stringify(event.detail ?? {})]
  );
}

export async function listAudit(db: Db, limit = 100) {
  const { rows } = await db.query(
    "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1",
    [limit]
  );
  return rows;
}

export async function insertSlot(db: Db, slotKey: string, scheduledFor: Date): Promise<void> {
  await db.query(
    "INSERT INTO publish_jobs(slot_key, scheduled_for) VALUES($1,$2) ON CONFLICT(slot_key) DO NOTHING",
    [slotKey, scheduledFor]
  );
}

export async function insertManualJob(db: Db, articleId?: number): Promise<number> {
  const key = `manual:${crypto.randomUUID()}`;
  const { rows } = await db.query<{ id: string }>(
    "INSERT INTO publish_jobs(slot_key, scheduled_for, article_id, idempotency_key) VALUES($1,now(),$2,$3) RETURNING id",
    [key, articleId ?? null, key]
  );
  return Number(rows[0]!.id);
}

export async function claimJob(db: Db, retryLimit = 4): Promise<Job | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<Job>(`
      SELECT id, slot_key, scheduled_for, status, attempts, article_id FROM publish_jobs
      WHERE status IN ('pending','failed') AND next_attempt_at <= now() AND scheduled_for <= now()
        AND attempts < $1
      ORDER BY scheduled_for ASC FOR UPDATE SKIP LOCKED LIMIT 1
    `, [retryLimit]);
    const job = rows[0];
    if (!job) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(
      "UPDATE publish_jobs SET status='running', attempts=attempts+1, started_at=now(), updated_at=now() WHERE id=$1",
      [job.id]
    );
    if (job.article_id) {
      await client.query(
        "UPDATE articles SET status='publishing', updated_at=now() WHERE id=$1 AND status IN ('ready','scheduled','failed','draft')",
        [job.article_id]
      );
    }
    await client.query("COMMIT");
    return job;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recentTopicContext(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ title: string; topic_fingerprint: string }>(
    `SELECT title, topic_fingerprint FROM articles
     WHERE topic_fingerprint <> '' AND status NOT IN ('archived','idea')
     ORDER BY created_at DESC LIMIT 90`
  );
  if (rows.length) return rows.map(r => `${r.title} [${r.topic_fingerprint}]`);

  const legacy = await db.query<{ article: GeneratedArticle }>(
    "SELECT article FROM publish_jobs WHERE article IS NOT NULL ORDER BY created_at DESC LIMIT 90"
  );
  return legacy.rows.map(row => `${row.article.title} [${row.article.topicFingerprint}]`);
}

export async function finishJob(
  db: Db,
  id: number,
  article: GeneratedArticle,
  shopifyId: string,
  url: string,
  extras?: { blogId?: string; responseStatus?: string; articleId?: number; handle?: string }
): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE publish_jobs SET status='published', article=$2::jsonb, shopify_article_id=$3, shopify_url=$4,
       shopify_blog_id=COALESCE($5, shopify_blog_id), shopify_response_status=$6,
       completed_at=now(), updated_at=now(), error=NULL WHERE id=$1`,
      [id, JSON.stringify(article), shopifyId, url, extras?.blogId ?? null, extras?.responseStatus ?? "ok"]
    );

    let articleId = extras?.articleId;
    if (!articleId) {
      const { rows } = await client.query<{ article_id: string | null }>("SELECT article_id FROM publish_jobs WHERE id=$1", [id]);
      articleId = rows[0]?.article_id ? Number(rows[0].article_id) : undefined;
    }

    if (articleId) {
      await client.query(
        `UPDATE articles SET status='published', shopify_article_id=$2, shopify_url=$3, shopify_handle=$4,
         shopify_blog_id=COALESCE($5, shopify_blog_id), shopify_response_status=$6,
         published_at=now(), last_error=NULL, updated_at=now(),
         title=$7, handle=$8, excerpt=$9, meta_description=$10, body_html=$11, tags=$12,
         primary_keyword=$13, topic_fingerprint=$14, rationale=$15
         WHERE id=$1`,
        [
          articleId, shopifyId, url, extras?.handle ?? article.handle, extras?.blogId ?? null,
          extras?.responseStatus ?? "ok", article.title, article.handle, article.summary,
          article.metaDescription, article.bodyHtml, article.tags, article.primaryKeyword,
          article.topicFingerprint, article.rationale
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function failJob(db: Db, id: number, article: GeneratedArticle | null, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE publish_jobs SET status='failed', article=COALESCE($2::jsonb,article), error=$3,
       next_attempt_at=now() + (interval '15 minutes' * power(2, GREATEST(attempts-1,0))), updated_at=now() WHERE id=$1`,
      [id, article ? JSON.stringify(article) : null, message.slice(0, 4000)]
    );
    const { rows } = await client.query<{ article_id: string | null }>("SELECT article_id FROM publish_jobs WHERE id=$1", [id]);
    if (rows[0]?.article_id) {
      await client.query(
        `UPDATE articles SET status='failed', last_error=$2, generation_error=COALESCE(generation_error, $2), updated_at=now() WHERE id=$1`,
        [Number(rows[0].article_id), message.slice(0, 4000)]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listJobs(db: Db, limit = 50) {
  const { rows } = await db.query("SELECT * FROM publish_jobs ORDER BY created_at DESC LIMIT $1", [limit]);
  return rows;
}

export async function createArticle(
  db: Db,
  content: Partial<ArticleContent>,
  opts?: { status?: ArticleStatus; source?: string; generationSettings?: Record<string, unknown>; scheduledFor?: Date | null }
): Promise<ArticleRecord> {
  const { rows } = await db.query(
    `INSERT INTO articles (
      status, title, handle, excerpt, meta_title, meta_description, body_html, tags, author,
      featured_image_url, featured_image_alt, primary_keyword, secondary_keywords, topic_fingerprint,
      rationale, source, generation_settings, scheduled_for
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18
    ) RETURNING *`,
    [
      opts?.status ?? "draft",
      content.title ?? "",
      content.handle ?? "",
      content.excerpt ?? "",
      content.metaTitle ?? content.title ?? "",
      content.metaDescription ?? "",
      content.bodyHtml ?? "",
      content.tags ?? [],
      content.author ?? "",
      content.featuredImageUrl ?? null,
      content.featuredImageAlt ?? null,
      content.primaryKeyword ?? "",
      content.secondaryKeywords ?? [],
      content.topicFingerprint ?? "",
      content.rationale ?? "",
      opts?.source ?? "manual",
      JSON.stringify(opts?.generationSettings ?? null),
      opts?.scheduledFor ?? null
    ]
  );
  return mapArticle(rows[0] as Record<string, unknown>);
}

export async function getArticle(db: Db, id: number): Promise<ArticleRecord | null> {
  const { rows } = await db.query("SELECT * FROM articles WHERE id=$1", [id]);
  return rows[0] ? mapArticle(rows[0] as Record<string, unknown>) : null;
}

export async function updateArticle(
  db: Db,
  id: number,
  patch: Partial<ArticleContent> & {
    status?: ArticleStatus;
    scheduledFor?: Date | null;
    lastError?: string | null;
    generationError?: string | null;
    merchantEdited?: boolean;
    merchantEditedFields?: string[];
    generationSettings?: Record<string, unknown> | null;
    shopifyBlogId?: string | null;
    shopifyArticleId?: string | null;
    shopifyHandle?: string | null;
    shopifyUrl?: string | null;
    shopifyResponseStatus?: string | null;
    publishedAt?: Date | null;
    idempotencyKey?: string | null;
  }
): Promise<ArticleRecord | null> {
  const current = await getArticle(db, id);
  if (!current) return null;

  const next = {
    status: patch.status ?? current.status,
    title: patch.title ?? current.title,
    handle: patch.handle ?? current.handle,
    excerpt: patch.excerpt ?? current.excerpt,
    meta_title: patch.metaTitle ?? current.metaTitle,
    meta_description: patch.metaDescription ?? current.metaDescription,
    body_html: patch.bodyHtml ?? current.bodyHtml,
    tags: patch.tags ?? current.tags,
    author: patch.author ?? current.author,
    featured_image_url: patch.featuredImageUrl !== undefined ? patch.featuredImageUrl : current.featuredImageUrl,
    featured_image_alt: patch.featuredImageAlt !== undefined ? patch.featuredImageAlt : current.featuredImageAlt,
    primary_keyword: patch.primaryKeyword ?? current.primaryKeyword,
    secondary_keywords: patch.secondaryKeywords ?? current.secondaryKeywords,
    topic_fingerprint: patch.topicFingerprint ?? current.topicFingerprint,
    rationale: patch.rationale ?? current.rationale,
    scheduled_for: patch.scheduledFor !== undefined ? patch.scheduledFor : current.scheduledFor,
    last_error: patch.lastError !== undefined ? patch.lastError : current.lastError,
    generation_error: patch.generationError !== undefined ? patch.generationError : current.generationError,
    merchant_edited: patch.merchantEdited ?? current.merchantEdited,
    merchant_edited_fields: patch.merchantEditedFields ?? current.merchantEditedFields,
    generation_settings: patch.generationSettings !== undefined ? patch.generationSettings : current.generationSettings,
    shopify_blog_id: patch.shopifyBlogId !== undefined ? patch.shopifyBlogId : current.shopifyBlogId,
    shopify_article_id: patch.shopifyArticleId !== undefined ? patch.shopifyArticleId : current.shopifyArticleId,
    shopify_handle: patch.shopifyHandle !== undefined ? patch.shopifyHandle : current.shopifyHandle,
    shopify_url: patch.shopifyUrl !== undefined ? patch.shopifyUrl : current.shopifyUrl,
    shopify_response_status: patch.shopifyResponseStatus !== undefined ? patch.shopifyResponseStatus : current.shopifyResponseStatus,
    published_at: patch.publishedAt !== undefined ? patch.publishedAt : current.publishedAt,
    idempotency_key: patch.idempotencyKey !== undefined ? patch.idempotencyKey : current.idempotencyKey
  };

  const { rows } = await db.query(
    `UPDATE articles SET
      status=$2, title=$3, handle=$4, excerpt=$5, meta_title=$6, meta_description=$7, body_html=$8,
      tags=$9, author=$10, featured_image_url=$11, featured_image_alt=$12, primary_keyword=$13,
      secondary_keywords=$14, topic_fingerprint=$15, rationale=$16, scheduled_for=$17, last_error=$18,
      generation_error=$19, merchant_edited=$20, merchant_edited_fields=$21, generation_settings=$22::jsonb,
      shopify_blog_id=$23, shopify_article_id=$24, shopify_handle=$25, shopify_url=$26,
      shopify_response_status=$27, published_at=$28, idempotency_key=$29, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [
      id, next.status, next.title, next.handle, next.excerpt, next.meta_title, next.meta_description,
      next.body_html, next.tags, next.author, next.featured_image_url, next.featured_image_alt,
      next.primary_keyword, next.secondary_keywords, next.topic_fingerprint, next.rationale,
      next.scheduled_for, next.last_error, next.generation_error, next.merchant_edited,
      next.merchant_edited_fields, JSON.stringify(next.generation_settings), next.shopify_blog_id,
      next.shopify_article_id, next.shopify_handle, next.shopify_url, next.shopify_response_status,
      next.published_at, next.idempotency_key
    ]
  );
  return mapArticle(rows[0] as Record<string, unknown>);
}

export async function duplicateArticle(db: Db, id: number): Promise<ArticleRecord | null> {
  const article = await getArticle(db, id);
  if (!article) return null;
  return createArticle(db, {
    ...article,
    title: `${article.title} (Copy)`,
    handle: `${article.handle}-copy-${Date.now().toString(36)}`,
    featuredImageUrl: article.featuredImageUrl,
    featuredImageAlt: article.featuredImageAlt
  }, { status: "draft", source: "duplicate" });
}

export interface ArticleListQuery {
  q?: string;
  status?: ArticleStatus | "all";
  from?: string;
  to?: string;
  sort?: "updated" | "created" | "title" | "scheduled";
  page?: number;
  pageSize?: number;
}

export async function listArticles(db: Db, query: ArticleListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.status && query.status !== "all") {
    params.push(query.status);
    where.push(`status = $${params.length}`);
  }
  if (query.q) {
    params.push(`%${query.q}%`);
    where.push(`(title ILIKE $${params.length} OR excerpt ILIKE $${params.length} OR handle ILIKE $${params.length})`);
  }
  if (query.from) {
    params.push(query.from);
    where.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (query.to) {
    params.push(query.to);
    where.push(`created_at <= $${params.length}::timestamptz`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const sortMap = {
    updated: "updated_at DESC",
    created: "created_at DESC",
    title: "title ASC",
    scheduled: "scheduled_for ASC NULLS LAST"
  } as const;
  const order = sortMap[query.sort ?? "updated"];

  const countRes = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM articles ${whereSql}`, params);
  params.push(pageSize, offset);
  const { rows } = await db.query(
    `SELECT * FROM articles ${whereSql} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    items: rows.map(r => mapArticle(r as Record<string, unknown>)),
    total: Number(countRes.rows[0]?.count ?? 0),
    page,
    pageSize
  };
}

export async function getOverviewStats(db: Db): Promise<OverviewStats> {
  const counts = await db.query<{ status: string; count: string }>(
    "SELECT status, count(*)::text AS count FROM articles GROUP BY status"
  );
  const map = Object.fromEntries(counts.rows.map(r => [r.status, Number(r.count)]));
  const next = await db.query(
    `SELECT * FROM articles WHERE status='scheduled' AND scheduled_for IS NOT NULL
     ORDER BY scheduled_for ASC LIMIT 1`
  );
  const successes = await db.query(
    "SELECT * FROM articles WHERE status='published' ORDER BY published_at DESC NULLS LAST LIMIT 5"
  );
  const failures = await db.query(
    "SELECT * FROM articles WHERE status='failed' ORDER BY updated_at DESC LIMIT 5"
  );

  return {
    draftCount: (map.draft ?? 0) + (map.idea ?? 0) + (map.ready ?? 0),
    readyCount: map.ready ?? 0,
    scheduledCount: map.scheduled ?? 0,
    publishedCount: map.published ?? 0,
    failedCount: map.failed ?? 0,
    nextScheduled: next.rows[0] ? mapArticle(next.rows[0] as Record<string, unknown>) : null,
    recentSuccesses: successes.rows.map(r => mapArticle(r as Record<string, unknown>)),
    recentFailures: failures.rows.map(r => mapArticle(r as Record<string, unknown>))
  };
}

export async function createArticleFromGenerated(
  db: Db,
  generated: GeneratedArticle,
  opts: { status: ArticleStatus; source: string; author: string; generationError?: string | null; generationSettings?: Record<string, unknown> }
): Promise<ArticleRecord> {
  const content = fromGenerated(generated, opts.author);
  return createArticle(db, content, {
    status: opts.status,
    source: opts.source,
    generationSettings: opts.generationSettings
  }).then(async article => {
    if (opts.generationError) {
      return (await updateArticle(db, article.id, { generationError: opts.generationError, lastError: opts.generationError }))!;
    }
    return article;
  });
}

export async function cancelScheduledArticle(db: Db, id: number): Promise<ArticleRecord | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `UPDATE articles SET status='ready', scheduled_for=NULL, updated_at=now()
       WHERE id=$1 AND status='scheduled' RETURNING *`,
      [id]
    );
    if (!rows[0]) {
      await client.query("COMMIT");
      return null;
    }
    await client.query(
      `UPDATE publish_jobs SET status='cancelled', updated_at=now()
       WHERE article_id=$1 AND status IN ('pending','failed')`,
      [id]
    );
    await client.query("COMMIT");
    return mapArticle(rows[0] as Record<string, unknown>);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function scheduleArticleJob(db: Db, articleId: number, scheduledFor: Date, idempotencyKey: string): Promise<number> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE articles SET status='scheduled', scheduled_for=$2, updated_at=now() WHERE id=$1`,
      [articleId, scheduledFor]
    );
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO publish_jobs(slot_key, scheduled_for, article_id, idempotency_key, status)
       VALUES ($1,$2,$3,$4,'pending')
       ON CONFLICT (slot_key) DO UPDATE SET scheduled_for=EXCLUDED.scheduled_for, status='pending', updated_at=now()
       RETURNING id`,
      [`article:${articleId}:${idempotencyKey}`, scheduledFor, articleId, idempotencyKey]
    );
    await client.query("COMMIT");
    return Number(rows[0]!.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
