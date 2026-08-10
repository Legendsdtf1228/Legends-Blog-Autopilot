# M2 Report — Source-backed ReaderTask ingestion

**Commit basis:** lands on `cursor/topic-research-engine-338a` after M1 `97f65b7`  
**PR #7:** remain Draft  
**Production behavior:** unchanged (paused `draft_only`; scheduler AUTO-only; no threshold dilution)

---

## Schema and migrations

Migration id: `008_source_evidence_reader_tasks` (idempotent `CREATE TABLE IF NOT EXISTS` in `src/db.ts`).

| Table | Purpose |
|---|---|
| `source_evidence` | First-party evidence records; `UNIQUE (provider, source_reference)` |
| `reader_tasks` | Normalized tasks; accepted fingerprint unique partial index |
| `source_evidence_reader_tasks` | Many-to-many support links |
| `reader_task_rejections` | Normalization rejection telemetry |
| `source_ingestion_runs` | Provider availability / last collection |

Artifacts stamp `schemaVersion` + `pipelineVersions` (M2).

---

## Implemented providers

| Provider | Status | Notes |
|---|---|---|
| `approved_customer_faq_import` | **Operational** | Reads `data/approved/customer-faq.v1.json` (or `APPROVED_FAQ_IMPORT_PATH`) |
| `seed_brainstorm` | Optional brainstorm | Explicit `inferred_seed` / `brainstormOnly`; never validated demand |
| GSC / Shopify Q&A / site search / approved web | **Not claimed** | Still stubs; not used in M2 ingestion |

### Proof first-party ≠ seeds

- FAQ file contains merchant-approved customer questions with `approvedBy` / `approvedAt`.
- Provider sets `sourceType: "approved_customer_faq"` and demand status `observed`.
- Seeds use `sourceType: "seed_brainstorm"` and cannot pass `isValidatedDemandReaderTask` / `readerTaskMayBecomeAutoEligible`.

---

## Normalization behavior

`normalizeSourceEvidenceToReaderTask`:

- Infers audience/situation/question/decision from evidence hints  
- Stable `semanticFingerprint`  
- Rejects generic “buyers should know”, taxonomy leakage, missing decision, stale evidence  
- Groups only identical normalized questions (not M3 semantic clustering)  
- **Does not generate titles**

---

## Tests

- `test/m2-source-evidence-contract.test.ts`  
- `test/m2-reader-task-normalization.test.ts`  
- `test/m2-source-evidence-db.test.ts`  

Plus existing suite (scheduler/rollout unchanged).

---

## Production behavior comparison

| Area | Before M2 | After M2 |
|---|---|---|
| Generation / titles / briefs / clustering | Unchanged | Unchanged |
| AUTO thresholds / articleQuality starvation | Unchanged | Unchanged |
| Scheduler AUTO-only | Unchanged | Unchanged |
| Legacy opportunities / reservations | Unchanged | Unchanged (asserted in DB tests) |
| New capability | — | Approved FAQ → SourceEvidence → ReaderTask + admin health card |

---

## Rollback plan

1. Stop using `/research/ingest-sources`.  
2. Optionally `DROP TABLE` M2 tables (payload-only; no opportunity FKs).  
3. Revert M2 code; migration id remains harmlessly recorded.  
4. Defaults still paused.

---

## Unresolved M3 risks

1. Identical-question grouping is not semantic clustering — near-duplicate FAQs stay separate until M3.  
2. ReaderTasks are not yet linked into opportunity decisioning — AUTO starvation remains until later milestones wire tasks into research.  
3. FAQ file is file-based; live CMS/admin editing of approved evidence is still future work.  
4. Accepted fingerprint uniqueness may collide if two distinct decisions normalize too aggressively — M3 must preserve decision/audience distinctions.
