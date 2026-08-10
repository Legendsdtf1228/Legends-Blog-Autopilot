/**
 * Shared builders for M2 approval trust-boundary tests.
 * Test-only identities — not production merchant evidence.
 */
import { computeEvidenceContentHash } from "../src/research/evidenceApproval.js";
import type { FaqImportRecord } from "../src/research/providers/approvedFaqImport.js";

export function buildExplicitlyApprovedFaqRecord(
  overrides: Partial<FaqImportRecord> & { id: string }
): FaqImportRecord {
  const base: FaqImportRecord = {
    id: overrides.id,
    audience: overrides.audience || "Middle Georgia school spirit coordinators",
    situation:
      overrides.situation ||
      "Ordering about 40 spirit shirts before a Friday kickoff with a fixed budget and no reprint window",
    problem:
      overrides.problem ||
      "Unsure whether DTF transfers or screen printing will hit the deadline without quality issues",
    question:
      overrides.question ||
      "Which decoration method should we use for 40 spirit shirts before Friday kickoff?",
    decisionOrAction:
      overrides.decisionOrAction || "choose DTF or screen printing and place the order this week",
    desiredOutcome:
      overrides.desiredOutcome || "Shirts arrive on time with acceptable durability for game day",
    stakes: overrides.stakes || "Missing kickoff or reprinting wastes limited booster funds",
    constraints: overrides.constraints || ["fixed budget", "no weekend production days", "about 40 units"],
    geographicRelevance: overrides.geographicRelevance || "Middle Georgia / Warner Robins",
    evidenceSummary:
      overrides.evidenceSummary ||
      "Explicitly approved test FAQ for trust-boundary verification — not a production merchant artifact.",
    periodStart: overrides.periodStart ?? "2026-01-01",
    periodEnd: overrides.periodEnd ?? "2026-01-31",
    legendsRelevance:
      overrides.legendsRelevance ||
      "Legends offers DTF transfers and can discuss decoration tradeoffs for school orders",
    metrics: overrides.metrics
  };

  const contentHash = computeEvidenceContentHash({
    sourceReference: base.id,
    normalizedProblem: base.problem,
    normalizedQuestion: base.question,
    evidenceSummary: base.evidenceSummary,
    audienceHint: base.audience,
    situationHint: base.situation,
    decisionHint: base.decisionOrAction,
    desiredOutcomeHint: base.desiredOutcome,
    stakesHint: base.stakes,
    constraintsHint: base.constraints,
    legendsRelevanceHint: base.legendsRelevance,
    periodStart: base.periodStart || null,
    periodEnd: base.periodEnd || null,
    geographicRelevance: base.geographicRelevance || null,
    metrics: base.metrics || {}
  });

  return {
    ...base,
    approvalState: overrides.approvalState || "APPROVED",
    approvedBy: overrides.approvedBy === undefined ? "ops:test-approver@legends.local" : overrides.approvedBy,
    approvedAt: overrides.approvedAt === undefined ? "2026-02-01T15:00:00.000Z" : overrides.approvedAt,
    approvalMethod: overrides.approvalMethod || "manual_ops_approval",
    contentHash: overrides.contentHash || contentHash,
    publicUsageAllowed: overrides.publicUsageAllowed !== false,
    usageScope: overrides.usageScope || "public_blog_editorial",
    templateExample: overrides.templateExample
  };
}
