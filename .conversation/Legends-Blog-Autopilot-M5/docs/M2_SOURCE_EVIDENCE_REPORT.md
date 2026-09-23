# M2 Report — Source-backed ReaderTask ingestion (provenance-corrected)

**Commit basis:** M2 correction on `cursor/topic-research-engine-338a` after M1 `97f65b7`  
**PR #7:** remain Draft  
**Production behavior:** unchanged (paused `draft_only`; scheduler AUTO-only; no threshold dilution)

---

## Status of “first-party” evidence

| Dataset | Path | Role | Count (repo default) |
|---|---|---|---|
| Production-approved FAQ | `data/approved/customer-faq.v1.json` | Only records with explicit merchant approval may live here | **0** (empty by design) |
| Pending / template FAQ | `data/fixtures/customer-faq.templates.json` | Merchant-review fixtures only | **2** pending templates |
| Seed brainstorm | in-code optional provider | Brainstorming only | N/A |

**Do not call the path “live first-party” until `approvedEvidenceCount > 0` with trustworthy audit rows.**

Current proof of the live path: **empty production-approved dataset + merchant approval workflow** (`approvePendingSourceEvidence` / `revokeSourceEvidenceApproval` / `invalidateApprovalIfContentChanged`).

---

## Schema and migrations

| Migration | Purpose |
|---|---|
| `008_source_evidence_reader_tasks` | Evidence / ReaderTask / ingestion run tables |
| `009_evidence_approval_authority` | Structured approval columns, `material_hash`, `evidence_approval_audits`, `unchanged_count` |

Approval is stored as authoritative columns (`approval_state`, `approved_by`, `approved_at`, `approval_method`, `content_hash`, `public_usage_allowed`, `usage_scope`, revoke fields) plus audit events — not free-form JSON alone.

---

## Implemented providers

| Provider | Status | Notes |
|---|---|---|
| `approved_customer_faq_import` | **Operational importer** | Rejects missing `approvedBy` / `approvedAt` / method / hash / scope. **Never defaults `approvedBy` to `"merchant"`.** |
| `pending_faq_template_import` | Review-only | Loads fixtures as `PENDING_APPROVAL`; confidence `unknown`; demand `unavailable` |
| `seed_brainstorm` | Optional brainstorm | Explicit `inferred_seed`; never validated demand |
| GSC / Shopify Q&A / site search / approved web | **Not claimed** | Still stubs |

### Trust boundary

- Missing approval fields → reject  
- `approvedBy: "merchant"` → reject  
- Pending/template → no observed/verified demand, no high confidence, no accepted production ReaderTasks, not AUTO-eligible  
- Content hash mismatch → approval invalid until re-approved  
- Revoked → cannot create active ReaderTasks  
- Content-aware upsert: identical retry → `unchanged` (no `updated_at` rewrite)

---

## Normalization behavior

`normalizeSourceEvidenceToReaderTask`:

- Requires production `APPROVED` authority for acceptance  
- Pending/template/seed paths retained for review/brainstorm but **not accepted**  
- Groups only identical normalized questions (not M3 semantic clustering)  
- **Does not generate titles**

---

## Tests

- `test/m2-source-evidence-contract.test.ts`  
- `test/m2-reader-task-normalization.test.ts`  
- `test/m2-source-evidence-db.test.ts`  
- `test/m2-trust-boundary.test.ts`  

Plus existing suite (scheduler/rollout/generation unchanged).

---

## Production behavior comparison

| Area | Before M2 | After M2 correction |
|---|---|---|
| Generation / titles / briefs / clustering | Unchanged | Unchanged |
| AUTO thresholds / articleQuality starvation | Unchanged | Unchanged |
| Scheduler AUTO-only | Unchanged | Unchanged |
| Legacy opportunities / reservations | Unchanged | Unchanged |
| Approved production evidence count | (fabricated samples removed) | **0** until merchant approves |
| New capability | — | Importer + pending review + approval audit workflow |

---

## Rollback plan

1. Stop using `/research/ingest-sources`.  
2. Optionally drop M2 tables (payload-only; no opportunity FKs).  
3. Revert M2 code; migration ids remain harmlessly recorded.  
4. Defaults still paused.

---

## Unresolved M3 risks

1. Identical-question grouping is not semantic clustering.  
2. ReaderTasks are not yet linked into opportunity decisioning.  
3. Merchant approval UI is workflow-backed in code; richer admin UX can follow without changing M2 boundaries.  
4. Accepted fingerprint uniqueness may collide if two distinct decisions normalize too aggressively.
