# M3 Report — Semantic ReaderTask clustering

**Commit basis:** M3 on `cursor/topic-research-engine-338a` after M2 `279c02c`  
**PR #7:** remain Draft  
**Production behavior:** unchanged (paused `draft_only`; no opportunities created from clusters)

---

## Schema / migration

Migration id: `010_opportunity_clusters` (additive in `src/db.ts`).

| Table | Purpose |
|---|---|
| `opportunity_clusters` | Canonical cluster payload + material hash + demand/confidence |
| `opportunity_cluster_members` | Active/historical membership with join reasons |
| `opportunity_cluster_evidence` | Supporting SourceEvidence IDs |
| `opportunity_cluster_audits` | Append-only CREATE/UPDATE/SUPERSEDE audit |
| `reader_task_cluster_history` | Per-task assignment history |
| `opportunity_cluster_review_candidates` | Ambiguous pairs requiring review |
| `clustering_runs` | Run accounting (inserted/updated/unchanged/superseded) |

Pipeline pin: `clustering.v1.semantic-reader-task` (`SEMANTIC_CLUSTERING_VERSION`).

**M3 does not create `research_opportunities` from clusters.**

---

## Clustering model and thresholds

Module: `src/research/semanticClustering.ts`

Compares audience, situation, problem, question, decision/action, intent, outcome, stakes, constraints, geography, provenance. Keyword Jaccard is a **capped** signal (~4% weight), never the deciding rule.

| Decision | Rule |
|---|---|
| **merge** | score ≥ **0.78**, no hard conflicts, decision similarity ≥ 0.55, audience ≥ 0.45 |
| **review** | score ≥ **0.55** and < merge bar (or soft conflicts) — **not auto-merged** |
| **separate** | score < 0.55 or any hard conflict |

Hard conflicts (default separate): audience class mismatch (e.g. school vs clothing brand), UV hard-surface vs apparel, product category mismatch, decision-family mismatch, commercial vs informational, local vs national when locality changes the answer (vendor choice), firsthand vs educational, quantity/deadline conflicts that change recommendations, desired-outcome conflicts.

Cluster demand cannot exceed active approved sources (`observed`/`verified` only when `hasActiveApprovedEvidence`). Inferred/pending cannot elevate demand.

---

## Deterministic identity / canonical selection

- Tasks sorted by stable ID before pairing.
- Union-Find links to lexicographically smaller root.
- Cluster ID = `sha1(clusteringVersion + sorted member fingerprints)[:24]`.
- Input order does not change IDs, memberships, canonicals, or explanations.

Canonical score (descending), then smaller task ID:

1. demand rank (verified > observed > unavailable > inferred) × 1000  
2. active approved evidence bonus  
3. freshness  
4. confidence  
5. completeness  
6. specificity  

---

## Conflict and ambiguity behavior

- Hard conflicts → separate clusters + recorded conflict pairs.  
- Ambiguous pairs → `opportunity_cluster_review_candidates`; both sides may be flagged `requires_manual_review` / `needs_review`.  
- Provenance and wording variants retained; no manufactured combined facts.

---

## Lifecycle

| Event | Behavior |
|---|---|
| Task added | Next rebuild assigns/merges deterministically |
| Evidence revoked / approval invalidated | Task inactive when no approved evidence remains |
| Stale task | Excluded from active clusters |
| Semantic fields change | Fingerprint/ID change → old cluster **superseded**; audits retained |
| Merge / split | New cluster IDs; history + audits preserved |
| Clustering version change | Explicit via `SEMANTIC_CLUSTERING_VERSION` |

---

## Concurrency / idempotency

- `pg_advisory_xact_lock(hashtext('m3_semantic_clustering'))` serializes rebuilds.  
- Material-hash equality → `unchanged` (no `updated_at` rewrite).  
- Concurrent runs converge to one active cluster per identity.  
- Full rebuild is a single transaction.

---

## Admin visibility (minimal)

Research page card: active / singleton / multi-task counts, review candidates, conflicts, unassigned tasks, last run accounting, sample traces, “Run semantic clustering” action (`POST /research/cluster-reader-tasks`).

---

## Tests

- `test/m3-semantic-clustering.test.ts` — comparison corpus + determinism  
- `test/m3-semantic-clustering-db.test.ts` — migrations, idempotency, merge/split, revocation, stale, concurrency, reservations untouched  

---

## Production behavior comparison

| Area | Before M3 | After M3 |
|---|---|---|
| Titles / briefs / knowledge registry | Unchanged | Unchanged |
| Opportunity decisions / AUTO thresholds | Unchanged | Unchanged |
| Generation / scheduler / rollout | Unchanged | Unchanged |
| Legacy opportunities / reservations | Unchanged | Unchanged (asserted) |
| Production pause | Paused | Paused |
| New capability | — | Semantic ReaderTask clusters + admin health |

AUTO starvation remains unresolved by design.

---

## Rollback

1. Stop using `/research/cluster-reader-tasks`.  
2. Optionally drop M3 tables (no FKs into opportunities).  
3. Revert M3 code; migration id remains recorded.  
4. Defaults still paused.

---

## Unresolved M4 risks

1. Clusters are not yet bound to a knowledge registry or claim-level evidence budgets.  
2. No title/brief generation from canonical ReaderTasks yet (M5).  
3. Decision engine still scores legacy keyword opportunities — clusters unused for AUTO yield.  
4. Review-candidate UX is minimal; merchants still need a clearer approve/reject merge flow.  
5. Embedding-free lexical similarity may under-merge paraphrases that a later embedding assist could catch — must remain conflict-safe.
