/**
 * M1 unit tests: ReaderTask coherence + versioning foundation.
 * Does not change production opportunity generation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReaderTaskStatement,
  emptyReaderTask,
  validateReaderTaskCoherence
} from "../src/research/readerTask.js";
import {
  PIPELINE_VERSIONS,
  createPipelineVersionStamp,
  pipelineVersionSummary
} from "../src/research/versioning.js";
import { defaultSettings } from "../src/defaults.js";

test("M1: production remains paused in draft_only", () => {
  assert.equal(defaultSettings.enabled, false);
  assert.equal(defaultSettings.draftOnlyMode, true);
  assert.equal(defaultSettings.rolloutMode, "draft_only");
});

test("M1: pipeline version stamp includes all required keys", () => {
  const stamp = createPipelineVersionStamp("M1");
  assert.equal(stamp.milestone, "M1");
  assert.ok(stamp.stampedAt);
  for (const key of [
    "provider",
    "normalization",
    "clustering",
    "titleGeneration",
    "decisionPolicy",
    "briefSchema",
    "generationPrompt",
    "verificationRubric",
    "readerTaskSchema"
  ] as const) {
    assert.equal(typeof PIPELINE_VERSIONS[key], "string");
    assert.equal(stamp.versions[key], PIPELINE_VERSIONS[key]);
  }
  assert.match(pipelineVersionSummary(stamp), /provider=/);
});

test("M1: coherent reader task statement validates", () => {
  const task = emptyReaderTask({
    id: "rt-1",
    audience: "Middle Georgia school spirit coordinators",
    situation: "ordering spirit wear before kickoff with a fixed budget",
    problem: "uncertain whether DTF or screen print fits the timeline",
    actualQuestion: "Which decoration method should we use for 40 spirit shirts before Friday?",
    decisionOrAction: "choose a decoration method and place the order",
    desiredOutcome: "shirts arrive on time without reprinting"
  });
  const result = validateReaderTaskCoherence(task);
  assert.equal(result.ok, true, result.reasons.join("; "));
  assert.match(
    buildReaderTaskStatement(task),
    /Middle Georgia school spirit coordinators needs to choose/
  );
});

test("M1: generic know-about and taxonomy leakage fail coherence", () => {
  const generic = validateReaderTaskCoherence({
    audience: "buyers",
    situation: "x",
    problem: "x",
    actualQuestion: "What should readers know about embroidery?",
    decisionOrAction: "learn",
    desiredOutcome: "info"
  });
  assert.equal(generic.ok, false);
  assert.ok(generic.reasons.some(r => /generic|Audience|Question|Decision|Situation/i.test(r)));

  const leak = validateReaderTaskCoherence({
    audience: "production education buyers",
    situation: "choosing a method",
    problem: "unclear subcategory fit",
    actualQuestion: "What should production education buyers know about the content pillar?",
    decisionOrAction: "pick a subcategory",
    desiredOutcome: "aligned pillar language"
  });
  assert.equal(leak.ok, false);
  assert.ok(leak.reasons.some(r => /Taxonomy|Audience|Question/i.test(r)));
});

test("M1: seed-inferred demand must not claim verified status on empty task", () => {
  const task = emptyReaderTask({ id: "rt-seed" });
  assert.equal(task.demandEvidence.status, "unavailable");
  assert.notEqual(task.demandEvidence.status, "verified");
});
