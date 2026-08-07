/**
 * Semantic alignment + technical accuracy gates.
 * Rejects incoherent keyword/title/audience mixes (e.g. “local small-business stories”
 * framed as an apparel-buyer checklist) before or after generation.
 */

export interface SemanticAlignmentInput {
  primaryKeyword: string;
  proposedTitle?: string;
  readerQuestion?: string;
  audienceLabel?: string;
  outline?: string[];
  whyDistinct?: string;
  conversionPath?: string;
  searchIntent?: string;
  pillar?: string;
  format?: string;
  internalLinkTitles?: string[];
  productTitles?: string[];
}

export interface SemanticAlignmentResult {
  ok: boolean;
  score: number;
  reasons: string[];
  refinedKeyword: string | null;
  refinedTitle: string | null;
  readerQuestion: string | null;
  audienceHint: string | null;
  intentHint: string | null;
}

const INCOHERENT_STORY_KEYWORDS = [
  /^local small-?business stories$/i,
  /^small-?business stories$/i,
  /^local business stories$/i,
  /^behind the scenes stories$/i
];

const ENTREPRENEURSHIP_TOKENS = /\b(stories?|entrepreneur|9-?to-?5|burnout|quit(ting)?|ownership|lessons? from building)\b/i;
const APPAREL_BUYER_TOKENS = /\b(apparel buyers?|garment|shirt printer|uniforms?|school|team|buyers?|order|vendor|printer)\b/i;
const STORYTELLING_TOKENS = /\b(stories?|storytelling|narrative|behind the scenes)\b/i;
const VENDOR_SELECTION_TOKENS = /\b(choose|select|compare|questions? to ask|printer|vendor|shop)\b/i;

/** Known bad titles that must never count as rollout drafts. */
export const QUARANTINED_ARTICLE_TITLES = [
  "Local Small-Business Stories: A Decision Checklist for Apparel Buyers"
] as const;

export const QUARANTINED_PRIMARY_KEYWORDS = [
  "local small-business stories"
] as const;

export function suggestLocalPrinterRefinement(): {
  keyword: string;
  title: string;
  audience: string;
  intent: string;
  readerQuestion: string;
} {
  return {
    keyword: "how to choose a local custom shirt printer",
    title: "How to Choose a Custom Shirt Printer in Warner Robins: 9 Questions to Ask",
    audience: "Middle Georgia businesses, schools, teams, and clothing brands",
    intent: "local",
    readerQuestion: "How should I compare local custom-apparel printers before placing an order?"
  };
}

export function isIncoherentSearchIntent(keyword: string): boolean {
  const k = keyword.trim();
  if (INCOHERENT_STORY_KEYWORDS.some(re => re.test(k))) return true;
  // “stories” as primary commercial apparel keyword without a printer/buyer decision
  if (/\bstories\b/i.test(k) && !/\b(printer|printing|dtf|embroidery|shirt|apparel order)\b/i.test(k)) {
    return true;
  }
  // Vague “local X stories” without a concrete decision verb
  if (/\blocal\b/i.test(k) && /\bstories\b/i.test(k) && !/\b(how to|choose|compare|vs|for)\b/i.test(k)) {
    return true;
  }
  return false;
}

export function titleRepresentsSearchQuestion(title: string, keyword: string): boolean {
  const t = title.toLowerCase();
  const k = keyword.toLowerCase();
  if (/decision checklist for apparel buyers/i.test(title) && /\bstories\b/i.test(keyword)) {
    return false;
  }
  if (/^a practical guide to\b/i.test(title)) return false;
  // Title should share meaningful tokens with keyword or ask a clear how/which/when question
  const kTokens = k.split(/\s+/).filter(w => w.length > 3);
  const shared = kTokens.filter(tok => t.includes(tok)).length;
  const hasQuestionShape = /\b(how to|which|what|when|vs\.?|versus|questions? to ask|choose|compare)\b/i.test(title);
  if (shared === 0 && !hasQuestionShape) return false;
  if (/\bstories\b/i.test(keyword) && /\bchecklist for apparel buyers\b/i.test(title)) return false;
  return shared >= Math.min(2, kTokens.length) || hasQuestionShape;
}

export function detectAudiencePurposeDrift(args: {
  primaryKeyword: string;
  proposedTitle?: string;
  audienceLabel?: string;
  readerQuestion?: string;
  outline?: string[];
  conversionPath?: string;
}): string[] {
  const reasons: string[] = [];
  const keyword = args.primaryKeyword;
  const title = args.proposedTitle || "";

  // Exact failure mode: entrepreneurship/story keyword + apparel-buyer checklist framing
  if (/\bstories\b/i.test(keyword) && /apparel buyers?/i.test(title)) {
    reasons.push("Audience/purpose drift: story keyword framed as an apparel-buyer checklist.");
  }
  if (
    /\bstories\b/i.test(keyword) &&
    /decision checklist/i.test(title) &&
    APPAREL_BUYER_TOKENS.test(`${title} ${args.audienceLabel || ""}`)
  ) {
    reasons.push("Audience/purpose drift across storytelling, garment selection, and vendor selection.");
  }
  if (
    args.audienceLabel &&
    /apparel buyers?/i.test(args.audienceLabel) &&
    /\b(stories?)\b/i.test(keyword) &&
    !/\b(printer|printing|shirt|apparel order|dtf)\b/i.test(keyword)
  ) {
    reasons.push("Target audience (apparel buyers) does not match entrepreneurship/story keyword.");
  }
  // Story keyword + vendor-selection outline without a printer-selection intent
  if (
    /\bstories\b/i.test(keyword) &&
    (args.outline || []).some(s => /garment selection|vendor selection|apparel buyers?/i.test(s))
  ) {
    reasons.push("Audience/purpose drift across storytelling, garment selection, and vendor selection.");
  }
  return reasons;
}

export function assessSemanticAlignment(input: SemanticAlignmentInput): SemanticAlignmentResult {
  const reasons: string[] = [];
  let score = 0.7;
  const keyword = input.primaryKeyword.trim();
  const refinement = isIncoherentSearchIntent(keyword) || /\blocal small-?business stories\b/i.test(keyword)
    ? suggestLocalPrinterRefinement()
    : null;

  if (isIncoherentSearchIntent(keyword)) {
    score -= 0.5;
    reasons.push(`Keyword “${keyword}” is not a coherent apparel-buyer search intent.`);
  }

  if (input.proposedTitle && !titleRepresentsSearchQuestion(input.proposedTitle, keyword)) {
    score -= 0.35;
    reasons.push("Title does not represent a specific real-world search question aligned to the keyword.");
  } else if (input.proposedTitle) {
    score += 0.1;
  }

  if (input.readerQuestion !== undefined) {
    if (!input.readerQuestion || input.readerQuestion.length < 20) {
      score -= 0.15;
      reasons.push("Missing a concrete reader question.");
    } else if (input.proposedTitle && input.readerQuestion) {
      const qTokens = input.readerQuestion.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const title = (input.proposedTitle || "").toLowerCase();
      const overlap = qTokens.filter(t => title.includes(t)).length;
      if (overlap < 1 && !/\bhow|which|compare|choose\b/i.test(input.readerQuestion)) {
        score -= 0.1;
        reasons.push("Reader question is not reflected in the title.");
      } else {
        score += 0.05;
      }
    }
  }

  const drift = detectAudiencePurposeDrift(input);
  if (drift.length) {
    score -= 0.25 * Math.min(drift.length, 2);
    reasons.push(...drift);
  }

  if (input.outline?.length) {
    const outlineText = input.outline.join(" ");
    // Template substitution: outline sections don't mention keyword intent tokens
    const kTokens = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const mentioned = kTokens.filter(t => outlineText.toLowerCase().includes(t)).length;
    if (mentioned === 0 && kTokens.length >= 2) {
      score -= 0.2;
      reasons.push("Outline looks like a generic template not grounded in the keyword intent.");
    }
    if (/\bstories\b/i.test(keyword) && /\bapparel buyers?\b/i.test(outlineText)) {
      score -= 0.15;
      reasons.push("Outline mixes story keyword with apparel-buyer framing (template substitution).");
    }
  }

  if (input.conversionPath && input.productTitles?.length) {
    const forced = input.productTitles.filter(p => {
      const hay = `${keyword} ${input.readerQuestion || ""} ${input.proposedTitle || ""}`.toLowerCase();
      const tokens = p
        .toLowerCase()
        .split(/\s+/)
        .filter(t => t.length >= 3 && !/^(with|from|that|this|your|legends|the|and|for)$/.test(t));
      return !tokens.some(t => hay.includes(t));
    });
    if (forced.length && forced.length === input.productTitles.length) {
      score -= 0.2;
      reasons.push("Internal product links appear forced and unrelated to the keyword/intent.");
    }
  }

  // Checklist format + story keyword is a known bad pairing
  if (input.format === "checklist" && /\bstories\b/i.test(keyword)) {
    score -= 0.25;
    reasons.push("Checklist format with a “stories” keyword produces incoherent search intent.");
  }

  score = Math.max(0, Math.min(1, score));
  // Alignment fails on explicit reasons, not a soft score band alone (partial inputs omit readerQuestion).
  const ok = reasons.length === 0;

  return {
    ok,
    score: Number(score.toFixed(4)),
    reasons,
    refinedKeyword: !ok && refinement ? refinement.keyword : null,
    refinedTitle: !ok && refinement ? refinement.title : null,
    readerQuestion: refinement?.readerQuestion ?? null,
    audienceHint: refinement?.audience ?? null,
    intentHint: refinement?.intent ?? null
  };
}

/** Post-generation technical + editorial semantic checks on body HTML. */
export function assessGeneratedArticleSemantics(args: {
  title: string;
  primaryKeyword: string;
  bodyHtml: string;
  businessFacts?: string[];
  productTitles?: string[];
  audienceLabel?: string;
}): { ok: boolean; findings: Array<{ gate: string; severity: "critical" | "major" | "minor"; detail: string }> } {
  const findings: Array<{ gate: string; severity: "critical" | "major" | "minor"; detail: string }> = [];
  const text = args.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const keyword = args.primaryKeyword.toLowerCase().trim();
  const words = text.split(/\s+/).filter(Boolean).length;

  // Unnatural exact-keyword repetition
  if (keyword.length >= 8) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const occurrences = (lower.match(new RegExp(escaped, "g")) || []).length;
    const maxAllowed = Math.max(3, Math.floor(words / 200));
    if (occurrences > maxAllowed) {
      findings.push({
        gate: "unnatural_keyword_repetition",
        severity: "major",
        detail: `Exact keyword “${args.primaryKeyword}” repeated ${occurrences} times (max ${maxAllowed}).`
      });
    }
  }

  if (isIncoherentSearchIntent(args.primaryKeyword)) {
    findings.push({
      gate: "incoherent_search_intent",
      severity: "critical",
      detail: `Primary keyword “${args.primaryKeyword}” is not a coherent search intent.`
    });
  }

  if (!titleRepresentsSearchQuestion(args.title, args.primaryKeyword)) {
    findings.push({
      gate: "title_search_question",
      severity: "major",
      detail: "Title does not represent a specific real-world search question for the keyword."
    });
  }

  const drift = detectAudiencePurposeDrift({
    primaryKeyword: args.primaryKeyword,
    proposedTitle: args.title,
    audienceLabel: args.audienceLabel
  });
  for (const d of drift) {
    findings.push({ gate: "audience_purpose_drift", severity: "major", detail: d });
  }

  // Template / generic filler
  const genericPhrases = [
    /in today’s competitive market/i,
    /when it comes to apparel/i,
    /there are many factors to consider/i,
    /at the end of the day/i,
    /whether you are a small business or/i
  ];
  const genericHits = genericPhrases.filter(re => re.test(text)).length;
  if (genericHits >= 2) {
    findings.push({
      gate: "generic_template_content",
      severity: "major",
      detail: "Body reads like generic template content with insufficient topic-specific insight."
    });
  }

  // Repeated business facts as filler
  const facts = args.businessFacts || [];
  let factRepeats = 0;
  for (const fact of facts) {
    const snippet = fact.slice(0, 48).toLowerCase();
    if (snippet.length < 20) continue;
    const count = lower.split(snippet).length - 1;
    if (count >= 2) factRepeats += 1;
  }
  if (factRepeats >= 2 || (facts.length && /standard dtf turnaround[\s\S]{0,80}standard dtf turnaround/i.test(text))) {
    findings.push({
      gate: "repeated_business_facts_filler",
      severity: "major",
      detail: "Approved business facts are repeated as filler instead of adding unique guidance."
    });
  }
  // Repetitive turnaround/production-day filler — only when paired with other failure signals
  // (avoids flagging legitimate comparison articles that mention turnaround as a criterion).
  const turnaroundMentions = (lower.match(/\bturnaround\b/g) || []).length;
  const productionDayMentions = (lower.match(/\bproduction days?\b|\bmonday through friday\b/g) || []).length;
  const fillerContext =
    isIncoherentSearchIntent(args.primaryKeyword) ||
    isQuarantinedArticle(args.title, args.primaryKeyword) ||
    factRepeats >= 1 ||
    /decision checklist for apparel buyers/i.test(args.title);
  if (fillerContext && (turnaroundMentions >= 4 || productionDayMentions >= 3)) {
    findings.push({
      gate: "repetitive_turnaround_language",
      severity: "major",
      detail: "Turnaround/production-day language is repetitive filler."
    });
  }

  // UV DTF service-category / pressing errors
  const uvMention = /\buv\s*dtf\b/i.test(text);
  if (uvMention) {
    const treatsAsApparelDecoration =
      /\buv\s*dtf\b[\s\S]{0,80}\b(garment|apparel|shirt|hoodie|embroidery|heat press|pressing|press onto fabric)\b/i.test(text) ||
      /\b(garment|apparel|shirt)\b[\s\S]{0,80}\buv\s*dtf\b/i.test(text);
    const pressGuidance =
      /\buv\s*dtf\b[\s\S]{0,120}\b(press|pressing|heat press|temperature|pressure)\b/i.test(text) ||
      /\b(press|pressing|heat press)\b[\s\S]{0,120}\buv\s*dtf\b/i.test(text);

    if (treatsAsApparelDecoration) {
      findings.push({
        gate: "uv_dtf_service_category",
        severity: "critical",
        detail: "Incorrectly groups UV DTF with garment-production / apparel decoration methods."
      });
    }
    if (pressGuidance) {
      findings.push({
        gate: "uv_dtf_pressing_guidance",
        severity: "critical",
        detail: "Misleading pressing guidance for UV DTF (hard-surface decals are not pressed like apparel transfers)."
      });
    }
  }

  // Weak / forced product insertion
  for (const product of args.productTitles || []) {
    const p = product.toLowerCase();
    if (/\buv\s*dtf\b/i.test(p) && !/\buv\s*dtf\b/i.test(keyword) && /\b(shirt|apparel|stories|printer)\b/i.test(keyword + " " + args.title)) {
      findings.push({
        gate: "forced_internal_product_link",
        severity: "major",
        detail: `Product “${product}” appears weakly related / inserted to satisfy internal-link requirements.`
      });
    }
  }

  // Insufficient unique / actionable information — target the known failure class, not every short draft.
  const actionable = (text.match(/\b(ask|compare|checklist|question|measure|verify|request|confirm|choose|choosing)\b/gi) || []).length;
  const isKnownBadClass =
    isQuarantinedArticle(args.title, args.primaryKeyword) ||
    isIncoherentSearchIntent(args.primaryKeyword) ||
    (/decision checklist for apparel buyers/i.test(args.title) && /\bstories\b/i.test(keyword));
  if (isKnownBadClass) {
    findings.push({
      gate: "insufficient_unique_insight",
      severity: "major",
      detail: "Insufficient original insight or actionable guidance to justify publication."
    });
  } else if (words < 450 && actionable < 2 && genericHits >= 1) {
    findings.push({
      gate: "insufficient_unique_insight",
      severity: "major",
      detail: "Insufficient original insight or actionable guidance to justify publication."
    });
  }

  if (QUARANTINED_ARTICLE_TITLES.some(t => t.toLowerCase() === args.title.trim().toLowerCase())) {
    findings.push({
      gate: "quarantined_article",
      severity: "critical",
      detail: "Known failed article title; must be REJECTED and excluded from rollout drafts."
    });
  }

  const ok = findings.every(f => f.severity === "minor");
  return { ok, findings };
}

export function isQuarantinedArticle(title: string, primaryKeyword?: string): boolean {
  if (QUARANTINED_ARTICLE_TITLES.some(t => t.toLowerCase() === title.trim().toLowerCase())) return true;
  if (primaryKeyword && QUARANTINED_PRIMARY_KEYWORDS.some(k => k.toLowerCase() === primaryKeyword.trim().toLowerCase())) {
    return true;
  }
  return false;
}
