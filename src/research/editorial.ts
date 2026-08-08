import {
  assessGeneratedArticleSemantics,
  isQuarantinedArticle
} from "./semanticIntent.js";

export type FindingSeverity = "critical" | "major" | "minor" | "pass";

export interface EditorialFinding {
  gate: string;
  severity: FindingSeverity;
  detail: string;
}

export interface EditorialReview {
  findings: EditorialFinding[];
  articleQuality: number;
  blocksAutoPublish: boolean;
}

export function runEditorialReview(args: {
  title: string;
  h1?: string;
  metaDescription: string;
  bodyHtml: string;
  primaryKeyword: string;
  requiresInterview: boolean;
  interviewApproved: boolean;
  brokenLinks: number;
  overlapScore: number;
  hasPlaceholderLanguage: boolean;
  demandLabel?: string;
  audienceLabel?: string;
  businessFacts?: string[];
  productTitles?: string[];
}): EditorialReview {
  const findings: EditorialFinding[] = [];
  const text = args.bodyHtml.replace(/<[^>]+>/g, " ");

  const push = (gate: string, severity: FindingSeverity, detail: string) => {
    findings.push({ gate, severity, detail });
  };

  if (isQuarantinedArticle(args.title, args.primaryKeyword)) {
    push("content_promise_coherence", "critical", "Keyword/title framing cannot fulfill a coherent content promise.");
  }

  if (/^a practical guide to\b/i.test(args.title)) {
    push("title_specificity", "major", "Generic “A Practical Guide to X” title.");
  } else if (/\bstories?\b/i.test(args.primaryKeyword) && /apparel buyers?|decision checklist/i.test(args.title)) {
    push("title_specificity", "critical", "Title does not represent a real search question for the keyword.");
  } else if (args.title.length < 25) {
    push("title_specificity", "major", "Title too weak/short.");
  } else {
    push("title_specificity", "pass", "Title specificity OK.");
  }

  const metaLen = args.metaDescription.trim().length;
  if (metaLen < 120 || metaLen > 160) {
    push("meta_description", "major", `Meta description length ${metaLen} outside 145–160 target band.`);
  } else if (!args.metaDescription.toLowerCase().includes(args.primaryKeyword.toLowerCase().split(" ")[0] || "")) {
    push("meta_description", "minor", "Meta description may not include the primary keyword naturally.");
  } else {
    push("meta_description", "pass", "Meta description OK.");
  }

  if (/\b(guaranteed|always in stock|best in the world|will increase sales by|same-day)\b/i.test(text)) {
    push("unsupported_claims", "critical", "Contains unsupported guarantee or invented promise language.");
  } else {
    push("unsupported_claims", "pass", "No obvious unsupported guarantees.");
  }

  if (args.requiresInterview && !args.interviewApproved && /\b(I |my |we )\b/.test(text)) {
    push("first_person_source", "critical", "First-person voice without approved merchant source material.");
  } else {
    push("first_person_source", "pass", "First-person source gate OK.");
  }

  if (args.brokenLinks > 0) {
    push("internal_links", "critical", `${args.brokenLinks} broken or unverified internal link(s).`);
  } else {
    push("internal_links", "pass", "Internal links OK or trust-building without product pitch.");
  }

  if (args.overlapScore >= 0.72) {
    push("duplicate_intent", "critical", "Substantial duplicate intent with existing content.");
  } else {
    push("duplicate_intent", "pass", "Overlap within tolerance.");
  }

  if (args.hasPlaceholderLanguage) {
    push("placeholder_language", "major", "Placeholder or generic filler language detected.");
  } else {
    push("placeholder_language", "pass", "No placeholder language.");
  }

  if (args.demandLabel && /\b(popular|trending|high volume)\b/i.test(args.demandLabel)) {
    push("invented_metrics", "critical", "Demand language implies verified popularity without supporting metrics.");
  } else {
    push("invented_metrics", "pass", "No invented popularity claims.");
  }

  if (/\b(scientifically proven to increase sales|universally means)\b/i.test(text)) {
    push("color_or_science_overclaim", "major", "Overstated scientific/color claim.");
  }

  const semantics = assessGeneratedArticleSemantics({
    title: args.title,
    primaryKeyword: args.primaryKeyword,
    bodyHtml: args.bodyHtml,
    businessFacts: args.businessFacts,
    productTitles: args.productTitles,
    audienceLabel: args.audienceLabel
  });
  for (const f of semantics.findings) {
    push(f.gate, f.severity, f.detail);
  }

  const critical = findings.filter(f => f.severity === "critical").length;
  const major = findings.filter(f => f.severity === "major").length;
  const passLike = findings.filter(f => f.severity === "pass").length;
  const articleQuality = Math.max(0, Math.min(1, passLike / Math.max(findings.length, 1) - critical * 0.3 - major * 0.15));

  return {
    findings,
    articleQuality: Number(articleQuality.toFixed(4)),
    blocksAutoPublish: critical > 0 || major > 0
  };
}
