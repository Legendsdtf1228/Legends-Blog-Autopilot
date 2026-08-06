import { BASE_SEED_CATEGORIES, CONTENT_PILLARS } from "../pillars.js";
import type { ProviderContext, ProviderResult, ResearchProvider } from "./types.js";
import type { ResearchSignal } from "../types.js";

/** Curated seed discovery — never invents volume/growth metrics. */
export const seedCatalogProvider: ResearchProvider = {
  id: "seed_catalog",
  async collect(ctx: ProviderContext): Promise<ProviderResult> {
    const collectedAt = ctx.collectedAt.toISOString();
    const seeds = new Set([...BASE_SEED_CATEGORIES, ...CONTENT_PILLARS.flatMap(p => p.seedKeywords)]);
    const signals: ResearchSignal[] = [...seeds].map(keyword => ({
      provider: "seed_catalog",
      collectedAt,
      dataPeriodStart: null,
      dataPeriodEnd: null,
      geographicRegion: ctx.region,
      keyword,
      topic: keyword,
      volume: null,
      relativeInterest: null,
      growth: null,
      competition: null,
      sourceUrl: null,
      completeness: "unavailable",
      notes: "Seed category for discovery. No fabricated search volume."
    }));
    return {
      provider: "seed_catalog",
      available: true,
      signals
    };
  }
};
