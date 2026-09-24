# M5 Natural Titles and Intent-Native Briefs

## Scope

M5 replaces manufactured title and reader-question fallbacks with deterministic,
intent-native framing. The acceptance correction makes question provenance
explicit and adds a pure framing path from an active M1–M4
`OpportunityCluster` and its canonical `ReaderTask`. Legacy candidate paths
continue to work without treating a seed, template, or generated framing as
observed reader language or evidence.

## Behavior changes

- Reader questions carry one of three explicit provenance values:
  `ACTUAL_READER_QUESTION`, `APPROVED_READER_TASK_QUESTION`, or
  `EDITORIAL_FALLBACK`.
- Only actual questions and approved canonical ReaderTask questions may enter
  the direct question-to-title path. A bare legacy string is conservatively
  treated as `EDITORIAL_FALLBACK`.
- The canonical cluster path deterministically uses the ReaderTask's audience,
  actual question, decision/action, situation, problem, intent, desired
  outcome, stakes, and constraints in title and brief framing.
- Comparison, local, transactional, how-to, checklist, troubleshooting, and
  firsthand paths receive deterministic natural title shapes.
- Corpus generation assigns unique candidate material across six title
  structures after stable sorting. This is deterministic and
  permutation-stable; it uses no randomization.
- Generic `What ... buyers/readers should know` framing is removed from
  production title and reader-question fallbacks.
- The default brief outline follows the reader's decision, trade-offs,
  conditions, and next step rather than a generic taxonomy outline.
- Existing refinement-specific titles and questions remain authoritative for
  those paths, while their generated questions remain labeled editorial
  fallback.

## Safety and compatibility

- No database schema, production data, reservation, threshold, rollout
  qualification, or publishing behavior changed.
- SourceEvidence, ReaderTask, knowledge-registry, freshness, authority,
  contradiction, and fail-closed gates remain unchanged.
- Canonical ReaderTask framing is a pure projection. Tests verify that it does
  not mutate cluster state, ReaderTask demand evidence, approval, freshness, or
  authority.
- Generated titles/questions are editorial framing only. They do not elevate
  evidence status, demand status, content authority, or AUTO eligibility.
- Production remains `draft_only`; no automatic publishing was enabled.
- Pipeline pins identify `title.v2.provenance-aware-balanced` and
  `brief.v3.canonical-reader-task`.

## Tests and validation

- `npm run typecheck`: passed.
- Focused M1–M5 regression run: 59 passed, 0 failed, 0 skipped.
- `npm run build`: passed.
- Complete database-backed `npm test`: 272 passed, 0 failed, 0 skipped.
- The complete run used a newly initialized disposable PostgreSQL 16.10
  service at `127.0.0.1:55432`, database `m5_test`, owned by the local
  `runner` user with trust authentication. Its data directory and socket were
  under `/tmp`; no production credentials, connection strings, or data were
  used.
- M5 coverage includes explicit provenance safety, canonical active-cluster
  integration, two materially different ReaderTasks sharing one keyword,
  normalized structural diversity capped at 20%, grammatical agreement,
  duplicate comparison wording, safe clipping, deterministic retries, and
  permutation stability.

## Rollback

Revert the narrow M5 acceptance-correction commit to restore the prior M5
implementation. Revert the original M5 milestone commit as well to remove M5
entirely. The change has no migration or data rollback requirement.

## Remaining risk

Natural-language quality is corpus-dependent. The deterministic representative
corpus now enforces structural balance and known grammar/wording regressions,
but future topic classes may require additional reviewed language fixtures.
This does not weaken evidence or publishing controls: generated framing remains
editorial-only, and production remains paused in `draft_only`.