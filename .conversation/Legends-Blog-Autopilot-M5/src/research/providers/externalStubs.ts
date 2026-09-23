import type { ProviderContext, ProviderResult, ResearchProvider } from "./types.js";

function stub(id: ResearchProvider["id"], envKeys: string[], label: string): ResearchProvider {
  return {
    id,
    async collect(ctx: ProviderContext): Promise<ProviderResult> {
      const missing = envKeys.filter(k => !ctx.env[k]);
      if (missing.length) {
        return {
          provider: id,
          available: false,
          reason: `${label} not configured (missing ${missing.join(", ")}). Continuing without inventing metrics.`,
          signals: []
        };
      }
      // Credentials present but live API integration is intentionally not executed here without approved connectors.
      return {
        provider: id,
        available: false,
        reason: `${label} credentials detected, but live connector is not enabled in this deployment. No fabricated metrics were used.`,
        signals: []
      };
    }
  };
}

export const googleSearchConsoleProvider = stub(
  "google_search_console",
  ["GSC_CLIENT_EMAIL", "GSC_PRIVATE_KEY", "GSC_SITE_URL"],
  "Google Search Console"
);

export const googleTrendsProvider = stub(
  "google_trends",
  ["GOOGLE_TRENDS_API_KEY"],
  "Google Trends"
);

export const keywordVolumeProvider = stub(
  "keyword_volume",
  ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN"],
  "Keyword volume provider"
);

export const siteSearchProvider = stub(
  "site_search",
  ["SITE_SEARCH_EXPORT_URL"],
  "Internal site-search export"
);

export const approvedWebProvider = stub(
  "approved_web",
  ["APPROVED_WEB_RESEARCH_ENABLED"],
  "Approved web research"
);
