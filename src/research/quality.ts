import { countWords } from "../content.js";
import { evaluatePreGeneration } from "./editorialControls.js";
import { runEditorialReview } from "./editorial.js";
import { validateInternalLinks, type InternalLinkCandidate, assessInternalLinkRelevance } from "./links.js";
import {
  assessGeneratedArticleSemantics,
  assessSemanticAlignment,
  isQuarantinedArticle
} from "./semanticIntent.js";
import { assessSalesContentLimits } from "./salesLimits.js";
import { buildSeoDeliverables, validateSeoDeliverables } from "./seo.js";
import { assessTechnicalAccuracy } from "./technicalRules.js";
import { assessTemplateFiller } from "./templateDetection.js";
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
  h1?: string;
}

export function runQualityGates(args: {
  brief: ArticleBrief;
  draft: GeneratedDraftFields;
  storefrontUrl?: string;
  interviewApproved?: boolean;
}): EvidenceReport {
  const results: EvidenceReport["qualityGateResults"] = [];
  const bodyText = args.draft.bodyHtml.replace(/<[^>]+>/g, " ");
  const words = countWords(args.draft.bodyHtml);
  const storefront = args.storefrontUrl || "https://legendsdtf.com";

  results.push({
    gate: "topic_preservation",
    ok: bodyText.toLowerCase().includes(args.brief.primaryKeyword.toLowerCase().split(" ")[0] || "") ||
      args.draft.title.toLowerCase().includes(args.brief.primaryKeyword.toLowerCase().split(" ")[0] || ""),
    detail: "Draft should preserve the approved primary topic/keyword.",
    severity: "major"
  });

  results.push({
    gate: "overlap",
    ok: args.brief.overlapScore < 0.72,
    detail: `Overlap score ${args.brief.overlapScore}`,
    severity: "critical"
  });

  results.push({
    gate: "generic_title",
    ok: !/^a practical guide to\b/i.test(args.draft.title),
    detail: "Reject generic Practical Guide titles.",
    severity: "major"
  });

  const incoherentFraming = isQuarantinedArticle(args.draft.title, args.brief.primaryKeyword);
  results.push({
    gate: "content_promise_coherence",
    ok: !incoherentFraming,
    detail: incoherentFraming
      ? "Keyword/title framing cannot fulfill a coherent content promise."
      : "Content-promise framing is coherent.",
    severity: "critical"
  });

  const factBlob = [
    ...(args.brief.factSheet.businessFacts || []),
    ...(args.brief.factSheet.legendsFacts || []),
    ...(args.brief.factSheet.productFacts || [])
  ].join(" ");
  const promiseEval = evaluatePreGeneration({
    primaryKeyword: args.brief.primaryKeyword,
    proposedTitle: args.draft.title,
    audienceLabel: args.brief.targetAudienceLabel,
    readerQuestion: args.brief.readerQuestion,
    outline: args.brief.proposedOutline,
    whyDistinct: args.brief.whyDistinct,
    conversionPath: args.brief.conversionPath,
    format: args.brief.format,
    intent: args.brief.searchIntent,
    pillar: args.brief.pillar,
    factSheet: args.brief.factSheet,
    interviewComplete: Boolean(args.interviewApproved),
    hasTechnicalFacts:
      args.brief.factSheet.productFacts.length > 0 ||
      /\b(dtf|embroidery|screen print|uv dtf|gang sheet|transfer)\b/i.test(factBlob),
    hasLocalFacts: /\b(warner|georgia|local)\b/i.test(factBlob + " " + args.brief.primaryKeyword),
    hasVerifiedPrices: /\b(price|cost|\$)\b/i.test(factBlob) && /\b(current|approved|as of)\b/i.test(factBlob),
    disableAutoRefine: true
  });
  // Post-generation: evidence/depth already gated pre-generation for AUTO/DRAFT briefs.
  // Fail only when the draft's framing is still unsupported (not when brief was already routed).
  const evidenceOk =
    promiseEval.evidenceBudget.supportsCentralPromise ||
    promiseEval.decision === "NEEDS_MERCHANT_INPUT" ||
    args.brief.decision === "DRAFT_ONLY" ||
    args.brief.decision === "AUTO_ELIGIBLE";
  results.push({
    gate: "evidence_budget",
    ok: evidenceOk,
    detail: evidenceOk
      ? "Evidence budget supports the central promise (or brief already routed)."
      : promiseEval.evidenceBudget.missingEvidence.join("; ") || promiseEval.evidenceBudget.reasons.join(" "),
    severity: "critical"
  });
  const depthOk =
    promiseEval.depth.ok ||
    promiseEval.decision === "NEEDS_MERCHANT_INPUT" ||
    (args.brief.decision === "DRAFT_ONLY" && promiseEval.depth.score >= 0.55);
  results.push({
    gate: "depth_information_gain",
    ok: depthOk,
    detail: depthOk
      ? "Brief/draft depth and information gain are adequate."
      : promiseEval.depth.reasons.join(" "),
    severity: "major"
  });

  const preGenSemantic = assessSemanticAlignment({
    primaryKeyword: args.brief.primaryKeyword,
    proposedTitle: args.draft.title,
    readerQuestion: args.brief.readerQuestion,
    audienceLabel: args.brief.targetAudienceLabel,
    outline: args.brief.proposedOutline,
    whyDistinct: args.brief.whyDistinct,
    conversionPath: args.brief.conversionPath,
    searchIntent: args.brief.searchIntent,
    format: args.brief.format,
    productTitles: args.brief.productsToFeature.map(p => p.title)
  });
  results.push({
    gate: "semantic_intent_alignment",
    ok: preGenSemantic.ok && !incoherentFraming,
    detail: preGenSemantic.ok
      ? "Keyword, reader, title, outline, and conversion path are aligned."
      : preGenSemantic.reasons.join(" "),
    severity: "critical"
  });

  const technical = assessTechnicalAccuracy(args.draft.bodyHtml);
  for (const finding of technical) {
    results.push({
      gate: `technical_${finding.gate}`,
      ok: finding.severity === "minor",
      detail: finding.detail,
      severity: finding.severity
    });
  }

  const sales = assessSalesContentLimits({
    bodyHtml: args.draft.bodyHtml,
    title: args.draft.title,
    primaryKeyword: args.brief.primaryKeyword,
    intent: args.brief.searchIntent,
    businessFacts: args.brief.factSheet.legendsFacts || args.brief.factSheet.businessFacts,
    productTitles: args.brief.productsToFeature.map(p => p.title)
  });
  results.push({
    gate: "sales_content_limits",
    ok: sales.ok,
    detail: sales.ok
      ? "Brand/CTA density within limits."
      : sales.reasons.join(" "),
    severity: "major"
  });

  const template = assessTemplateFiller({
    title: args.draft.title,
    primaryKeyword: args.brief.primaryKeyword,
    bodyHtml: args.draft.bodyHtml,
    outline: args.brief.proposedOutline
  });
  results.push({
    gate: "template_filler",
    ok: template.ok,
    detail: template.ok ? "No template-filler pattern detected." : template.reasons.join(" "),
    severity: "major"
  });

  const linkRelevance = assessInternalLinkRelevance({
    primaryKeyword: args.brief.primaryKeyword,
    title: args.draft.title,
    readerQuestion: args.brief.readerQuestion,
    productTitles: args.brief.productsToFeature.map(p => p.title),
    bodyHtml: args.draft.bodyHtml
  });
  results.push({
    gate: "internal_link_relevance",
    ok: linkRelevance.ok,
    detail: linkRelevance.ok
      ? "Internal product links are relevant to the article intent."
      : linkRelevance.reasons.join(" "),
    severity: "major"
  });

  // Surface post-generation semantic/technical findings as quality gates too
  const generatedSemantics = assessGeneratedArticleSemantics({
    title: args.draft.title,
    primaryKeyword: args.brief.primaryKeyword,
    bodyHtml: args.draft.bodyHtml,
    businessFacts: args.brief.factSheet.legendsFacts || args.brief.factSheet.businessFacts,
    productTitles: args.brief.productsToFeature.map(p => p.title),
    audienceLabel: args.brief.targetAudienceLabel
  });
  for (const finding of generatedSemantics.findings) {
    results.push({
      gate: `semantic_${finding.gate}`,
      ok: finding.severity === "minor",
      detail: finding.detail,
      severity: finding.severity
    });
  }

  results.push({
    gate: "placeholder_outline",
    ok: !args.brief.proposedOutline.some(s => /practical steps or comparisons/i.test(s)),
    detail: "Brief outline must not use placeholder sections.",
    severity: "major"
  });

  const metaLen = args.draft.metaDescription.trim().length;
  results.push({
    gate: "meta_description",
    ok: metaLen >= 120 && metaLen <= 160,
    detail: `Meta description length ${metaLen}`,
    severity: "major"
  });

  results.push({
    gate: "title_quality",
    ok: args.draft.title.length >= 25 && args.draft.title.length <= 70,
    detail: `Title length ${args.draft.title.length}`,
    severity: "major"
  });

  const stuffing = (bodyText.toLowerCase().match(new RegExp(args.brief.primaryKeyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  results.push({
    gate: "keyword_stuffing",
    ok: stuffing <= Math.max(8, Math.floor(words / 120)),
    detail: `Primary keyword occurrences ${stuffing}`,
    severity: "major"
  });

  const prohibitedHit = /\b(guaranteed|always in stock|best in the world|will increase sales by)\b/i.test(bodyText);
  results.push({
    gate: "unsupported_claims",
    ok: !prohibitedHit,
    detail: prohibitedHit ? "Contains prohibited unsupported claim language" : "No obvious prohibited claims",
    severity: "critical"
  });

  const colorAbsolutes = args.brief.pillar === "design_color_branding" &&
    /\b(always makes people buy|scientifically proven to increase sales|universally means)\b/i.test(bodyText);
  results.push({
    gate: "color_psychology_caution",
    ok: !colorAbsolutes,
    detail: colorAbsolutes ? "Overstated color-psychology claim" : "OK",
    severity: "major"
  });

  const inventedPersonal = args.brief.requiresInterview &&
    /\b(I made \$|my revenue|my employee|when I quit my job at)\b/i.test(bodyText) &&
    !(args.interviewApproved);
  results.push({
    gate: "invented_personal_experience",
    ok: !inventedPersonal,
    detail: inventedPersonal ? "Possible invented first-person specifics" : "OK",
    severity: "critical"
  });

  results.push({
    gate: "completeness",
    ok: words >= 500 && /<h2/i.test(args.draft.bodyHtml),
    detail: `Word count ${words}`,
    severity: "major"
  });

  const linkCandidates: InternalLinkCandidate[] = args.brief.internalLinks.map((url, i) => ({
    url,
    title: args.brief.productsToFeature[i]?.title || url,
    kind: "product" as const,
    anchorText: args.brief.productsToFeature[i]?.title || "Learn more"
  }));
  const linkCheck = validateInternalLinks(linkCandidates, storefront);
  results.push({
    gate: "internal_links",
    ok: linkCheck.broken === 0,
    detail: linkCheck.trustBuilding
      ? "Trust-building article with no product links."
      : `${linkCheck.broken} broken link(s); confidence ${linkCheck.confidence}`,
    severity: "critical"
  });

  results.push({
    gate: "invented_demand_language",
    ok: !/\b(popular|trending|high volume)\b/i.test(args.brief.demandEvidence) || args.brief.demandClass === "verified_demand",
    detail: "Demand evidence must not claim popularity without verified metrics.",
    severity: "critical"
  });

  const seo = args.brief.seoDeliverables || buildSeoDeliverables({
    brief: args.brief,
    storefrontUrl: storefront,
    blogHandle: "news",
    metaDescription: args.draft.metaDescription,
    excerpt: args.draft.excerpt
  });
  const seoCheck = validateSeoDeliverables({
    ...seo,
    seoTitle: args.draft.metaTitle || args.draft.title,
    h1: args.draft.h1 || args.draft.title,
    urlHandle: args.draft.handle,
    metaDescription: args.draft.metaDescription,
    excerpt: args.draft.excerpt,
    primaryKeyword: args.draft.primaryKeyword,
    secondaryCluster: args.draft.secondaryKeywords
  });
  const blockingSeoIssues = seoCheck.issues.filter(i => !/145–160|145-160/.test(i));
  results.push({
    gate: "seo_deliverables",
    ok: blockingSeoIssues.length === 0,
    detail: blockingSeoIssues.length ? blockingSeoIssues.join("; ") : "SEO deliverables validated (meta length checked separately).",
    severity: "major"
  });
  results.push({
    gate: "image_alt_recommendation",
    ok: Boolean(seo.imageAltText?.trim()),
    detail: seo.imageAltText ? "Image alt recommendation present." : "Missing image alt recommendation.",
    severity: "major"
  });
  results.push({
    gate: "canonical_url",
    ok: Boolean(seo.canonicalUrl),
    detail: seo.canonicalUrl || "Canonical URL unresolved.",
    severity: "minor"
  });

  const editorial = runEditorialReview({
    title: args.draft.title,
    h1: args.draft.h1 || args.draft.title,
    metaDescription: args.draft.metaDescription,
    bodyHtml: args.draft.bodyHtml,
    primaryKeyword: args.brief.primaryKeyword,
    requiresInterview: args.brief.requiresInterview,
    interviewApproved: Boolean(args.interviewApproved),
    brokenLinks: linkCheck.broken,
    overlapScore: args.brief.overlapScore,
    hasPlaceholderLanguage: /practical steps or comparisons|lorem ipsum|TODO:/i.test(bodyText),
    demandLabel: args.brief.demandEvidence,
    audienceLabel: args.brief.targetAudienceLabel,
    businessFacts: args.brief.factSheet.legendsFacts || args.brief.factSheet.businessFacts,
    productTitles: args.brief.productsToFeature.map(p => p.title)
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
    legendsFactsUsed: args.brief.factSheet.legendsFacts || args.brief.factSheet.businessFacts,
    reviewFlags: [
      ...args.brief.factSheet.reviewFlags,
      ...results.filter(r => !r.ok).map(r => `${r.gate}: ${r.detail}`),
      ...editorial.findings.filter(f => f.severity === "critical" || f.severity === "major").map(f => `${f.gate}: ${f.detail}`)
    ],
    qualityGateResults: results,
    editorialFindings: editorial.findings,
    decision: args.brief.decision,
    generatedAt: new Date().toISOString()
  };
}

export function qualityGatesPassed(report: EvidenceReport): boolean {
  const criticalOrMajor = [
    ...report.qualityGateResults.filter(g => !g.ok && (g.severity === "critical" || g.severity === "major")),
    ...(report.editorialFindings || []).filter(f => f.severity === "critical" || f.severity === "major")
  ];
  return criticalOrMajor.length === 0 && report.qualityGateResults.every(g => g.ok || g.severity === "minor");
}

export function blocksAutoPublish(report: EvidenceReport): boolean {
  return !qualityGatesPassed(report) || report.decision !== "AUTO_ELIGIBLE";
}
