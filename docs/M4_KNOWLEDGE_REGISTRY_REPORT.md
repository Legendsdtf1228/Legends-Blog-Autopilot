# M4 Report — Evidence and approved-knowledge registry

**Commit basis:** M4 claim-safety correction on `cursor/topic-research-engine-338a` (after unaccepted tip `add5c82`; M3 accepted at `e58c548`)  
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
Evaluation version: `knowledgeEval.v1.1.claim-safety` (claim-safety correction after tip `add5c82`).

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

Source types are distinct. Seeds/templates/model inference cannot satisfy claims.

**Approval is not technical authority.** Claim-class gates:

| Claim class | What can fully support |
|---|---|
| technical specifications | manufacturer documentation, authoritative technical sources, or government/standards |
| safety/compliance | authoritative technical sources, manufacturer documentation, or government/standards |
| product behavior | authoritative sources for general fact; merchant firsthand only as **scoped observation** (partial/qualified — never promoted to general technical fact) |
| merchant experience | approved merchant firsthand |
| price/cost, turnaround, merchant policy | approved business/policy or merchant firsthand (with explicit freshness) |
| customer results | approved customer/firsthand evidence + public-usage permission |

Merchant firsthand may describe observed shop experience. It cannot independently prove a general technical specification or safety rule. Approved business policy may prove a policy exists, not its technical correctness.

Authority rank + scope match + approval + effective date + revision + confidence resolve diagnostic precedence. Material contradictions still **block** the claim (no silent “writeability” preference).

---

## Explicit freshness for time-sensitive facts

Price, cost, turnaround, merchant policy, availability, and other `time_sensitive` claims **require explicit freshness metadata**:

- applicable `effectiveFrom` / checked date **and**
- a `freshnessPolicyDays` window **or** `effectiveTo` expiration

Rules:

- missing freshness metadata → `UNKNOWN` / unsupported (never supported)
- expired `effectiveTo` or exceeded window from `effectiveFrom` → stale
- future `effectiveFrom` → not currently usable
- **approval date alone does not establish indefinite freshness**
- timeless educational / comparison knowledge may remain usable without a price-style freshness window
- time-sensitive SourceEvidence must pass the same freshness checks before attachment

`assessKnowledgeFreshness()` implements this; evaluation version includes freshness in material hashes so identical evaluations stay idempotent on the same side of a freshness boundary and change when the boundary is crossed.

---

## Claim / evidence mapping

`deriveClaimRequirementsFromCluster` reads the canonical ReaderTask only (no titles/outlines/articles).

Claim classes include educational, technical, product behavior, price/cost, turnaround, policy, firsthand experience, customer result, local, comparison, safety/compliance, time-sensitive.

Each requirement stores evidence needed/found, supporting source/knowledge/revision IDs, confidence, freshness, contradictions, safe-to-state, qualification/merchant-input flags, prohibited wording, verification plan, and an explainable support decision.

Strict rules enforced in `knowledgeEvaluation.ts`:

- price/cost → numeric approved evidence **plus** explicit freshness metadata
- turnaround/policy → approved current business facts **plus** explicit freshness metadata
- firsthand → approved merchant firsthand
- customer results → approved evidence + public usage permission
- technical/safety → authoritative/manufacturer/standards only (merchant opinion and shop policy insufficient)
- product behavior → authoritative for general fact; merchant observation only when scoped/qualified
- local → local scope only (not promoted nationally)
- comparison → criteria/tradeoff evidence
- UV DTF ≠ apparel DTF scope
- missing evidence remains UNKNOWN / unsupported

### SourceEvidence vs factual answer evidence

Before attaching SourceEvidence for partial support, evaluation validates:

- allowed source type
- active approval
- public-usage permission
- freshness (especially for time-sensitive claims)
- process surface
- geographic scope
- claim-class suitability

**Customer-question evidence proves that customers ask something (demand). It is not technical or factual answer evidence** and cannot partially support technical, safety, price, turnaround, policy, or comparison claims.

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

Corpus covers approval boundary, pending/revoked/stale, numeric cost, model-inference technical, UV≠apparel, local≠national, customer permission, contradictions, multi-cluster reuse, keyword non-attachment, interview re-eval, idempotency, concurrency, legacy reservation invariance, plus claim-safety corrections:

- explicit freshness for price/turnaround/policy (missing/expired/future/boundary idempotency)
- technical/safety require authoritative sources (merchant opinion / shop policy insufficient)
- manufacturer scope match/mismatch
- merchant observation vs general technical fact
- customer-question SourceEvidence cannot act as technical answer evidence

Run: `npm run typecheck && npm test && npm run build`
