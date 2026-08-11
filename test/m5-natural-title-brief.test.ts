/**
 * M5 title naturalness corpus + intent-native brief tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  BANNED_TITLE_TEMPLATE_PATTERNS,
  PIPELINE_VERSIONS,
  TITLE_DIVERSITY_MAX_SHARE,
  buildIntentNativeBriefFromReaderTask,
  buildNaturalTitleFromKeyword,
  computeTitlePatternFamily,
  evaluateTitleDiversity,
  generateNaturalTitleFromReaderTask,
  isBannedTemplateTitle,
  runResearchCycle
} from "../src/research/index.js";
import {
  clusterFromTask,
  cottonPolyTask,
  firsthandGrowthTask,
  localWarnerRobinsTask,
  pricingTask
} from "./helpers/m4KnowledgeFixtures.js";
import { makeTask } from "./helpers/m3ClusterFixtures.js";
import { DEFAULT_RESEARCH_SETTINGS } from "../src/research/pillars.js";

test("M5: version pins moved off template-era title/brief", () => {
  assert.equal(PIPELINE_VERSIONS.titleGeneration, "title.v1.reader-task-natural");
  assert.equal(PIPELINE_VERSIONS.briefSchema, "brief.v2.intent-native-reader-task");
  assert.equal(TITLE_DIVERSITY_MAX_SHARE, 0.2);
});

test("M5 corpus: banned template patterns are detected", () => {
  const banned = [
    "Cotton Shirts: What Buyers Should Know",
    "DTF Transfers: Which Option Fits Your Apparel Project?",
    "Local Stories: A Decision Checklist for Apparel Buyers",
    "Leaving a 9-to-5: Honest Lessons From Building a Print Business",
    "Local Stories: Practical Questions Local Buyers Should Ask",
    "A Practical Guide to Custom Printing"
  ];
  for (const title of banned) {
    assert.equal(isBannedTemplateTitle(title), true, title);
  }
  assert.ok(BANNED_TITLE_TEMPLATE_PATTERNS.length >= 5);
});

test("M5 corpus: cotton vs polyester ReaderTask yields natural comparison title", () => {
  const task = cottonPolyTask();
  const proposal = generateNaturalTitleFromReaderTask({ task, cluster: clusterFromTask(task) });
  assert.equal(proposal.bannedTemplate, false);
  assert.ok(/\bvs\b/i.test(proposal.title), proposal.title);
  assert.ok(/how to choose/i.test(proposal.title), proposal.title);
  assert.equal(isBannedTemplateTitle(proposal.title), false);
  assert.equal(proposal.readerQuestion, task.actualQuestion);
  assert.ok(!/What Buyers Should Know|Which Option Fits|Decision Checklist|Honest Lessons/i.test(proposal.title));
});

test("M5 corpus: local Warner Robins task yields concrete local how-to title", () => {
  const task = localWarnerRobinsTask();
  const proposal = generateNaturalTitleFromReaderTask({ task });
  assert.equal(proposal.bannedTemplate, false);
  assert.match(proposal.title, /Warner Robins|How to/i);
  assert.equal(isBannedTemplateTitle(proposal.title), false);
});

test("M5 corpus: firsthand growth task does not use Honest Lessons template", () => {
  const task = firsthandGrowthTask();
  const proposal = generateNaturalTitleFromReaderTask({ task });
  assert.equal(isBannedTemplateTitle(proposal.title), false);
  assert.doesNotMatch(proposal.title, /Honest Lessons From Building a Print Business/i);
});

test("M5 corpus: artwork DPI task gets technical natural title", () => {
  const task = makeTask({
    id: "rt:m5-dpi",
    audience: "Apparel designers preparing logo files",
    situation: "Exporting a logo for apparel DTF at final print size",
    problem: "Unsure about resolution requirements",
    actualQuestion: "What DPI should my artwork use at final print size for apparel DTF?",
    decisionOrAction: "set artwork resolution for apparel DTF print size",
    desiredOutcome: "Print-ready artwork without pixelation",
    searchIntent: "informational"
  });
  const proposal = generateNaturalTitleFromReaderTask({ task });
  assert.equal(isBannedTemplateTitle(proposal.title), false);
  assert.match(proposal.title, /DPI|Artwork|Resolution/i);
});

test("M5: keyword engine path no longer emits banned templates", () => {
  const cases = [
    { primaryKeyword: "custom shirts", format: "faq", intent: "informational" },
    { primaryKeyword: "dtf transfers", format: "comparison", intent: "commercial" },
    { primaryKeyword: "print shop stories", format: "first_person_story", intent: "informational" },
    { primaryKeyword: "local small-business stories", format: "checklist", intent: "informational" }
  ];
  for (const c of cases) {
    const title = buildNaturalTitleFromKeyword(c);
    assert.equal(isBannedTemplateTitle(title), false, `${c.primaryKeyword} -> ${title}`);
  }
});

test("M5: runResearchCycle opportunities do not use banned template titles", async () => {
  const result = await runResearchCycle({
    products: [],
    existingArticles: [],
    usage: [],
    settings: {
      ...DEFAULT_RESEARCH_SETTINGS,
      enabled: true
    },
    extraKeywords: ["cotton vs polyester shirts for custom printing", "dtf transfers for small orders"]
  });
  assert.ok(result.opportunities.length >= 1);
  for (const o of result.opportunities) {
    assert.equal(
      isBannedTemplateTitle(o.proposedTitle),
      false,
      o.proposedTitle
    );
  }
});

test("M5: diversity cap is 20% for meaningful pools", () => {
  const recent = Array.from({ length: 8 }, (_, i) => `Alpha vs Beta Option ${i}: How to Choose`);
  const next = "Gamma vs Delta Fabrics: How to Choose";
  const d = evaluateTitleDiversity(next, recent);
  assert.equal(d.family, "comparison_how_to_choose");
  assert.ok(d.share > TITLE_DIVERSITY_MAX_SHARE);
  assert.equal(d.ok, false);
});

test("M5: identical ReaderTask title generation is deterministic", () => {
  const task = cottonPolyTask();
  const a = generateNaturalTitleFromReaderTask({ task });
  const b = generateNaturalTitleFromReaderTask({ task });
  assert.equal(a.title, b.title);
  assert.equal(a.materialHash, b.materialHash);
  assert.equal(a.id, b.id);
});

test("M5: intent-native brief uses actualQuestion and decision outline", () => {
  const task = cottonPolyTask();
  const title = generateNaturalTitleFromReaderTask({ task });
  const brief = buildIntentNativeBriefFromReaderTask({
    task,
    cluster: clusterFromTask(task),
    titleProposal: title
  });
  assert.equal(brief.readerQuestion, task.actualQuestion);
  assert.equal(brief.proposedTitle, title.title);
  assert.ok(brief.proposedOutline.length >= 3);
  assert.ok(brief.proposedOutline.some(l => /decision|compare|criteria|tradeoff/i.test(l)));
  assert.ok(["DRAFT_CANDIDATE", "NEEDS_EVIDENCE", "NEEDS_MERCHANT_INPUT", "BLOCKED"].includes(brief.decisionHint));
  assert.notEqual(brief.decisionHint as string, "AUTO_ELIGIBLE");
  assert.equal(isBannedTemplateTitle(brief.proposedTitle), false);
});

test("M5: intent-native brief never assigns AUTO and respects missing evidence", () => {
  const task = pricingTask();
  const brief = buildIntentNativeBriefFromReaderTask({
    task,
    evidenceBudget: {
      clusterId: "c1",
      canonicalReaderTaskId: task.id,
      evaluationVersion: "test",
      supportedClaims: [],
      partiallySupportedClaims: [],
      unsupportedClaims: ["price"],
      conflictingClaims: [],
      staleClaims: [],
      missingFirsthandKnowledge: [],
      missingTechnicalEvidence: [],
      missingQuantitativeEvidence: ["price"],
      prohibitedClaims: [],
      approvedFacts: [],
      safeExclusions: ["Do not state: price"],
      evidenceReadiness: {
        status: "partial",
        summary: "partial",
        blockingReasons: ["missing quantitative"]
      },
      claimRequirements: [],
      materialHash: "x",
      schemaVersion: "clusterEvidenceBudget.v1",
      pipelineVersions: {
        stampedAt: "2026-08-11T00:00:00.000Z",
        versions: PIPELINE_VERSIONS,
        milestone: "M4"
      }
    }
  });
  assert.equal(brief.decisionHint, "NEEDS_EVIDENCE");
  assert.ok(brief.missingEvidence.some(m => /quantitative|unsupported/i.test(m)));
  assert.ok(brief.safeExclusions.length >= 1);
});

test("M5: pattern family classifier distinguishes comparison vs how-to", () => {
  assert.equal(computeTitlePatternFamily("Cotton vs Polyester for Retail: How to Choose"), "comparison_how_to_choose");
  assert.equal(computeTitlePatternFamily("How to Choose a Custom Shirt Printer in Warner Robins"), "local_howto");
  assert.equal(computeTitlePatternFamily("What DPI should my artwork use?"), "question_form");
});
