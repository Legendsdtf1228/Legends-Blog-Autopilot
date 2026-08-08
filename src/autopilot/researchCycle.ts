import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import {
  createArticle,
  getSettings,
  recentTopicContext,
  recordAudit,
  saveSettings,
  updateArticle
} from "../db.js";
import { fromGenerated, normalizeArticle } from "../content.js";
import {
  attachBriefArticle,
  buildArticleBrief,
  createInterviewDraft,
  decideTopicOutcome,
  getInterviewForBrief,
  interviewAnswersAsFacts,
  IncompleteInventoryError,
  loadContentInventory,
  listPillarUsage,
  markOpportunityStatus,
  qualityGatesPassed,
  recordPillarUsage,
  researchSettingsFromApp,
  reserveOpportunity,
  runQualityGates,
  runResearchCycle,
  saveBrief,
  saveEvidenceReport,
  saveInterview,
  saveResearchCycle,
  scorecardFromOpportunity,
  updateBrief,
  type ArticleBrief,
  type EvidenceReport,
  type ResearchCycleResult,
  type ResearchOpportunity
} from "../research/index.js";
import {
  countsTowardRolloutDraft,
  quarantineFailedRolloutArticles,
  quarantineFailedRolloutOpportunities
} from "../research/quarantine.js";
import { getProductLinks, publishArticle } from "../shopify.js";
import type { GeneratedArticle, ProductLink, Settings } from "../types.js";
import { generateArticle as defaultGenerateArticle } from "../writer.js";
import { authorizeAutomaticPublication } from "./authorizePublish.js";
import { canPublishUnderFrequencyLimits, countPublishedLast7Days, hoursSinceLastPublish } from "./frequency.js";
import {
  canGenerateArticles,
  canRunResearch,
  killSwitchFromCondition,
  recordsShadowDecision,
  type RolloutMode
} from "./rollout.js";

export { canPublishUnderFrequencyLimits, countPublishedLast7Days, hoursSinceLastPublish };

export interface ResearchCycleRunResult {
  ok: boolean;
  cycleDecision: string;
  reasons: string[];
  briefId?: number;
  articleId?: number;
  opportunityId?: string | null;
  mode: RolloutMode;
  alreadyClaimed?: boolean;
  evidence?: EvidenceReport | null;
  wouldPublish?: boolean;
}

export interface ResearchCycleDeps {
  generateArticle?: typeof defaultGenerateArticle;
  loadContentInventory?: typeof loadContentInventory;
  runResearchCycle?: typeof runResearchCycle;
  getProductLinks?: typeof getProductLinks;
  publishArticle?: typeof publishArticle;
  /** Minutes after which a stuck `running` claim may be reclaimed. */
  abandonedClaimMinutes?: number;
}

const DEFAULT_ABANDONED_MINUTES = 30;

async function claimResearchSlot(
  db: Db,
  slotKey: string,
  mode: RolloutMode,
  abandonedClaimMinutes: number
): Promise<{ claimed: true; runId: number } | { claimed: false; reason: string }> {
  const insert = await db.query<{ id: string }>(
    `INSERT INTO research_cycle_runs(slot_key, collected_at, decision, reasons, mode, status, started_at)
     VALUES ($1, now(), 'RUNNING', '[]'::jsonb, $2, 'running', now())
     ON CONFLICT (slot_key) DO NOTHING
     RETURNING id`,
    [slotKey, mode]
  );
  if (insert.rows[0]) {
    return { claimed: true, runId: Number(insert.rows[0].id) };
  }

  const reclaim = await db.query<{ id: string }>(
    `UPDATE research_cycle_runs
     SET status='running',
         decision='RUNNING',
         reasons='[]'::jsonb,
         opportunity_id=NULL,
         brief_id=NULL,
         article_id=NULL,
         error=NULL,
         mode=$2,
         started_at=now(),
         completed_at=NULL,
         collected_at=now()
     WHERE slot_key=$1
       AND (
         status='failed'
         OR (status='running' AND started_at < now() - ($3 || ' minutes')::interval)
       )
     RETURNING id`,
    [slotKey, mode, String(abandonedClaimMinutes)]
  );
  if (reclaim.rows[0]) {
    return { claimed: true, runId: Number(reclaim.rows[0].id) };
  }

  const existing = await db.query<{ status: string; decision: string }>(
    `SELECT status, decision FROM research_cycle_runs WHERE slot_key=$1 LIMIT 1`,
    [slotKey]
  );
  const row = existing.rows[0];
  return {
    claimed: false,
    reason: row
      ? `Cycle slot ${slotKey} already ${row.status} (${row.decision}).`
      : `Cycle slot ${slotKey} already claimed.`
  };
}

async function completeResearchSlot(
  db: Db,
  runId: number,
  args: {
    decision: string;
    reasons: string[];
    opportunityId?: string | null;
    briefId?: number | null;
    articleId?: number | null;
    collectedAt?: string;
    status?: "completed" | "failed";
    error?: string | null;
  }
): Promise<void> {
  await db.query(
    `UPDATE research_cycle_runs
     SET decision=$2,
         reasons=$3::jsonb,
         opportunity_id=$4,
         brief_id=$5,
         article_id=$6,
         collected_at=COALESCE($7::timestamptz, collected_at),
         status=$8,
         completed_at=now(),
         error=$9
     WHERE id=$1`,
    [
      runId,
      args.decision,
      JSON.stringify(args.reasons),
      args.opportunityId ?? null,
      args.briefId ?? null,
      args.articleId ?? null,
      args.collectedAt ?? null,
      args.status ?? "completed",
      args.error ?? null
    ]
  );
}

function postGenerationDecision(args: {
  brief: ArticleBrief;
  evidence: EvidenceReport;
  settings: Settings;
  interviewComplete: boolean;
}): { brief: ArticleBrief; evidence: EvidenceReport } {
  const critical = (args.evidence.qualityGateResults || []).filter(g => !g.ok && g.severity === "critical").length
    + (args.evidence.editorialFindings || []).filter(f => f.severity === "critical").length;
  const major = (args.evidence.qualityGateResults || []).filter(g => !g.ok && g.severity === "major").length
    + (args.evidence.editorialFindings || []).filter(f => f.severity === "major").length;
  const gatesOk = qualityGatesPassed(args.evidence);
  const linkGate = args.evidence.qualityGateResults.find(g => g.gate === "internal_links");
  const semanticFail = (args.evidence.qualityGateResults || []).some(g =>
    !g.ok &&
    g.severity === "critical" &&
    /semantic|quarantined|uv_dtf|incoherent|audience_purpose|forced_internal|template/i.test(g.gate)
  ) || (args.evidence.editorialFindings || []).some(f =>
    f.severity === "critical" &&
    /quarantined|uv_dtf|incoherent|audience_purpose|forced_internal|title_specificity|template/i.test(f.gate)
  );

  const scorecard = scorecardFromOpportunity({
    scores: args.brief.scores,
    topicSpecificity: args.brief.topicSpecificity,
    uniqueness: args.brief.uniqueness,
    sourceQuality: args.brief.externalSources.length
      ? 0.85
      : ((args.brief.factSheet.legendsFacts?.length || args.brief.factSheet.businessFacts.length)
        ? 0.7 // approved Legends-only / source-free stable facts
        : 0.4),
    articleQuality: gatesOk ? 0.95 : 0.4,
    internalLinkConfidence: linkGate?.ok === false ? 0 : (args.brief.internalLinks.length ? 0.9 : 0.75),
    criticalViolations: critical,
    majorViolations: major
  });
  const outcome = decideTopicOutcome({
    scorecard,
    thresholds: args.settings.research.autoThresholds,
    requiresInterview: args.brief.requiresInterview,
    interviewComplete: args.interviewComplete,
    specificityOk: args.brief.topicSpecificity >= args.settings.research.minTopicSpecificity,
    overlapRejected: args.brief.overlapScore >= args.settings.research.overlapRejectThreshold,
    semanticRejected: semanticFail,
    semanticReasons: [
      ...(args.evidence.qualityGateResults || []).filter(g => !g.ok).map(g => `${g.gate}: ${g.detail}`),
      ...(args.evidence.editorialFindings || [])
        .filter(f => f.severity === "critical" || f.severity === "major")
        .map(f => `${f.gate}: ${f.detail}`)
    ].filter(r => /semantic|quarantined|uv_dtf|incoherent|audience|forced_internal|insufficient|template|turnaround|pressing/i.test(r))
  });

  const brief: ArticleBrief = {
    ...args.brief,
    decision: outcome.decision,
    decisionReasons: outcome.reasons,
    failedGates: [
      ...(args.evidence.qualityGateResults || []).filter(g => !g.ok).map(g => g.gate),
      ...(args.evidence.editorialFindings || [])
        .filter(f => f.severity === "critical" || f.severity === "major")
        .map(f => f.gate)
    ],
    automaticPublishingEligible: outcome.decision === "AUTO_ELIGIBLE" && gatesOk,
    status: outcome.decision === "REJECTED" ? "rejected" : args.brief.status
  };
  const evidence: EvidenceReport = {
    ...args.evidence,
    decision: brief.decision
  };
  return { brief, evidence };
}

async function generateArticleFromBrief(args: {
  db: Db;
  config: AppConfig;
  settings: Settings;
  brief: ArticleBrief;
  products: ProductLink[];
  slotKey: string;
  deps: ResearchCycleDeps;
}): Promise<{ articleId: number; generated: GeneratedArticle; evidence: EvidenceReport; brief: ArticleBrief }> {
  const generate = args.deps.generateArticle || defaultGenerateArticle;
  const getLinks = args.deps.getProductLinks || getProductLinks;

  const interview = await getInterviewForBrief(args.db, args.brief.id!);
  let brief: ArticleBrief = { ...args.brief, status: "approved" };
  if (brief.requiresInterview && interview?.completed) {
    const facts = interviewAnswersAsFacts(interview);
    brief = {
      ...brief,
      factSheet: {
        ...brief.factSheet,
        businessFacts: [...brief.factSheet.businessFacts, ...facts],
        legendsFacts: [...(brief.factSheet.legendsFacts || brief.factSheet.businessFacts), ...facts]
      }
    };
  }
  await updateBrief(args.db, brief.id!, brief);

  const placeholder = await createArticle(args.db, {
    title: brief.proposedTitle,
    handle: brief.proposedHandle || "generating",
    author: args.settings.authorName,
    primaryKeyword: brief.primaryKeyword,
    excerpt: "",
    metaTitle: brief.proposedTitle,
    metaDescription: "",
    bodyHtml: "",
    tags: [],
    featuredImageUrl: null,
    featuredImageAlt: null,
    secondaryKeywords: brief.secondaryKeywords,
    topicFingerprint: brief.primaryKeyword.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80),
    rationale: brief.whyDistinct
  }, {
    status: "generating",
    source: "research",
    generationSettings: {
      briefId: brief.id,
      opportunityId: brief.opportunityId,
      researchPipeline: true,
      pillar: brief.pillar,
      format: brief.format,
      audience: brief.audience,
      slotKey: args.slotKey,
      draftOnly: true
    }
  });

  let products = args.products;
  try {
    const live = await getLinks(args.config, args.settings.storefrontUrl);
    if (live.products.length) products = live.products;
  } catch {
    /* use brief products */
  }

  const recentTopics = await recentTopicContext(args.db);
  const generated = await generate({
    apiKey: args.config.OPENAI_API_KEY,
    model: args.settings.openaiModel || args.config.OPENAI_MODEL,
    settings: { ...args.settings, draftOnlyMode: true },
    products: products.length
      ? products
      : brief.productsToFeature.map(p => ({ title: p.title, url: p.url, handle: p.handle })),
    recentTopics,
    brief,
    generation: {
      topic: brief.proposedTitle,
      articleType: brief.format,
      primaryKeyword: brief.primaryKeyword,
      secondaryKeywords: brief.secondaryKeywords,
      targetAudience: brief.targetAudienceLabel,
      productFocus: brief.productsToFeature.map(p => p.title),
      callToAction: args.settings.defaultCta,
      internalLinking: true,
      draftOnly: true
    }
  });

  // Preserve selected brief topic/keyword/handle preferences when generator drifts.
  if (brief.primaryKeyword && generated.primaryKeyword.toLowerCase() !== brief.primaryKeyword.toLowerCase()) {
    generated.primaryKeyword = brief.primaryKeyword;
  }
  if (brief.proposedHandle && (!generated.handle || generated.handle === "generating")) {
    generated.handle = brief.proposedHandle;
  }

  const draftFields = {
    title: generated.title,
    handle: generated.handle,
    excerpt: generated.summary,
    metaTitle: generated.title,
    metaDescription: generated.metaDescription,
    bodyHtml: generated.bodyHtml,
    primaryKeyword: generated.primaryKeyword,
    secondaryKeywords: brief.secondaryKeywords,
    h1: brief.proposedH1 || generated.title
  };

  let evidence = runQualityGates({
    brief,
    draft: draftFields,
    storefrontUrl: args.settings.storefrontUrl,
    interviewApproved: Boolean(interview?.completed)
  });

  const decided = postGenerationDecision({
    brief,
    evidence,
    settings: args.settings,
    interviewComplete: Boolean(!brief.requiresInterview || interview?.completed)
  });
  brief = {
    ...decided.brief,
    status: decided.brief.decision === "REJECTED" ? "rejected" : "approved"
  };
  evidence = decided.evidence;

  const gatesOk = qualityGatesPassed(evidence);
  const rejected = brief.decision === "REJECTED";
  await updateArticle(args.db, placeholder.id, {
    ...normalizeArticle(fromGenerated(generated, args.settings.authorName), { author: args.settings.authorName }).content,
    // REJECTED articles are archived so they never count toward the 30-draft rollout.
    status: rejected ? "archived" : "draft",
    generationError: rejected
      ? `REJECTED: ${(brief.decisionReasons || []).join("; ").slice(0, 400)}`
      : gatesOk
        ? null
        : "Quality gates flagged issues — review evidence report before publishing.",
    lastError: rejected || !gatesOk
      ? evidence.reviewFlags.join("; ").slice(0, 500)
      : null,
    generationSettings: {
      briefId: brief.id,
      opportunityId: brief.opportunityId,
      researchPipeline: true,
      decision: brief.decision,
      automaticPublishingEligible: !rejected && brief.automaticPublishingEligible,
      countsTowardRollout: !rejected && countsTowardRolloutDraft({
        title: generated.title,
        primaryKeyword: generated.primaryKeyword,
        decision: brief.decision,
        status: rejected ? "archived" : "draft"
      }),
      slotKey: args.slotKey,
      rejected: rejected || undefined,
      rejectionReasons: rejected ? brief.decisionReasons : undefined
    }
  });
  await updateBrief(args.db, brief.id!, brief);
  await attachBriefArticle(args.db, brief.id!, placeholder.id);
  await saveEvidenceReport(args.db, placeholder.id, brief.id!, evidence);
  await markOpportunityStatus(args.db, brief.opportunityId, rejected ? "rejected" : "used");
  if (!rejected) {
    await recordPillarUsage(args.db, {
      pillar: brief.pillar,
      subcategory: brief.subcategory,
      audience: brief.audience,
      format: brief.format,
      primaryKeyword: brief.primaryKeyword,
      articleId: placeholder.id,
      usedAt: new Date().toISOString()
    });
  }

  return { articleId: placeholder.id, generated, evidence, brief };
}

/** Idempotent twice-daily research cycle used by the scheduler and manual runs. */
export async function executeScheduledResearchCycle(args: {
  db: Db;
  config: AppConfig;
  slotKey: string;
  actor?: string;
  deps?: ResearchCycleDeps;
  /** Optional locked settings snapshot (tests / callers that already loaded settings). */
  settingsOverride?: Settings;
}): Promise<ResearchCycleRunResult> {
  const deps = args.deps || {};
  const loadInventory = deps.loadContentInventory || loadContentInventory;
  const research = deps.runResearchCycle || runResearchCycle;
  const publish = deps.publishArticle || publishArticle;
  const abandonedClaimMinutes = deps.abandonedClaimMinutes ?? DEFAULT_ABANDONED_MINUTES;

  const settings = args.settingsOverride ?? (await getSettings(args.db));
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

  try {
    await quarantineFailedRolloutArticles(args.db);
    await quarantineFailedRolloutOpportunities(args.db);
  } catch {
    /* non-fatal — gates still reject at generation/quality time */
  }

  const claim = await claimResearchSlot(args.db, args.slotKey, mode, abandonedClaimMinutes);
  if (!claim.claimed) {
    return {
      ok: true,
      cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
      reasons: [claim.reason],
      mode,
      alreadyClaimed: true
    };
  }

  const runId = claim.runId;
  let briefId: number | undefined;
  let articleId: number | undefined;
  let opportunityId: string | null | undefined;

  try {
    const inventory = await loadInventory({ db: args.db, config: args.config, settings });
    if (inventory.counts.truncated) {
      throw new IncompleteInventoryError("Inventory truncated", "articles", inventory.counts.total, inventory.counts.total);
    }

    const usage = await listPillarUsage(args.db, 60);
    const result: ResearchCycleResult = await research({
      products: inventory.products,
      existingArticles: inventory.existing,
      usage,
      settings: researchSettingsFromApp(settings.research),
      env: process.env
    });
    await saveResearchCycle(args.db, result);

    if (result.cycleDecision === "SKIPPED_NO_QUALIFIED_TOPIC" || !result.selected) {
      await completeResearchSlot(args.db, runId, {
        decision: "SKIPPED_NO_QUALIFIED_TOPIC",
        reasons: result.cycleDecisionReasons,
        collectedAt: result.collectedAt
      });
      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: "research_cycle_skipped",
        detail: { slotKey: args.slotKey, reasons: result.cycleDecisionReasons, mode, runId }
      });
      return {
        ok: true,
        cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
        reasons: result.cycleDecisionReasons,
        mode
      };
    }

    // Autonomous fallback: never let merchant-input topics block the schedule when
    // another AUTO_ELIGIBLE opportunity can satisfy cadence (prefer AUTO over DRAFT_ONLY filler).
    let selectedOpp = result.selected;
    if (selectedOpp.decision === "NEEDS_MERCHANT_INPUT") {
      const replacement = result.opportunities.find(o =>
        o.id !== selectedOpp.id &&
        o.decision === "AUTO_ELIGIBLE" &&
        o.status !== "rejected"
      ) || result.opportunities.find(o =>
        o.id !== selectedOpp.id &&
        o.decision === "DRAFT_ONLY" &&
        o.status !== "rejected"
      );
      if (replacement) {
        selectedOpp = {
          ...replacement,
          editorialDecision: {
            ...(replacement.editorialDecision || {}),
            replacedByOtherTopic: false,
            reasons: [
              ...(replacement.decisionReasons || []),
              `Selected instead of merchant-input topic “${result.selected.proposedTitle}”.`
            ]
          }
        };
        await recordAudit(args.db, {
          actor: args.actor || "scheduler",
          action: "research_cycle_skipped_merchant_input_topic",
          detail: {
            slotKey: args.slotKey,
            skippedOpportunityId: result.selected.id,
            skippedTitle: result.selected.proposedTitle,
            selectedOpportunityId: selectedOpp.id,
            selectedTitle: selectedOpp.proposedTitle,
            missingEvidence: result.selected.editorialDecision?.missingEvidence || []
          }
        });
      }
    }

    opportunityId = selectedOpp.id;
    const reserved = await reserveOpportunity(args.db, selectedOpp.id, `cycle:${args.slotKey}`);
    if (!reserved) {
      await completeResearchSlot(args.db, runId, {
        decision: "SKIPPED_NO_QUALIFIED_TOPIC",
        reasons: ["Selected opportunity could not be reserved (concurrent worker)."],
        opportunityId,
        collectedAt: result.collectedAt
      });
      return {
        ok: true,
        cycleDecision: "SKIPPED_NO_QUALIFIED_TOPIC",
        reasons: ["Selected opportunity could not be reserved (concurrent worker)."],
        opportunityId,
        mode
      };
    }

    let brief = await saveBrief(args.db, buildArticleBrief(reserved, {
      businessFacts: settings.facts,
      settings: researchSettingsFromApp(settings.research),
      products: reserved.productsToFeature,
      storefrontUrl: settings.storefrontUrl,
      blogHandle: settings.shopifyBlogHandle
    }));
    briefId = brief.id;

    if (brief.requiresInterview || brief.decision === "NEEDS_MERCHANT_INPUT") {
      const interview = await getInterviewForBrief(args.db, brief.id!);
      if (!interview) {
        await saveInterview(
          args.db,
          createInterviewDraft(brief.id!, brief.interviewQuestions)
        );
      }
      await completeResearchSlot(args.db, runId, {
        decision: "NEEDS_MERCHANT_INPUT",
        reasons: brief.decisionReasons.length
          ? brief.decisionReasons
          : ["Merchant interview required before generation."],
        opportunityId,
        briefId,
        collectedAt: result.collectedAt
      });
      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: "research_cycle_needs_merchant_input",
        detail: {
          slotKey: args.slotKey,
          briefId,
          opportunityId,
          mode,
          contentPromiseClass: brief.contentPromiseClass,
          missingEvidence: brief.editorialDecision?.missingEvidence || []
        }
      });
      return {
        ok: true,
        cycleDecision: "NEEDS_MERCHANT_INPUT",
        reasons: ["Merchant interview required; brief saved without generation."],
        briefId,
        opportunityId,
        mode
      };
    }

    // OBSERVE: research + opportunity + brief only
    if (mode === "observe" || !canGenerateArticles(mode)) {
      await completeResearchSlot(args.db, runId, {
        decision: brief.decision,
        reasons: ["Observe mode: brief/opportunity recorded without generation."],
        opportunityId,
        briefId,
        collectedAt: result.collectedAt
      });
      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: "research_cycle_observe",
        detail: { slotKey: args.slotKey, opportunityId, briefId, decision: brief.decision, mode }
      });
      return {
        ok: true,
        cycleDecision: brief.decision,
        reasons: ["Observe mode: brief/opportunity recorded without generation."],
        briefId,
        opportunityId,
        mode
      };
    }

    const generated = await generateArticleFromBrief({
      db: args.db,
      config: args.config,
      settings,
      brief,
      products: inventory.products,
      slotKey: args.slotKey,
      deps
    });
    brief = generated.brief;
    briefId = brief.id;
    articleId = generated.articleId;
    const evidence = generated.evidence;

    let wouldPublish = false;
    if (recordsShadowDecision(mode) || mode === "auto_publish") {
      const auth = await authorizeAutomaticPublication({
        db: args.db,
        settings,
        articleId,
        brief,
        evidence,
        shadowEvaluation: mode !== "auto_publish"
      });
      wouldPublish = auth.wouldPublish;

      await recordAudit(args.db, {
        actor: args.actor || "scheduler",
        action: mode === "shadow_auto" ? "shadow_auto_decision" : "auto_publish_authorization",
        articleId,
        detail: {
          slotKey: args.slotKey,
          briefId,
          opportunityId,
          ok: auth.ok,
          wouldPublish: auth.wouldPublish,
          articleReady: auth.articleReady,
          settingsReady: auth.settingsReady,
          frequencyReady: auth.frequencyReady,
          promotionReady: auth.promotionReady,
          articleReasons: auth.articleReasons,
          promotionReasons: auth.promotionReasons,
          frequencyReasons: auth.frequencyReasons,
          livePublicationReasons: auth.livePublicationReasons,
          reasons: auth.reasons,
          mode,
          decision: brief.decision
        }
      });

      if (mode === "auto_publish" && auth.ok) {
        try {
          const published = await publish(args.config, generated.generated, settings.authorName, {
            ...settings,
            draftOnlyMode: false
          }, {
            isPublished: true,
            idempotencyKey: `research-cycle:${args.slotKey}`,
            existingShopifyArticleId: null
          });
          await updateArticle(args.db, articleId, {
            status: "published",
            shopifyArticleId: published.id,
            shopifyUrl: published.url,
            shopifyHandle: published.handle,
            shopifyBlogId: published.blogId,
            shopifyResponseStatus: published.responseStatus,
            publishedAt: new Date(),
            lastError: null
          });
          await recordAudit(args.db, {
            actor: args.actor || "scheduler",
            action: "research_article_auto_published",
            articleId,
            detail: { slotKey: args.slotKey, shopifyId: published.id, url: published.url }
          });
        } catch (publishError) {
          const message = publishError instanceof Error ? publishError.message : String(publishError);
          await updateArticle(args.db, articleId, {
            status: "draft",
            lastError: `AUTO_PUBLISH blocked after generation: ${message}`.slice(0, 500)
          });
          await recordAudit(args.db, {
            actor: args.actor || "scheduler",
            action: "research_article_auto_publish_failed",
            articleId,
            detail: { slotKey: args.slotKey, error: message }
          });
          if (/duplicate|already exists|taken/i.test(message)) {
            const kill = killSwitchFromCondition("duplicate_shopify_create");
            settings.killSwitch = { ...settings.killSwitch, ...kill };
            settings.enabled = false;
            await saveSettings(args.db, settings);
          }
        }
      } else if (mode === "auto_publish" && !auth.ok) {
        await recordAudit(args.db, {
          actor: args.actor || "scheduler",
          action: "auto_publish_blocked",
          articleId,
          detail: { slotKey: args.slotKey, reasons: auth.reasons, mode }
        });
      }
    }

    await completeResearchSlot(args.db, runId, {
      decision: brief.decision,
      reasons: brief.decisionReasons,
      opportunityId,
      briefId,
      articleId,
      collectedAt: result.collectedAt
    });

    await recordAudit(args.db, {
      actor: args.actor || "scheduler",
      action: "research_cycle_article_ready",
      articleId,
      detail: {
        slotKey: args.slotKey,
        briefId,
        opportunityId,
        decision: brief.decision,
        mode,
        automaticPublishingEligible: brief.automaticPublishingEligible,
        wouldPublish,
        gatesOk: qualityGatesPassed(evidence)
      }
    });

    return {
      ok: true,
      cycleDecision: brief.decision,
      reasons: brief.decisionReasons,
      briefId,
      articleId,
      opportunityId,
      mode,
      evidence,
      wouldPublish
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await completeResearchSlot(args.db, runId, {
      decision: "FAILED",
      reasons: [message],
      opportunityId,
      briefId,
      articleId,
      status: "failed",
      error: message
    }).catch(() => undefined);

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

/** Test helper: expose atomic claim behavior. */
export async function claimResearchSlotForTest(
  db: Db,
  slotKey: string,
  mode: RolloutMode = "draft_only",
  abandonedClaimMinutes = DEFAULT_ABANDONED_MINUTES
) {
  return claimResearchSlot(db, slotKey, mode, abandonedClaimMinutes);
}
