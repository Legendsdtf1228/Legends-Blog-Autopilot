# M5 Report — Natural titles and intent-native briefs

**Commit basis:** M5 on `cursor/topic-research-engine-338a` after M4 tip `71b4189`  
**PR #7:** remain Draft  
**Production behavior:** template title production paths removed; research remains paused `draft_only`; no AUTO_ELIGIBLE invented

---

## Scope

- Generate **natural titles** from canonical ReaderTasks (post-task, optionally post-evidence)
- Build **intent-native briefs** from ReaderTask + optional M4 evidence budget
- **Delete** production template title suffixes from keyword-engine and custom-topic paths
- Enforce title-pattern **diversity ≤ 20%**
- Title naturalness corpus tests

**Not in M5:** opportunity decision engine changes (M6), generation lock / dual-pass verification (M7), feedback dashboard (M8), legacy migration (M9), shadow qualification (M10).

---

## Schema / migration

Migration id: `012_natural_title_briefs`

| Table | Purpose |
|---|---|
| `natural_title_proposals` | ReaderTask-derived titles + pattern family + diversity flags |
| `intent_native_briefs` | Decision-centered briefs (never AUTO) |
| `title_generation_runs` | Operational run accounting |

Pipeline pins:

- `titleGeneration`: `title.v1.reader-task-natural`
- `briefSchema`: `brief.v2.intent-native-reader-task`

---

## Banned template title production paths (removed)

Production generators no longer emit:

- `…: What Buyers Should Know` / `What {subcategory} Buyers Should Know`
- `…: Which Option Fits Your Apparel Project?`
- `…: A Decision Checklist for Apparel Buyers`
- `…: Honest Lessons From Building a Print Business`
- `…: Practical Questions Local Buyers Should Ask`
- `A Practical Guide to…`

Replaced by:

- `buildNaturalTitleFromKeyword()` in `engine.ts` / `brief.ts` keyword paths
- `generateNaturalTitleFromReaderTask()` for canonical ReaderTask clusters

Hardcoded refinement titles (e.g. cotton vs polyester how-to-choose) remain allowed when they are specific and not banned templates.

---

## Natural title behavior

Module: `src/research/naturalTitle.ts`

- Derives title from `actualQuestion` / `decisionOrAction` (comparison, local how-to, technical, compressed question)
- Optional M4 evidence budget can strip unsupported price wording
- Pattern family classification + `TITLE_DIVERSITY_MAX_SHARE = 0.20`
- Deterministic ids / material hashes

---

## Intent-native brief behavior

Module: `src/research/intentNativeBrief.ts`

- `readerQuestion` = ReaderTask `actualQuestion`
- Outline from decision/situation/constraints (not format template filler)
- Carries approved facts / safe exclusions / missing evidence from M4 budget when present
- `decisionHint`: `DRAFT_CANDIDATE` | `NEEDS_EVIDENCE` | `NEEDS_MERCHANT_INPUT` | `BLOCKED`
- **Never** `AUTO_ELIGIBLE`

---

## Admin visibility

`/research` card: Natural titles & intent-native briefs (M5) with counts, pattern families, samples, and generate action.

---

## Production behavior comparison

| Behavior | Before M5 | After M5 |
|---|---|---|
| Template title suffixes in engine/custom topic | Yes | Removed |
| ReaderTask → title/brief path | Absent | Additive store + admin generate |
| AUTO thresholds / scheduler | Unchanged | Unchanged |
| Research enabled / draft_only defaults | Unchanged | Unchanged |
| Legacy opportunities / reservations | Untouched | Untouched |

---

## Rollback plan

1. Revert `engine.ts` / `brief.ts` title helpers if needed (or keep natural keyword titles).
2. Leave `012_*` tables unused or drop in reverse if empty.
3. No reservation repair required.

---

## Unresolved M6 risks

- Intent-native briefs are not yet the opportunity decision source of truth
- Keyword-engine opportunities still use outline helpers from format/promise classes
- Diversity is enforced on ReaderTask title proposals; legacy opportunity title history is separate
- AUTO starvation remains until M6 decision/lifecycle work uses real evidence readiness honestly

---

## Test results

Corpus: banned-template detection, cotton/local/firsthand/DPI natural titles, keyword + `runResearchCycle` paths, diversity cap, deterministic hashing, intent-native brief shape, DB idempotency, reservation invariance.

Run: `npm run typecheck && npm test && npm run build`
