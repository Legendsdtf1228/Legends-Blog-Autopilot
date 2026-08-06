import { createHash } from "node:crypto";
import { CONTENT_PILLARS, pillarById } from "./pillars.js";
import type {
  ArticleFormatId,
  AudienceId,
  ContentPillarId,
  KeywordCluster,
  ResearchProviderId,
  ResearchSignal,
  SearchIntent
} from "./types.js";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function stemToken(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies") && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ses") || token.endsWith("xes") || token.endsWith("zes")) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokenize(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(" ")
      .filter(t => t.length > 2)
      .map(stemToken)
  );
}

export function jaccard(a: string, b: string): number {
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function detectPillar(keyword: string): { pillar: ContentPillarId; subcategory: string } {
  const n = normalize(keyword);
  for (const pillar of CONTENT_PILLARS) {
    for (const seed of pillar.seedKeywords) {
      if (n.includes(normalize(seed)) || jaccard(n, seed) >= 0.45) {
        return { pillar: pillar.id, subcategory: pillar.subcategories[0]! };
      }
    }
    for (const sub of pillar.subcategories) {
      if (jaccard(n, sub) >= 0.4) return { pillar: pillar.id, subcategory: sub };
    }
  }
  if (/\b(entrepreneur|9-to-5|burnout|quit|owner)\b/.test(n)) {
    return { pillar: "honest_entrepreneurship", subcategory: "leaving a 9-to-5" };
  }
  if (/\b(color|logo|brand|design|typography)\b/.test(n)) {
    return { pillar: "design_color_branding", subcategory: "color psychology" };
  }
  if (/\b(shirt|cotton|polyester|garment|hoodie|brand)\b/.test(n)) {
    return { pillar: "apparel_garment", subcategory: "T-shirt brand comparisons" };
  }
  if (/\b(pricing|startup|wholesale|profit|business)\b/.test(n)) {
    return { pillar: "apparel_business", subcategory: "starting a T-shirt business" };
  }
  if (/\b(warner robins|middle georgia|legends|storefront)\b/.test(n)) {
    return { pillar: "legends_story", subcategory: "Warner Robins storefront" };
  }
  return { pillar: "dtf_education", subcategory: "production education" };
}

function detectIntent(keyword: string): SearchIntent {
  const n = normalize(keyword);
  if (/\b(near me|warner robins|middle georgia|local)\b/.test(n)) return "local";
  if (/\b(buy|price|pricing|cost|order|wholesale)\b/.test(n)) return "transactional";
  if (/\b(best|vs|versus|compare|review|for)\b/.test(n)) return "commercial";
  if (/\blegends dtf\b/.test(n)) return "navigational";
  return "informational";
}

function defaultAudience(pillar: ContentPillarId): AudienceId {
  return pillarById(pillar).audiences[0]!;
}

function defaultFormat(pillar: ContentPillarId, intent: SearchIntent): ArticleFormatId {
  if (pillar === "honest_entrepreneurship" || pillar === "legends_story") return "first_person_story";
  if (intent === "commercial") return "comparison";
  if (/\bhow\b|\bprep\b|\bpress\b/.test(pillar)) return "how_to";
  return pillarById(pillar).formats[0]!;
}

export function clusterSignals(
  signals: ResearchSignal[],
  missingProviders: ResearchProviderId[]
): KeywordCluster[] {
  // Demand-bearing and seed/product signals only for clustering (exclude existing_content overlap noise).
  const candidates = signals.filter(s => s.provider !== "existing_content");
  const used = new Set<number>();
  const clusters: KeywordCluster[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    const seed = candidates[i]!;
    const group = [seed];
    used.add(i);
    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      const other = candidates[j]!;
      if (jaccard(seed.keyword, other.keyword) >= 0.72) {
        group.push(other);
        used.add(j);
      }
    }

    const { pillar, subcategory } = detectPillar(seed.keyword);
    const intent = detectIntent(seed.keyword);
    const keywords = [...new Set(group.map(g => g.keyword))];
    const primary = keywords.sort((a, b) => a.length - b.length)[0]!;
    const id = createHash("sha1").update(`${pillar}|${intent}|${normalize(primary)}`).digest("hex").slice(0, 16);

    clusters.push({
      id,
      primaryKeyword: primary,
      secondaryKeywords: keywords.filter(k => k !== primary).slice(0, 8),
      intent,
      pillar,
      subcategory,
      audience: defaultAudience(pillar),
      format: defaultFormat(pillar, intent),
      signals: group,
      missingProviders
    });
  }
  return clusters;
}

export function isTrivialVariation(a: string, b: string): boolean {
  return jaccard(a, b) >= 0.72;
}
