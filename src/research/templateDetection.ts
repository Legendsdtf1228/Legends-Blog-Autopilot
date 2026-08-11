/**
 * Template diversity / template-filler detection.
 */

export interface TemplateDetectionResult {
  ok: boolean;
  score: number;
  reasons: string[];
  genericHeadingCount: number;
  keywordForceCount: number;
}

const GENERIC_HEADINGS = [
  /^what .+ means\b/i,
  /^common mistakes\b/i,
  /^how legends can help\b/i,
  /^next steps\b/i,
  /^key points\b/i,
  /^introduction\b/i,
  /^conclusion\b/i
];

const VAGUE_ADVICE = [
  /in today’s competitive market/i,
  /when it comes to apparel/i,
  /there are many factors to consider/i,
  /at the end of the day/i,
  /whether you are a small business or/i
];

export function assessTemplateFiller(args: {
  title: string;
  primaryKeyword: string;
  bodyHtml: string;
  outline?: string[];
}): TemplateDetectionResult {
  const reasons: string[] = [];
  const text = args.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const words = Math.max(1, text.split(/\s+/).filter(Boolean).length);

  const headings = [...args.bodyHtml.matchAll(/<h[2-4][^>]*>(.*?)<\/h[2-4]>/gi)].map(m =>
    m[1]!.replace(/<[^>]+>/g, "").trim()
  );
  const outlineHeadings = args.outline || [];
  const allHeadings = [...headings, ...outlineHeadings];
  const genericHeadingCount = allHeadings.filter(h => GENERIC_HEADINGS.some(re => re.test(h))).length;
  if (genericHeadingCount >= 2) {
    reasons.push("Repetitive generic heading structure (What X means / Common mistakes / How Legends can help).");
  }

  const vagueHits = VAGUE_ADVICE.filter(re => re.test(text)).length;
  if (vagueHits >= 2) {
    reasons.push("Vague advice without conditions — template language detected.");
  }

  const keyword = args.primaryKeyword.toLowerCase().trim();
  let keywordForceCount = 0;
  if (keyword.length >= 8) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    keywordForceCount = (lower.match(new RegExp(escaped, "g")) || []).length;
    const maxAllowed = Math.max(3, Math.floor(words / 200));
    if (keywordForceCount > maxAllowed) {
      reasons.push(`Exact-keyword forcing (${keywordForceCount} occurrences).`);
    }
  }

  // Strip keyword + brand; if little actionable residue remains, it's template filler
  const stripped = text
    .replace(new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ")
    .replace(/\blegends(\s+dtf)?(\s+prints)?\b/gi, " ")
    .replace(/\bwarner robins\b|\bmiddle georgia\b/gi, " ");
  const residualActionable = (stripped.match(/\b(ask|compare|choose|measure|verify|step|criteria|trade-?off|exception|when not)\b/gi) || []).length;
  if (words > 200 && residualActionable < 3) {
    reasons.push("Removing keyword and business name leaves generic template content.");
  }

  // Conclusion that only restates
  if (/\b(in conclusion|to summarize|as mentioned above|as we discussed)\b/i.test(text) && residualActionable < 4) {
    reasons.push("Conclusion mostly restates earlier content.");
  }

  const score = Math.max(0, 1 - reasons.length * 0.2 - genericHeadingCount * 0.1);
  return {
    ok: reasons.length === 0,
    score: Number(score.toFixed(4)),
    reasons,
    genericHeadingCount,
    keywordForceCount
  };
}

/** Prefer intent-specific outline structures over the default template. */
export function buildIntentOutline(args: {
  primaryKeyword: string;
  readerQuestion: string;
  promiseClass: string;
  audienceLabel: string;
  subcategory: string;
}): string[] {
  const k = args.primaryKeyword;
  const q = args.readerQuestion;
  switch (args.promiseClass) {
    case "comparison":
      return [
        `Decision criteria for evaluating ${k}`,
        `Side-by-side trade-offs that answer: ${q}`,
        `When each option is the better fit`,
        `Exceptions and common selection mistakes`,
        `A practical next step after you choose`
      ];
    case "how_to_guide":
    case "local_commercial":
      return [
        `Clarify the job-to-be-done behind “${k}”`,
        `Questions to ask before you commit`,
        `How to compare options against your constraints`,
        `Red flags and conditions that change the answer`,
        `Your next concrete step`
      ];
    case "cost_pricing":
      return [
        `Which cost components actually matter for ${k}`,
        `A transparent calculation framework (with assumptions labeled)`,
        `Variables that move break-even or margin`,
        `What not to estimate without current numbers`,
        `How to validate figures before you order`
      ];
    case "firsthand_experience":
      return [
        `The specific situation this experience answers`,
        `What changed decision-by-decision (approved firsthand only)`,
        `Mistakes that were expensive and why`,
        `What still remains hard`,
        `What a reader in a similar spot should do next`
      ];
    case "technical_production":
      return [
        `Production terms and constraints for “${k}”`,
        `Product-specific requirements that change the workflow`,
        `Approved settings / steps (only when sourced)`,
        `Failure modes and how to avoid them`,
        `How to verify results before a full run`
      ];
    default:
      return [
        `What ${args.audienceLabel.toLowerCase()} need to decide about ${k}`,
        `Answer: ${q}`,
        `Trade-offs specific to ${args.subcategory}`,
        `Conditions and exceptions that change the answer`,
        `A useful next step without a hard sell`
      ];
  }
}
