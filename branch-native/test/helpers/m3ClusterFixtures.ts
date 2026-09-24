/**
 * Test helpers for M3 semantic clustering fixtures.
 */
import { createHash } from "node:crypto";
import { emptyReaderTask, type ReaderTask } from "../../src/research/readerTask.js";
import type { ClusterableReaderTask } from "../../src/research/opportunityCluster.js";
import type { SearchIntent } from "../../src/research/types.js";

export function fingerprintFor(task: Pick<ReaderTask, "audience" | "actualQuestion" | "decisionOrAction" | "situation">): string {
  const norm = [task.audience, task.actualQuestion, task.decisionOrAction, task.situation]
    .map(s => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim())
    .join("|");
  return createHash("sha1").update(norm).digest("hex").slice(0, 24);
}

export function makeTask(
  partial: Partial<ReaderTask> & {
    id: string;
    audience: string;
    situation: string;
    problem: string;
    actualQuestion: string;
    decisionOrAction: string;
    desiredOutcome: string;
  }
): ReaderTask {
  const base = {
    audience: partial.audience,
    situation: partial.situation,
    problem: partial.problem,
    actualQuestion: partial.actualQuestion,
    decisionOrAction: partial.decisionOrAction,
    desiredOutcome: partial.desiredOutcome
  };
  return emptyReaderTask({
    ...partial,
    id: partial.id,
    searchIntent: (partial.searchIntent || "informational") as SearchIntent | "unknown",
    stakes: partial.stakes || "",
    constraints: partial.constraints || [],
    evidenceRequired: partial.evidenceRequired || [],
    evidenceAvailable: partial.evidenceAvailable || [],
    demandEvidence: partial.demandEvidence || {
      status: "observed",
      summary: "test observed demand",
      metrics: {},
      sourceRefs: [partial.id],
      lastUpdated: "2026-02-01T00:00:00.000Z"
    },
    legendsRelevance: partial.legendsRelevance || "Legends DTF relevance",
    conversionPath: partial.conversionPath ?? null,
    sourceProvenance: partial.sourceProvenance || [`test:${partial.id}`],
    confidence: partial.confidence || "high",
    freshness: partial.freshness || "fresh",
    semanticFingerprint: partial.semanticFingerprint || fingerprintFor(base)
  });
}

export function clusterable(
  task: ReaderTask,
  opts: Partial<ClusterableReaderTask> = {}
): ClusterableReaderTask {
  return {
    task,
    supportingSourceEvidenceIds: opts.supportingSourceEvidenceIds || [`ev:${task.id}`],
    hasActiveApprovedEvidence: opts.hasActiveApprovedEvidence ?? true,
    inactive: opts.inactive,
    inactiveReason: opts.inactiveReason
  };
}

/** Exact semantic duplicates with different wording (cotton vs polyester). */
export function cottonPolyDuplicatePair(): ClusterableReaderTask[] {
  const a = makeTask({
    id: "rt:cotton-poly-a",
    audience: "New clothing-brand owners preparing first blank orders",
    situation: "Choosing blanks for a small custom-print catalog launch",
    problem: "Unsure whether cotton or polyester blanks fit print quality and customer feel",
    actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
    decisionOrAction: "choose cotton or polyester fabric blanks for the first catalog run",
    desiredOutcome: "Blanks that print cleanly and feel right for retail customers",
    constraints: ["first catalog", "retail feel"],
    searchIntent: "commercial"
  });
  const b = makeTask({
    id: "rt:cotton-poly-b",
    audience: "New clothing-brand owners preparing first blank orders",
    situation: "Choosing blanks for a small custom-print catalog launch",
    problem: "Unsure whether cotton or polyester blanks fit print quality and customer feel for custom printing",
    actualQuestion: "Cotton vs polyester shirts for custom printing — which fabric should I choose?",
    decisionOrAction: "choose cotton or polyester fabric blanks for the first catalog run",
    desiredOutcome: "Blanks that print cleanly and feel right for retail customers",
    constraints: ["first catalog", "retail feel"],
    searchIntent: "commercial"
  });
  return [clusterable(a), clusterable(b)];
}

export function schoolVsBrandCottonTasks(): ClusterableReaderTask[] {
  const school = makeTask({
    id: "rt:school-spirit-cotton",
    audience: "Middle Georgia school spirit coordinators",
    situation: "Ordering about 100 spirit shirts before Friday kickoff with a fixed booster budget",
    problem: "Unsure whether cotton or polyester spirit shirts will survive game day and hit the deadline",
    actualQuestion: "Which fabric should we use for 100 school spirit shirts before Friday?",
    decisionOrAction: "choose cotton or polyester spirit shirts and place the rush school order",
    desiredOutcome: "Shirts arrive on time for kickoff with acceptable game-day durability",
    constraints: ["100 pieces", "Friday deadline", "booster budget"],
    stakes: "Missing kickoff wastes booster funds",
    searchIntent: "local"
  });
  const brand = makeTask({
    id: "rt:brand-retail-cotton",
    audience: "Clothing brand owners building retail merchandise lines",
    situation: "Choosing fabric for ongoing retail merchandise production",
    problem: "Need a fabric that matches brand hand-feel for retail shelves",
    actualQuestion: "Should a clothing brand choose cotton or polyester for retail merchandise shirts?",
    decisionOrAction: "choose cotton or polyester fabric for retail merchandise blanks",
    desiredOutcome: "Consistent retail hand-feel across restocks",
    constraints: ["retail shelf standards", "repeatable blanks"],
    searchIntent: "commercial"
  });
  return [clusterable(school), clusterable(brand)];
}

export function uvDtfVsApparelTasks(): ClusterableReaderTask[] {
  const hard = makeTask({
    id: "rt:uv-tumbler",
    audience: "Small gift-shop owners adding hard-surface products",
    situation: "Adding custom tumblers and glassware to a local gift assortment",
    problem: "Unsure whether UV DTF is the right decoration for hard tumblers",
    actualQuestion: "Should I use UV DTF for custom tumblers and hard-surface drinkware?",
    decisionOrAction: "choose UV DTF or an alternative for hard-surface tumbler decoration",
    desiredOutcome: "Durable decoration on tumblers that survives washing",
    searchIntent: "commercial"
  });
  const apparel = makeTask({
    id: "rt:apparel-dtf",
    audience: "Small gift-shop owners adding custom apparel",
    situation: "Adding custom t-shirts beside the gift assortment",
    problem: "Unsure whether DTF transfers are right for apparel decoration",
    actualQuestion: "Should I use DTF transfers for custom apparel shirts?",
    decisionOrAction: "choose DTF transfers for apparel shirt decoration",
    desiredOutcome: "Soft durable prints on shirts",
    searchIntent: "commercial"
  });
  return [clusterable(hard), clusterable(apparel)];
}
