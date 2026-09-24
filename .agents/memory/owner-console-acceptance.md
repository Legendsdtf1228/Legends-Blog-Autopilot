---
name: Accepted owner-console checkpoint
description: User acceptance boundary for the standalone M5 owner console and where to find its verification record.
---

The user accepted the standalone M5 owner-console branch as a fixed, locally verified code checkpoint. The exact commit and preserved evidence are recorded in `verification/m5-owner-console/ACCEPTANCE.md`; the release gates are in the adjacent readiness checklist.

**Why:** Acceptance of the code did not authorize an additional M5 change, merge into main, production migration, publishing enablement, or deployment. Treat the accepted revision as a reproducible baseline rather than an automatically shippable release.

**How to apply:** Before any later release work, read the acceptance report, confirm the exact branch tip, and obtain separate release authorization. Keep pending knowledge and draft-only publishing restrictions intact. Do not silently advance the accepted checkpoint.