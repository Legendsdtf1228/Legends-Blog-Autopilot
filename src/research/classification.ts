import type { ContentPillarId, SearchIntent } from "./types.js";

export interface ClassificationRule {
  pattern: RegExp;
  pillar: ContentPillarId;
  subcategory: string;
  priority: number;
}

/**
 * Explicit keyword → pillar/subcategory mappings.
 * Higher priority wins. Checked before generic seed Jaccard matching.
 */
export const CLASSIFICATION_RULES: ClassificationRule[] = [
  // Decoration / comparisons first
  { pattern: /\b(embroidery)\b.*\b(dtf|transfer)\b|\b(dtf|transfer)\b.*\b(embroidery)\b|\bembroidery vs\b|\bvs embroidery\b/i, pillar: "apparel_garment", subcategory: "decoration comparison", priority: 100 },
  { pattern: /\b(dtf)\b.*\b(vinyl|sublimation|screen print)\b|\b(vinyl|sublimation|screen print)\b.*\b(dtf)\b/i, pillar: "dtf_education", subcategory: "decoration comparison", priority: 95 },

  // Embroidery → garment knowledge (NOT dtf_education)
  { pattern: /\bembroidery\b/i, pillar: "apparel_garment", subcategory: "embroidery", priority: 90 },

  // Design / color
  { pattern: /\bcolor psychology\b|\blogo colou?rs?\b|\bbrand colou?r/i, pillar: "design_color_branding", subcategory: "color psychology", priority: 90 },
  { pattern: /\b(logo placement|shirt design placement|typography|brand consistency)\b/i, pillar: "design_color_branding", subcategory: "logo placement", priority: 85 },

  // Garment knowledge
  { pattern: /\bbest t-?shirt brands?\b|\bshirt brands? for printing\b/i, pillar: "apparel_garment", subcategory: "T-shirt brand comparisons", priority: 90 },
  { pattern: /\bcotton vs polyester\b|\bfabric weight\b|\bshirt fabric\b/i, pillar: "apparel_garment", subcategory: "fabric weight", priority: 88 },
  { pattern: /\b(hoodie|polo|workwear|performance apparel|blanks?)\b/i, pillar: "apparel_garment", subcategory: "choosing blanks", priority: 70 },

  // Apparel business
  { pattern: /\bpricing custom shirts?\b|\bpricing for profit\b|\bgarment and transfer costs?\b/i, pillar: "apparel_business", subcategory: "pricing for profit", priority: 90 },
  { pattern: /\bstarting a t-?shirt business\b|\bclothing-?brand startup\b|\bcustom apparel business\b/i, pillar: "apparel_business", subcategory: "starting a T-shirt business", priority: 88 },
  { pattern: /\b(wholesale|retail decisions|customer acquisition|gang-?sheet economics)\b/i, pillar: "apparel_business", subcategory: "customer acquisition", priority: 75 },

  // Entrepreneurship
  { pattern: /\bleaving a 9-?to-?5\b|\bquit (my |the )?job\b|\byoung entrepreneurs?\b/i, pillar: "honest_entrepreneurship", subcategory: "leaving a 9-to-5", priority: 90 },
  { pattern: /\b(small-?business burnout|work-?life balance|hiring and delegat)/i, pillar: "honest_entrepreneurship", subcategory: "burnout", priority: 85 },
  { pattern: /\bbusiness growth lessons\b|\bprint-?shop ownership\b/i, pillar: "honest_entrepreneurship", subcategory: "owning a job vs building a business", priority: 80 },

  // Legends story / local
  { pattern: /\bwarner robins\b|\bmiddle georgia\b|\blocal print shop story\b/i, pillar: "legends_story", subcategory: "Warner Robins storefront", priority: 85 },

  // DTF education (specific, not embroidery)
  { pattern: /\b(dtf transfers?|gang sheets?|dtf pressing|artwork preparation|glitter dtf|glow-in-the-dark dtf|uv dtf|specialty dtf)\b/i, pillar: "dtf_education", subcategory: "production education", priority: 80 },
  { pattern: /\b(heat press|transfer care|pressing temperature)\b/i, pillar: "dtf_education", subcategory: "pressing and application", priority: 75 }
];

export function classifyTopic(keyword: string): { pillar: ContentPillarId; subcategory: string; matchedRule: boolean } {
  const text = keyword.trim();
  let best: ClassificationRule | null = null;
  for (const rule of CLASSIFICATION_RULES) {
    if (!rule.pattern.test(text)) continue;
    if (!best || rule.priority > best.priority) best = rule;
  }
  if (best) {
    return { pillar: best.pillar, subcategory: best.subcategory, matchedRule: true };
  }
  // Unmatched keywords must not default into DTF education (embroidery bug class).
  return { pillar: "apparel_business", subcategory: "general apparel education", matchedRule: false };
}

/** Validate that a proposed pillar/subcategory is consistent with the keyword; reclassify if mismatched. */
export function validateOrReclassify(
  keyword: string,
  proposed: { pillar: ContentPillarId; subcategory: string }
): { pillar: ContentPillarId; subcategory: string; reclassified: boolean; reason?: string } {
  const classified = classifyTopic(keyword);
  if (!classified.matchedRule) {
    return { ...proposed, reclassified: false };
  }
  if (classified.pillar !== proposed.pillar) {
    return {
      pillar: classified.pillar,
      subcategory: classified.subcategory,
      reclassified: true,
      reason: `Keyword “${keyword}” mapped to ${classified.pillar}/${classified.subcategory}, not ${proposed.pillar}.`
    };
  }
  // Keep more specific subcategory from rules when pillar matches
  if (classified.subcategory && classified.subcategory !== proposed.subcategory) {
    return {
      pillar: classified.pillar,
      subcategory: classified.subcategory,
      reclassified: true,
      reason: `Subcategory refined to “${classified.subcategory}”.`
    };
  }
  return { ...proposed, reclassified: false };
}

export function detectIntentFromKeyword(keyword: string): SearchIntent {
  const n = keyword.toLowerCase();
  if (/\b(near me|warner robins|middle georgia|local)\b/.test(n)) return "local";
  if (/\b(buy|price|pricing|cost|order|wholesale)\b/.test(n)) return "transactional";
  if (/\b(best|vs|versus|compare|review|which is better)\b/.test(n)) return "commercial";
  if (/\blegends dtf\b/.test(n)) return "navigational";
  return "informational";
}
