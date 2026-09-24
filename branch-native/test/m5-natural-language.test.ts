import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntentReaderQuestion,
  buildNaturalTitle,
  buildNaturalTitleCorpus,
  READER_QUESTION_PROVENANCE,
  type NaturalTitleInput
} from "../src/research/naturalLanguage.js";
import { buildCanonicalReaderTaskBrief } from "../src/research/readerTaskFraming.js";
import { emptyReaderTask, type ReaderTask } from "../src/research/readerTask.js";
import { clusterReaderTasksSemantically } from "../src/research/semanticClustering.js";

const FORBIDDEN_TEMPLATES = [
  /which option fits your apparel project/i,
  /honest lessons from building a print business/i,
  /practical questions local buyers should ask/i,
  /a decision checklist for apparel buyers/i,
  /what .* buyers should know/i,
  /what buyers should know/i
];

function task(overrides: Partial<ReaderTask> & Pick<ReaderTask, "id">): ReaderTask {
  return emptyReaderTask({
    audience: "School spirit-wear coordinators",
    situation: "A 60-shirt fundraiser order must be ready before Friday",
    problem: "The coordinator cannot tell which decoration method fits the deadline",
    actualQuestion: "Should we choose DTF or screen printing for this school shirt order?",
    decisionOrAction: "choose a decoration method for the order",
    searchIntent: "commercial",
    desiredOutcome: "select a supportable method before requesting quotes",
    stakes: "A late or unsuitable order would miss the fundraiser",
    constraints: ["The shirts must be ready before Friday", "The order contains 60 shirts"],
    demandEvidence: {
      status: "observed",
      summary: "Observed in an approved customer question.",
      sourceRefs: ["faq:school-order"],
      lastUpdated: "2026-09-20T00:00:00.000Z"
    },
    sourceProvenance: ["approved_faq"],
    confidence: "high",
    freshness: "fresh",
    semanticFingerprint: overrides.id,
    ...overrides
  });
}

function activeCluster(canonicalTask: ReaderTask) {
  const result = clusterReaderTasksSemantically([
    {
      task: canonicalTask,
      supportingSourceEvidenceIds: [`evidence:${canonicalTask.id}`],
      hasActiveApprovedEvidence: true
    }
  ]);
  const cluster = result.clusters[0];
  assert.ok(cluster);
  assert.equal(cluster.status, "active");
  return cluster;
}

function normalizedTitleShape(title: string, input: NaturalTitleInput): string {
  const escapedTopic = input.primaryKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return title
    .toLowerCase()
    .replace(new RegExp(escapedTopic, "gi"), " topic ")
    .replace(/\b(schools?|teams?|brands?|buyers?|owners?|coordinators?|customers?)\b/g, " audience ")
    .replace(/\b\d+\b/g, " number ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(token => token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token)
    .join(" ");
}

test("actual or approved questions may directly drive a title", () => {
  const title = buildNaturalTitle({
    primaryKeyword: "embroidery vs DTF for work shirts",
    question: {
      text: "Should I choose embroidery or DTF printing for employee work shirts?",
      provenance: READER_QUESTION_PROVENANCE.ACTUAL_READER_QUESTION
    },
    format: "comparison",
    intent: "commercial"
  });

  assert.equal(title, "Embroidery or DTF Printing for Employee Work Shirts: How to Choose");
});

test("editorial fallback questions cannot enter the direct-question title path", () => {
  const generated = buildIntentReaderQuestion({
    primaryKeyword: "cotton vs polyester shirts for printing",
    audienceLabel: "People comparing garment options",
    format: "comparison",
    intent: "commercial"
  });
  const title = buildNaturalTitle({
    primaryKeyword: "cotton vs polyester shirts for printing",
    question: {
      text: generated,
      provenance: READER_QUESTION_PROVENANCE.EDITORIAL_FALLBACK
    },
    format: "comparison",
    intent: "commercial",
    variantKey: "legacy-comparison"
  });

  assert.doesNotMatch(title, /^Which differences matter most/i);
  assert.doesNotMatch(title, /people comparing garment options compares/i);
  assert.ok(FORBIDDEN_TEMPLATES.every(pattern => !pattern.test(title)));
});

test("generated comparison framing avoids duplicated comparison wording", () => {
  const inputs: NaturalTitleInput[] = Array.from({ length: 12 }, (_, index) => ({
    primaryKeyword: `cotton vs polyester work shirts ${index}`,
    question: {
      text: `Which differences matter most when comparing cotton vs polyester work shirts ${index}?`,
      provenance: READER_QUESTION_PROVENANCE.EDITORIAL_FALLBACK
    },
    format: "comparison",
    intent: "commercial",
    variantKey: `comparison-${index}`
  }));
  const titles = buildNaturalTitleCorpus(inputs);
  assert.ok(titles.every(title => !/\bcompare\b.*\b(vs\.?|versus)\b/i.test(title)));
  assert.ok(titles.every(title => !/\bbetween\b.*\b(vs\.?|versus)\b/i.test(title)));
});

test("representative fallback corpus has no title structure above 20 percent", () => {
  const inputs: NaturalTitleInput[] = Array.from({ length: 30 }, (_, index) => ({
    primaryKeyword: `method ${index} for school order ${index}`,
    question: {
      text: `Which differences matter most when comparing method ${index} for school order ${index}?`,
      provenance: READER_QUESTION_PROVENANCE.EDITORIAL_FALLBACK
    },
    format: "comparison",
    intent: "commercial",
    variantKey: `corpus-${index}`
  }));
  const titles = buildNaturalTitleCorpus(inputs);
  const shapes = titles.map((title, index) => normalizedTitleShape(title, inputs[index]!));
  const counts = [...new Set(shapes)].map(shape => shapes.filter(value => value === shape).length);

  assert.ok(Math.max(...counts) / titles.length <= 0.2, JSON.stringify({ titles, shapes, counts }, null, 2));
  assert.ok(titles.every(title => FORBIDDEN_TEMPLATES.every(pattern => !pattern.test(title))));
});

test("corpus output is deterministic and permutation-stable", () => {
  const inputs: NaturalTitleInput[] = Array.from({ length: 18 }, (_, index) => ({
    primaryKeyword: `artwork preparation case ${index}`,
    question: {
      text: `Which decisions and constraints shape artwork preparation case ${index}?`,
      provenance: READER_QUESTION_PROVENANCE.EDITORIAL_FALLBACK
    },
    format: "how_to",
    intent: "informational",
    variantKey: `stable-${index}`
  }));
  const first = buildNaturalTitleCorpus(inputs);
  const retry = buildNaturalTitleCorpus(inputs);
  const reversedInputs = [...inputs].reverse();
  const reversed = buildNaturalTitleCorpus(reversedInputs);
  const byKeyword = new Map(reversedInputs.map((input, index) => [input.primaryKeyword, reversed[index]]));

  assert.deepEqual(retry, first);
  inputs.forEach((input, index) => assert.equal(byKeyword.get(input.primaryKeyword), first[index]));
});

test("title fitting does not leave unsafe clipping endings", () => {
  const title = buildNaturalTitle({
    primaryKeyword: "a very long custom apparel planning topic ".repeat(8),
    question: {
      text: "Which decisions and constraints shape this unusually long custom apparel planning request?",
      provenance: READER_QUESTION_PROVENANCE.EDITORIAL_FALLBACK
    },
    format: "how_to",
    intent: "informational",
    variantKey: "long-title"
  });
  assert.ok(title.length <= 120);
  assert.doesNotMatch(title, /[,:;–—-]$/);
  assert.doesNotMatch(title, /\s[a-z]{1,2}$/i);
});

test("canonical active-cluster framing consumes the full ReaderTask and preserves trust state", () => {
  const firstTask = task({ id: "task-friday" });
  const secondTask = task({
    id: "task-budget",
    audience: "New clothing-brand owners",
    situation: "A first retail drop has a fixed launch budget",
    problem: "The owner must balance garment feel against decoration cost",
    actualQuestion: "Should we choose DTF or screen printing for this first shirt drop?",
    decisionOrAction: "choose a decoration method for the first retail drop",
    searchIntent: "commercial",
    desiredOutcome: "choose a method that fits the launch plan",
    stakes: "The first drop must protect limited launch cash",
    constraints: ["The decoration budget cannot exceed $500", "The run contains 60 shirts"],
    semanticFingerprint: "task-budget"
  });
  const firstCluster = activeCluster(firstTask);
  const secondCluster = activeCluster(secondTask);
  const beforeFirst = structuredClone({ cluster: firstCluster, task: firstTask });
  const beforeSecond = structuredClone({ cluster: secondCluster, task: secondTask });

  const first = buildCanonicalReaderTaskBrief({
    cluster: firstCluster,
    canonicalTask: firstTask,
    primaryKeyword: "shirt decoration method"
  });
  const second = buildCanonicalReaderTaskBrief({
    cluster: secondCluster,
    canonicalTask: secondTask,
    primaryKeyword: "shirt decoration method"
  });

  assert.notEqual(first.proposedTitle, second.proposedTitle);
  assert.notDeepEqual(first.proposedOutline, second.proposedOutline);
  assert.equal(first.readerQuestion, firstTask.actualQuestion);
  assert.equal(first.readerQuestionProvenance, "APPROVED_READER_TASK_QUESTION");
  for (const value of [
    firstTask.audience,
    firstTask.situation,
    firstTask.problem,
    firstTask.actualQuestion,
    firstTask.decisionOrAction,
    firstTask.desiredOutcome,
    firstTask.constraints[0]!,
    firstTask.stakes
  ]) {
    assert.ok(first.proposedOutline.some(section => section.includes(value)));
  }

  assert.deepEqual({ cluster: firstCluster, task: firstTask }, beforeFirst);
  assert.deepEqual({ cluster: secondCluster, task: secondTask }, beforeSecond);
  assert.equal(firstCluster.demandStatus, beforeFirst.cluster.demandStatus);
  assert.equal(firstTask.demandEvidence.status, beforeFirst.task.demandEvidence.status);
});

test("non-active or mismatched clusters fail closed", () => {
  const canonicalTask = task({ id: "task-active" });
  const cluster = activeCluster(canonicalTask);

  assert.throws(() => buildCanonicalReaderTaskBrief({
    cluster: { ...cluster, status: "needs_review" },
    canonicalTask,
    primaryKeyword: "shirt decoration method"
  }), /requires an active cluster/i);
  assert.throws(() => buildCanonicalReaderTaskBrief({
    cluster,
    canonicalTask: task({ id: "different-task" }),
    primaryKeyword: "shirt decoration method"
  }), /is not canonical/i);
});