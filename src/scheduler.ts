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
  updateArticle,
  createArticleFromGenerated
} from "./db.js";
import { generateArticle } from "./writer.js";
import { getProductLinks, publishArticle, ShopifyError } from "./shopify.js";
import type { GeneratedArticle, Settings } from "./types.js";
import { toGenerated } from "./content.js";

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

export class AutopilotWorker {
  private timer?: NodeJS.Timeout;
  private busy = false;
  private lastTickAt: Date | null = null;
  private lastError: string | null = null;
  private pausedEmergency = false;

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
      lastError: this.lastError
    };
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.lastTickAt = new Date();
    try {
      const settings = await getSettings(this.db);
      if (this.pausedEmergency || !settings.enabled) {
        // Still allow processing of explicitly queued manual article jobs only when enabled?
        // Spec: Never publish automatically while Autopilot is paused.
        // Manual publish-now should still work — those jobs exist with slot_key manual:* or article:*
        await this.processClaimed(settings, { autopilotPaused: !settings.enabled || this.pausedEmergency });
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
        if (existing.shopifyArticleId) {
          // Idempotent: already published
          await finishJob(this.db, job.id, toGenerated(existing), existing.shopifyArticleId, existing.shopifyUrl, {
            articleId,
            blogId: existing.shopifyBlogId || undefined,
            handle: existing.shopifyHandle || existing.handle,
            responseStatus: "already_published"
          });
          return;
        }
        article = toGenerated(existing);
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
          status: settings.draftOnlyMode ? "ready" : "publishing",
          source: "autopilot",
          author: settings.authorName
        });
        articleId = created.id;
        await this.db.query("UPDATE publish_jobs SET article_id=$2, updated_at=now() WHERE id=$1", [job.id, articleId]);

        if (settings.draftOnlyMode) {
          await updateArticle(this.db, articleId, { status: "ready" });
          await this.db.query(
            `UPDATE publish_jobs SET status='skipped', article=$2::jsonb, completed_at=now(), updated_at=now(), error=$3 WHERE id=$1`,
            [job.id, JSON.stringify(article), "Draft-only mode: article generated and saved as ready without publishing."]
          );
          await recordAudit(this.db, {
            actor: "scheduler",
            action: "article_generated_draft_only",
            articleId,
            jobId: job.id,
            detail: { title: article.title }
          });
          return;
        }
      }

      const published = await publishArticle(this.config, article, settings.authorName, settings, {
        imageUrl: articleId ? (await getArticle(this.db, articleId))?.featuredImageUrl : null,
        imageAlt: articleId ? (await getArticle(this.db, articleId))?.featuredImageAlt : null,
        isPublished: true,
        idempotencyKey: `job:${job.id}`
      });

      await finishJob(this.db, job.id, article, published.id, published.url, {
        articleId: articleId ?? undefined,
        blogId: published.blogId ?? undefined,
        handle: published.handle,
        responseStatus: published.responseStatus
      });
      await recordAudit(this.db, {
        actor: "scheduler",
        action: "article_published",
        articleId: articleId ?? undefined,
        jobId: job.id,
        detail: { shopifyId: published.id, url: published.url }
      });
      console.log(JSON.stringify({ event: "article_published", jobId: job.id, title: article.title, shopifyId: published.id }));
    } catch (error) {
      const retryable = error instanceof ShopifyError ? error.retryable : true;
      await failJob(this.db, job.id, article, error);
      if (!retryable) {
        await this.db.query(
          "UPDATE publish_jobs SET next_attempt_at = now() + interval '100 years', updated_at=now() WHERE id=$1",
          [job.id]
        );
      }
      await recordAudit(this.db, {
        actor: "scheduler",
        action: "article_failed",
        articleId: articleId ?? undefined,
        jobId: job.id,
        detail: { error: error instanceof Error ? error.message : String(error), retryable }
      });
      console.error(JSON.stringify(redactSecrets({
        event: "article_failed",
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      })));
    }
  }
}
