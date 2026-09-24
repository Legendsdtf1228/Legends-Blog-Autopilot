import type {
  ArticleFormatId,
  AudienceId,
  AutoPublishThresholds,
  ContentPillarId,
  PillarBalance,
  ResearchSettings,
  ScoringWeights
} from "./types.js";
import { DEFAULT_AUTO_THRESHOLDS } from "./outcomes.js";

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  demandScore: 0.15,
  growthScore: 0.15,
  businessRelevance: 0.2,
  conversionIntent: 0.15,
  rankingOpportunity: 0.1,
  localRelevance: 0.1,
  freshnessScore: 0.05,
  contentGapScore: 0.1
};

export const DEFAULT_PILLAR_BALANCE: PillarBalance = {
  dtf_education: 0.25,
  apparel_garment: 0.2,
  design_color_branding: 0.15,
  apparel_business: 0.15,
  honest_entrepreneurship: 0.15,
  legends_story: 0.1
};

export const DEFAULT_RESEARCH_SETTINGS: ResearchSettings = {
  enabled: true,
  region: "United States / Georgia / Warner Robins",
  freshnessMaxDays: 45,
  weights: DEFAULT_SCORING_WEIGHTS,
  pillarBalance: DEFAULT_PILLAR_BALANCE,
  overlapRejectThreshold: 0.72,
  requireInterviewForFirstPerson: true,
  autoThresholds: DEFAULT_AUTO_THRESHOLDS,
  minTopicSpecificity: 0.85
};

export function researchSettingsFromApp(research: {
  enabled: boolean;
  region: string;
  freshnessMaxDays: number;
  overlapRejectThreshold: number;
  requireInterviewForFirstPerson: boolean;
  weights: ScoringWeights;
  pillarBalance: PillarBalance;
  autoThresholds?: AutoPublishThresholds;
  minTopicSpecificity?: number;
}): ResearchSettings {
  return {
    enabled: research.enabled,
    region: research.region,
    freshnessMaxDays: research.freshnessMaxDays,
    overlapRejectThreshold: research.overlapRejectThreshold,
    requireInterviewForFirstPerson: research.requireInterviewForFirstPerson,
    weights: research.weights,
    pillarBalance: research.pillarBalance,
    autoThresholds: research.autoThresholds ?? DEFAULT_AUTO_THRESHOLDS,
    minTopicSpecificity: research.minTopicSpecificity ?? 0.85
  };
}

export interface PillarDefinition {
  id: ContentPillarId;
  label: string;
  subcategories: string[];
  seedKeywords: string[];
  audiences: AudienceId[];
  formats: ArticleFormatId[];
}

export const CONTENT_PILLARS: PillarDefinition[] = [
  {
    id: "dtf_education",
    label: "DTF Education",
    subcategories: [
      "pressing and application",
      "artwork preparation",
      "gang-sheet planning",
      "troubleshooting",
      "specialty DTF",
      "production education"
    ],
    seedKeywords: [
      "DTF transfers",
      "DTF gang sheets",
      "DTF artwork preparation",
      "DTF pressing",
      "specialty DTF",
      "glitter DTF",
      "glow-in-the-dark DTF",
      "UV DTF decals"
    ],
    audiences: ["apparel_decorators", "new_brand_owners", "local_customers", "established_print_shops"],
    formats: ["how_to", "troubleshooting", "checklist", "faq", "seasonal_planning"]
  },
  {
    id: "apparel_garment",
    label: "Apparel and Garment Knowledge",
    subcategories: [
      "T-shirt brand comparisons",
      "garment quality and durability",
      "fabric weight",
      "cotton polyester blends",
      "fit sizing softness shrinkage",
      "choosing blanks",
      "hoodies polos workwear",
      "embroidery",
      "decoration comparison"
    ],
    seedKeywords: [
      "best T-shirt brands for printing",
      "shirt fabric and weight",
      "cotton vs polyester shirts",
      "custom shirts",
      "hoodies for printing",
      "embroidery",
      "embroidery vs DTF for work shirts",
      "embroidery for work shirts"
    ],
    // subcategory "embroidery" and "decoration comparison" used by classification rules
    audiences: ["garment_comparison_shoppers", "apparel_decorators", "new_brand_owners", "schools_teams"],
    formats: ["comparison", "buyers_guide", "checklist", "faq"]
  },
  {
    id: "design_color_branding",
    label: "Design, Color, and Branding",
    subcategories: [
      "color psychology",
      "garment and ink color combinations",
      "logo placement",
      "typography",
      "brand consistency",
      "designing for schools teams businesses",
      "print vs screen colors"
    ],
    seedKeywords: [
      "color psychology in branding",
      "logo colors",
      "shirt design placement",
      "brand color combinations",
      "custom apparel design"
    ],
    audiences: ["new_brand_owners", "small_business_owners", "schools_teams", "local_customers"],
    formats: ["how_to", "buyers_guide", "opinion", "checklist"]
  },
  {
    id: "apparel_business",
    label: "Apparel-Business Education",
    subcategories: [
      "starting a T-shirt business",
      "pricing for profit",
      "garment and transfer costs",
      "gang-sheet economics",
      "customer acquisition",
      "wholesale and retail",
      "production planning",
      "startup mistakes"
    ],
    seedKeywords: [
      "starting a T-shirt business",
      "clothing-brand startup",
      "pricing custom shirts",
      "print-shop ownership",
      "custom apparel business"
    ],
    audiences: ["aspiring_entrepreneurs", "new_brand_owners", "small_business_owners", "established_print_shops"],
    formats: ["how_to", "checklist", "lessons_learned", "faq", "case_study"]
  },
  {
    id: "honest_entrepreneurship",
    label: "Honest Entrepreneurship",
    subcategories: [
      "starting young",
      "leaving a 9-to-5",
      "long workdays",
      "financial pressure",
      "burnout",
      "hiring and delegating",
      "equipment investments",
      "mistakes and recovery",
      "owning a job vs building a business"
    ],
    seedKeywords: [
      "leaving a 9-to-5",
      "young entrepreneurs",
      "small-business burnout",
      "business growth lessons",
      "print shop ownership reality"
    ],
    audiences: ["aspiring_entrepreneurs", "small_business_owners", "new_brand_owners"],
    formats: ["first_person_story", "lessons_learned", "opinion", "case_study"]
  },
  {
    id: "legends_story",
    label: "Legends DTF Story and Behind the Scenes",
    subcategories: [
      "Warner Robins storefront",
      "clothing brand to print company",
      "choosing equipment",
      "color management",
      "large orders",
      "production failures",
      "Middle Georgia customers",
      "milestones and challenges"
    ],
    seedKeywords: [
      "Warner Robins printing",
      "Middle Georgia printing",
      "local print shop story",
      "custom apparel business story"
    ],
    audiences: ["local_customers", "aspiring_entrepreneurs", "small_business_owners"],
    formats: ["first_person_story", "lessons_learned", "case_study", "opinion"]
  }
];

export const AUDIENCE_LABELS: Record<AudienceId, string> = {
  local_customers: "Local customers ordering finished apparel",
  apparel_decorators: "Apparel decorators",
  new_brand_owners: "New clothing-brand owners",
  schools_teams: "Schools and teams",
  small_business_owners: "Small-business owners",
  aspiring_entrepreneurs: "Aspiring entrepreneurs",
  established_print_shops: "Established print shops",
  garment_comparison_shoppers: "People comparing garment or decoration options"
};

export const FORMAT_LABELS: Record<ArticleFormatId, string> = {
  how_to: "How-to guide",
  comparison: "Comparison",
  buyers_guide: "Buyer’s guide",
  checklist: "Checklist",
  troubleshooting: "Troubleshooting guide",
  first_person_story: "First-person story",
  lessons_learned: "Lessons learned",
  case_study: "Case study",
  opinion: "Opinion/perspective",
  faq: "Frequently asked questions",
  seasonal_planning: "Seasonal planning guide"
};

export const BASE_SEED_CATEGORIES = [
  "DTF transfers",
  "DTF gang sheets",
  "DTF artwork preparation",
  "DTF pressing",
  "specialty DTF",
  "glitter DTF",
  "glow-in-the-dark DTF",
  "UV DTF decals",
  "embroidery",
  "custom shirts",
  "school spirit wear",
  "team apparel",
  "business uniforms",
  "Warner Robins printing",
  "Middle Georgia printing",
  "best T-shirt brands for printing",
  "shirt fabric and weight",
  "cotton vs polyester shirts",
  "color psychology in branding",
  "logo colors",
  "shirt design placement",
  "starting a T-shirt business",
  "clothing-brand startup",
  "pricing custom shirts",
  "leaving a 9-to-5",
  "young entrepreneurs",
  "print-shop ownership",
  "small-business burnout",
  "business growth lessons",
  "custom apparel business",
  "how to choose a local custom shirt printer"
];

export const ENTREPRENEURSHIP_INTERVIEW_QUESTIONS = [
  "What made you leave your job?",
  "How old were you when you began?",
  "What did your schedule look like at the beginning?",
  "What was the hardest financial period?",
  "Which equipment purchase changed the business?",
  "What mistake cost you the most?",
  "When did you realize the business was becoming real?",
  "What would you tell someone preparing to quit?",
  "What does success look like now?",
  "What part of ownership is still difficult?"
];

export function pillarById(id: ContentPillarId): PillarDefinition {
  const found = CONTENT_PILLARS.find(p => p.id === id);
  if (!found) throw new Error(`Unknown pillar: ${id}`);
  return found;
}
