import type { Settings } from "./types.js";

export const CONTENT_LIMITS = {
  title: { min: 10, max: 120 },
  handle: { min: 3, max: 120 },
  excerpt: { min: 40, max: 320 },
  metaTitle: { min: 10, max: 70 },
  metaDescription: { min: 50, max: 160 },
  bodyHtml: { min: 200, max: 200_000 },
  tag: { min: 2, max: 40 },
  tags: { min: 0, max: 12 },
  author: { min: 2, max: 100 },
  featuredImageAlt: { max: 200 },
  primaryKeyword: { min: 2, max: 80 },
  secondaryKeyword: { max: 80 },
  heading: { max: 200 },
  topicFingerprint: { max: 100 },
  rationale: { max: 400 }
} as const;

export const ALLOWED_HTML_TAGS = [
  "p", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "b", "i",
  "a", "br", "blockquote", "img", "figure", "figcaption"
] as const;

export const defaultSettings: Settings = {
  enabled: false,
  cadence: "daily",
  timezone: "America/New_York",
  firstTime: "09:00",
  secondTime: "16:00",
  authorName: "Legends DTF Prints",
  wordCountMin: 900,
  wordCountMax: 1400,
  facts: [
    "Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia.",
    "Services include custom DTF transfers, gang sheets, embroidery, UV DTF, neck labels, and finished apparel.",
    "Standard DTF turnaround is generally 1–2 business days; embroidery is generally 1–5 business days.",
    "Do not promise same-day completion, exact pricing, free shipping, or guaranteed deadlines.",
    "Business production days are Monday through Friday; do not count Saturday or Sunday as production days.",
    "Customers should use the current website product pages for live prices, sizes, options, and availability."
  ],
  contentPillars: [
    "DTF printing education",
    "gang sheet planning and artwork preparation",
    "heat press instructions and transfer care",
    "DTF versus vinyl, sublimation, or screen printing",
    "embroidery and branded apparel",
    "school, team, and spirit wear",
    "small-business branding and merchandise",
    "seasonal ordering guidance",
    "Warner Robins and Middle Georgia custom apparel",
    "product and service spotlights"
  ],
  shopifyBlogId: null,
  shopifyBlogHandle: "news",
  storefrontUrl: "https://legendsdtf.com",
  businessName: "Legends DTF Prints",
  brandVoice: "Practical, local, helpful, and confident without hype. Speak like an experienced print shop that wants customers to succeed.",
  targetAudience: "custom apparel buyers, small businesses, schools, teams, creators, and heat-transfer customers in Warner Robins and Middle Georgia",
  defaultCta: "Explore current products and options on legendsdtf.com, or contact Legends DTF Prints in Warner Robins for help planning your next order.",
  defaultArticleLength: "medium",
  defaultSeoBehavior: "auto",
  openaiModel: null,
  draftOnlyMode: true,
  retryLimit: 4,
  enableAiImages: false,
  primaryKeywordDefault: "DTF transfers",
  secondaryKeywordsDefault: ["gang sheets", "custom apparel", "Warner Robins"]
};

export function mergeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const base = { ...defaultSettings, ...(raw ?? {}) };
  return {
    ...base,
    facts: Array.isArray(raw?.facts) ? raw!.facts : defaultSettings.facts,
    contentPillars: Array.isArray(raw?.contentPillars) ? raw!.contentPillars : defaultSettings.contentPillars,
    secondaryKeywordsDefault: Array.isArray(raw?.secondaryKeywordsDefault)
      ? raw!.secondaryKeywordsDefault
      : defaultSettings.secondaryKeywordsDefault,
    enabled: Boolean(raw?.enabled ?? false),
    draftOnlyMode: raw?.draftOnlyMode ?? true,
    retryLimit: Number(raw?.retryLimit ?? defaultSettings.retryLimit),
    shopifyBlogId: raw?.shopifyBlogId ?? null,
    openaiModel: raw?.openaiModel ?? null
  };
}
