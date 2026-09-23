# M5 Natural Titles and Intent-Native Briefs

## Scope

M5 replaces manufactured title and reader-question fallbacks with deterministic,
intent-native framing. When a validated ReaderTask question is available, the
title is derived from that question. Legacy candidate paths continue to work
without treating a seed, template, or generated framing as evidence.

## Behavior changes

- Comparison, local, transactional, how-to, checklist, troubleshooting, and
  firsthand paths now receive distinct natural title shapes.
- Generic `What ... buyers/readers should know` framing is removed from
  production title and reader-question fallbacks.
- The default brief outline now follows the reader's decision, trade-offs,
  conditions, and next step rather than a generic taxonomy outline.
- Existing refinement-specific titles and questions remain authoritative for
  those paths.

## Safety and compatibility

- No database schema, production data, reservation, threshold, rollout
  qualification, or publishing behavior changed.
- SourceEvidence, ReaderTask, knowledge-registry, freshness, authority,
  contradiction, and fail-closed gates remain unchanged.
- Generated titles/questions are editorial framing only. They do not elevate
  evidence status, demand status, content authority, or AUTO eligibility.
- Production remains `draft_only`; no automatic publishing was enabled.
- Pipeline pins now identify `title.v1.reader-question-native` and
  `brief.v2.intent-native-reader-task`.

## Tests and validation

- M5 natural-title and reader-question regression tests pass.
- Focused M1–M4 regression tests pass.
- `npm run typecheck` passes.
- `npm run build` passes.
- The complete suite ran 268 tests: 215 passed, 47 failed, and 6 skipped.
  All 47 failures were PostgreSQL setup failures (`ECONNREFUSED
  127.0.0.1:5432`) before assertions; no production database credentials were
  used.

## Rollback

Revert the single M5 milestone commit. The change is additive at the code and
documentation level and has no migration or data rollback requirement.

## Remaining risk

The complete database-backed suite still needs an isolated local PostgreSQL
test database for end-to-end verification. The offline regression suite covers
the new title/brief behavior and the accepted M1–M4 trust boundaries.