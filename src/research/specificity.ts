import type { KeywordCluster } from "./types.js";
import {
  assessSemanticAlignment,
  isIncoherentSearchIntent,
  suggestLocalPrinterRefinement
} from "./semanticIntent.js";

export interface SpecificityAssessment {
  score: number;
  ok: boolean;
  reasons: string[];
  refinedKeyword: string | null;
  refinedTitle: string | null;
  readerQuestion: string | null;
  audienceHint: string | null;
}

const GENERIC_TITLE = /^a practical guide to\b/i;
const PLACEHOLDER_OUTLINE = /\b(practical steps or comparisons|key points|introduction|next steps|common mistakes to avoid)\b/i;
const BROAD_ONE_WORD = /^(embroidery|shirts?|printing|branding|business|design|apparel|dtf|transfers?)$/i;

/** Suggest a qualified long-tail refinement for known broad seeds. */
export function suggestRefinement(keyword: string): {
  keyword: string;
  title: string;
  audience: string;
  intent: string;
  readerQuestion: string;
} | null {
  const n = keyword.toLowerCase().trim();
  if (n === "embroidery" || n === "embroidery printing") {
    return {
      keyword: "embroidery vs DTF for work shirts",
      title: "Embroidery vs. DTF Printing: Which Is Better for Work Shirts?",
      audience: "Small-business owners purchasing employee uniforms",
      intent: "commercial",
      readerQuestion: "Should I choose embroidery or DTF printing for employee work shirts?"
    };
  }
  if (n === "shirts" || n === "shirt" || n === "custom shirts") {
    return {
      keyword: "cotton vs polyester shirts for custom printing",
      title: "Cotton vs. Polyester Shirts for Custom Printing: How to Choose",
      audience: "People comparing garment options for a custom apparel order",
      intent: "commercial",
      readerQuestion: "Which shirt fabric works better for my custom print project?"
    };
  }
  if (n === "dtf" || n === "transfers" || n === "transfer") {
    return {
      keyword: "DTF transfers vs vinyl for small apparel orders",
      title: "DTF Transfers vs. Vinyl: Which Is Better for Small Apparel Orders?",
      audience: "New clothing-brand owners choosing a decoration method",
      intent: "commercial",
      readerQuestion: "Is DTF or vinyl the better decoration method for small apparel runs?"
    };
  }
  if (
    isIncoherentSearchIntent(n) ||
    /\blocal small-?business stories\b/i.test(n) ||
    /\bhow to choose a local custom shirt printer\b/i.test(n)
  ) {
    return suggestLocalPrinterRefinement();
  }
  return null;
}

export function assessTopicSpecificity(args: {
  primaryKeyword: string;
  proposedTitle?: string;
  outline?: string[];
  audienceLabel?: string;
  whyDistinct?: string;
}): SpecificityAssessment {
  const reasons: string[] = [];
  let score = 0.5;
  const keyword = args.primaryKeyword.trim();
  const words = keyword.split(/\s+/).filter(Boolean);

  if (BROAD_ONE_WORD.test(keyword) || words.length === 1) {
    score -= 0.45;
    reasons.push("Broad one-word keyword without a qualified search intent.");
  } else if (words.length >= 4) {
    score += 0.25;
  } else if (words.length >= 3) {
    score += 0.15;
  } else {
    score -= 0.1;
    reasons.push("Keyword is short; prefer a focused long-tail intent cluster.");
  }

  if (/\b(vs|versus|for|how to|which|when|cost|pricing|warner|georgia|school|team|work shirts?)\b/i.test(keyword)) {
    score += 0.15;
  }

  if (args.proposedTitle && GENERIC_TITLE.test(args.proposedTitle)) {
    score -= 0.35;
    reasons.push("Generic title pattern (“A Practical Guide to X”) is not specific enough.");
  } else if (args.proposedTitle && args.proposedTitle.length >= 40) {
    score += 0.1;
  }

  if (args.outline?.length) {
    const placeholderCount = args.outline.filter(s => PLACEHOLDER_OUTLINE.test(s)).length;
    if (placeholderCount >= 2) {
      score -= 0.35;
      reasons.push("Outline uses generic placeholder sections instead of topic-specific questions.");
    } else if (placeholderCount === 0 && args.outline.every(s => s.length >= 28)) {
      score += 0.15;
    }
  }

  if (!args.audienceLabel || /general|everyone|anyone/i.test(args.audienceLabel)) {
    score -= 0.1;
    reasons.push("Target audience is missing or too general.");
  } else {
    score += 0.1;
  }

  if (!args.whyDistinct || args.whyDistinct.length < 20) {
    score -= 0.1;
    reasons.push("No clear unique angle or distinct-question explanation.");
  }

  const semantic = assessSemanticAlignment({
    primaryKeyword: keyword,
    proposedTitle: args.proposedTitle,
    audienceLabel: args.audienceLabel,
    outline: args.outline,
    whyDistinct: args.whyDistinct
    // readerQuestion intentionally omitted — specificity runs before the brief locks a question
  });
  if (!semantic.ok) {
    score = Math.min(score, semantic.score);
    reasons.push(...semantic.reasons);
  }

  score = Math.max(0, Math.min(1, score));
  const refinement = suggestRefinement(keyword) || (semantic.refinedKeyword
    ? {
        keyword: semantic.refinedKeyword,
        title: semantic.refinedTitle || suggestLocalPrinterRefinement().title,
        audience: semantic.audienceHint || suggestLocalPrinterRefinement().audience,
        intent: semantic.intentHint || "local",
        readerQuestion: semantic.readerQuestion || suggestLocalPrinterRefinement().readerQuestion
      }
    : null);
  const ok =
    score >= 0.85 &&
    semantic.ok &&
    !BROAD_ONE_WORD.test(keyword) &&
    !(args.proposedTitle && GENERIC_TITLE.test(args.proposedTitle)) &&
    !isIncoherentSearchIntent(keyword);

  return {
    score: Number(score.toFixed(4)),
    ok,
    reasons,
    refinedKeyword: !ok && refinement ? refinement.keyword : null,
    refinedTitle: !ok && refinement ? refinement.title : null,
    readerQuestion: refinement?.readerQuestion ?? null,
    audienceHint: refinement?.audience ?? null
  };
}

export function isPlaceholderOutline(outline: string[]): boolean {
  if (!outline.length) return true;
  const hits = outline.filter(s => PLACEHOLDER_OUTLINE.test(s)).length;
  return hits >= Math.ceil(outline.length * 0.5);
}

export function buildTopicSpecificOutline(cluster: KeywordCluster, readerQuestion: string): string[] {
  const k = cluster.primaryKeyword;
  return [
    `What “${k}” means for ${cluster.audience.replace(/_/g, " ")} facing this decision`,
    `Answer the reader question: ${readerQuestion}`,
    `Compare the practical trade-offs specific to ${cluster.subcategory}`,
    `Common mistakes when choosing or applying ${k}`,
    `How Legends DTF Prints in Warner Robins / Middle Georgia can help next`
  ];
}
