import type { OpportunityCluster } from "./opportunityCluster.js";
import type { ReaderTask } from "./readerTask.js";
import {
  buildNaturalTitle,
  READER_QUESTION_PROVENANCE,
  type ReaderQuestionProvenance
} from "./naturalLanguage.js";

export interface CanonicalReaderTaskBrief {
  clusterId: string;
  canonicalReaderTaskId: string;
  primaryKeyword: string;
  proposedTitle: string;
  readerQuestion: string;
  readerQuestionProvenance: ReaderQuestionProvenance;
  audience: string;
  situation: string;
  problem: string;
  decisionOrAction: string;
  intent: ReaderTask["searchIntent"];
  desiredOutcome: string;
  constraints: string[];
  proposedOutline: string[];
}

/**
 * M5 framing for active M1–M4 clusters. This is a pure projection: it neither
 * changes nor upgrades demand, evidence, approval, freshness, or cluster state.
 */
export function buildCanonicalReaderTaskBrief(args: {
  cluster: OpportunityCluster;
  canonicalTask: ReaderTask;
  primaryKeyword: string;
}): CanonicalReaderTaskBrief {
  const { cluster, canonicalTask } = args;
  if (cluster.status !== "active") {
    throw new Error(`Canonical ReaderTask framing requires an active cluster; received ${cluster.status}.`);
  }
  if (cluster.canonicalReaderTaskId !== canonicalTask.id) {
    throw new Error(
      `ReaderTask ${canonicalTask.id} is not canonical for cluster ${cluster.id}.`
    );
  }

  const proposedTitle = buildNaturalTitle({
    primaryKeyword: args.primaryKeyword,
    question: {
      text: canonicalTask.actualQuestion,
      provenance: READER_QUESTION_PROVENANCE.APPROVED_READER_TASK_QUESTION
    },
    readerTask: canonicalTask,
    intent: canonicalTask.searchIntent,
    variantKey: cluster.materialHash
  });

  const constraints = canonicalTask.constraints.length
    ? canonicalTask.constraints.map(value => value.trim()).filter(Boolean)
    : ["No explicit reader constraints were recorded."];

  return {
    clusterId: cluster.id,
    canonicalReaderTaskId: canonicalTask.id,
    primaryKeyword: args.primaryKeyword,
    proposedTitle,
    readerQuestion: canonicalTask.actualQuestion,
    readerQuestionProvenance: READER_QUESTION_PROVENANCE.APPROVED_READER_TASK_QUESTION,
    audience: canonicalTask.audience,
    situation: canonicalTask.situation,
    problem: canonicalTask.problem,
    decisionOrAction: canonicalTask.decisionOrAction,
    intent: canonicalTask.searchIntent,
    desiredOutcome: canonicalTask.desiredOutcome,
    constraints: [...canonicalTask.constraints],
    proposedOutline: [
      `${canonicalTask.audience}: ${canonicalTask.situation}`,
      `Decision or action: ${canonicalTask.decisionOrAction}`,
      `Problem to resolve: ${canonicalTask.problem}`,
      `Reader question: ${canonicalTask.actualQuestion}`,
      `Desired outcome for ${canonicalTask.searchIntent} intent: ${canonicalTask.desiredOutcome}`,
      `Constraints that change the answer: ${constraints.join("; ")}`,
      `What is at stake: ${canonicalTask.stakes}`
    ]
  };
}