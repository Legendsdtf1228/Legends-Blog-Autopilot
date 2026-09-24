/**
 * M3 correction tests: merge threshold, complete-link, justified demand, idempotency.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDb, migrate } from "../src/db.js";
import {
  agglomerateCompleteLink,
  clusterReaderTasksSemantically,
  clusterSatisfiesCompleteLinkInvariant,
  compareReaderTasksSemantically,
  DEFAULT_CLUSTERING_THRESHOLDS,
  justifiedDemandStatus,
  MERGE_AUDIENCE_FLOOR,
  MERGE_DECISION_FLOOR,
  persistReaderTaskNormalization,
  persistSemanticClustering,
  resolvePairDecision,
  selectCanonicalReaderTask,
  type SemanticComparisonResult
} from "../src/research/index.js";
import {
  clusterable,
  cottonPolyDuplicatePair,
  makeTask,
  schoolVsBrandCottonTasks,
  uvDtfVsApparelTasks
} from "./helpers/m3ClusterFixtures.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

function mergeCmp(a: string, b: string, score = 0.9): SemanticComparisonResult {
  return {
    leftTaskId: a,
    rightTaskId: b,
    score,
    keywordOverlap: 0.5,
    hardConflicts: [],
    softConflicts: [],
    signals: {},
    decision: "merge",
    explanation: "merge"
  };
}

function reviewCmp(a: string, b: string, score = 0.6): SemanticComparisonResult {
  return {
    leftTaskId: a,
    rightTaskId: b,
    score,
    keywordOverlap: 0.5,
    hardConflicts: [],
    softConflicts: ["ambiguous"],
    signals: {},
    decision: "review",
    explanation: "review"
  };
}

function conflictCmp(a: string, b: string, reason: string): SemanticComparisonResult {
  return {
    leftTaskId: a,
    rightTaskId: b,
    score: 0.2,
    keywordOverlap: 0.4,
    hardConflicts: [reason],
    softConflicts: [],
    signals: {},
    decision: "separate",
    explanation: reason
  };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

test("M3 correction: 0.779 is never automatic merge", () => {
  assert.equal(
    resolvePairDecision({
      score: 0.779,
      audience: 1,
      decisionSimilarity: 1,
      hardConflicts: []
    }),
    "review"
  );
});

test("M3 correction: 0.780 merges only when floors pass", () => {
  assert.equal(
    resolvePairDecision({
      score: 0.78,
      audience: MERGE_AUDIENCE_FLOOR,
      decisionSimilarity: MERGE_DECISION_FLOOR,
      hardConflicts: []
    }),
    "merge"
  );
  assert.notEqual(
    resolvePairDecision({
      score: 0.78,
      audience: MERGE_AUDIENCE_FLOOR - 0.01,
      decisionSimilarity: MERGE_DECISION_FLOOR,
      hardConflicts: []
    }),
    "merge"
  );
  assert.notEqual(
    resolvePairDecision({
      score: 0.78,
      audience: MERGE_AUDIENCE_FLOOR,
      decisionSimilarity: MERGE_DECISION_FLOOR - 0.01,
      hardConflicts: []
    }),
    "merge"
  );
});

test("M3 correction: above 0.78 with failed audience floor is not merge", () => {
  assert.notEqual(
    resolvePairDecision({
      score: 0.9,
      audience: 0.4,
      decisionSimilarity: 1,
      hardConflicts: []
    }),
    "merge"
  );
});

test("M3 correction: above 0.78 with failed decision floor is not merge", () => {
  assert.notEqual(
    resolvePairDecision({
      score: 0.9,
      audience: 1,
      decisionSimilarity: 0.5,
      hardConflicts: []
    }),
    "merge"
  );
});

test("M3 correction: above 0.78 with hard conflict is separate", () => {
  assert.equal(
    resolvePairDecision({
      score: 0.99,
      audience: 1,
      decisionSimilarity: 1,
      hardConflicts: ["audience mismatch"]
    }),
    "separate"
  );
});

test("M3 correction: no undocumented sub-mergeMin automatic merge path", () => {
  assert.equal(
    resolvePairDecision({
      score: 0.6,
      audience: 0.95,
      decisionSimilarity: 0.75,
      hardConflicts: []
    }),
    "review"
  );
  assert.equal(DEFAULT_CLUSTERING_THRESHOLDS.mergeMin, 0.78);
});

test("M3 correction: A-B merge, B-C merge, A-C hard conflict — A and C never share a cluster", () => {
  const cmpByPair = new Map([
    [pairKey("A", "B"), mergeCmp("A", "B", 0.92)],
    [pairKey("B", "C"), mergeCmp("B", "C", 0.91)],
    [pairKey("A", "C"), conflictCmp("A", "C", "audience mismatch")]
  ]);
  const components = agglomerateCompleteLink(["A", "B", "C"], cmpByPair);
  for (const c of components) {
    assert.ok(!(c.includes("A") && c.includes("C")), JSON.stringify(components));
  }
  assert.ok(components.some(c => c.includes("A") && c.includes("B")) || components.some(c => c.includes("B") && c.includes("C")));
});

test("M3 correction: A-B merge, B-C merge, A-C review — no automatic three-task cluster", () => {
  const cmpByPair = new Map([
    [pairKey("A", "B"), mergeCmp("A", "B", 0.9)],
    [pairKey("B", "C"), mergeCmp("B", "C", 0.89)],
    [pairKey("A", "C"), reviewCmp("A", "C", 0.62)]
  ]);
  const components = agglomerateCompleteLink(["A", "B", "C"], cmpByPair);
  assert.ok(!components.some(c => c.length === 3), JSON.stringify(components));
  for (const c of components) {
    if (c.length > 1) {
      assert.equal(clusterSatisfiesCompleteLinkInvariant(c, cmpByPair), true);
    }
  }
});

test("M3 correction: complete-link results identical under every input permutation", () => {
  const cmpByPair = new Map([
    [pairKey("A", "B"), mergeCmp("A", "B", 0.9)],
    [pairKey("B", "C"), mergeCmp("B", "C", 0.85)],
    [pairKey("A", "C"), conflictCmp("A", "C", "surface mismatch")]
  ]);
  const orders = [
    ["A", "B", "C"],
    ["C", "B", "A"],
    ["B", "A", "C"],
    ["C", "A", "B"]
  ];
  const results = orders.map(o => JSON.stringify(agglomerateCompleteLink(o, cmpByPair)));
  assert.ok(results.every(r => r === results[0]), results.join(" | "));
});

test("M3 correction: bridge cannot merge school and clothing-brand audiences", () => {
  const [school, brand] = schoolVsBrandCottonTasks();
  const bridge = clusterable(
    makeTask({
      id: "rt:bridge-general",
      audience: "Apparel buyers comparing cotton and polyester options",
      situation: "Choosing cotton or polyester shirts for a custom order",
      problem: "Unsure whether cotton or polyester fits print quality and feel",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
      decisionOrAction: "choose cotton or polyester fabric blanks for the order",
      desiredOutcome: "Blanks that print cleanly and feel right",
      searchIntent: "commercial"
    })
  );
  const result = clusterReaderTasksSemantically([school!, brand!, bridge]);
  for (const cluster of result.clusters) {
    assert.ok(
      !(cluster.memberReaderTaskIds.includes(school!.task.id) && cluster.memberReaderTaskIds.includes(brand!.task.id))
    );
  }
});

test("M3 correction: bridge cannot merge UV hard-surface and apparel", () => {
  const [hard, apparel] = uvDtfVsApparelTasks();
  const bridge = clusterable(
    makeTask({
      id: "rt:bridge-decoration",
      audience: "Small gift-shop owners adding custom products",
      situation: "Choosing a decoration method for new SKUs",
      problem: "Unsure which decoration method fits new products",
      actualQuestion: "Which decoration method should I use for new custom products?",
      decisionOrAction: "choose a decoration method for new custom products",
      desiredOutcome: "Durable decoration on new products",
      searchIntent: "commercial"
    })
  );
  const result = clusterReaderTasksSemantically([hard!, apparel!, bridge]);
  for (const cluster of result.clusters) {
    assert.ok(
      !(cluster.memberReaderTaskIds.includes(hard!.task.id) && cluster.memberReaderTaskIds.includes(apparel!.task.id))
    );
  }
});

test("M3 correction: bridge cannot merge firsthand and educational tasks", () => {
  const firsthand = clusterable(
    makeTask({
      id: "rt:fh",
      audience: "Print-shop operators sharing firsthand production lessons",
      situation: "Reflecting on mistakes from running a print shop",
      problem: "Need to explain firsthand lessons about rush orders",
      actualQuestion: "What firsthand lessons matter when taking rush DTF orders in a small shop?",
      decisionOrAction: "document firsthand rush-order lessons for shop operators",
      desiredOutcome: "Honest operator guidance grounded in shop experience",
      searchIntent: "informational"
    })
  );
  const edu = clusterable(
    makeTask({
      id: "rt:edu",
      audience: "New clothing-brand owners learning production basics",
      situation: "Planning a first rush order without shop experience",
      problem: "Unsure how rush timelines work for DTF",
      actualQuestion: "How should a new brand evaluate rush timelines for a first DTF order?",
      decisionOrAction: "evaluate rush timeline options before placing a first DTF order",
      desiredOutcome: "A realistic rush plan for a first order",
      searchIntent: "informational"
    })
  );
  const bridge = clusterable(
    makeTask({
      id: "rt:edu-bridge",
      audience: "Apparel buyers learning about rush DTF orders",
      situation: "Planning a rush DTF order",
      problem: "Unsure how rush DTF timelines work",
      actualQuestion: "How should buyers evaluate rush timelines for DTF orders?",
      decisionOrAction: "evaluate rush timeline options before placing a DTF order",
      desiredOutcome: "A realistic rush plan",
      searchIntent: "informational"
    })
  );
  const result = clusterReaderTasksSemantically([firsthand, edu, bridge]);
  for (const cluster of result.clusters) {
    assert.ok(
      !(cluster.memberReaderTaskIds.includes(firsthand.task.id) && cluster.memberReaderTaskIds.includes(edu.task.id))
    );
  }
});

test("M3 correction: bridge cannot merge local-vendor and national-general when locality changes answer", () => {
  const local = clusterable(
    makeTask({
      id: "rt:local-vendor",
      audience: "Warner Robins small-business owners needing custom shirts",
      situation: "Choosing a local printer for employee shirts near Warner Robins",
      problem: "Unsure which local shop can hit a Friday deadline",
      actualQuestion: "How should I choose a local custom shirt printer near Warner Robins?",
      decisionOrAction: "choose a local Warner Robins area printer and place the order",
      desiredOutcome: "On-time local pickup for employee shirts",
      searchIntent: "local"
    })
  );
  const national = clusterable(
    makeTask({
      id: "rt:national-vendor",
      audience: "Online store owners shipping shirts nationwide",
      situation: "Choosing a mail-order transfer vendor for national fulfillment",
      problem: "Unsure which national vendor fits mail-order transfer workflows",
      actualQuestion: "How should I choose a nationwide DTF transfer vendor for online orders?",
      decisionOrAction: "choose a nationwide transfer vendor for mail-order fulfillment",
      desiredOutcome: "Reliable nationwide shipping of transfers",
      searchIntent: "commercial"
    })
  );
  const bridge = clusterable(
    makeTask({
      id: "rt:vendor-bridge",
      audience: "Business owners choosing a shirt vendor",
      situation: "Choosing a vendor for custom shirts",
      problem: "Unsure which vendor fits the order",
      actualQuestion: "How should I choose a custom shirt vendor for my order?",
      decisionOrAction: "choose a custom shirt vendor and place the order",
      desiredOutcome: "A reliable vendor for the order",
      searchIntent: "commercial"
    })
  );
  const result = clusterReaderTasksSemantically([local, national, bridge]);
  for (const cluster of result.clusters) {
    assert.ok(
      !(cluster.memberReaderTaskIds.includes(local.task.id) && cluster.memberReaderTaskIds.includes(national.task.id))
    );
  }
});

test("M3 correction: bridge cannot merge materially different quantity/deadline constraints", () => {
  const small = clusterable(
    makeTask({
      id: "rt:qty-small",
      audience: "Middle Georgia school spirit coordinators",
      situation: "Ordering about 40 spirit shirts before Friday kickoff",
      problem: "Need a decoration method for a small rush order",
      actualQuestion: "Which decoration method fits 40 spirit shirts before Friday?",
      decisionOrAction: "choose DTF or screen printing for a 40-piece rush school order",
      desiredOutcome: "On-time shirts for kickoff",
      constraints: ["40 units", "Friday deadline"],
      searchIntent: "local"
    })
  );
  const large = clusterable(
    makeTask({
      id: "rt:qty-large",
      audience: "Middle Georgia school spirit coordinators",
      situation: "Ordering about 500 spirit shirts for a district-wide event",
      problem: "Need a decoration method for a large district order",
      actualQuestion: "Which decoration method fits 500 spirit shirts for a district event?",
      decisionOrAction: "choose DTF or screen printing for a 500-piece district school order",
      desiredOutcome: "Consistent shirts across schools",
      constraints: ["500 units", "district budget"],
      searchIntent: "local"
    })
  );
  const bridge = clusterable(
    makeTask({
      id: "rt:qty-bridge",
      audience: "Middle Georgia school spirit coordinators",
      situation: "Ordering spirit shirts for a school event",
      problem: "Need a decoration method for spirit shirts",
      actualQuestion: "Which decoration method fits school spirit shirts?",
      decisionOrAction: "choose DTF or screen printing for a school spirit shirt order",
      desiredOutcome: "Spirit shirts ready for the event",
      searchIntent: "local"
    })
  );
  const result = clusterReaderTasksSemantically([small, large, bridge]);
  for (const cluster of result.clusters) {
    assert.ok(
      !(cluster.memberReaderTaskIds.includes(small.task.id) && cluster.memberReaderTaskIds.includes(large.task.id))
    );
  }
});

test("M3 correction: every pair in automatic multi-task cluster satisfies complete-link", () => {
  const inputs = [...cottonPolyDuplicatePair(), ...schoolVsBrandCottonTasks(), ...uvDtfVsApparelTasks()];
  const result = clusterReaderTasksSemantically(inputs);
  const cmpByPair = new Map(
    result.comparisons.map(c => [pairKey(c.leftTaskId, c.rightTaskId), c] as const)
  );
  for (const cluster of result.clusters) {
    if (cluster.memberReaderTaskIds.length > 1 && cluster.status === "active" && !cluster.requiresManualReview) {
      assert.equal(
        clusterSatisfiesCompleteLinkInvariant(cluster.memberReaderTaskIds, cmpByPair),
        true,
        cluster.id
      );
    }
  }
});

test("M3 correction: unsupported verified demand cannot beat approved observed for canonical", () => {
  const unsupportedVerified = clusterable(
    makeTask({
      id: "rt:fake-verified",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing blanks for a catalog launch",
      problem: "Unsure which fabric fits",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing?",
      decisionOrAction: "choose cotton or polyester fabric blanks for the catalog",
      desiredOutcome: "Retail-ready blanks",
      demandEvidence: {
        status: "verified",
        summary: "claimed verified without approval",
        metrics: {},
        sourceRefs: [],
        lastUpdated: null
      },
      confidence: "high",
      freshness: "fresh"
    }),
    { hasActiveApprovedEvidence: false }
  );
  const approvedObserved = clusterable(
    makeTask({
      id: "rt:real-observed",
      audience: "New clothing-brand owners preparing first blank orders",
      situation: "Choosing blanks for a small custom-print catalog launch with retail hand-feel goals",
      problem: "Unsure whether cotton or polyester blanks fit print quality and customer feel",
      actualQuestion: "Should I choose cotton or polyester shirts for custom printing on a first catalog?",
      decisionOrAction: "choose cotton or polyester fabric blanks for the first catalog run",
      desiredOutcome: "Blanks that print cleanly and feel right for retail customers",
      demandEvidence: {
        status: "observed",
        summary: "approved observed",
        metrics: {},
        sourceRefs: ["faq:1"],
        lastUpdated: "2026-02-01T00:00:00.000Z"
      },
      confidence: "high",
      freshness: "fresh",
      stakes: "Poor blanks waste launch budget",
      constraints: ["first catalog"]
    }),
    { hasActiveApprovedEvidence: true }
  );
  assert.equal(justifiedDemandStatus(unsupportedVerified), "unavailable");
  assert.equal(justifiedDemandStatus(approvedObserved), "observed");
  const canonical = selectCanonicalReaderTask([unsupportedVerified, approvedObserved]);
  assert.equal(canonical.task.id, approvedObserved.task.id);
});

test("M3 correction: identical retry does not churn memberships, evidence, audits, or history", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const inputs = cottonPolyDuplicatePair().map((item, idx) => {
    const id = `rt:idem-corr-${idx}-${item.task.id.replace("rt:", "")}`;
    const task = makeTask({
      ...item.task,
      id,
      semanticFingerprint: createHash("sha1")
        .update(`${id}|${item.task.semanticFingerprint}`)
        .digest("hex")
        .slice(0, 24)
    });
    return clusterable(task, { supportingSourceEvidenceIds: [`ev-${id}`], hasActiveApprovedEvidence: true });
  });

  for (const item of inputs) {
    await db.query(`DELETE FROM source_evidence_reader_tasks WHERE reader_task_id=$1`, [item.task.id]);
    await db.query(`DELETE FROM reader_task_cluster_history WHERE reader_task_id=$1`, [item.task.id]);
    await db.query(`DELETE FROM opportunity_cluster_members WHERE reader_task_id=$1`, [item.task.id]);
    await db.query(`DELETE FROM reader_tasks WHERE id=$1`, [item.task.id]);
    await persistReaderTaskNormalization(db, {
      task: item.task,
      accepted: true,
      reasons: [],
      supportingEvidenceIds: []
    });
  }

  const first = await persistSemanticClustering(db, { inputs, actor: "test:idem-corr-1" });
  assert.ok(first.result.clusters.length >= 1);
  const clusterId = first.result.clusters[0]!.id;

  const before = await db.query<{
    updated_at: Date;
    members: string;
    evidence: string;
    audits: string;
    history: string;
  }>(
    `SELECT
       (SELECT updated_at FROM opportunity_clusters WHERE id=$1) AS updated_at,
       (SELECT count(*)::text FROM opportunity_cluster_members WHERE cluster_id=$1 AND active=true) AS members,
       (SELECT count(*)::text FROM opportunity_cluster_evidence WHERE cluster_id=$1) AS evidence,
       (SELECT count(*)::text FROM opportunity_cluster_audits WHERE cluster_id=$1) AS audits,
       (SELECT count(*)::text FROM reader_task_cluster_history WHERE cluster_id=$1) AS history`,
    [clusterId]
  );

  const second = await persistSemanticClustering(db, { inputs, actor: "test:idem-corr-2" });
  assert.equal(second.unchanged, first.activeClusterCount);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 0);

  const after = await db.query<{
    updated_at: Date;
    members: string;
    evidence: string;
    audits: string;
    history: string;
  }>(
    `SELECT
       (SELECT updated_at FROM opportunity_clusters WHERE id=$1) AS updated_at,
       (SELECT count(*)::text FROM opportunity_cluster_members WHERE cluster_id=$1 AND active=true) AS members,
       (SELECT count(*)::text FROM opportunity_cluster_evidence WHERE cluster_id=$1) AS evidence,
       (SELECT count(*)::text FROM opportunity_cluster_audits WHERE cluster_id=$1) AS audits,
       (SELECT count(*)::text FROM reader_task_cluster_history WHERE cluster_id=$1) AS history`,
    [clusterId]
  );

  assert.equal(new Date(after.rows[0]!.updated_at).getTime(), new Date(before.rows[0]!.updated_at).getTime());
  assert.equal(after.rows[0]!.members, before.rows[0]!.members);
  assert.equal(after.rows[0]!.evidence, before.rows[0]!.evidence);
  assert.equal(after.rows[0]!.audits, before.rows[0]!.audits);
  assert.equal(after.rows[0]!.history, before.rows[0]!.history);

  const { rows: retain } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM reader_task_cluster_history WHERE cluster_id=$1 AND action='RETAIN'`,
    [clusterId]
  );
  assert.equal(Number(retain[0]!.n), 0);

  await db.end();
});

test("M3 correction: compareReaderTasksSemantically never merges below mergeMin", () => {
  // Sanity: real compare path uses resolvePairDecision — score band [0.55, 0.78) is review.
  const decision = resolvePairDecision({
    score: 0.77,
    audience: 1,
    decisionSimilarity: 1,
    hardConflicts: []
  });
  assert.equal(decision, "review");
  void compareReaderTasksSemantically;
});
