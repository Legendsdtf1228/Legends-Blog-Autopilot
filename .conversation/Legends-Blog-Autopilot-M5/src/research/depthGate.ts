/**
 * Depth / information-gain gate for briefs before generation.
 */
import type { ContentPromise } from "./contentPromise.js";
import type { EvidenceBudget } from "./evidenceBudget.js";

export interface DepthAssessment {
  ok: boolean;
  score: number;
  reasons: string[];
  readerDefined: boolean;
  questionDefined: boolean;
  decisionDefined: boolean;
  hasTradeoffs: boolean;
  beyondGeneric: boolean;
  restrainedConversion: boolean;
}

const GENERIC_OUTLINE = /\b(what .+ means|common mistakes|how legends can help|next steps|key points|introduction|practical steps or comparisons)\b/i;

export function assessBriefDepth(args: {
  audienceLabel?: string;
  readerQuestion?: string;
  proposedTitle?: string;
  primaryKeyword: string;
  outline?: string[];
  whyDistinct?: string;
  conversionPath?: string;
  contentPromise: ContentPromise;
  evidenceBudget: EvidenceBudget;
}): DepthAssessment {
  const reasons: string[] = [];
  let score = 0.5;

  const readerDefined = Boolean(args.audienceLabel && args.audienceLabel.length >= 12 && !/everyone|general|anyone/i.test(args.audienceLabel));
  const questionDefined = Boolean(args.readerQuestion && args.readerQuestion.length >= 24);
  const decisionDefined = /\b(how|which|should|compare|choose|decide|ask|when|what)\b/i.test(
    `${args.readerQuestion || ""} ${args.proposedTitle || ""}`
  );

  if (readerDefined) score += 0.1; else reasons.push("No clearly defined reader.");
  if (questionDefined) score += 0.1; else reasons.push("No real reader question.");
  if (decisionDefined) score += 0.1; else reasons.push("Article does not complete a clear decision or task.");

  const outline = args.outline || [];
  const placeholderCount = outline.filter(s => GENERIC_OUTLINE.test(s)).length;
  const hasTradeoffs = outline.some(s => /\b(trade-?off|exception|mistake|when not|vs|compare|criteria|ask)\b/i.test(s));
  const beyondGeneric = placeholderCount <= 1 && outline.length >= 4 && (args.whyDistinct || "").length >= 20;

  if (hasTradeoffs) score += 0.1; else reasons.push("Missing exceptions, trade-offs, or decision criteria.");
  if (beyondGeneric) score += 0.15; else reasons.push("Outline/angle looks like a generic template.");

  if (!args.evidenceBudget.supportsCentralPromise) {
    score -= 0.25;
    reasons.push("Evidence budget cannot support the promised depth.");
  } else {
    score += 0.1;
  }

  const conversion = (args.conversionPath || "").toLowerCase();
  const restrainedConversion =
    !conversion ||
    conversion.includes("trust-building") ||
    (!/feature .{0,80}, .{0,80}, /.test(conversion) && conversion.length < 220);
  if (restrainedConversion) score += 0.05;
  else reasons.push("Conversion path is not restrained / not tied to the reader’s next step.");

  // Story keyword + apparel-buyer checklist is a known incoherent depth failure (feature-based)
  if (
    /\bstories?\b/i.test(args.primaryKeyword) &&
    /apparel buyers?|decision checklist/i.test(`${args.proposedTitle || ""} ${args.audienceLabel || ""}`)
  ) {
    score -= 0.35;
    reasons.push("Story keyword framed as an apparel-buyer checklist — no coherent information gain.");
  }

  score = Math.max(0, Math.min(1, score));
  const ok =
    score >= 0.75 &&
    readerDefined &&
    questionDefined &&
    decisionDefined &&
    beyondGeneric &&
    args.evidenceBudget.supportsCentralPromise;

  return {
    ok,
    score: Number(score.toFixed(4)),
    reasons,
    readerDefined,
    questionDefined,
    decisionDefined,
    hasTradeoffs,
    beyondGeneric,
    restrainedConversion
  };
}
