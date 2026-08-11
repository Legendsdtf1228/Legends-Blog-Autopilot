/**
 * Persistence for natural titles and intent-native briefs (M5).
 * Additive; does not mutate legacy opportunities/reservations or assign AUTO.
 */
import type { Db } from "../db.js";
import type { OpportunityCluster } from "./opportunityCluster.js";
import type { ReaderTask } from "./readerTask.js";
import type { ClusterEvidenceBudgetM4 } from "./knowledgeRegistry.js";
import {
  generateNaturalTitleFromReaderTask,
  NATURAL_TITLE_VERSION,
  TITLE_DIVERSITY_MAX_SHARE,
  type NaturalTitleProposal
} from "./naturalTitle.js";
import {
  buildIntentNativeBriefFromReaderTask,
  INTENT_NATIVE_BRIEF_VERSION,
  type IntentNativeBrief
} from "./intentNativeBrief.js";

export async function listRecentNaturalTitles(db: Db, limit = 40): Promise<string[]> {
  const { rows } = await db.query<{ title: string }>(
    `SELECT title FROM natural_title_proposals
     WHERE banned_template = false
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(r => r.title);
}

export async function persistNaturalTitleAndBrief(
  db: Db,
  args: {
    task: ReaderTask;
    cluster?: OpportunityCluster | null;
    evidenceBudget?: ClusterEvidenceBudgetM4 | null;
    actor?: string;
  }
): Promise<{ title: NaturalTitleProposal; brief: IntentNativeBrief; outcome: "inserted" | "unchanged" }> {
  const actor = args.actor || "system:m5-title-brief";
  const recentTitles = await listRecentNaturalTitles(db, 40);
  const title = generateNaturalTitleFromReaderTask({
    task: args.task,
    cluster: args.cluster,
    evidenceBudget: args.evidenceBudget,
    recentTitles
  });
  const brief = buildIntentNativeBriefFromReaderTask({
    task: args.task,
    cluster: args.cluster,
    evidenceBudget: args.evidenceBudget,
    titleProposal: title,
    recentTitles
  });

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(87251005)");

    const { rows: existing } = await client.query<{ material_hash: string }>(
      `SELECT material_hash FROM natural_title_proposals WHERE id=$1 FOR UPDATE`,
      [title.id]
    );
    let outcome: "inserted" | "unchanged" = "inserted";
    if (existing.length && existing[0]!.material_hash === title.materialHash) {
      outcome = "unchanged";
    } else if (existing.length) {
      await client.query(
        `UPDATE natural_title_proposals SET
           title=$2, pattern_family=$3, reader_question=$4, rationale=$5,
           evidence_gated=$6, blocked_claim_ids=$7::jsonb, diversity_ok=$8,
           diversity_share=$9, banned_template=$10, title_version=$11,
           material_hash=$12, payload=$13::jsonb, pipeline_versions=$14::jsonb,
           updated_at=now()
         WHERE id=$1`,
        [
          title.id,
          title.title,
          title.patternFamily,
          title.readerQuestion,
          title.rationale,
          title.evidenceGated,
          JSON.stringify(title.blockedClaimIds),
          title.diversityOk,
          title.diversityShare,
          title.bannedTemplate,
          title.titleVersion,
          title.materialHash,
          JSON.stringify(title),
          JSON.stringify(title.pipelineVersions)
        ]
      );
      outcome = "inserted";
    } else {
      await client.query(
        `INSERT INTO natural_title_proposals(
           id, cluster_id, canonical_reader_task_id, title, pattern_family,
           reader_question, rationale, evidence_gated, blocked_claim_ids,
           diversity_ok, diversity_share, banned_template, title_version,
           material_hash, payload, pipeline_versions
         ) VALUES (
           $1,$2,$3,$4,$5,
           $6,$7,$8,$9::jsonb,
           $10,$11,$12,$13,
           $14,$15::jsonb,$16::jsonb
         )`,
        [
          title.id,
          title.clusterId,
          title.canonicalReaderTaskId,
          title.title,
          title.patternFamily,
          title.readerQuestion,
          title.rationale,
          title.evidenceGated,
          JSON.stringify(title.blockedClaimIds),
          title.diversityOk,
          title.diversityShare,
          title.bannedTemplate,
          title.titleVersion,
          title.materialHash,
          JSON.stringify(title),
          JSON.stringify(title.pipelineVersions)
        ]
      );
    }

    const { rows: existingBrief } = await client.query<{ material_hash: string }>(
      `SELECT material_hash FROM intent_native_briefs WHERE id=$1 FOR UPDATE`,
      [brief.id]
    );
    if (!existingBrief.length || existingBrief[0]!.material_hash !== brief.materialHash) {
      await client.query(
        `INSERT INTO intent_native_briefs(
           id, cluster_id, canonical_reader_task_id, title_proposal_id,
           proposed_title, reader_question, decision_hint, brief_version,
           material_hash, payload, pipeline_versions
         ) VALUES (
           $1,$2,$3,$4,
           $5,$6,$7,$8,
           $9,$10::jsonb,$11::jsonb
         )
         ON CONFLICT (id) DO UPDATE SET
           proposed_title=EXCLUDED.proposed_title,
           reader_question=EXCLUDED.reader_question,
           decision_hint=EXCLUDED.decision_hint,
           material_hash=EXCLUDED.material_hash,
           payload=EXCLUDED.payload,
           pipeline_versions=EXCLUDED.pipeline_versions,
           updated_at=now()`,
        [
          brief.id,
          brief.clusterId,
          brief.canonicalReaderTaskId,
          brief.titleProposalId,
          brief.proposedTitle,
          brief.readerQuestion,
          brief.decisionHint,
          brief.briefVersion,
          brief.materialHash,
          JSON.stringify(brief),
          JSON.stringify(brief.pipelineVersions)
        ]
      );
    }

    if (outcome === "inserted") {
      await client.query(
        `INSERT INTO title_generation_runs(
           title_version, brief_version, inserted_count, unchanged_count, detail
         ) VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [
          NATURAL_TITLE_VERSION,
          INTENT_NATIVE_BRIEF_VERSION,
          1,
          0,
          JSON.stringify({ actor, titleId: title.id, briefId: brief.id })
        ]
      );
    }

    await client.query("COMMIT");
    return { title, brief, outcome };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function generateTitlesForActiveClusters(
  db: Db,
  args: { actor?: string } = {}
): Promise<{
  generated: number;
  unchanged: number;
  bannedBlocked: number;
  diversityViolations: number;
  samples: Array<{ title: string; clusterId: string | null; decisionHint: string }>;
}> {
  const { rows: clusterRows } = await db.query<{ payload: OpportunityCluster }>(
    `SELECT payload FROM opportunity_clusters WHERE status IN ('active','needs_review') ORDER BY id`
  );
  let generated = 0;
  let unchanged = 0;
  let bannedBlocked = 0;
  let diversityViolations = 0;
  const samples: Array<{ title: string; clusterId: string | null; decisionHint: string }> = [];

  for (const row of clusterRows) {
    const cluster = row.payload;
    const { rows: taskRows } = await db.query<{ payload: ReaderTask }>(
      `SELECT payload FROM reader_tasks WHERE id=$1`,
      [cluster.canonicalReaderTaskId]
    );
    if (!taskRows.length) continue;

    let budget: ClusterEvidenceBudgetM4 | null = null;
    const { rows: budgetRows } = await db.query<{ payload: ClusterEvidenceBudgetM4 }>(
      `SELECT payload FROM cluster_evidence_budgets WHERE cluster_id=$1`,
      [cluster.id]
    );
    if (budgetRows.length) budget = budgetRows[0]!.payload;

    const result = await persistNaturalTitleAndBrief(db, {
      task: taskRows[0]!.payload,
      cluster,
      evidenceBudget: budget,
      actor: args.actor
    });
    if (result.outcome === "unchanged") unchanged++;
    else generated++;
    if (result.title.bannedTemplate) bannedBlocked++;
    if (!result.title.diversityOk) diversityViolations++;
    if (samples.length < 8) {
      samples.push({
        title: result.title.title,
        clusterId: result.title.clusterId,
        decisionHint: result.brief.decisionHint
      });
    }
  }

  return { generated, unchanged, bannedBlocked, diversityViolations, samples };
}

export async function getNaturalTitleHealth(db: Db): Promise<{
  titleVersion: string;
  briefVersion: string;
  titleProposalCount: number;
  intentNativeBriefCount: number;
  bannedTemplateCount: number;
  diversityMaxShare: number;
  diversityViolationCount: number;
  decisionHintCounts: Array<{ hint: string; count: number }>;
  patternFamilyCounts: Array<{ family: string; count: number }>;
  sampleTitles: Array<{ title: string; patternFamily: string; diversityOk: boolean }>;
  lastRunAt: string | null;
}> {
  const { rows: titleCount } = await db.query<{ n: string; banned: string; diversity_bad: string }>(
    `SELECT
       count(*)::text AS n,
       count(*) FILTER (WHERE banned_template)::text AS banned,
       count(*) FILTER (WHERE diversity_ok = false)::text AS diversity_bad
     FROM natural_title_proposals`
  );
  const { rows: briefCount } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM intent_native_briefs`
  );
  const { rows: hints } = await db.query<{ decision_hint: string; n: string }>(
    `SELECT decision_hint, count(*)::text AS n FROM intent_native_briefs
     GROUP BY decision_hint ORDER BY decision_hint`
  );
  const { rows: families } = await db.query<{ pattern_family: string; n: string }>(
    `SELECT pattern_family, count(*)::text AS n FROM natural_title_proposals
     GROUP BY pattern_family ORDER BY pattern_family`
  );
  const { rows: samples } = await db.query<{ title: string; pattern_family: string; diversity_ok: boolean }>(
    `SELECT title, pattern_family, diversity_ok FROM natural_title_proposals
     ORDER BY created_at DESC LIMIT 8`
  );
  const { rows: runs } = await db.query<{ created_at: string }>(
    `SELECT created_at FROM title_generation_runs ORDER BY id DESC LIMIT 1`
  );

  return {
    titleVersion: NATURAL_TITLE_VERSION,
    briefVersion: INTENT_NATIVE_BRIEF_VERSION,
    titleProposalCount: Number(titleCount[0]?.n || 0),
    intentNativeBriefCount: Number(briefCount[0]?.n || 0),
    bannedTemplateCount: Number(titleCount[0]?.banned || 0),
    diversityMaxShare: TITLE_DIVERSITY_MAX_SHARE,
    diversityViolationCount: Number(titleCount[0]?.diversity_bad || 0),
    decisionHintCounts: hints.map(h => ({ hint: h.decision_hint, count: Number(h.n) })),
    patternFamilyCounts: families.map(f => ({ family: f.pattern_family, count: Number(f.n) })),
    sampleTitles: samples.map(s => ({
      title: s.title,
      patternFamily: s.pattern_family,
      diversityOk: s.diversity_ok
    })),
    lastRunAt: runs[0]?.created_at || null
  };
}
