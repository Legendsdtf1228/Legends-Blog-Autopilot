/**
 * M3 semantic ReaderTask clustering — pure comparison and determinism tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  clusterDemandStatus,
  clusterReaderTasksSemantically,
  compareReaderTasksSemantically,
  detectHardConflicts,
  selectCanonicalReaderTask,
  SEMANTIC_CLUSTERING_VERSION
} from "../src/research/index.js";
import {
  clusterable,
  cottonPolyDuplicatePair,
  makeTask,
  schoolVsBrandCottonTasks,
  uvDtfVsApparelTasks
} from "./helpers/m3ClusterFixtures.js";
import { defaultSettings } from "../src/defaults.js";

test("M3: exact semantic duplicates with different wording merge", () => {
  const inputs = cottonPolyDuplicatePair();
  const result = clusterReaderTasksSemantically(inputs);
  assert.equal(result.clusters.length, 1);
  assert.equal(result.clusters[0]!.memberReaderTaskIds.length, 2);
  assert.ok(result.clusters[0]!.wordingVariants.length >= 2);
  assert.ok(result.clusters[0]!.similarityExplanation.length > 10);
  assert.equal(result.clusters[0]!.demandStatus, "observed");
});

test("M3: same keywords but different audiences stay separate", () => {
  const inputs = schoolVsBrandCottonTasks();
  const cmp = compareReaderTasksSemantically(inputs[0]!.task, inputs[1]!.task);
  assert.ok(cmp.hardConflicts.length >= 1, cmp.explanation);
  assert.equal(cmp.decision, "separate");
  const result = clusterReaderTasksSemantically(inputs);
  assert.equal(result.clusters.length, 2);
});

test("M3: same audience but different decisions stay separate", () => {
  const audience = "New clothing-brand owners preparing first blank orders";
  const fabric = makeTask({
    id: "rt:dec-fabric",
    audience,
    situation: "Choosing blanks for a catalog launch",
    problem: "Unsure which fabric fits print quality",
    actualQuestion: "Should I choose cotton or polyester shirts for the catalog?",
    decisionOrAction: "choose cotton or polyester fabric blanks for the catalog",
    desiredOutcome: "Retail-ready fabric hand-feel",
    searchIntent: "commercial"
  });
  const method = makeTask({
    id: "rt:dec-method",
    audience,
    situation: "Choosing decoration for the same catalog launch",
    problem: "Unsure whether DTF or screen printing fits the volume",
    actualQuestion: "Should I choose DTF or screen printing for the catalog shirts?",
    decisionOrAction: "choose DTF or screen printing as the decoration method",
    desiredOutcome: "Reliable decoration quality at catalog volume",
    searchIntent: "commercial"
  });
  const cmp = compareReaderTasksSemantically(fabric, method);
  assert.equal(cmp.decision, "separate", cmp.explanation);
  assert.ok(detectHardConflicts(fabric, method).some(r => /decision/i.test(r)));
});

test("M3: UV DTF hard-surface versus apparel mismatch", () => {
  const inputs = uvDtfVsApparelTasks();
  const cmp = compareReaderTasksSemantically(inputs[0]!.task, inputs[1]!.task);
  assert.equal(cmp.decision, "separate", cmp.explanation);
  assert.ok(cmp.hardConflicts.some(r => /surface|product|category/i.test(r)));
});

test("M3: school/team apparel with different legitimate audiences stay separate", () => {
  const school = makeTask({
    id: "rt:school-40",
    audience: "Middle Georgia school spirit coordinators",
    situation: "Ordering about 40 spirit shirts before Friday kickoff",
    problem: "Unsure which decoration method hits the deadline",
    actualQuestion: "Which decoration method should we use for 40 spirit shirts before Friday?",
    decisionOrAction: "choose DTF or screen printing and place the school order",
    desiredOutcome: "Shirts arrive on time for kickoff",
    constraints: ["40 units", "Friday deadline"],
    searchIntent: "local"
  });
  const team = makeTask({
    id: "rt:rec-league",
    audience: "Adult recreational league team managers",
    situation: "Ordering roster shirts for a 12-team summer league",
    problem: "Unsure which decoration method fits roster names and numbers",
    actualQuestion: "Which decoration method should we use for adult league roster shirts?",
    decisionOrAction: "choose DTF or screen printing for roster-numbered league shirts",
    desiredOutcome: "Durable roster shirts for a full season",
    constraints: ["roster names", "season durability"],
    searchIntent: "commercial"
  });
  const result = clusterReaderTasksSemantically([clusterable(school), clusterable(team)]);
  assert.equal(result.clusters.length, 2);
});

test("M3: local and national tasks that should merge (shared non-local decision)", () => {
  const local = makeTask({
    id: "rt:art-local",
    audience: "New clothing-brand owners preparing first DTF orders",
    situation: "Uploading logo artwork for a first gang sheet",
    problem: "Artwork looks soft when scaled to chest size",
    actualQuestion: "How should I evaluate logo resolution for DTF at the final print size before I order?",
    decisionOrAction: "check artwork resolution at final output size and fix the file before ordering",
    desiredOutcome: "A print-ready file that stays sharp at chest size",
    searchIntent: "informational",
    legendsRelevance: "Artwork prep for DTF gang sheets; Middle Georgia customers welcome"
  });
  const national = makeTask({
    id: "rt:art-national",
    audience: "New clothing-brand owners preparing first DTF orders",
    situation: "Uploading logo artwork for a first gang sheet",
    problem: "Artwork looks soft when scaled to chest size",
    actualQuestion: "How should I evaluate logo resolution for DTF at the final print size before ordering?",
    decisionOrAction: "check artwork resolution at final output size and fix the file before ordering",
    desiredOutcome: "A print-ready file that stays sharp at chest size",
    searchIntent: "informational",
    legendsRelevance: "Artwork preparation guidance for DTF gang sheets for nationwide online customers"
  });
  const cmp = compareReaderTasksSemantically(local, national);
  assert.equal(cmp.decision, "merge", cmp.explanation);
  const result = clusterReaderTasksSemantically([clusterable(local), clusterable(national)]);
  assert.equal(result.clusters.length, 1);
});

test("M3: local and national tasks that must remain distinct (vendor choice)", () => {
  const local = makeTask({
    id: "rt:vendor-local",
    audience: "Warner Robins small-business owners needing custom shirts",
    situation: "Choosing a local printer for employee shirts near Warner Robins",
    problem: "Unsure which local shop can hit a Friday deadline",
    actualQuestion: "How should I choose a local custom shirt printer near Warner Robins?",
    decisionOrAction: "choose a local Warner Robins area printer and place the order",
    desiredOutcome: "On-time local pickup for employee shirts",
    searchIntent: "local"
  });
  const national = makeTask({
    id: "rt:vendor-national",
    audience: "Online store owners shipping shirts nationwide",
    situation: "Choosing a mail-order transfer vendor for national fulfillment",
    problem: "Unsure which national vendor fits mail-order transfer workflows",
    actualQuestion: "How should I choose a nationwide DTF transfer vendor for online orders?",
    decisionOrAction: "choose a nationwide transfer vendor for mail-order fulfillment",
    desiredOutcome: "Reliable nationwide shipping of transfers",
    searchIntent: "commercial"
  });
  const cmp = compareReaderTasksSemantically(local, national);
  assert.equal(cmp.decision, "separate", cmp.explanation);
});

test("M3: firsthand versus educational intent stay separate", () => {
  const firsthand = makeTask({
    id: "rt:firsthand",
    audience: "Print-shop operators sharing firsthand production lessons",
    situation: "Reflecting on mistakes from running a print shop",
    problem: "Need to explain firsthand lessons about rush orders",
    actualQuestion: "What firsthand lessons matter when taking rush DTF orders in a small shop?",
    decisionOrAction: "document firsthand rush-order lessons for shop operators",
    desiredOutcome: "Honest operator guidance grounded in shop experience",
    searchIntent: "informational",
    sourceProvenance: ["firsthand:owner-interview"]
  });
  const edu = makeTask({
    id: "rt:edu-rush",
    audience: "New clothing-brand owners learning production basics",
    situation: "Planning a first rush order without shop experience",
    problem: "Unsure how rush timelines work for DTF",
    actualQuestion: "How should a new brand evaluate rush timelines for a first DTF order?",
    decisionOrAction: "evaluate rush timeline options before placing a first DTF order",
    desiredOutcome: "A realistic rush plan for a first order",
    searchIntent: "informational"
  });
  const cmp = compareReaderTasksSemantically(firsthand, edu);
  assert.equal(cmp.decision, "separate", cmp.explanation);
});

test("M3: conflicting constraints keep tasks separate", () => {
  const small = makeTask({
    id: "rt:qty-40",
    audience: "Middle Georgia school spirit coordinators",
    situation: "Ordering about 40 spirit shirts before Friday kickoff",
    problem: "Need a decoration method for a small rush order",
    actualQuestion: "Which decoration method fits 40 spirit shirts before Friday?",
    decisionOrAction: "choose DTF or screen printing for a 40-piece rush school order",
    desiredOutcome: "On-time shirts for kickoff",
    constraints: ["40 units", "Friday deadline"],
    searchIntent: "local"
  });
  const large = makeTask({
    id: "rt:qty-500",
    audience: "Middle Georgia school spirit coordinators",
    situation: "Ordering about 500 spirit shirts for a district-wide event",
    problem: "Need a decoration method for a large district order",
    actualQuestion: "Which decoration method fits 500 spirit shirts for a district event?",
    decisionOrAction: "choose DTF or screen printing for a 500-piece district school order",
    desiredOutcome: "Consistent shirts across schools",
    constraints: ["500 units", "district budget"],
    searchIntent: "local"
  });
  const cmp = compareReaderTasksSemantically(small, large);
  assert.ok(cmp.decision === "separate" || cmp.hardConflicts.some(r => /quantity/i.test(r)), cmp.explanation);
});

test("M3: deterministic canonical selection prefers approved observed fresh complete tasks", () => {
  const weak = clusterable(
    makeTask({
      id: "rt:canon-weak",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing blanks",
      problem: "Unsure about fabric",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
      decisionOrAction: "choose cotton or polyester fabric blanks",
      desiredOutcome: "Good blanks",
      confidence: "low",
      freshness: "aging",
      demandEvidence: {
        status: "unavailable",
        summary: "no demand",
        metrics: {},
        sourceRefs: [],
        lastUpdated: null
      }
    }),
    { hasActiveApprovedEvidence: false }
  );
  const strong = clusterable(
    makeTask({
      id: "rt:canon-strong",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing blanks for a small custom-print catalog launch with retail hand-feel goals",
      problem: "Unsure whether cotton or polyester blanks fit print quality and customer feel",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing on a first catalog?",
      decisionOrAction: "choose cotton or polyester fabric blanks for the first catalog run",
      desiredOutcome: "Blanks that print cleanly and feel right for retail customers",
      confidence: "high",
      freshness: "fresh",
      stakes: "Poor blanks waste launch budget",
      constraints: ["first catalog", "retail feel"]
    }),
    { hasActiveApprovedEvidence: true }
  );
  const canonical = selectCanonicalReaderTask([weak, strong]);
  assert.equal(canonical.task.id, "rt:canon-strong");
});

test("M3: stable cluster IDs independent of input order", () => {
  const inputs = cottonPolyDuplicatePair();
  const a = clusterReaderTasksSemantically(inputs);
  const b = clusterReaderTasksSemantically([...inputs].reverse());
  assert.equal(a.clusters[0]!.id, b.clusters[0]!.id);
  assert.equal(a.clusters[0]!.canonicalReaderTaskId, b.clusters[0]!.canonicalReaderTaskId);
  assert.deepEqual(a.clusters[0]!.memberReaderTaskIds, b.clusters[0]!.memberReaderTaskIds);
});

test("M3: repeated runs are deterministic for identities and explanations", () => {
  const mixed = [
    ...cottonPolyDuplicatePair(),
    ...schoolVsBrandCottonTasks(),
    ...uvDtfVsApparelTasks()
  ];
  const a = clusterReaderTasksSemantically(mixed);
  const b = clusterReaderTasksSemantically([...mixed].reverse());
  assert.equal(a.clusteringVersion, SEMANTIC_CLUSTERING_VERSION);
  assert.deepEqual(
    a.clusters.map(c => ({ id: c.id, canonical: c.canonicalReaderTaskId, members: c.memberReaderTaskIds })),
    b.clusters.map(c => ({ id: c.id, canonical: c.canonicalReaderTaskId, members: c.memberReaderTaskIds }))
  );
  assert.deepEqual(
    a.clusters.map(c => c.similarityExplanation),
    b.clusters.map(c => c.similarityExplanation)
  );
});

test("M3: inferred/pending evidence cannot elevate cluster demand", () => {
  const inferred = clusterable(
    makeTask({
      id: "rt:inferred",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Brainstorming fabric options",
      problem: "Exploring cotton versus polyester without validated demand",
      actualQuestion: "What open questions exist around cotton vs polyester shirts?",
      decisionOrAction: "brainstorm fabric options only",
      desiredOutcome: "brainstorm exploration",
      demandEvidence: {
        status: "inferred_seed",
        summary: "seed only",
        metrics: {},
        sourceRefs: ["seed:x"],
        lastUpdated: null
      },
      confidence: "low"
    }),
    { hasActiveApprovedEvidence: false, inactive: true, inactiveReason: "inferred/seed demand only" }
  );
  const unavailable = clusterable(
    makeTask({
      id: "rt:unavail",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing blanks for a catalog launch",
      problem: "Unsure which fabric fits",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
      decisionOrAction: "choose cotton or polyester fabric blanks for the catalog",
      desiredOutcome: "Retail-ready blanks",
      demandEvidence: {
        status: "unavailable",
        summary: "pending approval",
        metrics: {},
        sourceRefs: [],
        lastUpdated: null
      }
    }),
    { hasActiveApprovedEvidence: false }
  );
  assert.equal(clusterDemandStatus([inferred, unavailable]), "unavailable");
});

test("M3: ambiguous similarity routed to review (not auto-merged)", () => {
  const a = makeTask({
    id: "rt:amb-a",
    audience: "Apparel buyers comparing decoration options",
    situation: "Planning a mid-size custom order",
    problem: "Need clarity on decoration tradeoffs",
    actualQuestion: "How should apparel buyers compare DTF and embroidery for mixed orders?",
    decisionOrAction: "compare DTF and embroidery tradeoffs for a mixed apparel order",
    desiredOutcome: "A workable decoration mix",
    searchIntent: "commercial"
  });
  const b = makeTask({
    id: "rt:amb-b",
    audience: "Apparel buyers evaluating print methods",
    situation: "Planning custom apparel with mixed techniques",
    problem: "Unclear when embroidery beats DTF",
    actualQuestion: "When should apparel buyers prefer embroidery over DTF on mixed garments?",
    decisionOrAction: "decide when embroidery is preferable to DTF on mixed garments",
    desiredOutcome: "Clear method choice for mixed garments",
    searchIntent: "commercial"
  });
  const cmp = compareReaderTasksSemantically(a, b);
  // May be review or separate depending on score — must not silently force merge without strong alignment.
  assert.notEqual(cmp.decision, "merge");
  const result = clusterReaderTasksSemantically([clusterable(a), clusterable(b)]);
  if (cmp.decision === "review") {
    assert.ok(result.reviewCandidates.length >= 1);
    assert.equal(result.clusters.length, 2);
  }
});

test("M3: keyword overlap alone is not deciding rule", () => {
  const inputs = schoolVsBrandCottonTasks();
  const cmp = compareReaderTasksSemantically(inputs[0]!.task, inputs[1]!.task);
  assert.ok(cmp.hardConflicts.length >= 1, "audience/decision conflicts must separate despite shared fabric keywords");
  assert.equal(cmp.decision, "separate");
});

test("M3: production remains paused", () => {
  assert.equal(defaultSettings.enabled, false);
  assert.equal(defaultSettings.rolloutMode, "draft_only");
  assert.equal(defaultSettings.draftOnlyMode, true);
});
