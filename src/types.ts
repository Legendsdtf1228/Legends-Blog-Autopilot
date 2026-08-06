export type Cadence = "daily" | "twice_daily";

export type ArticleStatus =
  | "idea"
  | "generating"
  | "draft"
  | "ready"
  | "scheduled"
  | "publishing"
  | "published"
  | "failed"
  | "archived";

export type JobStatus =
  | "pending"
  | "running"
  | "published"
  | "failed"
  | "skipped"
  | "cancelled";

export type ArticleLength = "short" | "medium" | "long" | "custom";

export type SeoBehavior = "auto" | "manual";

export interface ResearchConfig {
  enabled: boolean;
  region: string;
  freshnessMaxDays: number;
  overlapRejectThreshold: number;
  requireInterviewForFirstPerson: boolean;
  weights: {
    demandScore: number;
    growthScore: number;
    businessRelevance: number;
    conversionIntent: number;
    rankingOpportunity: number;
    localRelevance: number;
    freshnessScore: number;
    contentGapScore: number;
  };
  pillarBalance: {
    dtf_education: number;
    apparel_garment: number;
    design_color_branding: number;
    apparel_business: number;
    honest_entrepreneurship: number;
    legends_story: number;
  };
}

export interface Settings {
  enabled: boolean;
  cadence: Cadence;
  timezone: string;
  firstTime: string;
  secondTime: string;
  authorName: string;
  wordCountMin: number;
  wordCountMax: number;
  facts: string[];
  contentPillars: string[];
  shopifyBlogId: string | null;
  shopifyBlogHandle: string;
  storefrontUrl: string;
  businessName: string;
  brandVoice: string;
  targetAudience: string;
  defaultCta: string;
  defaultArticleLength: ArticleLength;
  defaultSeoBehavior: SeoBehavior;
  openaiModel: string | null;
  draftOnlyMode: boolean;
  retryLimit: number;
  enableAiImages: boolean;
  primaryKeywordDefault: string;
  secondaryKeywordsDefault: string[];
  research: ResearchConfig;
}

export interface ProductLink {
  id?: string;
  title: string;
  handle?: string;
  url: string;
  imageUrl?: string | null;
  status?: string;
  available?: boolean;
}

export interface ArticleContent {
  title: string;
  handle: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  bodyHtml: string;
  tags: string[];
  author: string;
  featuredImageUrl: string | null;
  featuredImageAlt: string | null;
  primaryKeyword: string;
  secondaryKeywords: string[];
  topicFingerprint: string;
  rationale: string;
}

/** Legacy shape used by existing generator / jobs JSON */
export interface GeneratedArticle {
  title: string;
  handle: string;
  summary: string;
  metaDescription: string;
  bodyHtml: string;
  tags: string[];
  primaryKeyword: string;
  topicFingerprint: string;
  rationale: string;
}

export interface ArticleRecord extends ArticleContent {
  id: number;
  status: ArticleStatus;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  shopifyBlogId: string | null;
  shopifyArticleId: string | null;
  shopifyHandle: string | null;
  shopifyUrl: string | null;
  shopifyResponseStatus: string | null;
  generationError: string | null;
  lastError: string | null;
  idempotencyKey: string | null;
  source: string;
  merchantEdited: boolean;
  merchantEditedFields: string[];
  generationSettings: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Job {
  id: number;
  slot_key: string;
  scheduled_for: Date;
  status: string;
  attempts: number;
  article_id?: number | null;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface NormalizationResult {
  content: ArticleContent;
  warnings: FieldError[];
  changed: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
  content?: ArticleContent;
}

export interface GenerationSettings {
  model?: string;
  brandVoice?: string;
  targetAudience?: string;
  articleType?: string;
  topic?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  desiredLength?: ArticleLength;
  productFocus?: string[];
  callToAction?: string;
  internalLinking?: boolean;
  imagePrompt?: string;
  draftOnly?: boolean;
}

export interface AuditEvent {
  id?: number;
  actor: string;
  action: string;
  articleId?: number | null;
  jobId?: number | null;
  detail?: Record<string, unknown>;
  createdAt?: Date;
}

export interface OverviewStats {
  draftCount: number;
  readyCount: number;
  scheduledCount: number;
  publishedCount: number;
  failedCount: number;
  nextScheduled: ArticleRecord | null;
  recentSuccesses: ArticleRecord[];
  recentFailures: ArticleRecord[];
}
