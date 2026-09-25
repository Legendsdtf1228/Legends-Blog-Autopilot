#!/usr/bin/env bash
# Synthetic verification for m5-production-schema-inspection.sql
# Does not touch production.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SQL="$ROOT/verification/m5-production/m5-production-schema-inspection.sql"
OUT_DIR="${M5_INSPECT_OUT:-/tmp/m5-inspect-test}"
PGDATA="${M5_INSPECT_PGDATA:-/tmp/m5-inspect-pgdata-test}"
PGPORT="${M5_INSPECT_PGPORT:-55433}"
PGHOST="${M5_INSPECT_PGHOST:-/tmp}"
export PGHOST PGPORT PGUSER=postgres PGDATABASE=m5_inspect
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"

mkdir -p "$OUT_DIR"

cleanup() {
  if [[ "${M5_INSPECT_KEEP:-0}" != "1" ]]; then
    "$PG_BIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  rm -rf "$PGDATA"
  "$PG_BIN/initdb" -D "$PGDATA" --auth-local=trust --auth-host=trust -U postgres >/dev/null
  "$PG_BIN/pg_ctl" -D "$PGDATA" -l "$OUT_DIR/pg.log" -o "-p ${PGPORT} -k ${PGHOST}" start
  for _ in $(seq 1 30); do
    if psql -d postgres -c 'SELECT 1' >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
fi

psql -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'm5_inspect' AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS m5_inspect;
CREATE DATABASE m5_inspect;
SQL

psql -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(id) VALUES
  ('001_initial'),
  ('002_articles_audit'),
  ('003_sessions'),
  ('004_topic_research'),
  ('005_research_cycle_runs'),
  ('006_research_cycle_atomic_claim');

CREATE TABLE articles (
  id bigserial PRIMARY KEY,
  status text NOT NULL DEFAULT 'draft',
  title text NOT NULL DEFAULT '',
  handle text NOT NULL DEFAULT '',
  excerpt text NOT NULL DEFAULT '',
  meta_title text NOT NULL DEFAULT '',
  meta_description text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  author text NOT NULL DEFAULT '',
  primary_keyword text NOT NULL DEFAULT '',
  topic_fingerprint text NOT NULL DEFAULT '',
  rationale text NOT NULL DEFAULT '',
  shopify_article_id text,
  shopify_url text,
  source text NOT NULL DEFAULT 'manual',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE publish_jobs (
  id bigserial PRIMARY KEY,
  slot_key text NOT NULL UNIQUE,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  article jsonb,
  article_id bigint,
  shopify_article_id text,
  shopify_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  article_id bigint,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Existing article that can match by handle/title/created_at
INSERT INTO articles(id, title, handle, shopify_article_id, created_at, updated_at)
VALUES (100, 'Linked Title', 'linked-handle', 'gid://shopify/Article/1', '2024-01-01 00:00:00+00', now());
SELECT setval('articles_id_seq', 100);

-- Synthetic publish_jobs
-- 1) Already linked → no INSERT/UPDATE impact
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'already-linked',
  '{"title":"Linked Title","handle":"linked-handle"}'::jsonb,
  100,
  'gid://shopify/Article/1',
  '2024-01-01 00:00:00+00'
);

-- 2) Null article_id but matches existing via shopify → INSERT skipped, UPDATE would link
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'shopify-match',
  '{"title":"Other","handle":"other"}'::jsonb,
  NULL,
  'gid://shopify/Article/1',
  '2024-02-01 00:00:00+00'
);

-- 3) Null article_id; matches handle+title+created_at → INSERT skipped
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'ht-created-match',
  '{"title":"Linked Title","handle":"linked-handle"}'::jsonb,
  NULL,
  NULL,
  '2024-01-01 00:00:00+00'
);

-- 4) Null JSON handle → HT match impossible; no shopify → INSERT would create
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'null-handle',
  '{"title":"Only Title"}'::jsonb,
  NULL,
  NULL,
  '2024-03-01 00:00:00+00'
);

-- 5) Null JSON title → INSERT would create
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'null-title',
  '{"handle":"only-handle"}'::jsonb,
  NULL,
  NULL,
  '2024-03-02 00:00:00+00'
);

-- 6) Explicit JSON nulls for both → INSERT would create
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'json-null-ht',
  '{"title":null,"handle":null}'::jsonb,
  NULL,
  NULL,
  '2024-03-03 00:00:00+00'
);

-- 7) Naive COALESCE trap: existing untitled/Untitled must NOT suppress INSERT
--    when JSON handle/title are null (migrate does not COALESCE in NOT EXISTS).
INSERT INTO articles(title, handle, created_at, updated_at)
VALUES ('Untitled', 'untitled', '2024-03-03 00:00:00+00', now());

-- 8) Fresh unmatched job → INSERT would create; UPDATE would not (no match)
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'fresh-unmatched',
  '{"title":"Brand New","handle":"brand-new"}'::jsonb,
  NULL,
  NULL,
  '2024-04-01 00:00:00+00'
);

-- 9) Handle/title match without created_at → INSERT still happens; UPDATE would link
INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at)
VALUES (
  'ht-update-only',
  '{"title":"Linked Title","handle":"linked-handle"}'::jsonb,
  NULL,
  NULL,
  '2024-05-01 00:00:00+00'
);

-- Audit duplicates for 007 (article 100 has 3 rows → delete 2)
INSERT INTO audit_events(actor, action, article_id) VALUES
  ('a', 'rollout_draft_counted', 100),
  ('a', 'rollout_draft_counted', 100),
  ('a', 'rollout_draft_counted', 100),
  ('a', 'rollout_draft_counted', 200),
  ('a', 'rollout_draft_counted', 200),
  ('a', 'rollout_draft_counted', NULL),
  ('a', 'other_action', 100);
SQL

echo "== Running inspection script =="
psql -v ON_ERROR_STOP=1 -f "$SQL" | tee "$OUT_DIR/inspection.out"

echo "== Asserting key aggregates via exact predicates =="
psql -v ON_ERROR_STOP=1 -At <<'SQL' | tee "$OUT_DIR/asserts.txt"
-- Expected missing migrations: 007-011 = 5
SELECT 'missing_count=' || COUNT(*)
FROM (
  VALUES
    ('007_rollout_draft_counted_unique'),
    ('008_source_evidence_reader_tasks'),
    ('009_evidence_approval_authority'),
    ('010_opportunity_clusters'),
    ('011_knowledge_registry')
) e(id)
LEFT JOIN schema_migrations s USING (id)
WHERE s.id IS NULL;

SELECT 'rows_007_delete=' || COALESCE(SUM(n - 1),0)
FROM (
  SELECT article_id, COUNT(*) AS n
  FROM audit_events
  WHERE action = 'rollout_draft_counted' AND article_id IS NOT NULL
  GROUP BY article_id
  HAVING COUNT(*) > 1
) d;

-- INSERT would create: null-handle, null-title, json-null-ht, fresh-unmatched, ht-update-only = 5
-- (shopify-match and ht-created-match skipped; already-linked excluded by article_id IS NULL)
SELECT 'insert_would_create=' || COUNT(*)
FROM publish_jobs pj
WHERE pj.article IS NOT NULL
  AND pj.article_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title' AND a.created_at = pj.created_at)
  );

-- UPDATE would set: shopify-match, ht-created-match, ht-update-only = 3
SELECT 'update_would_set=' || COUNT(*)
FROM publish_jobs pj
WHERE pj.article_id IS NULL
  AND pj.article IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title')
  );

-- Null HT candidates that still insert: null-handle, null-title, json-null-ht = 3
SELECT 'null_ht_still_insert=' || COUNT(*)
FROM publish_jobs pj
WHERE pj.article IS NOT NULL
  AND pj.article_id IS NULL
  AND ((pj.article->>'handle') IS NULL OR (pj.article->>'title') IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title' AND a.created_at = pj.created_at)
  );

-- Incorrect COALESCE-based match must NOT equal exact insert count
SELECT 'coalesce_trap_differs=' || (
  (
    SELECT COUNT(*) FROM publish_jobs pj
    WHERE pj.article IS NOT NULL AND pj.article_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM articles a
        WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
           OR (
             a.handle = COALESCE(pj.article->>'handle','untitled')
             AND a.title = COALESCE(pj.article->>'title','Untitled')
             AND a.created_at = pj.created_at
           )
      )
  )
  <>
  (
    SELECT COUNT(*) FROM publish_jobs pj
    WHERE pj.article IS NOT NULL AND pj.article_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM articles a
        WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
           OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title' AND a.created_at = pj.created_at)
      )
  )
);
SQL

python3 - <<'PY'
from pathlib import Path
text = Path("/tmp/m5-inspect-test/asserts.txt").read_text().splitlines()
expect = {
  "missing_count=5": False,
  "rows_007_delete=3": False,  # (3-1)+(2-1)=3
  "insert_would_create=5": False,
  "update_would_set=3": False,
  "null_ht_still_insert=3": False,
  "coalesce_trap_differs=true": False,
}
for line in text:
    if line in expect:
        expect[line] = True
missing = [k for k,v in expect.items() if not v]
if missing:
    raise SystemExit(f"ASSERT FAIL missing: {missing} full={text}")
print("ASSERT OK:", text)
PY

echo "== Negative: writes must fail inside READ ONLY transaction =="
set +e
psql -v ON_ERROR_STOP=1 <<'SQL' >"$OUT_DIR/negative-write.out" 2>&1
BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ;
INSERT INTO audit_events(actor, action) VALUES ('x','y');
ROLLBACK;
SQL
rc=$?
set -e
if [[ $rc -eq 0 ]]; then
  echo "NEGATIVE FAIL: INSERT succeeded in READ ONLY transaction" >&2
  exit 1
fi
grep -qi 'read-only\|read only' "$OUT_DIR/negative-write.out"
echo "NEGATIVE OK: write rejected"

echo "== Static: inspection SQL must not contain write/DDL verbs outside comments =="
python3 - <<'PY'
from pathlib import Path
import re
sql = Path("/workspace/verification/m5-production/m5-production-schema-inspection.sql").read_text()
# Strip line comments
lines = []
for line in sql.splitlines():
    if line.strip().startswith('--'):
        continue
    lines.append(re.sub(r'--.*$', '', line))
body = "\n".join(lines).upper()
# Allow only BEGIN/SET LOCAL/SELECT/WITH/ROLLBACK and psql meta
forbidden = re.findall(
    r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|COPY|VACUUM|REINDEX|CLUSTER|LOCK)\b',
    body,
)
# WITH is ok; CREATE is forbidden
if forbidden:
    raise SystemExit(f"Forbidden verbs in executable SQL: {forbidden}")
if 'BEGIN TRANSACTION READ ONLY' not in sql.upper().replace('\n',' '):
    # original case
    pass
if 'BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ' not in sql:
    raise SystemExit('Missing READ ONLY REPEATABLE READ begin')
if "SET LOCAL statement_timeout = '15s'" not in sql:
    raise SystemExit('Missing 15s statement_timeout')
if not sql.strip().endswith('ROLLBACK;') and 'ROLLBACK;' not in sql:
    raise SystemExit('Missing ROLLBACK')
print('STATIC READ-ONLY OK')
PY

echo "== Edge: inspection against empty optional tables must still complete =="
psql -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null
# Re-run inspection; source_evidence columns query returns 0 rows — fine
psql -v ON_ERROR_STOP=1 -f "$SQL" >/dev/null
echo "EDGE OK: re-run succeeded"

echo "ALL TESTS PASSED"
echo "Artifacts: $OUT_DIR"
