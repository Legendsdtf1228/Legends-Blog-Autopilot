-- M5 production schema inspection (READ-ONLY)
-- Candidate: 465661e48837e349a20bcfc9f5d9c5c19eef312a (branch-native migrate())
-- Purpose: authorized operator inspection before any production migration.
--
-- DO NOT run migrations with this file.
-- DO NOT use this session for writes.
-- Connect with a role that can SELECT catalogs + application schema metadata.
-- Prefer a credential that cannot INSERT/UPDATE/DELETE/DDL if available.

\set ON_ERROR_STOP on
\timing off

BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
SET LOCAL statement_timeout = '15s';

-- ---------------------------------------------------------------------------
-- 0) Session guards
-- ---------------------------------------------------------------------------
SELECT
  current_setting('transaction_read_only') AS transaction_read_only,
  current_setting('transaction_isolation') AS transaction_isolation,
  current_setting('statement_timeout') AS statement_timeout,
  current_database() AS database_name,
  current_user AS db_user,
  inet_server_addr() AS server_addr,
  inet_server_port() AS server_port,
  now() AS inspected_at;

-- Expect: transaction_read_only = on

-- ---------------------------------------------------------------------------
-- 1) Installed migration IDs
-- ---------------------------------------------------------------------------
SELECT id AS installed_migration_id, applied_at
FROM schema_migrations
ORDER BY id;

-- ---------------------------------------------------------------------------
-- 2) Missing / unexpected vs candidate expected set (001–011)
-- ---------------------------------------------------------------------------
WITH expected(id) AS (
  VALUES
    ('001_initial'),
    ('002_articles_audit'),
    ('003_sessions'),
    ('004_topic_research'),
    ('005_research_cycle_runs'),
    ('006_research_cycle_atomic_claim'),
    ('007_rollout_draft_counted_unique'),
    ('008_source_evidence_reader_tasks'),
    ('009_evidence_approval_authority'),
    ('010_opportunity_clusters'),
    ('011_knowledge_registry')
)
SELECT e.id AS missing_migration_id
FROM expected e
LEFT JOIN schema_migrations s ON s.id = e.id
WHERE s.id IS NULL
ORDER BY e.id;

WITH expected(id) AS (
  VALUES
    ('001_initial'),
    ('002_articles_audit'),
    ('003_sessions'),
    ('004_topic_research'),
    ('005_research_cycle_runs'),
    ('006_research_cycle_atomic_claim'),
    ('007_rollout_draft_counted_unique'),
    ('008_source_evidence_reader_tasks'),
    ('009_evidence_approval_authority'),
    ('010_opportunity_clusters'),
    ('011_knowledge_registry')
)
SELECT s.id AS unexpected_migration_id
FROM schema_migrations s
LEFT JOIN expected e ON e.id = s.id
WHERE e.id IS NULL
ORDER BY s.id;

-- ---------------------------------------------------------------------------
-- 3) Migration 007 — duplicate rollout_draft_counted aggregates ONLY
--    Detection logic matches migrate(): group by article_id where
--      action = 'rollout_draft_counted' AND article_id IS NOT NULL
--    DELETE keeps the lowest audit id per group; removes (n - 1) rows.
--    This inspection never returns article_id values or other row identifiers.
--    Unique index target (name only; not row data):
--      audit_events_rollout_draft_counted_article_uidx
-- ---------------------------------------------------------------------------
WITH rollout_dup_groups AS (
  SELECT COUNT(*) AS group_size
  FROM audit_events
  WHERE action = 'rollout_draft_counted'
    AND article_id IS NOT NULL
  GROUP BY article_id
  HAVING COUNT(*) > 1
)
SELECT
  (SELECT COUNT(*)::bigint FROM rollout_dup_groups) AS duplicate_group_count,
  COALESCE((SELECT SUM(group_size - 1) FROM rollout_dup_groups), 0)::bigint
    AS rows_007_delete_would_remove,
  COALESCE((SELECT MAX(group_size) FROM rollout_dup_groups), 0)::bigint
    AS max_duplicate_group_size,
  EXISTS (SELECT 1 FROM rollout_dup_groups) AS duplicates_exist,
  (
    SELECT COUNT(*)::bigint
    FROM audit_events
    WHERE action = 'rollout_draft_counted' AND article_id IS NOT NULL
  ) AS rollout_counted_rows_with_article,
  (
    SELECT COUNT(*)::bigint
    FROM audit_events
    WHERE action = 'rollout_draft_counted' AND article_id IS NULL
  ) AS rollout_counted_rows_null_article;

-- ---------------------------------------------------------------------------
-- 4) Legacy publish_jobs → articles backfill impact
--    Predicates copied from branch-native/src/db.ts migrate() (candidate).
--
--    INSERT eligibility (would create an articles row):
--      pj.article IS NOT NULL
--      AND pj.article_id IS NULL
--      AND NOT EXISTS (
--            shopify match when pj.shopify_article_id IS NOT NULL
--         OR (a.handle = pj.article->>'handle'
--             AND a.title = pj.article->>'title'
--             AND a.created_at = pj.created_at)
--          )
--
--    NULL SEMANTICS (critical correction):
--      JSON ->> yields NULL when the key is missing or JSON null.
--      SQL equality (=) with NULL is UNKNOWN, so the handle/title(/created_at)
--      match branch NEVER succeeds when handle or title from JSON is NULL.
--      Do NOT rewrite with COALESCE(..., 'untitled'/'Untitled') for matching —
--      migrate() only uses COALESCE on the INSERTED column values, not in NOT EXISTS.
--
--    UPDATE eligibility (would set publish_jobs.article_id):
--      pj.article_id IS NULL
--      AND pj.article IS NOT NULL
--      AND (
--            shopify match when pj.shopify_article_id IS NOT NULL
--         OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title')
--          )
--      Note: UPDATE match does NOT require created_at equality.
-- ---------------------------------------------------------------------------

-- 4a) Candidate pool and null-json breakdown (aggregate only)
SELECT
  COUNT(*) FILTER (
    WHERE article IS NOT NULL AND article_id IS NULL
  ) AS jobs_with_article_json_and_null_article_id,
  COUNT(*) FILTER (
    WHERE article IS NOT NULL
      AND article_id IS NULL
      AND (article->>'handle') IS NULL
  ) AS candidates_null_json_handle,
  COUNT(*) FILTER (
    WHERE article IS NOT NULL
      AND article_id IS NULL
      AND (article->>'title') IS NULL
  ) AS candidates_null_json_title,
  COUNT(*) FILTER (
    WHERE article IS NOT NULL
      AND article_id IS NULL
      AND ((article->>'handle') IS NULL OR (article->>'title') IS NULL)
  ) AS candidates_null_handle_or_title_cannot_ht_match,
  COUNT(*) FILTER (
    WHERE article IS NOT NULL
      AND article_id IS NULL
      AND shopify_article_id IS NOT NULL
  ) AS candidates_with_shopify_article_id
FROM publish_jobs;

-- 4b) Exact INSERT impact (mirrors migrate NOT EXISTS)
SELECT COUNT(*)::bigint AS jobs_insert_backfill_would_create
FROM publish_jobs pj
WHERE pj.article IS NOT NULL
  AND pj.article_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (
            a.handle = pj.article->>'handle'
        AND a.title = pj.article->>'title'
        AND a.created_at = pj.created_at
       )
  );

-- 4c) Why INSERT would be skipped (overlap possible if both match paths true)
SELECT COUNT(*)::bigint AS jobs_insert_skipped_due_to_existing_match
FROM publish_jobs pj
WHERE pj.article IS NOT NULL
  AND pj.article_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (
            a.handle = pj.article->>'handle'
        AND a.title = pj.article->>'title'
        AND a.created_at = pj.created_at
       )
  );

-- 4d) Exact UPDATE impact (mirrors migrate UPDATE ... FROM articles)
SELECT COUNT(*)::bigint AS jobs_update_would_set_article_id
FROM publish_jobs pj
WHERE pj.article_id IS NULL
  AND pj.article IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (
            a.handle = pj.article->>'handle'
        AND a.title = pj.article->>'title'
       )
  );

-- 4e) Null handle/title edge: INSERT still possible when no shopify match
--     (HT path cannot suppress INSERT because NULL = text is unknown)
SELECT COUNT(*)::bigint AS null_ht_candidates_that_would_still_insert
FROM publish_jobs pj
WHERE pj.article IS NOT NULL
  AND pj.article_id IS NULL
  AND ((pj.article->>'handle') IS NULL OR (pj.article->>'title') IS NULL)
  AND NOT EXISTS (
    SELECT 1
    FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (
            a.handle = pj.article->>'handle'
        AND a.title = pj.article->>'title'
        AND a.created_at = pj.created_at
       )
  );

-- ---------------------------------------------------------------------------
-- 5) Relevant schema metadata for 007–011 + owner_console_preferences
-- ---------------------------------------------------------------------------
SELECT c.relname AS table_name,
       CASE c.relkind WHEN 'r' THEN 'table' WHEN 'i' THEN 'index' ELSE c.relkind::text END AS kind
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'i')
  AND (
    c.relname IN (
      'schema_migrations',
      'audit_events',
      'articles',
      'publish_jobs',
      'owner_console_preferences',
      'source_evidence',
      'reader_tasks',
      'source_evidence_reader_tasks',
      'reader_task_rejections',
      'source_ingestion_runs',
      'evidence_approval_audits',
      'opportunity_clusters',
      'opportunity_cluster_members',
      'opportunity_cluster_evidence',
      'opportunity_cluster_audits',
      'reader_task_cluster_history',
      'opportunity_cluster_review_candidates',
      'clustering_runs',
      'merchant_knowledge',
      'knowledge_entries',
      'knowledge_entry_revisions',
      'knowledge_approvals',
      'knowledge_source_links',
      'knowledge_claims',
      'cluster_evidence_budgets',
      'cluster_claim_requirements',
      'merchant_interview_packets',
      'merchant_interview_questions',
      'merchant_interview_answers',
      'knowledge_audit_events',
      'knowledge_evaluation_runs'
    )
    OR c.relname LIKE '%rollout_draft_counted%'
    OR c.relname LIKE 'source_evidence%'
    OR c.relname LIKE 'reader_task%'
    OR c.relname LIKE 'opportunity_cluster%'
    OR c.relname LIKE 'knowledge_%'
    OR c.relname LIKE 'merchant_interview%'
    OR c.relname LIKE 'cluster_%'
  )
ORDER BY kind, table_name;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'source_evidence'
  AND column_name IN (
    'approval_state',
    'public_usage_allowed',
    'content_hash',
    'material_hash',
    'approved_by',
    'approved_at',
    'revoked_at',
    'revoked_by',
    'revoke_reason',
    'usage_scope',
    'approval_method'
  )
ORDER BY column_name;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND (
    indexname IN (
      'audit_events_rollout_draft_counted_article_uidx',
      'reader_tasks_fingerprint_accepted_uidx',
      'source_evidence_approval_state_idx',
      'knowledge_entries_content_hash_uidx',
      'articles_shopify_article_uidx',
      'publish_jobs_idempotency_uidx'
    )
    OR indexdef ILIKE '%rollout_draft_counted%'
  )
ORDER BY indexname;

SELECT conrelid::regclass::text AS table_name,
       conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN (
    'audit_events',
    'articles',
    'publish_jobs',
    'source_evidence',
    'reader_tasks',
    'opportunity_clusters',
    'knowledge_entries',
    'schema_migrations'
  )
ORDER BY table_name, conname;

-- ---------------------------------------------------------------------------
-- End read-only inspection — discard transaction
-- ---------------------------------------------------------------------------
ROLLBACK;
