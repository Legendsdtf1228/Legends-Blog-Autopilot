/**
 * Full pre-generation editorial decisioning:
 * intent → content promise → evidence budget → depth → AUTO_ELIGIBLE / NEEDS_MERCHANT_INPUT / DRAFT_ONLY / REJECTED
 */
import { classifyContentPromise, type ContentPromise } from "./contentPromise.js";
import { buildEvidenceBudget, type EvidenceBudget } from "./evidenceBudget.js";
import { assessBriefDepth, type DepthAssessment } from "./depthGate.js";
import { isIncoherentSearchIntent, suggestLocalPrinterRefinement, titleRepresentsSearchQuestion } from "./semanticIntent.js";
import { buildIntentOutline } from "./templateDetection.js";
import type { LockedFactSheet, TopicDecision } from "./types.js";

export interface EditorialDecisionTrace {
  originalKeyword: string;
  originalTitle: string;
  refinedKeyword: string | null;
  refinedTitle: string | null;
  contentPromise: ContentPromise;
  evidenceBudget: EvidenceBudget;
  depth: DepthAssessment;
  decision: TopicDecision;
  reasons: string[];
  missingEvidence: string[];
  merchantInputWouldUnlock: boolean;
  replacedByOtherTopic: boolean;
}

export interface PreGenerationEvaluation {
  okToGenerate: boolean;
  decision: TopicDecision;
  reasons: string[];
  contentPromise: ContentPromise;
  evidenceBudget: EvidenceBudget;
  depth: DepthAssessment;
  requiresInterview: boolean;
  interviewQuestions: string[];
  refined?: {
    keyword: string;
    title: string;
    audience: string;
    intent: string;
    readerQuestion: string;
    outline: string[];
  } | null;
  trace: EditorialDecisionTrace;
}

export function interviewQuestionsForPromise(promise: ContentPromise): string[] {
  if (promise.requiresFirsthand) {
    return [
      "What specific situation or decision does this experience answer?",
      "What changed, decision by decision, that a reader could reuse?",
      "Which mistake cost the most, and what would you do instead?",
      "What still remains hard that readers should plan for?",
      "What would you tell someone facing the same choice this month?"
    ];
  }
  if (promise.requiresVerifiedNumbers) {
    return [
      "Which cost components are approved to discuss publicly?",
      "What assumptions must be labeled in any pricing framework?",
      "Which figures must never be invented or approximated?"
    ];
  }
  return [];
}

/**
 * Evaluate whether a candidate may proceed to automatic generation.
 * Prefer refine → NEEDS_MERCHANT_INPUT → REJECTED over weak DRAFT_ONLY filler.
 */
export function evaluatePreGeneration(args: {
  primaryKeyword: string;
  proposedTitle: string;
  audienceLabel?: string;
  readerQuestion?: string;
  outline?: string[];
  whyDistinct?: string;
  conversionPath?: string;
  format?: string;
  intent?: string;
  pillar?: string;
  factSheet?: LockedFactSheet | null;
  interviewComplete?: boolean;
  hasVerifiedPrices?: boolean;
  hasTechnicalFacts?: boolean;
  hasLocalFacts?: boolean;
  /** When true, do not auto-refine; evaluate the framing as-is (tests / locked briefs). */
  disableAutoRefine?: boolean;
}): PreGenerationEvaluation {
  const reasons: string[] = [];
  let keyword = args.primaryKeyword;
  let title = args.proposedTitle;
  let audience = args.audienceLabel || "";
  let readerQuestion = args.readerQuestion || "";
  let outline = args.outline || [];
  let intent = args.intent || "";
  let refined: PreGenerationEvaluation["refined"] = null;

  // Feature-based incoherent story/commercial mix → refine to a supportable local-commercial angle
  const incoherent =
    isIncoherentSearchIntent(keyword) ||
    (/\bstories?\b/i.test(keyword) && /apparel buyers?|decision checklist/i.test(title));

  if (incoherent && !args.disableAutoRefine) {
    const suggestion = suggestLocalPrinterRefinement();
    refined = {
      keyword: suggestion.keyword,
      title: suggestion.title,
      audience: suggestion.audience,
      intent: suggestion.intent,
      readerQuestion: suggestion.readerQuestion,
      outline: buildIntentOutline({
        primaryKeyword: suggestion.keyword,
        readerQuestion: suggestion.readerQuestion,
        promiseClass: "local_commercial",
        audienceLabel: suggestion.audience,
        subcategory: "choosing a print partner"
      })
    };
    keyword = refined.keyword;
    title = refined.title;
    audience = refined.audience;
    readerQuestion = refined.readerQuestion;
    outline = refined.outline;
    intent = refined.intent;
    reasons.push("Refined incoherent story/commercial framing into a supportable local-printer decision guide.");
  }

  const contentPromise = classifyContentPromise({
    title,
    primaryKeyword: keyword,
    format: args.format,
    intent,
    pillar: args.pillar
  });

  // Prefer intent-specific outlines when still on the generic template
  if (
    outline.filter(s => /what .+ means|common mistakes|how legends can help|next steps/i.test(s)).length >= 2
  ) {
    outline = buildIntentOutline({
      primaryKeyword: keyword,
      readerQuestion: readerQuestion || `What should readers know about ${keyword}?`,
      promiseClass: contentPromise.primaryClass,
      audienceLabel: audience || "readers",
      subcategory: args.pillar || "general"
    });
  }

  const evidenceBudget = buildEvidenceBudget({
    contentPromise,
    factSheet: args.factSheet,
    interviewComplete: args.interviewComplete,
    hasVerifiedPrices: args.hasVerifiedPrices,
    hasTechnicalFacts: args.hasTechnicalFacts ?? Boolean(args.factSheet?.productFacts?.length),
    hasLocalFacts: args.hasLocalFacts ?? /\bwarner|georgia|local\b/i.test(
      `${keyword} ${title} ${(args.factSheet?.businessFacts || []).join(" ")}`
    ),
    outline,
    readerQuestion
  });

  const depth = assessBriefDepth({
    audienceLabel: audience,
    readerQuestion,
    proposedTitle: title,
    primaryKeyword: keyword,
    outline,
    whyDistinct: args.whyDistinct,
    conversionPath: args.conversionPath,
    contentPromise,
    evidenceBudget
  });

  const requiresInterview = contentPromise.requiresFirsthand && !args.interviewComplete;
  const interviewQuestions = interviewQuestionsForPromise(contentPromise);

  let decision: TopicDecision = "AUTO_ELIGIBLE";
  const decisionReasons = [...reasons];

  if (args.disableAutoRefine && incoherent) {
    decision = "REJECTED";
    decisionReasons.push("Incoherent search intent / audience-purpose drift; cannot fulfill a real reader question.");
  } else if (!titleRepresentsSearchQuestion(title, keyword) && !refined) {
    decision = "REJECTED";
    decisionReasons.push("Title does not represent a specific real-world search question.");
  } else if (requiresInterview) {
    decision = "NEEDS_MERCHANT_INPUT";
    decisionReasons.push(...evidenceBudget.missingEvidence.map(m => `Missing: ${m}`));
    decisionReasons.push("Route to merchant interview; do not generate a weak draft.");
  } else if (!evidenceBudget.supportsCentralPromise) {
    // Cost/comparison/technical without evidence → reject (don't dump into DRAFT_ONLY)
    if (
      contentPromise.requiresVerifiedNumbers ||
      contentPromise.requiresTechnicalKnowledge ||
      contentPromise.requiresComparisonCriteria
    ) {
      decision = "REJECTED";
      decisionReasons.push(...evidenceBudget.reasons);
      decisionReasons.push("Evidence cannot fulfill the title’s central promise — select another topic.");
    } else {
      decision = "DRAFT_ONLY";
      decisionReasons.push(...evidenceBudget.reasons);
    }
  } else if (!depth.ok) {
    decision = "REJECTED";
    decisionReasons.push(...depth.reasons);
    decisionReasons.push("Insufficient information gain — refine or select another topic.");
  } else if (contentPromise.primaryClass === "informational_general" && depth.score < 0.85) {
    decision = "DRAFT_ONLY";
    decisionReasons.push("Informational topic lacks AUTO_ELIGIBLE depth.");
  } else {
    decision = "AUTO_ELIGIBLE";
    decisionReasons.push("Content promise, evidence budget, and depth gates support automatic generation.");
  }

  // Automatic generation requires AUTO_ELIGIBLE. DRAFT_ONLY may still be
  // generated in draft_only/review modes by the research cycle, but is not
  // treated as autonomously qualified content.
  const okToGenerate = decision === "AUTO_ELIGIBLE";

  const trace: EditorialDecisionTrace = {
    originalKeyword: args.primaryKeyword,
    originalTitle: args.proposedTitle,
    refinedKeyword: refined?.keyword ?? null,
    refinedTitle: refined?.title ?? null,
    contentPromise,
    evidenceBudget,
    depth,
    decision,
    reasons: decisionReasons,
    missingEvidence: evidenceBudget.missingEvidence,
    merchantInputWouldUnlock: requiresInterview || contentPromise.requiresVerifiedNumbers,
    replacedByOtherTopic: false
  };

  return {
    okToGenerate: okToGenerate && decision !== "REJECTED" && decision !== "NEEDS_MERCHANT_INPUT",
    decision,
    reasons: decisionReasons,
    contentPromise,
    evidenceBudget,
    depth,
    requiresInterview,
    interviewQuestions,
    refined,
    trace
  };
}
