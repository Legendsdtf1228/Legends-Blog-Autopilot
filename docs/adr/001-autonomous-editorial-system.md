# ADR 001 — Autonomous Editorial System Foundation (M1)

**Status:** Accepted for M1 (documentation + non-behavioral foundation only)  
**Date:** 2026-08-10  
**Branch:** `cursor/topic-research-engine-338a` (PR #7 — remain Draft)  
**Supersedes:** Article-specific quarantine / exact-title production patches  
**Production posture:** Unchanged — `enabled=false`, `rolloutMode=draft_only`, `draftOnlyMode=true`

---

## 1. Current architecture audit

Full stage-by-stage audit: [`docs/RESEARCH_PIPELINE_AUDIT.md`](../RESEARCH_PIPELINE_AUDIT.md).

### Pipeline today

```
source providers → signals → keyword clustering → topic refinement
→ audience/format rotation → title generation → evidence planning
→ opportunity scoring → decision → reservation → brief → generation
→ post-generation review → rollout counting → publication
```

### Authoritative findings (do not weaken gates)

| Finding | Evidence |
|---|---|
| **Zero genuine AUTO_ELIGIBLE at research time** | `engine.ts` sets `articleQuality: 0` and `factualConfidence ≤ 0.7` while `DEFAULT_AUTO_THRESHOLDS` require `0.9`. `decideTopicOutcome` never upgrades. Scheduler correctly refuses non-AUTO generation → structural starvation. |
| **Seed-first discovery** | `seedCatalogProvider` always available; GSC/Trends/volume/site_search/approved_web are stubs that never emit signals. |
| **False-precision scoring** | Demand/growth fall back to `0.35`/`0.4` when metrics are null, then surface three-decimal composites as if measured. |
| **Template titles** | `buildTitle()` / custom brief still emit “What … Buyers Should Know”, “Which Option Fits Your Apparel Project?”, “A Decision Checklist for Apparel Buyers”, “Honest Lessons From Building a Print Business”. |
| **Keyword ≠ opportunity** | Clusters are keyword Jaccard groups; audience/format come from pillar rotation; reader questions are often `What should {audience label} know about {keyword}?`. |
| **Downstream rescue** | Strong gates (`evaluatePreGeneration`, quality, technical, sales, template) correctly reject weak drafts but cannot invent demand or reader tasks upstream. |
| **Safety already present (retain)** | AUTO_ELIGIBLE-only generation; transactional rollout counter + unique audit index; feature-based content-promise / evidence / depth; merchant_knowledge append path; production paused. |

### Stage summary

| Stage | Authoritative data | Heuristic / failure |
|---|---|---|
| Providers | Shopify product titles (optional); seeds | All demand providers stubbed |
| Clustering | Keyword tokens | Jaccard ≥ 0.72; pillar classification rules |
| Refinement | Hardcoded long-tails + story→local refine | Feature patches for incoherent story framing |
| Rotation | `pillar_usage` history | Pillar taxonomy drives customer-facing language |
| Titles | Refinement strings or format templates | Taxonomy leakage into titles |
| Evidence | Fact sheet + interview + feature gates | “Products exist” treated as weak technical signal |
| Scoring | Mostly unavailable metrics | Invented mid-range fallbacks |
| Decision | Thresholds + editorial controls | AUTO unreachable at research time |
| Reservation | SQL claim | Can reserve DRAFT_ONLY historically; generation now blocked |
| Brief | Opportunity copy | Parallel custom-topic mini-pipeline |
| Generation | OpenAI + brief lock rules | Can still over-sell if brief weak |
| Post-gen review | Independent gates | Good; duplicated UV/filler logic across modules |
| Rollout | Transactional counter | Correct; only counts eligible drafts |
| Admin | List + brief review | No full decision trace / provider health / knowledge UI |

---

## 2. Proposed target architecture

### Core principle

**The reader task is the source of truth** — not the pillar, seed keyword, or template title.

A candidate proceeds only when the system can state:

> “[Specific reader] needs to [decision/action] because [specific situation/problem].”

### Target flow

```
approved sources → SourceEvidence records
  → normalize to customer problems
  → semantic cluster (reader × situation × question × decision × intent × outcome)
  → ReaderTask (first-class)
  → evidence budget against claim map + KnowledgeRegistry
  → natural title (post-task, post-evidence)
  → brief (intent-native outline)
  → decision (AUTO / NEEDS_MERCHANT_INPUT / DRAFT_ONLY / REJECTED)
  → reserve only AUTO_ELIGIBLE
  → generation (locked task + evidence + knowledge)
  → independent verification passes
  → feedback learning (structured categories)
  → transactional rollout / publish
```

### First-class objects

1. **SourceEvidence** — provider, type, period, geography, normalized problem, metrics, confidence, freshness, provenance  
2. **ReaderTask** — audience, situation, problem, question, decision/action, intent, outcome, stakes, constraints, evidence required/available, demand evidence, Legends relevance, conversion path, fingerprint, confidence, freshness  
3. **OpportunityCluster** — canonical ReaderTask + supporting variants + merged evidence + rejected duplicates  
4. **KnowledgeRecord** — typed claim with approval, owner, dates, scope, restrictions, superseded state  
5. **EditorialArtifact versions** — provider/normalization/clustering/title/decision/brief/generation/verification version stamps on every opportunity, brief, and article

### Decision semantics (strict — retain)

| Decision | Meaning | Scheduler |
|---|---|---|
| `AUTO_ELIGIBLE` | Complete evidence-backed reader task; generate/verify without merchant | May reserve + generate |
| `NEEDS_MERCHANT_INPUT` | Worthwhile; missing firsthand/merchant facts | Interview packet only; never generate |
| `DRAFT_ONLY` | Coherent manual work; not autonomous | Never reserve for schedule; never generate |
| `REJECTED` | Incoherent / duplicate / unsupported / low value | Never use |
| `SKIPPED_NO_QUALIFIED_TOPIC` | Cycle outcome when no AUTO remains | Honest skip |

### Non-goals for later milestones (explicit)

- Do not weaken post-generation gates to create AUTO yield.  
- Do not add exact-title quarantines or one-off seed refinements.  
- Do not treat seed-only candidates as validated demand.  
- Do not let pillars dictate customer-facing title language.

---

## 3. Database / schema migration plan

### Principles

- Additive, idempotent migrations in `src/db.ts` `migrate()`.  
- Opaque JSONB payloads gain `schemaVersion` fields; new first-class tables for queryable lifecycle.  
- Legacy opportunities remain readable; migration job (M9) reconstructs ReaderTasks.  
- Published Shopify URLs never change automatically.

### Proposed tables (M2–M5 introduce; M1 documents only)

| Table | Purpose | Milestone |
|---|---|---|
| `source_evidence` | Ingested provider records with provenance | M2 |
| `reader_tasks` | First-class reader tasks | M2 |
| `opportunity_clusters` | Canonical task + variants + merge audit | M3 |
| `knowledge_registry` | Structured approved claims (evolves `merchant_knowledge`) | M4 |
| `editorial_versions` | Named version pins used per artifact | M1 foundation constants; table M6 |
| `merchant_feedback` | Structured rejection categories | M8 |
| `system_health_snapshots` | Dashboard aggregates | M8 |

### Columns to add on existing rows (via payload `schemaVersion` + optional columns)

- `research_opportunities.payload.schemaVersion`  
- `research_opportunities.payload.readerTaskId`  
- `research_opportunities.payload.pipelineVersions`  
- `article_briefs.payload.schemaVersion` / `readerTaskId` / `pipelineVersions`  
- `articles.generation_settings.pipelineVersions`  
- `articles.generation_settings.countsTowardRollout` (already present)

### Reservation invariants (M6 / M9)

After migration:

- No `DRAFT_ONLY` or `NEEDS_MERCHANT_INPUT` row may remain `status='reserved'`.  
- Invalid template titles cleared or rejected.  
- Legacy weak drafts: `countsTowardRollout=false`.  
- `used` ≠ qualified.

### Rollback

- Feature flags / version pins allow reading old payload shapes.  
- New tables dropped only in reverse migration if unused.  
- Keep `merchant_knowledge` until `knowledge_registry` dual-writes then cut over.

---

## 4. Milestone plan

| ID | Scope | Production behavior | Exit criteria |
|---|---|---|---|
| **M1** | Audit, ADR, versioning module, ReaderTask types, migration plan | **None** (docs + types only) | This ADR accepted; typecheck/tests/build green |
| **M2** | SourceEvidence + ReaderTask ingestion; seed demoted to brainstorm | New candidates require SourceEvidence; seeds labeled non-demand | ≥1 provider contract test; seed-only ≠ AUTO |
| **M3** | Semantic clustering / dedup by reader-task similarity | Duplicate merge with explanation | Deterministic merge tests |
| **M4** | Knowledge registry + claim-level evidence budgets | Business/location facts cannot satisfy subject claims | Registry CRUD + budget tests |
| **M5** | Natural title + intent-native brief | Delete template title production paths; diversity ≤20% | Title naturalness corpus |
| **M6** | Decision engine + lifecycle invariants | Reserve/generate AUTO only (already); clear bad reservations | Invariant integration tests |
| **M7** | Generation inputs locked to task/evidence; independent verification passes | Structured failure routing upstream | Dual-pass verification tests |
| **M8** | Feedback learning + admin health dashboard | Correction categories → system warnings | Dashboard fields present |
| **M9** | Legacy opportunity migration | Reservations cleaned; invalid titles eliminated | Migration report + zero illegal reserved |
| **M10** | Shadow corpus (≥30 cycles) + rollout qualification | Still draft_only until criteria met | Yield/duplicate/title/evidence metrics acceptable |

**Per-milestone deliverables required:** scope, schema changes, migrations, behavior changes, tests, backward compatibility, rollback, metrics, risks.

**Completion definition:** Shadow system produces several distinct, useful, evidence-supported articles without title-specific rules or merchant micromanagement — not merely green CI.

---

## 5. PR #7 code — retain / refactor / remove

### Retain (do not regress)

| Component | Why |
|---|---|
| AUTO_ELIGIBLE-only `executeScheduledResearchCycle` generation gate | Correct scheduler invariant |
| Transactional `recordReviewedDraftForRollout` + unique audit index | Concurrency-safe counting |
| `contentPromise` / `evidenceBudget` / `depthGate` / `technicalRules` / `salesLimits` / `templateDetection` | Feature-based gates (strengthen, don’t delete) |
| `evaluatePreGeneration` decision routing | Keep; feed from ReaderTask later |
| `merchant_knowledge` storage path | Evolve into registry |
| Production pause defaults | Hard requirement |
| Editorial corpus + concurrency tests | Expand, don’t replace wholesale |

### Refactor (later milestones)

| Component | Direction |
|---|---|
| `seedCatalogProvider` | Brainstorm-only; never “validated demand” |
| `clusterSignals` | Cluster ReaderTasks, not keyword Jaccard alone |
| `buildTitle` / custom title templates | Delete production templates; task-driven titles |
| `pickRotatedAudience` / format rotation | Infer from ReaderTask; pillars organize strategy only |
| `decideTopicOutcome` + research-time scorecard | Honest components; stop `articleQuality: 0` starvation without inventing demand |
| `buildArticleBrief` / `evaluateCustomTopic` | Build from ReaderTask + knowledge |
| `writer.ts` prompts | Receive claim/evidence map only |
| Admin `/research` | Full decision trace + system health |
| UV/filler checks duplicated across modules | Single shared technical/sales/template libs |

### Remove (from production paths)

| Item | When |
|---|---|
| Exact-title / exact-keyword quarantine lists | Already emptied; keep empty; fixtures test-only |
| Automatic production use of “What Buyers Should Know”, “Which Option Fits…”, “Decision Checklist for Apparel Buyers”, “Honest Lessons…” | M5 |
| Treating inferred seed weight as demand | M2 / M14 |
| Article-specific production patches | Ongoing ban |

### Do not merge PR #7 under its outdated one-article title/body

PR remains **Draft** until M10 shadow qualification and metadata describe the autonomous system (not a single quarantine article).

---

## 6. Acceptance criteria for M1

M1 is complete when:

1. **Architecture audit** published at `docs/RESEARCH_PIPELINE_AUDIT.md` covering all pipeline stages.  
2. **This ADR** accepted and committed, including target architecture, schema plan, milestones, and PR #7 retain/refactor/remove.  
3. **Versioning module** exists (`src/research/versioning.ts`) with named pipeline version constants and helpers to stamp artifacts — **not yet required on every write**.  
4. **ReaderTask types** exist (`src/research/readerTask.ts`) with validation helper for the coherence statement — **not yet wired into `runResearchCycle`**.  
5. **Production behavior unchanged:** still paused; no new AUTO yield faked; gates not weakened.  
6. **`npm run typecheck`**, **`npm test -- --test-concurrency=1`**, and **`npm run build`** pass.  
7. Explicit stop: **M2+ not started** until this ADR is the shared foundation.

### Out of scope for M1

- Provider implementations  
- Migrating existing opportunities  
- Deleting title templates from engine (scheduled M5)  
- Admin dashboard rebuild  
- Shadow 30-cycle evaluation  

---

## Risks carried into M2

1. AUTO starvation is correct given current gates + missing demand sources; fixing yield requires real SourceEvidence, not threshold dilution.  
2. Dual custom-topic vs engine pipelines will drift until both consume ReaderTask.  
3. Opaque JSONB opportunities need careful schemaVersioning to avoid silent field loss.  
4. Merchant expectations: reviewing system health, not micromanaging titles.
