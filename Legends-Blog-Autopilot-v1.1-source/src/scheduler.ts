import { DateTime } from "luxon";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import { claimJob, failJob, finishJob, getSettings, insertSlot, recentTopicContext } from "./db.js";
import { generateArticle } from "./writer.js";
import { getProductLinks, publishArticle } from "./shopify.js";
import type { Settings } from "./types.js";

export function dueSlots(now: DateTime, settings: Settings): Array<{key: string; date: Date}> {
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
  constructor(private db: Db, private config: AppConfig) {}

  start(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const settings = await getSettings(this.db);
      for (const slot of dueSlots(DateTime.utc(), settings)) await insertSlot(this.db, slot.key, slot.date);
      const job = await claimJob(this.db);
      if (!job) return;
      let article = null;
      try {
        const products = await getProductLinks(this.config);
        const recentTopics = await recentTopicContext(this.db);
        article = await generateArticle({ apiKey: this.config.OPENAI_API_KEY, model: this.config.OPENAI_MODEL, settings, products, recentTopics });
        const duplicate = recentTopics.some(t => t.toLowerCase().includes(`[${article!.topicFingerprint.toLowerCase()}]`));
        if (duplicate) throw new Error(`Duplicate topic fingerprint: ${article.topicFingerprint}`);
        const published = await publishArticle(this.config, article, settings.authorName);
        await finishJob(this.db, job.id, article, published.id, published.url);
        console.log(JSON.stringify({ event: "article_published", jobId: job.id, title: article.title, shopifyId: published.id }));
      } catch (error) {
        await failJob(this.db, job.id, article, error);
        console.error(JSON.stringify({ event: "article_failed", jobId: job.id, error: error instanceof Error ? error.message : String(error) }));
      }
    } finally { this.busy = false; }
  }
}
