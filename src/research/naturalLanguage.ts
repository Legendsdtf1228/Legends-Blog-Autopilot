import { createHash } from "node:crypto";
import type { ReaderTask } from "./readerTask.js";

const GENERIC_READER_QUESTION = /^what should (readers?|buyers?|customers?|.+ buyers?) know about\b/i;
const TITLE_STOP_WORDS = new Set(["a", "an", "and", "for", "from", "in", "of", "or", "the", "to", "vs"]);

export const READER_QUESTION_PROVENANCE = {
  ACTUAL_READER_QUESTION: "ACTUAL_READER_QUESTION",
  APPROVED_READER_TASK_QUESTION: "APPROVED_READER_TASK_QUESTION",
  EDITORIAL_FALLBACK: "EDITORIAL_FALLBACK"
} as const;

export type ReaderQuestionProvenance =
  typeof READER_QUESTION_PROVENANCE[keyof typeof READER_QUESTION_PROVENANCE];

export interface ProvenancedReaderQuestion {
  text: string;
  provenance: ReaderQuestionProvenance;
}

export type EditorialReaderTask = Pick<
  ReaderTask,
  | "audience"
  | "actualQuestion"
  | "decisionOrAction"
  | "situation"
  | "problem"
  | "searchIntent"
  | "desiredOutcome"
  | "stakes"
  | "constraints"
>;

export interface NaturalTitleInput {
  primaryKeyword: string;
  question?: ProvenancedReaderQuestion;
  /**
   * Backward-compatible legacy input. A bare string is always treated as
   * EDITORIAL_FALLBACK and can never enter the direct-question title path.
   */
  readerQuestion?: string;
  format?: string;
  intent?: string;
  subcategory?: string;
  readerTask?: EditorialReaderTask;
  /** Stable per-candidate input used to spread fallback title shapes. */
  variantKey?: string;
}

function titleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      const clean = word.replace(/^[("'“]+|[)"'”?!.,]+$/g, "");
      if (!clean) return word;
      if (/^(dtf|uv|seo|faq|h1|h2)$/i.test(clean)) {
        return word.replace(clean, clean.toUpperCase());
      }
      const lower = clean.toLowerCase();
      const cased = index > 0 && TITLE_STOP_WORDS.has(lower)
        ? lower
        : `${lower[0]!.toUpperCase()}${lower.slice(1)}`;
      return word.replace(clean, cased);
    })
    .join(" ");
}

function sentenceCase(value: string): string {
  const trimmed = value.trim().replace(/[.?!]+$/, "");
  if (!trimmed) return "";
  return `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}`;
}

function safeShorten(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[,:;–—-]\s*$/, "");
  if (normalized.length <= max) return normalized;
  const clipped = normalized.slice(0, Math.max(1, max - 1)).replace(/\s+\S*$/, "").trim();
  return `${clipped.replace(/[,:;–—-]\s*$/, "")}…`;
}

function fitTitle(base: string, qualifier?: string, max = 120): string {
  const cleanBase = base.replace(/\s+/g, " ").trim();
  const cleanQualifier = qualifier ? safeShorten(qualifier, 42) : "";
  if (!cleanQualifier) return safeShorten(cleanBase, max);
  const separator = " — ";
  const combined = `${cleanBase}${separator}${cleanQualifier}`;
  if (combined.length <= max) return combined;
  const baseBudget = max - separator.length - cleanQualifier.length;
  return `${safeShorten(cleanBase, Math.max(36, baseBudget))}${separator}${cleanQualifier}`;
}

function stableVariant(key: string, count: number): number {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) % count;
}

function questionFor(input: NaturalTitleInput): ProvenancedReaderQuestion | null {
  if (input.question) {
    return {
      text: input.question.text.replace(/\s+/g, " ").trim(),
      provenance: input.question.provenance
    };
  }
  if (input.readerQuestion?.trim()) {
    return {
      text: input.readerQuestion.replace(/\s+/g, " ").trim(),
      provenance: READER_QUESTION_PROVENANCE.EDITORIAL_FALLBACK
    };
  }
  return null;
}

function mayDirectlyDriveTitle(question: ProvenancedReaderQuestion | null): boolean {
  return Boolean(
    question &&
    question.provenance !== READER_QUESTION_PROVENANCE.EDITORIAL_FALLBACK
  );
}

function meaningfulQuestion(question: string | undefined): string | null {
  const normalized = question?.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 24 || GENERIC_READER_QUESTION.test(normalized)) return null;
  return normalized.replace(/[?]+$/, "");
}

function questionTitle(question: string | undefined): string | null {
  const normalized = meaningfulQuestion(question);
  if (!normalized) return null;

  const shouldChoose = normalized.match(/^should (?:i|we) choose (.+)$/i);
  if (shouldChoose?.[1]) {
    return `${titleCase(shouldChoose[1])}: How to Choose`;
  }

  const compare = normalized.match(/^how should (?:i|we) compare (.+)$/i);
  if (compare?.[1]) {
    return `How to Compare ${titleCase(compare[1])}`;
  }

  return `${titleCase(normalized)}?`;
}

function taskMaterial(task: EditorialReaderTask | undefined): string {
  if (!task) return "";
  return [
    task.audience,
    task.actualQuestion,
    task.decisionOrAction,
    task.situation,
    task.problem,
    task.searchIntent,
    task.desiredOutcome,
    task.stakes,
    ...(task.constraints || [])
  ].join("|");
}

function materialKey(input: NaturalTitleInput): string {
  const question = questionFor(input);
  return [
    input.variantKey || "",
    input.primaryKeyword,
    input.format || "",
    input.intent || "",
    input.subcategory || "",
    question?.text || "",
    question?.provenance || "",
    taskMaterial(input.readerTask)
  ].join("|");
}

function canonicalQualifier(task: EditorialReaderTask | undefined): string {
  if (!task) return "";
  const constraint = task.constraints.find(value => value.trim().length >= 5);
  if (constraint) return sentenceCase(constraint);
  if (task.situation.trim()) return sentenceCase(task.situation);
  if (task.audience.trim()) return `For ${task.audience.trim()}`;
  return "";
}

function topicFromQuestion(input: NaturalTitleInput, question: ProvenancedReaderQuestion | null): string {
  const directQuestion = mayDirectlyDriveTitle(question)
    ? meaningfulQuestion(question?.text)
    : null;
  if (directQuestion) {
    const shouldChoose = directQuestion.match(/^should (?:i|we) choose (.+)$/i);
    if (shouldChoose?.[1]) return titleCase(shouldChoose[1]);
    const compare = directQuestion.match(/^how should (?:i|we) compare (.+)$/i);
    if (compare?.[1]) return titleCase(compare[1]);
  }
  return titleCase(input.primaryKeyword);
}

function fallbackTitle(input: NaturalTitleInput, topic: string, variantOverride?: number): string {
  const kind = `${input.format || ""} ${input.intent || ""}`.toLowerCase();
  const variant = variantOverride ?? stableVariant(materialKey(input), 6);
  const comparison = /\b(comparison|commercial)\b/.test(kind);
  const localOrAction = /\b(local|transactional|how_to|checklist|buyers_guide|troubleshooting)\b/.test(kind);
  const firsthand = /\b(first_person_story|lessons_learned|case_study)\b/.test(kind);

  if (comparison) {
    const betweenTopic = topic.replace(/\b(vs\.?|versus)\b/i, "and");
    return [
      `${topic}: How to Choose`,
      `Choosing Between ${betweenTopic}: What Changes the Answer`,
      `Before You Choose: ${topic}`,
      `${topic}: Decision Factors for Your Project`,
      `Finding the Right Fit for ${topic}`,
      `${topic}: Trade-Offs to Settle First`
    ][variant % 6]!;
  }
  if (firsthand) {
    return [
      `${topic}: What Changed Along the Way`,
      `Building Around ${topic}: Lessons From the Work`,
      `${topic}: Mistakes, Adjustments, and Next Steps`,
      `What ${topic} Taught Us About the Business`,
      `${topic}: Decisions Behind the Work`,
      `Inside the Work of ${topic}`
    ][variant % 6]!;
  }
  if (localOrAction) {
    return [
      `Planning ${topic}: Questions to Answer First`,
      `Before You Order ${topic}: Check These Details`,
      `${topic}: A Practical Way to Decide`,
      `How to Approach ${topic} With Fewer Surprises`,
      `${topic}: What to Confirm Before You Start`,
      `Getting ${topic} Ready for the Next Step`
    ][variant % 6]!;
  }
  return [
    `${topic}: The Questions That Shape the Decision`,
    `A Clearer Way to Think About ${topic}`,
    `${topic}: Trade-Offs Worth Understanding`,
    `Making a Better Decision About ${topic}`,
    `${topic}: Where to Start`,
    `What Matters Most in ${topic}`
  ][variant % 6]!;
}

function buildNaturalTitleInternal(input: NaturalTitleInput, variantOverride?: number): string {
  const question = questionFor(input);
  const direct = mayDirectlyDriveTitle(question)
    ? questionTitle(question?.text)
    : null;
  const topic = topicFromQuestion(input, question);
  if (direct) {
    return fitTitle(direct, canonicalQualifier(input.readerTask));
  }
  return fitTitle(fallbackTitle(input, topic, variantOverride));
}

/**
 * Only explicitly provenanced actual or approved canonical questions may take
 * the direct question-to-title path. Bare/generated questions remain fallback
 * framing and cannot masquerade as observed reader language.
 */
export function buildNaturalTitle(input: NaturalTitleInput): string {
  return buildNaturalTitleInternal(input);
}

/**
 * Build a structurally balanced corpus without randomness. Unique material
 * keys are sorted first, then assigned across six shapes; input permutations
 * therefore produce the same title for every candidate.
 */
export function buildNaturalTitleCorpus(inputs: NaturalTitleInput[]): string[] {
  const keys = [...new Set(inputs.map(materialKey))].sort();
  const variantByKey = new Map(keys.map((key, index) => [key, index % 6]));
  return inputs.map(input => buildNaturalTitleInternal(input, variantByKey.get(materialKey(input))));
}

/**
 * Legacy/editorial framing only. The returned question must be labeled
 * EDITORIAL_FALLBACK by its caller and is never demand or answer evidence.
 */
export function buildIntentReaderQuestion(args: {
  primaryKeyword: string;
  audienceLabel?: string;
  format?: string;
  intent?: string;
}): string {
  const keyword = args.primaryKeyword.trim();
  const kind = `${args.format || ""} ${args.intent || ""}`.toLowerCase();
  if (/\b(comparison|commercial)\b/.test(kind)) {
    return `Which differences matter most when comparing ${keyword}?`;
  }
  if (/\b(local|transactional)\b/.test(kind)) {
    return `What needs to be confirmed before choosing ${keyword}?`;
  }
  if (/\b(how_to|checklist|troubleshooting)\b/.test(kind)) {
    return `Which decisions and constraints shape a plan for ${keyword}?`;
  }
  return `How can someone make a sound decision about ${keyword}?`;
}