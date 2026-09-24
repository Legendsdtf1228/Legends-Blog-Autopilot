import type { ProviderContext, ProviderResult, ResearchProvider } from "./types.js";
import type { ResearchSignal } from "../types.js";

/** Derive research signals from Shopify catalog titles/descriptions — no invented metrics. */
export const shopifyCatalogProvider: ResearchProvider = {
  id: "shopify_catalog",
  async collect(ctx: ProviderContext): Promise<ProviderResult> {
    if (!ctx.products.length) {
      return {
        provider: "shopify_catalog",
        available: false,
        reason: "No Shopify products available (missing access or empty catalog).",
        signals: []
      };
    }
    const collectedAt = ctx.collectedAt.toISOString();
    const signals: ResearchSignal[] = ctx.products.slice(0, 40).map(p => ({
      provider: "shopify_catalog",
      collectedAt,
      dataPeriodStart: null,
      dataPeriodEnd: null,
      geographicRegion: ctx.region,
      keyword: p.title,
      topic: `Product-connected topic: ${p.title}`,
      volume: null,
      relativeInterest: null,
      growth: null,
      competition: null,
      sourceUrl: p.url,
      completeness: "partial",
      notes: "Derived from live Shopify catalog title/URL. Not a search-volume metric.",
      raw: { handle: p.handle, description: (p.description || "").slice(0, 280) }
    }));
    return { provider: "shopify_catalog", available: true, signals };
  }
};
