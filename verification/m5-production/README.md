# M5 production schema inspection

**Candidate:** `465661e48837e349a20bcfc9f5d9c5c19eef312a`  
**Branch:** `release/m5-owner-console-candidate`  
**Script:** [`m5-production-schema-inspection.sql`](m5-production-schema-inspection.sql)  
**Migrate source:** `branch-native/src/db.ts` `migrate()`

This package prepares a **read-only** production inspection. It does **not** authorize migration, deploy, merge, or secret disclosure.

## What the script reports (aggregate / schema only)

| Section | Output |
| --- | --- |
| Session guards | `transaction_read_only`, isolation, 15s `statement_timeout`, database/role/host identity |
| Installed migrations | `schema_migrations.id` + `applied_at` |
| Missing / unexpected | Diff vs candidate expected IDs `001`–`011` |
| Migration 007 impact | **Aggregates only:** `duplicate_group_count`, `rows_007_delete_would_remove` (`SUM(n - 1)`), `max_duplicate_group_size`, `duplicates_exist`, plus total counted-row tallies |
| Legacy backfill impact | Exact INSERT/UPDATE **counts** using migrate predicates, plus null JSON handle/title **counts** (no job ids, titles, handles, or Shopify ids) |
| Schema metadata | Catalog names for tables/indexes/columns/constraints relevant to 007–011 |

**Not reported:** application `article_id` values, publish-job ids/slot keys, titles, handles, Shopify article ids, interview/knowledge content, or any other per-row application identifiers.

## Migration 007 aggregate fields

Detection matches migrate (group `rollout_draft_counted` rows with non-null `article_id`):

| Column | Meaning |
| --- | --- |
| `duplicate_group_count` | Number of article groups with `COUNT(*) > 1` |
| `rows_007_delete_would_remove` | `SUM(group_size - 1)` — rows the DELETE would remove |
| `max_duplicate_group_size` | Largest duplicate group size (`0` if none) |
| `duplicates_exist` | Boolean |

## Corrected legacy backfill impact (null semantics)

Migrate INSERT matching uses **raw** JSON text extraction:

```sql
a.handle = pj.article->>'handle'
AND a.title = pj.article->>'title'
AND a.created_at = pj.created_at
```

`->>` returns SQL `NULL` when the key is missing or JSON-null. In SQL, `NULL = <value>` is **UNKNOWN**, so the handle/title path **never matches** when handle or title is null.

Migrate still inserts with `COALESCE(..., 'untitled'/'Untitled')` for **new row values only**. That COALESCE is **not** part of the match predicate.

Therefore:

- A naive count of `article IS NOT NULL AND article_id IS NULL` **overstates** INSERT impact if existing articles already match shopify/handle-title-created_at.
- Rewriting the match with `COALESCE(pj.article->>'handle','untitled')` **understates** INSERT impact for null handles/titles (falsely treating them as matching existing `untitled` rows).
- This script’s `jobs_insert_backfill_would_create` and `jobs_update_would_set_article_id` mirror migrate predicates **exactly**, including null behavior.

UPDATE linking omits `created_at` but still uses raw `=` on handle/title (same null rule).

## Production connection verification (authorized operator)

1. Obtain production `DATABASE_URL` only from the approved secret manager / Railway UI. Do **not** paste it into tickets, chat, or git.
2. Confirm target identity before running inspection:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT current_database(), inet_server_addr(), inet_server_port(), current_user;"
```

3. Prefer a read-only DB role. If only the app role is available, rely on the script’s `BEGIN TRANSACTION READ ONLY` + `ROLLBACK`.
4. Run:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f verification/m5-production/m5-production-schema-inspection.sql \
  | tee m5-production-schema-inspection.out
```

5. Confirm the first result shows `transaction_read_only = on`.
6. Archive the output in the approved release evidence location (not this repository unless policy allows redacted aggregates).

## Local disposable test

A synthetic harness is in [`test-inspection.sh`](test-inspection.sh):

```bash
# Requires PostgreSQL 16+ client/server tools
./verification/m5-production/test-inspection.sh
```

It covers:

- Zero duplicate groups and multiple duplicate groups
- Correct `SUM(count - 1)` delete estimate
- No individual application identifiers in inspection stdout
- Legacy backfill null-semantics / COALESCE-trap checks
- READ ONLY write rejection + static no-write audit

## Limitations

- Does not connect to production from CI/agent environments by itself.
- Does not validate Railway env vars or secrets.
- Does not execute migrations or prove post-migrate application behavior.
- Catalog queries list expected objects; absence on current production (still on `001`–`006`) is an expected pre-migrate result, not an error.
- Read-only transaction prevents writes in-session; a privileged role could still write in a **different** session—use least privilege.

## STOP conditions

Do not migrate, deploy, merge to `main`, or change Railway variables based solely on this preparation.
