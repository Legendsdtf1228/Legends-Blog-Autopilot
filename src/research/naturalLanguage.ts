import { createHash } from "node:crypto";
import type { ReaderTask } from "./readerTask.js";

const GENERIC_READER_QUESTION = /^what should (readers?|buyers?|customers?|.+ buyers?) know about\b/i;
const TITLE_STOP_WORDS = new Set(["a", "an", "and", "for", "from", "in", "of", "or", "the", "to", "vs"]);

export interface NaturalTitleInput {
  primaryKeyword: string;
  readerQuestion?: string;
  decisionOrAction?: string;
  situation?: string;
  format?: string;
  intent?: string;
  subcategory?: string;
  readerTask?: Pick<
    ReaderTask,
    "audience" | "actualQuestion" | "decisionOrAction" | "situation" | "problem"
  >;
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

function clipTitle(value: string, max = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/[,:;–-]\s*$/, "");
  if (normalized.length <= max) return normalized;
  const clipped = normalized.slice(0, max + 1).replace(/\s+\S*$/, "").trim();
  return clipped.replace(/[,:;–-]\s*$/, "");
}

function stableVariant(key: string, count: number): number {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 8);
  return Number.parseInt(hex, 16) % count;
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

function topicFromQuestion(input: NaturalTitleInput): string {
  const taskQuestion = input.readerTask?.actualQuestion;
  const task = meaningfulQuestion(taskQuestion) || meaningfulQuestion(input.readerQuestion);
  if (task) {
    const question = task.replace(/[?]+$/, "");
    const shouldChoose = question.match(/^should (?:i|we) choose (.+)$/i);
    if (shouldChoose?.[1]) return titleCase(shouldChoose[1]);
    const compare = question.match(/^how should (?:i|we) compare (.+)$/i);
    if (compare?.[1]) return titleCase(compare[1]);
  }
  return titleCase(input.primaryKeyword);
}

function fallbackTitle(input: NaturalTitleInput, topic: string): string {
  const kind = `${input.format || ""} ${input.intent || ""}`.toLowerCase();
  const key = input.variantKey || `${input.primaryKeyword}|${input.format || ""}|${input.intent || ""}`;
  const comparison = /\b(comparison|commercial)\b/.test(kind);
  const localOrAction = /\b(local|transactional|how_to|checklist|buyers_guide|troubleshooting)\b/.test(kind);
  const firsthand = /\b(first_person_story|lessons_learned|case_study)\b/.test(kind);

  if (comparison) {
    return [
      `${topic}: How to Choose`,
      `Choosing Between ${topic}: What Changes the Answer`,
      `Compare ${topic} Before You Order`,
      `${topic}: Decision Factors for Your Project`,
      `The Right ${topic} for This Order`
    ][stableVariant(key, 5)]!;
  }
  if (firsthand) {
    return [
      `${topic}: What Changed Along the Way`,
      `Building Around ${topic}: Lessons From the Work`,
      `${topic}: Mistakes, Adjustments, and Next Steps`,
      `What ${topic} Taught Us About the Business`,
      `${topic}: Decisions Behind the Work`
    ][stableVariant(key, 5)]!;
  }
  if (localOrAction) {
    return [
      `Planning ${topic}: Questions to Answer First`,
      `Before You Order ${topic}: Check These Details`,
      `${topic}: A Practical Way to Decide`,
      `How to Approach ${topic} With Fewer Surprises`,
      `${topic}: What to Confirm Before You Start`
    ][stableVariant(key, 5)]!;
  }
  return [
    `${topic}: The Questions That Shape the Decision`,
    `A Clearer Way to Think About ${topic}`,
    `${topic}: Trade-Offs Worth Understanding`,
    `Making a Better Decision About ${topic}`,
    `${topic}: Where to Start`
  ][stableVariant(key, 5)]!;
}

/**
 * Build a title from a real reader question when one exists. Fallbacks describe
 * a decision or action without claiming demand, authority, prices, or outcomes.
 */
export function buildNaturalTitle(input: NaturalTitleInput): string {
  const fromQuestion = questionTitle(input.readerTask?.actualQuestion || input.readerQuestion);
  const topic = topicFromQuestion(input);
  return clipTitle(fromQuestion || fallbackTitle(input, topic));
}

/**
 * Keep legacy candidates usable while removing the manufactured
 * “What should readers know about …?” question shape. This is framing only;
 * it is never treated as demand or factual answer evidence.
 */
export function buildIntentReaderQuestion(args: {
  primaryKeyword: string;
  audienceLabel?: string;
  format?: string;
  intent?: string;
}): string {
  const keyword = args.primaryKeyword.trim();
  const audience = args.audienceLabel?.trim() || "a buyer";
  const kind = `${args.format || ""} ${args.intent || ""}`.toLowerCase();
  if (/\b(comparison|commercial)\b/.test(kind)) {
    return `Which differences matter most when ${audience.toLowerCase()} compares ${keyword}?`;
  }
  if (/\b(local|transactional)\b/.test(kind)) {
    return `What should ${audience.toLowerCase()} confirm before choosing ${keyword}?`;
  }
  if (/\b(how_to|checklist|troubleshooting)\b/.test(kind)) {
    return `What decisions and constraints should ${audience.toLowerCase()} work through when planning ${keyword}?`;
  }
  return `How can ${audience.toLowerCase()} make a sound decision about ${keyword}?`;
}