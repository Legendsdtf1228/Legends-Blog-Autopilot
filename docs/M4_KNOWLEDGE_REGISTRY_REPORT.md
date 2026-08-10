# M4 Report — Evidence and approved-knowledge registry

**Commit basis:** M4 on `cursor/topic-research-engine-338a` after accepted M3 `e58c548`  
**PR #7:** remain Draft  
**Production behavior:** unchanged (paused `draft_only`; no AUTO_ELIGIBLE; no titles/briefs/articles from this milestone)

---

## Schema / migrations

Migration id: `011_knowledge_registry` (additive in `src/db.ts`).

| Table | Purpose |
|---|---|
| `knowledge_entries` | Stable knowledge rows with approval, scope, freshness, content hash, revision |
| `knowledge_entry_revisions` | Immutable revision payloads keyed by content hash |
| `knowledge_approvals` | Approval events bound to revision + content hash |
| `knowledge_source_links` | Links from knowledge entries to SourceEvidence |
| `knowledge_claims` | Claim snapshots used in evaluation traces |
| `cluster_evidence_budgets` | Per-cluster structured evidence readiness |
| `cluster_claim_requirements` | Claim-level evidence map rows |
| `merchant_interview_packets` | Reusable missing-knowledge packets |
| `merchant_interview_questions` | Packet questions |
| `merchant_interview_answers` | Pending answers → knowledge revisions |
| `knowledge_audit_events` | Append-only registry lifecycle audit |
| `knowledge_evaluation_runs` | Operational evaluation run accounting |

Pipeline pin: `knowledge.v1.approved-claim-budget` (`PIPELINE_VERSIONS.knowledgeRegistry`).  
Evaluation version: `knowledgeEval.v1.claim-budget`.

**M4 does not mutate legacy `research_opportunities` or reservations.**

---

## Knowledge classes

Reusable classes (not title-specific rules):

- `dtf_shop_operations`, `equipment_startup_costs`, `artwork_preparation_failures`
- `garment_selection`, `fulfillment_turnaround`, `local_customer_needs`
- `embroidery_vs_dtf`, `uv_dtf_vs_apparel_dtf`, `print_shop_growth_lessons`
- `legends_products_services`, `legends_policies`, `pricing_cost_facts`
- `technical_specifications`, `general_authoritative_education`

One approved entry may support many ReaderTask clusters when scope matches.

---

## Approval and revision workflow

- States: `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `REVOKED`, `INVALIDATED`, `STALE`
- Approval binds to immutable `contentHash` + `revisionId`
- Content change creates a new revision, clears approval fields, invalidates prior approval rows
- Never defaults: approver identity, approval timestamp, approval state, firsthand, usage permission, confidence, effective dates
- `approvedBy: "merchant"` is rejected
- Pending/rejected/revoked/invalidated/stale cannot satisfy approved claim requirements

Modules: `knowledgeBuilders.ts`, `knowledgeApproval.ts`, `knowledgeStore.ts`.

---

## Source-authority rules

Source types are distinct. Only approving types can satisfy claims:

| Can satisfy claims | Cannot satisfy claims |
|---|---|
| approved merchant firsthand | inferred seed |
| approved business fact/policy | model inference |
| active first-party customer evidence | template/example |
| authoritative technical / manufacturer / government | unsupported assertion |

Authority rank + scope match + approval + effective date + revision + confidence resolve diagnostic precedence. Material contradictions still **block** the claim (no silent “writeability” preference).

---

## Claim / evidence mapping

`deriveClaimRequirementsFromCluster` reads the canonical ReaderTask only (no titles/outlines/articles).

Claim classes include educational, technical, product behavior, price/cost, turnaround, policy, firsthand experience, customer result, local, comparison, safety/compliance, time-sensitive.

Each requirement stores evidence needed/found, supporting source/knowledge/revision IDs, confidence, freshness, contradictions, safe-to-state, qualification/merchant-input flags, prohibited wording, verification plan, and an explainable support decision.

Strict rules enforced in `knowledgeEvaluation.ts`:

- price/cost → numeric approved or authoritative range
- turnaround/policy → approved current business facts
- firsthand → approved merchant firsthand
- customer results → approved evidence + public usage permission
- technical → authoritative support (model inference insufficient)
- local → local scope only (not promoted nationally)
- comparison → criteria/tradeoff evidence
- UV DTF ≠ apparel DTF scope
- missing evidence remains UNKNOWN / unsupported

---

## Evidence-budget structure

`ClusterEvidenceBudgetM4` reports supported / partial / unsupported / conflicting / stale / prohibited claims, missing firsthand/technical/quantitative evidence, approved facts, safe exclusions, and structured readiness:

```json
{
  "status": "ready|partial|blocked|needs_merchant_input",
  "summary": "...",
  "blockingReasons": ["..."]
}
```

No three-decimal composite score. **AUTO_ELIGIBLE is not assigned in M4.**

---

## Contradiction handling

Detects disagreements (merchant vs policy, revision drift, manufacturer vs generic, product-specific vs general, local vs national, DTF vs UV DTF). Material conflicts set `supportStatus=conflicting` and block `safeToState`.

---

## Interview packets

`buildMerchantInterviewPackets` groups missing merchant/policy/price/local/firsthand gaps by knowledge class across clusters. Answers enter as `PENDING_APPROVAL` revisions via `submitInterviewAnswerAsPendingKnowledge`. After explicit approval, `evaluateAndPersistAllActiveClusters` re-evaluates affected clusters deterministically.

---

## Concurrency / idempotency

- Upserts are content-hash aware (`inserted` / `updated` / `unchanged`)
- Unchanged evaluations do not rewrite budget `updated_at` or create duplicate run rows for identical material hashes
- Approval uses `FOR UPDATE` + expected revision/hash; competing revisions fail closed
- Revocation immediately clears future support
- Evidence-budget rebuilds are transactional (`pg_advisory_xact_lock`)
- Fixtures are labeled `FIXTURE_NOT_PRODUCTION:` and cannot masquerade as production approvals

---

## Admin visibility (M4-only)

`/research` shows Knowledge registry (M4) card: approved/pending/terminal counts, class/source breakdowns, clusters with budgets, missing merchant/technical evidence, contradictions, stale claims, interview packets, sample claim traces, and “Evaluate cluster evidence budgets”.

Not the full M8 system-health dashboard.

---

## Production behavior comparison

| Behavior | Before M4 | After M4 |
|---|---|---|
| Research enabled default | false | unchanged |
| Rollout mode | draft_only | unchanged |
| Opportunity decisions / AUTO | unchanged | unchanged |
| Titles / briefs / generation | unchanged | unchanged |
| Legacy opportunities / reservations | untouched | untouched |
| Cluster evidence truthfulness | not registry-backed | claim-level budgets + approved knowledge |

AUTO starvation remains unresolved by design in M4.

---

## Rollback plan

1. Stop using `/research/evaluate-knowledge` and ignore M4 admin card.
2. Revert or leave unused `011_knowledge_registry` tables (additive; safe to retain empty).
3. No legacy opportunity/reservation repair required — M4 does not write those paths.
4. Revert code modules (`knowledge*`, `claimRequirements`, admin wiring) on the PR branch if needed.

---

## Unresolved M5 risks

- Natural-title generation still absent; budgets do not yet gate title proposals
- No brief generation or opportunity decision integration — risk of later wiring inventing AUTO yield
- Interview-packet UX is registry-level only; merchant admin answer/approval UI is minimal
- SourceEvidence↔knowledge link population is schema-ready but not auto-backfilled from all importers
- Strict claim map may under-fire on sparse ReaderTasks until M5 title/brief needs clarify claim inventory
- Precedence diagnostics vs hard-block policy may need product review when policy and firsthand both APPROVED but disagree

---

## Test results

Corpus covers approval boundary, pending/revoked/stale, numeric cost, model-inference technical, UV≠apparel, local≠national, customer permission, contradictions, multi-cluster reuse, keyword non-attachment, interview re-eval, idempotency, concurrency, legacy reservation invariance.

Run: `npm run typecheck && npm test && npm run build`
