export type ContentPillarId =
  | "dtf_education"
  | "apparel_garment"
  | "design_color_branding"
  | "apparel_business"
  | "honest_entrepreneurship"
  | "legends_story";

export type AudienceId =
  | "local_customers"
  | "apparel_decorators"
  | "new_brand_owners"
  | "schools_teams"
  | "small_business_owners"
  | "aspiring_entrepreneurs"
  | "established_print_shops"
  | "garment_comparison_shoppers";

export type ArticleFormatId =
  | "how_to"
  | "comparison"
  | "buyers_guide"
  | "checklist"
  | "troubleshooting"
  | "first_person_story"
  | "lessons_learned"
  | "case_study"
  | "opinion"
  | "faq"
  | "seasonal_planning";

export type SearchIntent =
  | "informational"
  | "commercial"
  | "transactional"
  | "local"
  | "navigational";

export type TopicFreshnessClass = "evergreen" | "seasonal" | "trending" | "news_sensitive";

export type DataCompleteness = "complete" | "partial" | "historical" | "unavailable";

export type ResearchProviderId =
  | "seed_catalog"
  | "shopify_catalog"
  | "existing_content"
  | "google_search_console"
  | "google_trends"
  | "keyword_volume"
  | "site_search"
  | "approved_web";

export interface ScoringWeights {
  demandScore: number;
  growthScore: number;
  businessRelevance: number;
  conversionIntent: number;
  rankingOpportunity: number;
  localRelevance: number;
  freshnessScore: number;
  contentGapScore: number;
}

export interface PillarBalance {
  dtf_education: number;
  apparel_garment: number;
  design_color_branding: number;
  apparel_business: number;
  honest_entrepreneurship: number;
  legends_story: number;
}

export interface ResearchSettings {
  enabled: boolean;
  region: string;
  freshnessMaxDays: number;
  weights: ScoringWeights;
  pillarBalance: PillarBalance;
  overlapRejectThreshold: number;
  requireInterviewForFirstPerson: boolean;
}

export interface ResearchSignal {
  id?: number;
  provider: ResearchProviderId;
  collectedAt: string;
  dataPeriodStart: string | null;
  dataPeriodEnd: string | null;
  geographicRegion: string;
  keyword: string;
  topic: string | null;
  volume: number | null;
  relativeInterest: number | null;
  growth: number | null;
  competition: number | null;
  sourceUrl: string | null;
  completeness: DataCompleteness;
  notes: string | null;
  raw?: Record<string, unknown>;
}

export interface KeywordCluster {
  id: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  intent: SearchIntent;
  pillar: ContentPillarId;
  subcategory: string;
  audience: AudienceId;
  format: ArticleFormatId;
  signals: ResearchSignal[];
  missingProviders: ResearchProviderId[];
}

export interface OpportunityScores {
  demandScore: number;
  growthScore: number;
  businessRelevance: number;
  conversionIntent: number;
  rankingOpportunity: number;
  localRelevance: number;
  freshnessScore: number;
  contentGapScore: number;
  overlapPenalty: number;
  factualConfidence: number;
  opportunityScore: number;
}

export interface OverlapMatch {
  articleId: number | null;
  title: string;
  handle: string;
  status: string;
  score: number;
  reason: string;
}

export interface ResearchOpportunity {
  id: string;
  cluster: KeywordCluster;
  scores: OpportunityScores;
  freshnessClass: TopicFreshnessClass;
  dataCollectedLabel: string;
  completeness: DataCompleteness;
  closestExisting: OverlapMatch | null;
  whyDistinct: string;
  whyFitsLegends: string;
  requiresInterview: boolean;
  productsToFeature: Array<{ title: string; url: string }>;
  proposedTitle: string;
  proposedHandle: string;
  proposedOutline: string[];
  internalLinks: string[];
  externalSources: Array<{ url: string; retrievedAt: string; note: string }>;
  status: "suggested" | "reserved" | "approved" | "rejected" | "used";
  reservedBy?: string | null;
  reservedUntil?: string | null;
}

export interface LockedFactSheet {
  productFacts: string[];
  businessFacts: string[];
  sourcedIndustryFacts: Array<{ claim: string; url: string; retrievedAt: string }>;
  prohibitedClaims: string[];
  reviewFlags: string[];
}

export interface MerchantInterview {
  id?: number;
  briefId: number;
  questions: Array<{ id: string; question: string; answer: string | null }>;
  completed: boolean;
  updatedAt?: string;
}

export interface ArticleBrief {
  id?: number;
  opportunityId: string;
  pillar: ContentPillarId;
  subcategory: string;
  audience: AudienceId;
  format: ArticleFormatId;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: SearchIntent;
  targetAudienceLabel: string;
  geographicTarget: string;
  demandEvidence: string;
  dataCollectedLabel: string;
  estimatedCompetition: string;
  conversionRelevance: string;
  closestExistingTitle: string | null;
  overlapScore: number;
  whyDistinct: string;
  proposedTitle: string;
  proposedHandle: string;
  proposedOutline: string[];
  productsToFeature: Array<{ title: string; url: string }>;
  internalLinks: string[];
  externalSources: Array<{ url: string; retrievedAt: string; note: string }>;
  freshnessClass: TopicFreshnessClass;
  requiresInterview: boolean;
  factSheet: LockedFactSheet;
  status: "pending_review" | "approved" | "rejected" | "generated";
  customTopic?: string | null;
  scores: OpportunityScores;
  createdAt?: string;
  updatedAt?: string;
}

export interface EvidenceReport {
  sourcesUsed: Array<{ provider: string; detail: string; collectedAt: string }>;
  shopifyFactsUsed: string[];
  reviewFlags: string[];
  qualityGateResults: Array<{ gate: string; ok: boolean; detail: string }>;
  generatedAt: string;
}

export interface ResearchCycleResult {
  collectedAt: string;
  missingProviders: Array<{ provider: ResearchProviderId; reason: string }>;
  signals: ResearchSignal[];
  opportunities: ResearchOpportunity[];
  selected: ResearchOpportunity | null;
}
