import { DateTime } from "luxon";
import type { AppConfig } from "./config.js";
import { redactSecrets } from "./config.js";
import type { Db } from "./db.js";
import {
  claimJob,
  failJob,
  finishJob,
  getArticle,
  getSettings,
  insertSlot,
  recentTopicContext,
  recordAudit,
  saveSettings,
  updateArticle,
  createArticleFromGenerated
} from "./db.js";
import { generateArticle } from "./writer.js";
import { getProductLinks, publishArticle, ShopifyError } from "./shopify.js";
import type { GeneratedArticle, Settings } from "./types.js";
import { toGenerated } from "./content.js";
import {
  canAutoPublish,
  canRunResearch,
  killSwitchFromCondition,
  recordsShadowDecision
} from "./autopilot/rollout.js";
import { canPublishUnderFrequencyLimits, executeScheduledResearchCycle } from "./autopilot/researchCycle.js";

export function dueSlots(now: DateTime, settings: Settings): Array<{ key: string; date: Date }> {
  if (!settings.enabled) return [];
  const local = now.setZone(settings.timezone);
  const times = settings.cadence === "twice_daily" ? [settings.firstTime, settings.secondTime] : [settings.firstTime];
  return times.flatMap((time, index) => {
    const [hour, minute] = time.split(":").map(Number);
    const slot = local.set({ hour, minute, second: 0, millisecond: 0 });
    if (!slot.isValid || slot > local) return [];
    return [{ key: `${slot.toISODate()}:${index + 1}`, date: slot.toUTC().toJSDate() }];
  });
}

/** Research windows use researchCadence and are independent of publish `enabled`. */
export function dueResearchSlots(now: DateTime, settings: Settings): Array<{ key: string; date: Date }> {
  if (!canRunResearch(settings.rolloutMode) || settings.killSwitch.paused || !settings.research.enabled) return [];
  const local = now.setZone(settings.timezone);
  const cadence = settings.researchCadence || "twice_daily";
  const times = cadence === "twice_daily" ? [settings.firstTime, settings.secondTime] : [settings.firstTime];
  return times.flatMap((time, index) => {
    const [hour, minute] = time.split(":").map(Number);
    const slot = local.set({ hour, minute, second: 0, millisecond: 0 });
    if (!slot.isValid || slot > local) return [];
    return [{ key: `research:${slot.toISODate()}:${index + 1}`, date: slot.toUTC().toJSDate() }];
  });
}

export class AutopilotWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastTickAt: Date | null = null;
  private lastError: string | null = null;
  private pausedEmergency = false;
  private consecutiveFailures = 0;
  private publishedThisTick = 0;

  constructor(private db: Db, private config: AppConfig) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  emergencyPause(on = true): void {
    this.pausedEmergency = on;
  }

  getDiagnostics() {
    return {
      running: Boolean(this.timer) && !this.busy,
      busy: this.busy,
      emergencyPaused: this.pausedEmergency,
      lastTickAt: this.lastTickAt,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures
    };
  }

  private async tripKillSwitch(kind: string, detail: Record<string, unknown>): Promise<void> {
    const settings = await getSettings(this.db);
    const kill = killSwitchFromCondition(kind);
    settings.killSwitch = {
      ...settings.killSwitch,
      ...kill,
      consecutiveFailureThreshold: settings.killSwitch.consecutiveFailureThreshold
    };
    settings.enabled = false;
    await saveSettings(this.db, settings);
    this.pausedEmergency = true;
    await recordAudit(this.db, {
      actor: "scheduler",
      action: "kill_switch_triggered",
      detail: { kind, ...detail, recoveryStep: kill.recoveryStep }
    });
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.lastTickAt = new Date();
    this.publishedThisTick = 0;
    try {
      const settings = await getSettings(this.db);

      // Research cycles (twice-daily by default) — never publishes by themselves
      for (const slot of dueResearchSlots(DateTime.utc(), settings)) {
        try {
          await executeScheduledResearchCycle({
            db: this.db,
            config: this.config,
            slotKey: slot.key,
            actor: "scheduler"
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(JSON.stringify(redactSecrets({ event: "research_cycle_failed", error: message, slot: slot.key })));
        }
      }

      const publishPaused =
        this.pausedEmergency ||
        !settings.enabled ||
        settings.killSwitch.paused ||
        settings.rolloutMode === "paused" ||
        settings.rolloutMode === "observe" ||
        settings.draftOnlyMode ||
        !canAutoPublish(settings.rolloutMode);

      if (publishPaused) {
        const hardPause = this.pausedEmergency || settings.killSwitch.paused || settings.rolloutMode === "paused";
        await this.processClaimed(settings, { autopilotPaused: hardPause || !settings.enabled });
        return;
      }

      for (const slot of dueSlots(DateTime.utc(), settings)) {
        await insertSlot(this.db, slot.key, slot.date);
      }
      await this.processClaimed(settings, { autopilotPaused: false });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify(redactSecrets({ event: "worker_tick_failed", error: this.lastError })));
    } finally {
      this.busy = false;
    }
  }

  private async processClaimed(settings: Settings, opts: { autopilotPaused: boolean }): Promise<void> {
    const job = await claimJob(this.db, settings.retryLimit || 4);
    if (!job) return;

    // If autopilot is paused, only run manual/article-targeted jobs
    if (opts.autopilotPaused && !String(job.slot_key).startsWith("manual:") && !String(job.slot_key).startsWith("article:")) {
      await this.db.query(
        "UPDATE publish_jobs SET status='pending', attempts=GREATEST(attempts-1,0), updated_at=now() WHERE id=$1",
        [job.id]
      );
      return;
    }

    let article: GeneratedArticle | null = null;
    let articleId = job.article_id ? Number(job.article_id) : null;

    try {
      // Existing article path (edit/schedule/publish-now)
      if (articleId) {
        const existing = await getArticle(this.db, articleId);
        if (!existing) throw new Error(`Article ${articleId} not found for job ${job.id}`);
        if (existing.status === "archived") throw new Error("Article is archived");
        article = toGenerated(existing);

        // Already linked: update via articleUpdate (never create again).
        if (existing.shopifyArticleId) {
          const frequency = await canPublishUnderFrequencyLimits(this.db, settings);
          if (!frequency.ok && canAutoPublish(settings.rolloutMode) && !String(job.slot_key).startsWith("manual:")) {
            await this.db.query(
              `UPDATE publish_jobs SET status='skipped', error=$2, completed_at=now(), updated_at=now() WHERE id=$1`,
              [job.id, frequency.reason || "Frequency limit"]
            );
            return;
          }

          if (recordsShadowDecision(settings.rolloutMode) || settings.draftOnlyMode || !canAutoPublish(settings.rolloutMode)) {
            await recordAudit(this.db, {
              actor: "scheduler",
              action: "shadow_auto_decision",
              articleId,
              jobId: job.id,
              detail: {
                wouldPublish: true,
                mode: settings.rolloutMode,
                shopifyArticleId: existing.shopifyArticleId,
                reason: "Existing Shopify article would be updated under AUTO_PUBLISH."
              }
            });
            await this.db.query(
              `UPDATE publish_jobs SET status='skipped', article=$2::jsonb, completed_at=now(), updated_at=now(), error=$3 WHERE id=$1`,
              [job.id, JSON.stringify(article), `Rollout ${settings.rolloutMode}: recorded without publishing.`]
            );
            return;
          }

          const published = await publishArticle(this.config, article, settings.authorName, settings, {
            imageUrl: existing.featuredImageUrl,
            imageAlt: existing.featuredImageAlt,
            isPublished: true,
            idempotencyKey: `job:${job.id}`,
            existingShopifyArticleId: existing.shopifyArticleId
          });
          await finishJob(this.db, job.id, article, published.id, published.url, {
            articleId,
            blogId: published.blogId ?? undefined,
            handle: published.handle,
            responseStatus: published.responseStatus
          });
          this.consecutiveFailures = 0;
          this.publishedThisTick += 1;
          return;
        }
      } else {
        const { products, warning } = await getProductLinks(this.config, settings.storefrontUrl);
        if (warning) console.warn(JSON.stringify({ event: "product_access_warning", warning }));
        const recentTopics = await recentTopicContext(this.db);
        const model = settings.openaiModel || this.config.OPENAI_MODEL;
        article = await generateArticle({
          apiKey: this.config.OPENAI_API_KEY,
          model,
          settings,
          products,
          recentTopics
        });
        const duplicate = recentTopics.some(t => t.toLowerCase().includes(`[${article!.topicFingerprint.toLowerCase()}]`));
        if (duplicate) throw new Error(`Duplicate topic fingerprint: ${article.topicFingerprint}`);

        const created = await createArticleFromGenerated(this.db, article, {
          status: settings.draftOnlyMode || recordsShadowDecision(settings.rolloutMode) ? "ready" : "publishing",
          source: "autopilot",
          author: settings.authorName
        });
        articleId = created.id;
        await this.db.query("UPDATE publish_jobs SET article_id=$2, updated_at=now() WHERE id=$1", [job.id, articleId]);

        if (settings.draftOnlyMode || recordsShadowDecision(settings.rolloutMode) || !canAutoPublish(settings.rolloutMode)) {
          await updateArticle(this.db, articleId, { status: "ready" });
          if (recordsShadowDecision(settings.rolloutMode)) {
            await recordAudit(this.db, {
              actor: "scheduler",
              action: "shadow_auto_decision",
              articleId,
              jobId: job.id,
              detail: {
                wouldPublish: false,
                mode: "shadow_auto",
                reason: "SHADOW_AUTO keeps drafts; would evaluate AUTO_PUBLISH gates before live publish."
              }
            });
          }
          await this.db.query(
            `UPDATE publish_jobs SET status='skipped', article=$2::jsonb, completed_at=now(), updated_at=now(), error=$3 WHERE id=$1`,
            [job.id, JSON.stringify(article), "Draft-only / shadow mode: article generated and saved without publishing."]
          );
          await recordAudit(this.db, {
            actor: "scheduler",
            action: "article_generated_draft_only",
            articleId,
            jobId: job.id,
            detail: { title: article.title, mode: settings.rolloutMode }
          });
          return;
        }
      }

      if (!article) throw new Error("No article payload for publish job");

      if (this.publishedThisTick >= settings.frequencyLimits.maxArticlesPerCycle) {
        await this.db.query(
          `UPDATE publish_jobs SET status='pending', attempts=GREATEST(attempts-1,0), next_attempt_at=now() + interval '1 hour', updated_at=now(), error=$2 WHERE id=$1`,
          [job.id, "maxArticlesPerCycle reached for this tick"]
        );
        return;
      }

      const frequency = await canPublishUnderFrequencyLimits(this.db, settings);
      if (!frequency.ok) {
        await recordAudit(this.db, {
          actor: "scheduler",
          action: "publish_skipped_frequency",
          articleId: articleId ?? undefined,
          jobId: job.id,
          detail: { reason: frequency.reason }
        });
        await this.db.query(
          `UPDATE publish_jobs SET status='skipped', completed_at=now(), updated_at=now(), error=$2 WHERE id=$1`,
          [job.id, frequency.reason || "Frequency limit"]
        );
        return;
      }

      const existingLocal = articleId ? await getArticle(this.db, articleId) : null;
      const published = await publishArticle(this.config, article, settings.authorName, settings, {
        imageUrl: existingLocal?.featuredImageUrl ?? null,
        imageAlt: existingLocal?.featuredImageAlt ?? null,
        isPublished: true,
        idempotencyKey: `job:${job.id}`,
        existingShopifyArticleId: existingLocal?.shopifyArticleId
      });

      try {
        await finishJob(this.db, job.id, article, published.id, published.url, {
          articleId: articleId ?? undefined,
          blogId: published.blogId ?? undefined,
          handle: published.handle,
          responseStatus: published.responseStatus
        });
      } catch (persistError) {
        // Shopify succeeded but local persistence failed — do not create again on retry.
        if (articleId && published.id) {
          await updateArticle(this.db, articleId, {
            shopifyArticleId: published.id,
            shopifyUrl: published.url,
            shopifyHandle: published.handle,
            shopifyBlogId: published.blogId,
            shopifyResponseStatus: "created_pending_local",
            status: "published",
            publishedAt: new Date()
          }).catch(() => undefined);
        }
        await this.tripKillSwitch("ambiguous_shopify_persistence", {
          jobId: job.id,
          shopifyId: published.id,
          persistError: persistError instanceof Error ? persistError.message : String(persistError)
        });
        throw persistError;
      }

      this.consecutiveFailures = 0;
      this.publishedThisTick += 1;
      await recordAudit(this.db, {
        actor: "scheduler",
        action: "article_published",
        articleId: articleId ?? undefined,
        jobId: job.id,
        detail: { shopifyId: published.id, url: published.url, responseStatus: published.responseStatus }
      });
      console.log(JSON.stringify({ event: "article_published", jobId: job.id, title: article.title, shopifyId: published.id }));
    } catch (error) {
      const retryable = error instanceof ShopifyError ? error.retryable : true;
      const message = error instanceof Error ? error.message : String(error);
      await failJob(this.db, job.id, article, error);
      if (!retryable) {
        await this.db.query(
          "UPDATE publish_jobs SET next_attempt_at = now() + interval '100 years', updated_at=now() WHERE id=$1",
          [job.id]
        );
      }

      if (/duplicate|already exists|taken/i.test(message) && /shopify|article/i.test(message)) {
        await this.tripKillSwitch("duplicate_shopify_create", { jobId: job.id, error: message });
      }

      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= (settings.killSwitch.consecutiveFailureThreshold || 3)) {
        await this.tripKillSwitch("consecutive_failures", {
          jobId: job.id,
          consecutiveFailures: this.consecutiveFailures,
          error: message
        });
      }

      await recordAudit(this.db, {
        actor: "scheduler",
        action: "article_failed",
        articleId: articleId ?? undefined,
        jobId: job.id,
        detail: { error: message, retryable }
      });
      console.error(JSON.stringify(redactSecrets({
        event: "article_failed",
        jobId: job.id,
        error: message
      })));
    }
  }
}
