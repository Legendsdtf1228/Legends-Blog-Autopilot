# Legends Blog Autopilot — Research/Opportunity Pipeline Audit

**Source branch audited:** `cursor/topic-research-engine-338a` (commit basis: `82c2ae0`+)  
**Companion ADR:** [`docs/adr/001-autonomous-editorial-system.md`](adr/001-autonomous-editorial-system.md)  
**Orchestrator:** `src/research/engine.ts` → `runResearchCycle`  
**Scheduler wrapper:** `src/autopilot/researchCycle.ts` → `executeScheduledResearchCycle`

---

## End-to-end flow (summary)

```
Providers.collect → ResearchSignal[]
  → clusterSignals → KeywordCluster[]
  → applyTopicRefinement (specificity + rotation)
  → overlap / demand / scores / buildTitle / evaluatePreGeneration
  → decideTopicOutcome → ResearchOpportunity[]
  → select AUTO_ELIGIBLE (or NEEDS_MERCHANT_INPUT for interview only)
  → reserveOpportunity → buildArticleBrief → generateArticle (writer.ts)
  → runQualityGates → postGenerationDecision → authorizeAutomaticPublication
  → (optional) Shopify publish / rollout counting
```

---

## 1. Source providers (`src/research/providers/`)

| Provider file | id | Function | Available? | Authoritative data | Heuristic / stub |
|---|---|---|---|---|---|
| `seedCatalog.ts` | `seed_catalog` | `seedCatalogProvider.collect` | Always `true` | Curated keyword list only | **No volume/growth** — `completeness: "unavailable"`, all metrics `null` |
| `shopifyCatalog.ts` | `shopify_catalog` | `shopifyCatalogProvider.collect` | If `ctx.products.length > 0` | Live product titles/URLs (up to 40) | Keywords = product titles; **not** search demand |
| `existingContent.ts` | `existing_content` | `existingContentProvider.collect` | If topics exist | Existing article topic strings | Overlap awareness only; **excluded from demand scoring** |
| `externalStubs.ts` | `google_search_console` | `googleSearchConsoleProvider` | **Never** | — | Stub: missing env → unavailable; credentials present → still unavailable (“live connector not enabled”) |
| `externalStubs.ts` | `google_trends` | `googleTrendsProvider` | **Never** | — | Same stub pattern (`GOOGLE_TRENDS_API_KEY`) |
| `externalStubs.ts` | `keyword_volume` | `keywordVolumeProvider` | **Never** | — | Same stub (`GOOGLE_ADS_*`) |
| `externalStubs.ts` | `site_search` | `siteSearchProvider` | **Never** | — | Same stub (`SITE_SEARCH_EXPORT_URL`) |
| `externalStubs.ts` | `approved_web` | `approvedWebProvider` | **Never** | — | Same stub (`APPROVED_WEB_RESEARCH_ENABLED`) |

**Registry:** `PROVIDERS` array in `src/research/engine.ts` (lines 51–60).

### seedCatalogProvider (detail)

- **Inputs:** `ProviderContext` (`collectedAt`, `region`); seed lists from `BASE_SEED_CATEGORIES` + `CONTENT_PILLARS[].seedKeywords` (`pillars.ts`).
- **Outputs:** One `ResearchSignal` per unique seed keyword; `volume/relativeInterest/growth/competition = null`.
- **Notes:** Explicit comment: “never invents volume/growth metrics.”
- **Fallback:** This is the primary discovery source when external stubs are down (always).

### External stubs (detail)

- Shared `stub(id, envKeys, label)` in `externalStubs.ts`.
- **Fallback:** Empty `signals[]`, `available: false`, reason string recorded into `missingProviders` on the cycle.
- **Failure mode:** Credentials alone do not unlock metrics — intentional no-op even when env is set.

### Related tests

- `test/research.test.ts` — “never invents search metrics…”
- `test/autopilot-safety.test.ts` — “no verified metrics are invented…”

### DB / admin

- Signals persisted in `research_signals` via `saveResearchCycle`.
- Admin Research page shows `missingProviders` notice (`views.ts` `researchPage`).

---

## 2. Signals

**Type:** `ResearchSignal` (`src/research/types.ts`).

| Field | Source |
|---|---|
| `provider`, `keyword`, `collectedAt`, `geographicRegion` | Provider |
| `volume`, `relativeInterest`, `growth`, `competition` | External APIs only (currently always null) |
| `completeness` | `unavailable` (seeds), `partial` (Shopify/existing) |
| `notes` | Provider disclaimer text |

**Extra seeds:** `runResearchCycle({ extraKeywords })` injects additional `seed_catalog` signals (tests / overrides).

**Demand filtering:** `cluster.signals.filter(s => s.provider !== "existing_content")` before scoring.

**Authoritative vs heuristic:** With stubs offline, **no authoritative demand metrics exist**. Demand/growth scores fall back to neutral heuristics (`0.35` / `0.4` in `scoring.ts`).

---

## 3. Keyword clustering (`src/research/cluster.ts`)

**Entry:** `clusterSignals(signals, missingProviders)`.

| Step | Logic |
|---|---|
| Filter | Drop `existing_content` |
| Group | Jaccard ≥ **0.72** (`jaccard` / `isTrivialVariation`) |
| Primary keyword | Longest keyword in group |
| Pillar | `detectPillar` → `classifyTopic` rules first, then seed Jaccard, then regex fallbacks; final default `apparel_business` / `"custom topic"` |
| Intent | `detectIntentFromKeyword` (`classification.ts`) |
| Audience/format | Pillar defaults (`defaultAudience`, `defaultFormat`) — **overwritten later by rotation/refinement** |
| Cluster id | SHA1 of `pillar|intent|normalizedPrimary` (16 hex) |

**Overlap with inventory:** Separate module `overlap.ts` — `findClosestOverlap` / `isRejectedByOverlap` (default threshold **0.72**).

**Duplicated logic:** Outline builders exist in both `specificity.buildTopicSpecificOutline` and `templateDetection.buildIntentOutline` (similar section strings). Jaccard tokenization is cluster-local (not shared with links).

**Failure modes:** Over-clustering distinct long-tails if tokenized Jaccard ≥ 0.72; under-classification of unknown keywords into `apparel_business`.

**Tests:** `test/research.test.ts` (“groups trivial keyword variations…”), `test/autopilot-safety.test.ts` (embroidery ≠ DTF).

---

## 4. Topic refinement

### `suggestRefinement()` — `src/research/specificity.ts`

Hardcoded long-tail map for broad seeds:

| Seed | Refined keyword | Title |
|---|---|---|
| embroidery / embroidery printing | embroidery vs DTF for work shirts | Embroidery vs. DTF Printing: Which Is Better for Work Shirts? |
| shirts / shirt / custom shirts | cotton vs polyester shirts for custom printing | Cotton vs. Polyester Shirts for Custom Printing: How to Choose |
| dtf / transfers / transfer | DTF transfers vs vinyl for small apparel orders | DTF Transfers vs. Vinyl: Which Is Better for Small Apparel Orders? |
| incoherent story intents | → `suggestLocalPrinterRefinement()` | How to Choose a Custom Shirt Printer in Warner Robins: 9 Questions to Ask |

### `applyTopicRefinement()` — `src/research/engine.ts`

1. `validateOrReclassify` seed  
2. Refine if `suggestRefinement` hits **and** (≤2 words OR incoherent)  
3. Rebuild intent/audience/format from refinement **or** pillar rotation  
4. Recompute cluster `id`

**Bug/duplication:** Condition repeats `isIncoherentSearchIntent(next.primaryKeyword)` twice (lines 186–187).

### Second refinement pass (feature-specific patch)

Inside the opportunity loop, `evaluatePreGeneration` can auto-refine incoherent story/checklist framing to the local-printer angle **again**, mutating keyword/title/outline/audience after the first refinement.

### `semanticIntent.ts`

- `isIncoherentSearchIntent`, `detectAudiencePurposeDrift`, `titleRepresentsSearchQuestion`
- `suggestLocalPrinterRefinement()` — production feature patch for the “local small-business stories” failure class
- Exact title quarantines **removed** (`QUARANTINED_*` empty arrays); feature-based `isQuarantinedArticle` remains

**Tests:** `test/refinement-rollout-regression.test.ts`, `test/semantic-intent-regression.test.ts`, `test/editorial-corpus.test.ts`

---

## 5. Audience / format rotation (`rotation.ts` + `pillars.ts`)

| Function | Behavior |
|---|---|
| `pickRotatedAudience` | First candidate not used in last **2** usage records |
| `pickRotatedFormat` | Same for format |
| `pillarRotationBonus` | Boost underused pillars vs `DEFAULT_PILLAR_BALANCE` |
| `avoidRepeatedDtfBias` | −0.25 if ≥3 of last 5 usages are `dtf_education` |

**Pillar-driven lists:** Each `CONTENT_PILLARS[]` entry defines allowed `audiences` and `formats`.

**When skipped:** Refined topics force audience via `audienceForRefinement` and format via `formatForRefinedIntent` (prefers checklist/how_to/faq for local/commercial).

**Usage store:** `pillar_usage` table; `listPillarUsage` / `recordPillarUsage` in `store.ts`.

**Tests:** `test/research.test.ts` (“pillar, audience, and format rotation…”).

---

## 6. Title generation — `buildTitle()` (`engine.ts`)

```ts
function buildTitle(cluster): string {
  const refinement = suggestRefinement(cluster.primaryKeyword);
  if (refinement) return refinement.title;
  const k = TitleCase(cluster.primaryKeyword);
  if (format === "comparison" || intent === "commercial")
    return `${k}: Which Option Fits Your Apparel Project?`;
  if (format === "first_person_story")
    return `${k}: Honest Lessons From Building a Print Business`;
  if (format === "checklist") {
    if (stories OR incoherent)
      return `${k}: Practical Questions Local Buyers Should Ask`;
    return `${k}: A Decision Checklist for Apparel Buyers`;
  }
  return `${k}: What ${TitleCase(subcategory)} Buyers Should Know`;
}
```

**Also used:** refinement titles win first (`refinementMeta?.title || buildTitle`); `evaluateCustomTopic` uses a separate template (`: What Buyers Should Know`).

### Exact title template strings still in production

| Template | Location |
|---|---|
| `` `${k}: Which Option Fits Your Apparel Project?` `` | `engine.ts` `buildTitle` |
| `` `${k}: Honest Lessons From Building a Print Business` `` | `engine.ts` `buildTitle` |
| `` `${k}: Practical Questions Local Buyers Should Ask` `` | `engine.ts` `buildTitle` |
| `` `${k}: A Decision Checklist for Apparel Buyers` `` | `engine.ts` `buildTitle` |
| `` `${k}: What ${Subcategory} Buyers Should Know` `` | `engine.ts` `buildTitle` |
| `` `${Keyword}: What Buyers Should Know` `` | `brief.ts` `evaluateCustomTopic` |
| `"Embroidery vs. DTF Printing: Which Is Better for Work Shirts?"` | `specificity.ts` |
| `"Cotton vs. Polyester Shirts for Custom Printing: How to Choose"` | `specificity.ts` |
| `"DTF Transfers vs. Vinyl: Which Is Better for Small Apparel Orders?"` | `specificity.ts` |
| `"How to Choose a Custom Shirt Printer in Warner Robins: 9 Questions to Ask"` | `semanticIntent.ts` |

**Rejected generic pattern (gate, not generator):** `/^a practical guide to\b/i` in specificity/editorial/quality.

### Generic reader-question construction

1. **Refinement path:** hardcoded `readerQuestion` from `suggestRefinement` / `suggestLocalPrinterRefinement`.  
2. **Default path (`engine.ts`):**  
   `` `What should ${AUDIENCE_LABELS[audience].toLowerCase()} know about ${primaryKeyword}?` ``  
3. **Custom topic fallback (`brief.ts`):**  
   `` `What should readers know about ${primaryKeyword}?` ``  
4. **editorialControls** outline rebuild fallback:  
   `` `What should readers know about ${keyword}?` ``

---

## 7. Evidence planning

| Module | Key functions | Role |
|---|---|---|
| `contentPromise.ts` | `classifyContentPromise` | Classes: firsthand / cost / comparison / how_to / technical / local / informational |
| `evidenceBudget.ts` | `buildEvidenceBudget` | Maps promise → required evidence; `supportsCentralPromise`, `missingEvidence`, `confidence` |
| `editorialControls.ts` | `evaluatePreGeneration` | Orchestrates promise → budget → depth → decision + optional refine |
| `depthGate.ts` | `assessBriefDepth` | Information-gain gate (score ≥ 0.75 + checks) |

**Authoritative:** Locked fact sheet fields when present.  
**Heuristic:** Outline regex for “has criteria / has steps”; local facts via keyword regex (`warner|georgia|local`); `hasTechnicalFacts` often = `products.length > 0` in engine.

**Feature patch:** Prefer refine → NEEDS_MERCHANT_INPUT → REJECTED over weak DRAFT_ONLY filler (`editorialControls` comment).

**Tests:** `test/editorial-corpus.test.ts` (full promise/evidence matrix).

---

## 8. Opportunity scoring (`scoring.ts` + `outcomes.ts`)

### `scoreOpportunity`

Weighted sum of demand/growth/business/conversion/ranking/local/freshness/gap − overlapPenalty.  
Missing metrics → heuristic floors (`demandFromSignals` → 0.35, `growthFromSignals` → 0.4).

### Engine-side heuristic scorers (not metrics)

`businessRelevance`, `conversionIntent`, `localRelevance`, `fitsLegends`, `freshnessClass` — all keyword/regex heuristics in `engine.ts`.

### `classifyDemandEvidence`

- verified if volume/growth metrics used  
- else inferred if shopify/existing available  
- else `editorial_business_opportunity`

### `decideTopicOutcome` (`outcomes.ts`)

Order: editorial/semantic REJECTED → overlap/classification → specificity → NEEDS_MERCHANT_INPUT → quality violations → threshold checks → AUTO_ELIGIBLE else DRAFT_ONLY.

**Default thresholds (`DEFAULT_AUTO_THRESHOLDS`):** opportunity 0.78, business 0.7, specificity 0.85, factual 0.9, uniqueness 0.85, conversion 0.55, source 0.6, **articleQuality 0.9**, links 0.7.

### Critical inconsistency (failure mode)

At opportunity build time (`engine.ts`):

- `articleQuality` is hardcoded to **`0`**
- `factualConfidence` is at most **`0.7`** (never ≥ 0.9 threshold)

Therefore **`decideTopicOutcome` cannot return `AUTO_ELIGIBLE` under default thresholds during research scoring.**

Merge logic only **downgrades** AUTO→DRAFT when editorial is stricter; it does **not** upgrade DRAFT→AUTO when `evaluatePreGeneration` says AUTO_ELIGIBLE.

**Effect:** Autonomous schedule (`executeScheduledResearchCycle`) requires AUTO_ELIGIBLE and refuses DRAFT_ONLY filler → cycles tend toward `SKIPPED_NO_QUALIFIED_TOPIC` unless tests inject AUTO_ELIGIBLE opportunities. Manual `/research/briefs/:id/approve-generate` can still generate any non-interview-blocked brief.

Post-generation (`researchCycle.postGenerationDecision`) sets `articleQuality: gatesOk ? 0.95 : 0.4`, so AUTO eligibility is only computable **after** generation — but generation already requires AUTO.

---

## 9. Decision (`TopicDecision`)

Values (`types.ts`):

- `AUTO_ELIGIBLE` — schedule may generate (+ later publish if authorized)
- `DRAFT_ONLY` — visible; **not** auto-generated by scheduler
- `NEEDS_MERCHANT_INPUT` — brief + interview packet only
- `REJECTED` — blocked / quarantined
- `SKIPPED_NO_QUALIFIED_TOPIC` — cycle-level only

**Selection rank** (`engine.ts`): AUTO(4) > MERCHANT(2) > DRAFT(1); selected = auto ?? merchant ?? null (draft never selected for schedule).

**Admin visibility:** Research table columns for decision, reasons, missing evidence, replaced-by-other-topic (`views.ts` `researchPage` / `briefReviewPage`).

---

## 10. Reservation (`store.ts` `reserveOpportunity`)

**Inputs:** `opportunityId`, `workerId`, TTL default **900s**.

**SQL guards:** status not in rejected/used/approved; suggested OR expired reserved OR same worker; payload decision ≠ REJECTED; quarantine check.

**Outputs:** Opportunity with `status: "reserved"` or `null`.

**Lifecycle statuses (opportunity):** `suggested` | `reserved` | `approved` | `rejected` | `used`  
**Brief statuses:** `pending_review` | `approved` | `rejected` | `generated`

**DB:** `research_opportunities` CHECK constraint matches the five statuses.

**Failure modes:** Concurrent claim; quarantine after SELECT; expired reservation reclaim.

**Tests:** `test/research.test.ts` concurrent reserve; `test/refinement-rollout-regression.test.ts` legacy bad opportunities.

---

## 11. Brief (`brief.ts`)

### `buildArticleBrief(opportunity, args)`

Copies opportunity fields into `ArticleBrief`; builds `LockedFactSheet` (`buildLockedFactSheet`); sets `automaticPublishingEligible = decision === AUTO_ELIGIBLE`; SEO via `buildSeoDeliverables`; interview questions when required.

### `evaluateCustomTopic(topic, args)`

Parallel mini-pipeline: cluster → refine → overlap → title/question → `evaluatePreGeneration` → specificity → **always** decision ∈ {NEEDS_MERCHANT_INPUT, REJECTED, **DRAFT_ONLY**} (never auto-promotes custom to AUTO_ELIGIBLE).

**Duplication:** Refinement / product selection / preGen logic largely reimplemented vs `engine.ts`.

---

## 12. Generation (`writer.ts`)

**Location of prompts:** `src/writer.ts` → `generateArticle`.

- **System/instructions string** (lines ~144–156): senior content editor role, accuracy rules, no invented metrics/prices/specs.
- **Brief rules block** (lines ~120–141): when `brief` present — lock keyword, title, outline, fact sheet, prohibited claims.
- **User input:** JSON payload with `researchBrief`, `lockedFactSheet`, products, recent topics.
- **API:** OpenAI `responses.create` with strict JSON schema `shopify_blog_article`.
- **No separate prompt files** — prompts are inline in `writer.ts`.

**Called from:** `generateArticleFromBrief` (`researchCycle.ts`) and manual approve-generate (`server.ts`).

**Tests:** `test/writer.test.ts` (sanitize/validate); pipeline tests mock `generateArticle`.

---

## 13. Post-generation review

| Module | Function | Checks |
|---|---|---|
| `quality.ts` | `runQualityGates` | Aggregates all gates → `EvidenceReport` |
| `quality.ts` | `qualityGatesPassed` / `blocksAutoPublish` | critical/major + decision |
| `editorial.ts` | `runEditorialReview` | Title, meta, claims, first-person, links, overlap, placeholders, invented metrics + semantics |
| `technicalRules.ts` | `assessTechnicalAccuracy` | UV DTF category/pressing, interchangeable services, printer-pass, proofs, DPI, live prices |
| `salesLimits.ts` | `assessSalesContentLimits` | Brand density, CTAs, turnaround filler, unrelated UV links |
| `templateDetection.ts` | `assessTemplateFiller` | Generic headings, vague advice, keyword forcing |
| `semanticIntent.ts` | `assessGeneratedArticleSemantics` | Repetition, drift, UV DTF, insight |

**Duplication:** UV DTF rules appear in both `technicalRules` and `semanticIntent`; generic filler phrases duplicated across semantic/template; `evaluatePreGeneration` re-run post-gen with `disableAutoRefine: true`.

**Feature patches:** Story/checklist incoherent class; UV DTF product exclusion; sales/template gates added after known failure articles.

**Tests:** `editorial-corpus`, `semantic-intent-regression`, `autopilot-safety`, `research-inventory`.

---

## 14. Rollout counting (`rolloutProgress.ts` + `quarantine.ts`)

| Function | Role |
|---|---|
| `recordReviewedDraftForRollout` | Authoritative counter++ under `FOR UPDATE` + unique audit action `rollout_draft_counted` |
| `isEligibleForRolloutProgress` | Rejects REJECTED/archived/quarantined/failed gates/unapproved |
| `countsTowardRolloutDraft` | Convenience wrapper assuming evidence/gates/approval true |
| `quarantineFailedRolloutArticles` | Archives incoherent/REJECTED drafts |
| `quarantineFailedRolloutOpportunities` | Marks bad opportunities rejected |

**Eligibility requirements:** decision ≠ REJECTED; status not archived/failed/rejected; `countsTowardRollout ≠ false`; not quarantined/incoherent; evidence present; quality gates passed; merchant approved.

**Promotion thresholds** (`rollout.ts`): 30 consecutive reviewed drafts, 90% approval rate, 14 shadow-auto days.

**Tests:** `rollout-counter-concurrency.test.ts`, `refinement-rollout-regression.test.ts`.

**Admin:** Dashboard shows rollout mode + promotion progress; article approve path calls `recordReviewedDraftForRollout` (`server.ts` ~950).

---

## 15. Publication (`authorizePublish.ts` + `researchCycle.ts`)

### `authorizeAutomaticPublication`

Fail-closed. Requires:

1. Research-pipeline article + brief `AUTO_ELIGIBLE` + `automaticPublishingEligible` + no failed gates + interview if needed  
2. Evidence present + quality gates pass + `blocksAutoPublish` false  
3. Settings: enabled, !draftOnly, !killSwitch, `autoPublishExplicitlyActivated`, `rolloutMode === auto_publish`  
4. Promotion thresholds  
5. Frequency limits (`frequency.ts`)

**Shadow mode:** `wouldPublish` may be true; `ok` always false (no Shopify write).

### `executeScheduledResearchCycle` stages

1. Kill switch / mode / research.enabled gates  
2. Quarantine sweep  
3. Atomic `research_cycle_runs` slot claim  
4. Inventory load (incomplete → kill switch)  
5. `runResearchCycle` + `saveResearchCycle`  
6. Select AUTO (or merchant for interview)  
7. `reserveOpportunity` → `buildArticleBrief` → save  
8. Interview path OR observe stop OR generate  
9. Shadow/auto authorize; publish only if `auto_publish && auth.ok`  
10. Complete slot + audit events

**Rollout modes:** `paused` | `observe` | `draft_only` | `shadow_auto` | `auto_publish` (`rollout.ts`).

**Tests:** `autopilot-pipeline.test.ts`, `autopilot-shadow.test.ts`, `autopilot-safety.test.ts`.

---

## Opportunity lifecycle statuses (authoritative)

| Entity | Statuses |
|---|---|
| Opportunity | `suggested` → `reserved` → (`approved` manual) → `used` / `rejected` |
| Brief | `pending_review` → `approved` → `generated` / `rejected` |
| Cycle run | `running` → `completed` / `failed` |
| Article (research) | `generating` → `draft` / `archived`(REJECTED) → `ready`/`scheduled`/`published` |

Decision enum is separate from status and lives in JSON payloads + `generation_settings.decision`.

---

## DB state (tables)

Defined in `src/db.ts` migrate:

- `research_cycles`, `research_signals`, `research_opportunities`
- `article_briefs`, `merchant_interviews`, `merchant_knowledge`
- `pillar_usage`, `evidence_reports`, `research_cycle_runs`
- Unique index: `audit_events_rollout_draft_counted_article_uidx`

---

## Admin visibility map

| UI | Path | Shows |
|---|---|---|
| Dashboard | `/` | Rollout mode, latest cycle decision, auto thresholds |
| Research | `/research` | Missing providers, opportunity table (title, refined-from, reasons, promise class, missing evidence, score, decision, merchant-unlock) |
| Opportunity claim | `/research/opportunities/:id` | Reserves + builds brief |
| Brief review | `/research/briefs/:id` | Full decision telemetry, fact sheet, SEO, approve/generate |
| Interview | `/research/briefs/:id/interview` | Merchant Q&A |
| Custom topic | POST `/research/custom` | Parallel evaluate path |
| Settings | settings form | rolloutMode, research toggles, cadence, region, interview requirement |
| Articles | article detail | Evidence / generation flags / rollout count notices |

---

## Cross-cutting: duplicated logic & feature patches

**Duplication**

- Refinement pipeline: `engine.applyTopicRefinement` vs `brief.evaluateCustomTopic`
- Outline templates: `buildTopicSpecificOutline` vs `buildIntentOutline`
- UV DTF / filler / story-checklist guards across semantic, technical, sales, quarantine, quality
- `decideTopicOutcome` used both pre-gen (engine) and post-gen (researchCycle) with different scorecard inputs

**Feature-specific patches (known failure class: “local small-business stories” / apparel-buyer checklist)**

- `suggestLocalPrinterRefinement`
- `isIncoherentSearchIntent` / drift detectors
- `buildTitle` checklist special-case for stories
- `evaluatePreGeneration` auto-refine
- Quarantine feature gates (no exact-title list)
- UV DTF product hard-exclude in `productSelection`
- Schedule refusal of DRAFT_ONLY filler

---

## Related test inventory

| File | Focus |
|---|---|
| `test/research.test.ts` | Providers, clustering, scoring labels, rotation, reserve, facts |
| `test/research-inventory.test.ts` | Inventory completeness, Shopify facts, overlap sources |
| `test/editorial-corpus.test.ts` | Promise/evidence/depth corpus |
| `test/semantic-intent-regression.test.ts` | Story keyword class, fixture gates |
| `test/refinement-rollout-regression.test.ts` | Refinement + quarantine + rollout exclusion |
| `test/rollout-counter-concurrency.test.ts` | Idempotent counter |
| `test/autopilot-pipeline.test.ts` | Slot claim, AUTO/DRAFT/MERCHANT schedule behavior, authorize |
| `test/autopilot-shadow.test.ts` | Shadow wouldPublish vs ok |
| `test/autopilot-safety.test.ts` | Classification, thresholds, rollout modes, kill switch |

---

## Highest-impact findings

1. **All external demand providers are stubs** — production discovery is seed + Shopify catalog heuristics only.  
2. **`decideTopicOutcome` cannot emit AUTO_ELIGIBLE at research time** with defaults (`articleQuality: 0`, `factualConfidence ≤ 0.7` vs thresholds 0.9). Editorial AUTO is not promoted. Autonomous generation is therefore structurally starved unless thresholds change or scorecard is fixed.  
3. **Double refinement** (applyTopicRefinement + evaluatePreGeneration) and duplicated custom-topic path increase drift risk but also patch the story-keyword failure class.  
4. **Title templates remain production strings** (Decision Checklist / Buyers Should Know / Which Option Fits / Honest Lessons / Practical Questions).  
5. **Rollout eligibility is feature-based and concurrency-safe**; REJECTED/quarantined drafts correctly excluded from the 30-count.
