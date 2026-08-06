import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { getSettings, recordAudit, saveSettings } from "../db.js";
import {
  buildArticleBrief,
  loadContentInventory,
  listPillarUsage,
  researchSettingsFromApp,
  reserveOpportunity,
  runResearchCycle,
  saveBrief,
  saveResearchCycle,
  createInterviewDraft,
  getInterviewForBrief,
  saveInterview,
  IncompleteInventoryError
} from "../research/index.js";
import {
  canGenerateArticles,
  canRunResearch,
  killSwitchFromCondition,
  recordsShadowDecision,
  type RolloutMode
} from "./rollout.js";

export interface ResearchCycleRunResult {
  ok: boolean;
  cycleDecision: string;
  reasons: string[];
  briefId?: number;
  opportunityId?: string | null;
  mode: RolloutMode;
}

/** Idempotent twice-daily research cycle used by the scheduler and manual runs. */
export async function executeScheduledResearchCycle(args: {
  db: Db;
  config: AppConfig;
  slotKey: string;
  actor?: string;
}): Promise<ResearchCycleRunResult> {
  const settings = await getSettings(args.db);
  const mode = settings.rolloutMode;

  if (settings.killSwitch.paused) {
    return {
      ok: true,
      cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
      reasons: [`Kill switch active: ${settings.killSwitch.reason || "paused"}`],
      mode
    };
  }

  if (!canRunResearch(mode) || !settings.research.enabled) {
    return {
      ok: true,
      cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
      reasons: [`Rollout mode ${mode} does not run research.`],
      mode
    };
  }

  // Idempotency: one successful research cycle marker per slot
  const existing = await args.db.query<{ id: string }>(
    `SELECT id FROM research_cycle_runs WHERE slot_key=$1 LIMIT 1`,
    [args.slotKey]
  );
  if (existing.rows[0]) {
    return {
      ok: true,
      cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
      reasons: [`Cycle slot ${args.slotKey} already completed (idempotent).`],
      mode
    };
  }

  try {
    const inventory = await loadContentInventory({ db: args.db, config: args.config, settings });
    if (inventory.counts.truncated) {
      throw new IncompleteInventoryError("Inventory truncated", "articles", inventory.counts.total, inventory.counts.total);
    }

    const usage = await listPillarUsage(args.db, 60);
    const result = await runResearchCycle({
      products: inventory.products,
      existingArticles: inventory.existing,
      usage,
      settings: researchSettingsFromApp(settings.research),
      env: process.env
    });
    await saveResearchCycle(args.db, result);

    await args.db.query(
      `INSERT INTO research_cycle_runs(slot_key, collected_at, decision, reasons, opportunity_id, mode)
       VALUES ($1,$2::timestamptz,$3,$4::jsonb,$5,$6)
       ON CONFLICT (slot_key) DO NOTHING`,
      [
        args.slotKey,
        result.collectedAt,
        result.cycleDecision,
        JSON.stringify(result.cycleDecisionReasons),
        result.selected?.id ?? null,
        mode
      ]
    );

    if (result.cycleDecision === "SKIPPED_NO_QUALIFIED_TOPIC" || !result.selected) {
      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: "research_cycle_skipped",
        detail: { slotKey: args.slotKey, reasons: result.cycleDecisionReasons, mode }
      });
      return {
        ok: true,
        cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
        reasons: result.cycleDecisionReasons,
        mode
      };
    }

    if (mode === "observe" || !canGenerateArticles(mode)) {
      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: "research_cycle_observe",
        detail: {
          slotKey: args.slotKey,
          opportunityId: result.selected.id,
          decision: result.selected.decision,
          mode
        }
      });
      return {
        ok: true,
        cycleDecision: result.selected.decision,
        reasons: ["Observe mode: brief/opportunity recorded without generation."],
        opportunityId: result.selected.id,
        mode
      };
    }

    const reserved = await reserveOpportunity(args.db, result.selected.id, `cycle:${args.slotKey}`);
    if (!reserved) {
      return {
        ok: true,
        cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
        reasons: ["Selected opportunity could not be reserved (concurrent worker)."],
        mode
      };
    }

    const brief = await saveBrief(args.db, buildArticleBrief(reserved, {
      businessFacts: settings.facts,
      settings: researchSettingsFromApp(settings.research),
      products: reserved.productsToFeature,
      storefrontUrl: settings.storefrontUrl,
      blogHandle: settings.shopifyBlogHandle
    }));

    if (brief.requiresInterview || brief.decision === "NEEDS_MERCHANT_INPUT") {
      const interview = await getInterviewForBrief(args.db, brief.id!);
      if (!interview) await saveInterview(args.db, createInterviewDraft(brief.id!));
    }

    if (recordsShadowDecision(mode)) {
      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: "shadow_auto_decision",
        detail: {
          slotKey: args.slotKey,
          briefId: brief.id,
          opportunityId: reserved.id,
          wouldAutoPublish: brief.automaticPublishingEligible && brief.decision === "AUTO_ELIGIBLE",
          decision: brief.decision,
          reasons: brief.decisionReasons,
          failedGates: brief.failedGates,
          mode
        }
      });
    }

    await recordAudit(args.db, {
      actor: args.actor || "scheduler",
      action: "research_cycle_brief_ready",
      detail: {
        slotKey: args.slotKey,
        briefId: brief.id,
        decision: brief.decision,
        mode,
        automaticPublishingEligible: brief.automaticPublishingEligible
      }
    });

    return {
      ok: true,
      cycleDecision: brief.decision,
      reasons: brief.decisionReasons,
      briefId: brief.id,
      opportunityId: reserved.id,
      mode
    };
  } catch (error) {
    if (error instanceof IncompleteInventoryError) {
      const kill = killSwitchFromCondition("incomplete_inventory");
      settings.killSwitch = { ...settings.killSwitch, ...kill };
      settings.enabled = false;
      await saveSettings(args.db, settings);
      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: "kill_switch_triggered",
        detail: { kind: "incomplete_inventory", message: error.message, slotKey: args.slotKey }
      });
    }
    throw error;
  }
}

export async function countPublishedLast7Days(db: Db): Promise<number> {
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM articles
     WHERE status='published' AND published_at >= now() - interval '7 days'`
  );
  return Number(rows[0]?.count ?? 0);
}

export async function hoursSinceLastPublish(db: Db): Promise<number | null> {
  const { rows } = await db.query<{ published_at: string }>(
    `SELECT published_at FROM articles WHERE status='published' AND published_at IS NOT NULL
     ORDER BY published_at DESC LIMIT 1`
  );
  if (!rows[0]?.published_at) return null;
  const ms = Date.now() - new Date(rows[0].published_at).getTime();
  return ms / 3_600_000;
}

/** Frequency gate for AUTO_PUBLISH — research may still run. */
export async function canPublishUnderFrequencyLimits(db: Db, settings: Awaited<ReturnType<typeof getSettings>>): Promise<{ ok: boolean; reason?: string }> {
  const weekly = await countPublishedLast7Days(db);
  if (weekly >= settings.frequencyLimits.maxPublishedPerRolling7Days) {
    return { ok: false, reason: `Rolling 7-day publish limit reached (${weekly}/${settings.frequencyLimits.maxPublishedPerRolling7Days}).` };
  }
  const hours = await hoursSinceLastPublish(db);
  if (hours !== null && hours < settings.frequencyLimits.minHoursBetweenPublishes) {
    return { ok: false, reason: `Minimum spacing not met (${hours.toFixed(1)}h < ${settings.frequencyLimits.minHoursBetweenPublishes}h).` };
  }
  return { ok: true };
}
