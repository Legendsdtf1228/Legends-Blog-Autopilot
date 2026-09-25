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

bootstrap_schema() {
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
SQL
}

seed_backfill_cases() {
psql -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE articles, publish_jobs, audit_events RESTART IDENTITY;

INSERT INTO articles(id, title, handle, shopify_article_id, created_at, updated_at)
VALUES (100, 'Linked Title', 'linked-handle', 'gid://shopify/Article/1', '2024-01-01 00:00:00+00', now());
SELECT setval('articles_id_seq', 100);

INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at) VALUES
(
  'already-linked',
  '{"title":"Linked Title","handle":"linked-handle"}'::jsonb,
  100,
  'gid://shopify/Article/1',
  '2024-01-01 00:00:00+00'
),
(
  'shopify-match',
  '{"title":"Other","handle":"other"}'::jsonb,
  NULL,
  'gid://shopify/Article/1',
  '2024-02-01 00:00:00+00'
),
(
  'ht-created-match',
  '{"title":"Linked Title","handle":"linked-handle"}'::jsonb,
  NULL,
  NULL,
  '2024-01-01 00:00:00+00'
),
(
  'null-handle',
  '{"title":"Only Title"}'::jsonb,
  NULL,
  NULL,
  '2024-03-01 00:00:00+00'
),
(
  'null-title',
  '{"handle":"only-handle"}'::jsonb,
  NULL,
  NULL,
  '2024-03-02 00:00:00+00'
),
(
  'json-null-ht',
  '{"title":null,"handle":null}'::jsonb,
  NULL,
  NULL,
  '2024-03-03 00:00:00+00'
);

INSERT INTO articles(title, handle, created_at, updated_at)
VALUES ('Untitled', 'untitled', '2024-03-03 00:00:00+00', now());

INSERT INTO publish_jobs(slot_key, article, article_id, shopify_article_id, created_at) VALUES
(
  'fresh-unmatched',
  '{"title":"Brand New","handle":"brand-new"}'::jsonb,
  NULL,
  NULL,
  '2024-04-01 00:00:00+00'
),
(
  'ht-update-only',
  '{"title":"Linked Title","handle":"linked-handle"}'::jsonb,
  NULL,
  NULL,
  '2024-05-01 00:00:00+00'
);
SQL
}

seed_zero_duplicates() {
psql -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE audit_events RESTART IDENTITY;
INSERT INTO audit_events(actor, action, article_id) VALUES
  ('a', 'rollout_draft_counted', 100),
  ('a', 'rollout_draft_counted', 200),
  ('a', 'rollout_draft_counted', NULL),
  ('a', 'other_action', 100);
SQL
}

seed_multiple_duplicates() {
psql -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE audit_events RESTART IDENTITY;
-- Groups: 100→3 (delete 2), 200→2 (delete 1), 300→4 (delete 3) => groups=3, delete=6, max=4
INSERT INTO audit_events(actor, action, article_id) VALUES
  ('a', 'rollout_draft_counted', 100),
  ('a', 'rollout_draft_counted', 100),
  ('a', 'rollout_draft_counted', 100),
  ('a', 'rollout_draft_counted', 200),
  ('a', 'rollout_draft_counted', 200),
  ('a', 'rollout_draft_counted', 300),
  ('a', 'rollout_draft_counted', 300),
  ('a', 'rollout_draft_counted', 300),
  ('a', 'rollout_draft_counted', 300),
  ('a', 'rollout_draft_counted', NULL),
  ('a', 'other_action', 100);
SQL
}

assert_no_app_identifiers() {
  local file="$1"
  python3 - "$file" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
# Forbidden application identifiers / content from synthetic seed (and common shapes)
patterns = [
    r'(?i)\barticle_id\b',           # column header or values must not appear in output
    r'\bgid://shopify/Article/',
    r'linked-handle',
    r'Linked Title',
    r'only-handle',
    r'Only Title',
    r'brand-new',
    r'Brand New',
    r'already-linked',
    r'shopify-match',
    r'ht-created-match',
    r'null-handle',
    r'null-title',
    r'json-null-ht',
    r'fresh-unmatched',
    r'ht-update-only',
]
# Allow schema catalog mentions of index *name* containing rollout_draft_counted_article_uidx
# but not a result column literally named article_id from the removed per-row query.
hits = []
for pat in patterns:
    if re.search(pat, text):
        # Index name audit_events_rollout_draft_counted_article_uidx contains "article" substring
        # but pattern is \barticle_id\b — fine.
        # Indexdef from pg_indexes may include "(article_id)" — that is schema metadata.
        # User forbids individual application identifiers; schema column names in indexdef
        # are acceptable. Filter: only flag article_id if it looks like a data column header
        # from the removed query (duplicate_row_count context) or numeric id listing.
        if pat == r'(?i)\barticle_id\b':
            # Fail if "article_id" appears as a selected output column header with data rows
            # e.g. " article_id | duplicate_row_count"
            if re.search(r'article_id\s*\|', text) or re.search(r'^\s*article_id\s*$', text, re.M):
                hits.append(pat)
            # Also fail bare numeric listing tables that paired with duplicate_row_count
            if 'duplicate_row_count' in text or 'rows_that_would_be_deleted_for_this_article' in text:
                hits.append('per-article-duplicate-table')
            continue
        hits.append(pat)
if hits:
    raise SystemExit(f'IDENTIFIER LEAK in inspection output: {hits}')
print('NO-IDENTIFIER OK')
PY
}

assert_inspection_007_aggregates() {
  local file="$1"
  local expect_groups="$2"
  local expect_delete="$3"
  local expect_max="$4"
  local expect_exists="$5"
  python3 - "$file" "$expect_groups" "$expect_delete" "$expect_max" "$expect_exists" <<'PY'
import re, sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
eg, ed, em, ee = sys.argv[2:6]
for col in (
    'duplicate_group_count',
    'rows_007_delete_would_remove',
    'max_duplicate_group_size',
    'duplicates_exist',
):
    if col not in text:
        raise SystemExit(f'missing {col} header')
# Data row: four leading aggregate fields before the optional tallies
row = None
for line in text.splitlines():
    m = re.match(
        r'^\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(t|f|true|false)\b',
        line,
        re.I,
    )
    if m:
        row = m
        break
if not row:
    raise SystemExit(f'Could not parse 007 aggregate data row from {sys.argv[1]}')
got = (row.group(1), row.group(2), row.group(3), row.group(4).lower()[0])
exp = (eg, ed, em, ee.lower()[0])
if got != exp:
    raise SystemExit(f'007 aggregate mismatch got={got} expected={exp}')
print(f'007 AGGREGATE OK groups={got[0]} delete={got[1]} max={got[2]} exists={got[3]}')
PY
}

assert_backfill_counts() {
psql -v ON_ERROR_STOP=1 -At <<'SQL' | tee "$OUT_DIR/asserts-backfill.txt"
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

SELECT 'insert_would_create=' || COUNT(*)
FROM publish_jobs pj
WHERE pj.article IS NOT NULL
  AND pj.article_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title' AND a.created_at = pj.created_at)
  );

SELECT 'update_would_set=' || COUNT(*)
FROM publish_jobs pj
WHERE pj.article_id IS NULL
  AND pj.article IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM articles a
    WHERE (pj.shopify_article_id IS NOT NULL AND a.shopify_article_id = pj.shopify_article_id)
       OR (a.handle = pj.article->>'handle' AND a.title = pj.article->>'title')
  );

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
text = Path("/tmp/m5-inspect-test/asserts-backfill.txt").read_text().splitlines()
expect = {
  "missing_count=5": False,
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
    raise SystemExit(f"BACKFILL ASSERT FAIL missing: {missing} full={text}")
print("BACKFILL ASSERT OK:", text)
PY
}

echo "== Bootstrap =="
bootstrap_schema
seed_backfill_cases

echo "== Case A: zero duplicate groups =="
seed_zero_duplicates
psql -v ON_ERROR_STOP=1 -f "$SQL" | tee "$OUT_DIR/inspection-zero-dups.out"
assert_inspection_007_aggregates "$OUT_DIR/inspection-zero-dups.out" 0 0 0 f
assert_no_app_identifiers "$OUT_DIR/inspection-zero-dups.out"

echo "== Case B: multiple duplicate groups (SUM n-1 = 6, max = 4) =="
seed_multiple_duplicates
psql -v ON_ERROR_STOP=1 -f "$SQL" | tee "$OUT_DIR/inspection-multi-dups.out"
assert_inspection_007_aggregates "$OUT_DIR/inspection-multi-dups.out" 3 6 4 t
assert_no_app_identifiers "$OUT_DIR/inspection-multi-dups.out"

echo "== Prior migration-impact / null-semantics asserts =="
assert_backfill_counts

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
lines = []
for line in sql.splitlines():
    if line.strip().startswith('--'):
        continue
    lines.append(re.sub(r'--.*$', '', line))
body = "\n".join(lines).upper()
forbidden = re.findall(
    r'\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|COPY|VACUUM|REINDEX|CLUSTER|LOCK)\b',
    body,
)
if forbidden:
    raise SystemExit(f"Forbidden verbs in executable SQL: {forbidden}")
if 'BEGIN TRANSACTION READ ONLY ISOLATION LEVEL REPEATABLE READ' not in sql:
    raise SystemExit('Missing READ ONLY REPEATABLE READ begin')
if "SET LOCAL statement_timeout = '15s'" not in sql:
    raise SystemExit('Missing 15s statement_timeout')
if 'ROLLBACK;' not in sql:
    raise SystemExit('Missing ROLLBACK')
# Ensure per-row duplicate disclosure query is gone
if re.search(r'rows_that_would_be_deleted_for_this_article', sql):
    raise SystemExit('per-article delete column still present')
if re.search(r'SELECT\s+article_id\s*,\s*COUNT', sql, re.I):
    raise SystemExit('SELECT article_id, COUNT still present')
print('STATIC READ-ONLY + NO-PER-ROW OK')
PY

echo "== Edge: re-run inspection succeeds =="
psql -v ON_ERROR_STOP=1 -f "$SQL" >/dev/null
echo "EDGE OK"

echo "ALL TESTS PASSED"
echo "Artifacts: $OUT_DIR"
