import type { ResearchConfig, Settings } from "./types.js";

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
    "DTF Education",
    "Apparel and Garment Knowledge",
    "Design, Color, and Branding",
    "Apparel-Business Education",
    "Honest Entrepreneurship",
    "Legends DTF Story and Behind the Scenes"
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
  secondaryKeywordsDefault: ["gang sheets", "custom apparel", "Warner Robins"],
  research: {
    enabled: true,
    region: "United States / Georgia / Warner Robins",
    freshnessMaxDays: 45,
    overlapRejectThreshold: 0.72,
    requireInterviewForFirstPerson: true,
    weights: {
      demandScore: 0.15,
      growthScore: 0.15,
      businessRelevance: 0.2,
      conversionIntent: 0.15,
      rankingOpportunity: 0.1,
      localRelevance: 0.1,
      freshnessScore: 0.05,
      contentGapScore: 0.1
    },
    pillarBalance: {
      dtf_education: 0.25,
      apparel_garment: 0.2,
      design_color_branding: 0.15,
      apparel_business: 0.15,
      honest_entrepreneurship: 0.15,
      legends_story: 0.1
    },
    autoThresholds: {
      overallOpportunityScore: 0.78,
      businessRelevance: 0.7,
      topicSpecificity: 0.85,
      factualConfidence: 0.9,
      uniqueness: 0.85,
      conversionRelevance: 0.55,
      sourceQuality: 0.6,
      articleQuality: 0.9,
      internalLinkConfidence: 0.7
    },
    minTopicSpecificity: 0.85
  },
  rolloutMode: "draft_only",
  frequencyLimits: {
    maxArticlesPerCycle: 1,
    maxPublishedPerRolling7Days: 5,
    minHoursBetweenPublishes: 18
  },
  promotionThresholds: {
    minConsecutiveReviewedDrafts: 30,
    minMerchantApprovalRate: 0.9,
    minShadowAutoDays: 14
  },
  promotionProgress: {
    consecutiveReviewedDrafts: 0,
    merchantApprovalRate: 0,
    shadowAutoDays: 0,
    autoPublishExplicitlyActivated: false
  },
  killSwitch: {
    paused: false,
    reason: null,
    recoveryStep: null,
    triggeredAt: null,
    consecutiveFailureThreshold: 3
  },
  researchCadence: "twice_daily"
};

export function mergeResearchConfig(raw: Partial<ResearchConfig> | null | undefined): ResearchConfig {
  const base = defaultSettings.research;
  return {
    ...base,
    ...(raw ?? {}),
    enabled: Boolean(raw?.enabled ?? base.enabled),
    weights: { ...base.weights, ...(raw?.weights ?? {}) },
    pillarBalance: { ...base.pillarBalance, ...(raw?.pillarBalance ?? {}) },
    autoThresholds: { ...base.autoThresholds, ...(raw?.autoThresholds ?? {}) },
    requireInterviewForFirstPerson: raw?.requireInterviewForFirstPerson ?? base.requireInterviewForFirstPerson,
    freshnessMaxDays: Number(raw?.freshnessMaxDays ?? base.freshnessMaxDays),
    overlapRejectThreshold: Number(raw?.overlapRejectThreshold ?? base.overlapRejectThreshold),
    minTopicSpecificity: Number(raw?.minTopicSpecificity ?? base.minTopicSpecificity)
  };
}

export function mergeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const base = { ...defaultSettings, ...(raw ?? {}) };
  const rolloutMode = (raw?.rolloutMode ?? defaultSettings.rolloutMode) as Settings["rolloutMode"];
  // Never auto-enable AUTO_PUBLISH from missing/partial settings; require explicit value.
  const safeRollout =
    rolloutMode === "auto_publish" && raw?.rolloutMode !== "auto_publish"
      ? "draft_only"
      : rolloutMode;
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
    openaiModel: raw?.openaiModel ?? null,
    research: mergeResearchConfig(raw?.research),
    rolloutMode: safeRollout,
    frequencyLimits: { ...defaultSettings.frequencyLimits, ...(raw?.frequencyLimits ?? {}) },
    promotionThresholds: { ...defaultSettings.promotionThresholds, ...(raw?.promotionThresholds ?? {}) },
    promotionProgress: { ...defaultSettings.promotionProgress, ...(raw?.promotionProgress ?? {}) },
    killSwitch: { ...defaultSettings.killSwitch, ...(raw?.killSwitch ?? {}) },
    researchCadence: raw?.researchCadence ?? defaultSettings.researchCadence
  };
}
