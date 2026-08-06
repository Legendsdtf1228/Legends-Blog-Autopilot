import type { ProviderContext, ProviderResult, ResearchProvider } from "./types.js";
import type { ResearchSignal } from "../types.js";

/** Existing content used for overlap awareness — not a demand metric source. */
export const existingContentProvider: ResearchProvider = {
  id: "existing_content",
  async collect(ctx: ProviderContext): Promise<ProviderResult> {
    const collectedAt = ctx.collectedAt.toISOString();
    const signals: ResearchSignal[] = ctx.existingTopics.slice(0, 90).map(topic => ({
      provider: "existing_content",
      collectedAt,
      dataPeriodStart: null,
      dataPeriodEnd: null,
      geographicRegion: ctx.region,
      keyword: topic,
      topic,
      volume: null,
      relativeInterest: null,
      growth: null,
      competition: null,
      sourceUrl: null,
      completeness: "partial",
      notes: "Existing local/Shopify article topic used for overlap detection only."
    }));
    return {
      provider: "existing_content",
      available: ctx.existingTopics.length > 0,
      reason: ctx.existingTopics.length ? undefined : "No existing articles found yet.",
      signals
    };
  }
};
