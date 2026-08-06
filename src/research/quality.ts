import { countWords } from "../content.js";
import type { ArticleBrief, EvidenceReport } from "./types.js";

export interface GeneratedDraftFields {
  title: string;
  handle: string;
  excerpt: string;
  metaTitle: string;
  metaDescription: string;
  bodyHtml: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
}

export function runQualityGates(args: {
  brief: ArticleBrief;
  draft: GeneratedDraftFields;
}): EvidenceReport {
  const results: EvidenceReport["qualityGateResults"] = [];
  const bodyText = args.draft.bodyHtml.replace(/<[^>]+>/g, " ");
  const words = countWords(args.draft.bodyHtml);

  results.push({
    gate: "topic_preservation",
    ok: bodyText.toLowerCase().includes(args.brief.primaryKeyword.toLowerCase().split(" ")[0] || "") ||
      args.draft.title.toLowerCase().includes(args.brief.primaryKeyword.toLowerCase().split(" ")[0] || ""),
    detail: "Draft should preserve the approved primary topic/keyword."
  });

  results.push({
    gate: "overlap",
    ok: args.brief.overlapScore < 0.72,
    detail: `Overlap score ${args.brief.overlapScore}`
  });

  const metaLen = args.draft.metaDescription.trim().length;
  results.push({
    gate: "meta_description",
    ok: metaLen >= 120 && metaLen <= 160,
    detail: `Meta description length ${metaLen}`
  });

  results.push({
    gate: "title_quality",
    ok: args.draft.title.length >= 20 && args.draft.title.length <= 70,
    detail: `Title length ${args.draft.title.length}`
  });

  const stuffing = (bodyText.toLowerCase().match(new RegExp(args.brief.primaryKeyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  results.push({
    gate: "keyword_stuffing",
    ok: stuffing <= Math.max(8, Math.floor(words / 120)),
    detail: `Primary keyword occurrences ${stuffing}`
  });

  const prohibitedHit = /\b(guaranteed|always in stock|best in the world|will increase sales by)\b/i.test(bodyText);
  results.push({
    gate: "unsupported_claims",
    ok: !prohibitedHit,
    detail: prohibitedHit ? "Contains prohibited unsupported claim language" : "No obvious prohibited claims"
  });

  const colorAbsolutes = args.brief.pillar === "design_color_branding" &&
    /\b(always makes people buy|scientifically proven to increase sales|universally means)\b/i.test(bodyText);
  results.push({
    gate: "color_psychology_caution",
    ok: !colorAbsolutes,
    detail: colorAbsolutes ? "Overstated color-psychology claim" : "OK"
  });

  const inventedPersonal = args.brief.requiresInterview &&
    /\b(I made \$|my revenue|my employee|when I quit my job at)\b/i.test(bodyText) &&
    !args.brief.factSheet.businessFacts.some(f => bodyText.includes(f.slice(0, 24)));
  results.push({
    gate: "invented_personal_experience",
    ok: !inventedPersonal,
    detail: inventedPersonal ? "Possible invented first-person specifics" : "OK"
  });

  results.push({
    gate: "completeness",
    ok: words >= 500 && /<h2/i.test(args.draft.bodyHtml),
    detail: `Word count ${words}`
  });

  results.push({
    gate: "internal_links",
    ok: args.brief.productsToFeature.length === 0 || /href=/i.test(args.draft.bodyHtml) || args.brief.format === "first_person_story",
    detail: "Trust-building formats may omit product links; product briefs should include links when products were selected."
  });

  return {
    sourcesUsed: [
      {
        provider: "research_brief",
        detail: args.brief.demandEvidence,
        collectedAt: new Date().toISOString()
      },
      ...args.brief.externalSources.map(s => ({
        provider: "external",
        detail: s.note,
        collectedAt: s.retrievedAt
      }))
    ],
    shopifyFactsUsed: args.brief.factSheet.productFacts,
    reviewFlags: [
      ...args.brief.factSheet.reviewFlags,
      ...results.filter(r => !r.ok).map(r => `${r.gate}: ${r.detail}`)
    ],
    qualityGateResults: results,
    generatedAt: new Date().toISOString()
  };
}

export function qualityGatesPassed(report: EvidenceReport): boolean {
  return report.qualityGateResults.every(g => g.ok);
}
