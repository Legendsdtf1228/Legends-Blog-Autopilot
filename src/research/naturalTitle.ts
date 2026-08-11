/**
 * Natural title generation from ReaderTask (M5).
 * Deletes production dependence on banned template title suffixes.
 * Titles are post-task (and optionally post-evidence); never pillar/template slogans.
 */
import { createHash } from "node:crypto";
import type { ReaderTask } from "./readerTask.js";
import type { ClusterEvidenceBudgetM4 } from "./knowledgeRegistry.js";
import type { OpportunityCluster } from "./opportunityCluster.js";
import { createPipelineVersionStamp, type PipelineVersionStamp } from "./versioning.js";
import { extractSemanticFeatures } from "./semanticClustering.js";

export const NATURAL_TITLE_VERSION = "title.v1.reader-task-natural";
export const TITLE_DIVERSITY_MAX_SHARE = 0.2;

/** Production-banned template title patterns (ADR M5 remove list + close variants). */
export const BANNED_TITLE_TEMPLATE_PATTERNS: RegExp[] = [
  /:\s*What\s+.+\s+Buyers?\s+Should\s+Know\b/i,
  /:\s*What Buyers Should Know\b/i,
  /:\s*Which Option Fits(?:\s+Your\s+Apparel\s+Project)?\b/i,
  /:\s*A Decision Checklist for Apparel Buyers\b/i,
  /:\s*Honest Lessons From Building a Print Business\b/i,
  /:\s*Practical Questions Local Buyers Should Ask\b/i,
  /^A Practical Guide to\b/i
];

export function isBannedTemplateTitle(title: string): boolean {
  const t = title.trim();
  return BANNED_TITLE_TEMPLATE_PATTERNS.some(re => re.test(t));
}

export type TitlePatternFamily =
  | "comparison_how_to_choose"
  | "how_to_question"
  | "local_howto"
  | "question_form"
  | "decision_noun"
  | "other";

export function computeTitlePatternFamily(title: string): TitlePatternFamily {
  const t = title.toLowerCase();
  if (/\bvs\.?\b/.test(t) && /\b(how to choose|which|or)\b/.test(t)) return "comparison_how_to_choose";
  if (/\bvs\.?\b/.test(t)) return "comparison_how_to_choose";
  if (/^how to\b/.test(t) && /\b(warner|georgia|local)\b/.test(t)) return "local_howto";
  if (/^how to\b/.test(t)) return "how_to_question";
  if (/\?$/.test(t.trim())) return "question_form";
  if (/\b(for|when|before)\b/.test(t)) return "decision_noun";
  return "other";
}

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(w => {
      if (/^(vs\.?|or|for|to|a|an|the|and|of|in|on)$/i.test(w)) return w.toLowerCase();
      if (/^[A-Z0-9]+$/.test(w) && w.length <= 4) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ")
    .replace(/\bVs\b/g, "vs")
    .replace(/\bDtf\b/g, "DTF")
    .replace(/\bUv\b/g, "UV");
}

function stripQuestionMark(q: string): string {
  return q.replace(/[?？]\s*$/, "").trim();
}

function compressQuestionToTitle(question: string): string {
  let q = stripQuestionMark(question);
  q = q.replace(/^(should i|should we|can i|can we|how do i|how do we|what is|what are|which)\s+/i, "");
  q = q.replace(/\s+/g, " ").trim();
  return titleCaseWords(q);
}

function comparisonTitle(task: ReaderTask): string | null {
  const blob = `${task.actualQuestion} ${task.decisionOrAction}`;
  const vs = blob.match(
    /\b([a-z][a-z0-9\/\- ]{1,40}?)\s+(?:vs\.?|versus|or)\s+([a-z][a-z0-9\/\- ]{1,40}?)(?:\s+for|\s+when|\s*\?|$)/i
  );
  if (!vs) return null;
  const left = titleCaseWords(vs[1]!.trim());
  const right = titleCaseWords(vs[2]!.trim());
  const forMatch = blob.match(/\bfor\s+([^?.!]{8,60})/i);
  const useCase = forMatch ? titleCaseWords(forMatch[1]!.trim()) : null;
  if (useCase) return `${left} vs ${right} for ${useCase}: How to Choose`;
  return `${left} vs ${right}: How to Choose`;
}

function localHowToTitle(task: ReaderTask): string | null {
  const features = extractSemanticFeatures(task);
  if (features.geographyClass !== "local" && task.searchIntent !== "local") return null;
  const q = task.actualQuestion.toLowerCase();
  if (/\b(printer|print shop|where|warner|georgia)\b/.test(q)) {
    return "How to Choose a Custom Shirt Printer in Warner Robins";
  }
  const compressed = compressQuestionToTitle(task.actualQuestion);
  if (compressed.length >= 12) return compressed.startsWith("How ") ? compressed : `How to ${compressed}`;
  return null;
}

export interface NaturalTitleProposal {
  id: string;
  clusterId: string | null;
  canonicalReaderTaskId: string;
  title: string;
  patternFamily: TitlePatternFamily;
  readerQuestion: string;
  rationale: string;
  evidenceGated: boolean;
  blockedClaimIds: string[];
  diversityOk: boolean;
  diversityShare: number;
  bannedTemplate: boolean;
  titleVersion: string;
  materialHash: string;
  schemaVersion: string;
  pipelineVersions: PipelineVersionStamp;
}

function materialTitleHash(parts: object): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function proposalId(taskId: string, title: string): string {
  return createHash("sha1").update(`${taskId}|${title}`).digest("hex").slice(0, 24);
}

/**
 * Generate a natural title from a canonical ReaderTask.
 * Optional evidence budget gates titles that would imply unsupported/prohibited claims.
 */
export function generateNaturalTitleFromReaderTask(args: {
  task: ReaderTask;
  cluster?: OpportunityCluster | null;
  evidenceBudget?: ClusterEvidenceBudgetM4 | null;
  recentTitles?: string[];
}): NaturalTitleProposal {
  const task = args.task;
  const features = extractSemanticFeatures(task);

  let title: string;
  let rationale: string;

  const comparison = comparisonTitle(task);
  const local = localHowToTitle(task);

  if (comparison) {
    title = comparison;
    rationale = "Comparison decision phrased as a natural how-to-choose title from the ReaderTask question.";
  } else if (local) {
    title = local;
    rationale = "Local decision framed as a concrete how-to title from the ReaderTask.";
  } else if (features.decisionFamily === "evaluate_artwork" || /\b(dpi|artwork|resolution)\b/i.test(task.actualQuestion)) {
    title = "Artwork Resolution for Apparel DTF: DPI at Final Print Size";
    rationale = "Technical artwork decision titled from the ReaderTask without template suffixes.";
  } else if (/^how\b/i.test(task.actualQuestion.trim())) {
    title = titleCaseWords(stripQuestionMark(task.actualQuestion));
    rationale = "Preserved how-to framing from the ReaderTask question.";
  } else if (/\?$/.test(task.actualQuestion.trim())) {
    // Prefer declarative decision title when possible; keep question form as fallback.
    const compressed = compressQuestionToTitle(task.actualQuestion);
    title = compressed.length >= 18 ? compressed : titleCaseWords(stripQuestionMark(task.actualQuestion)) + "?";
    rationale = "Compressed ReaderTask question into a searchable natural title.";
  } else {
    const fromDecision = titleCaseWords(task.decisionOrAction.replace(/^(choose|decide|set|confirm|apply)\s+/i, ""));
    title = fromDecision.length >= 18
      ? fromDecision
      : titleCaseWords(stripQuestionMark(task.actualQuestion));
    rationale = "Title derived from ReaderTask decision/action language.";
  }

  // Soft length bound for naturalness
  if (title.length > 90) title = title.slice(0, 87).replace(/\s+\S*$/, "").trim();

  const blockedClaimIds: string[] = [];
  let evidenceGated = false;
  if (args.evidenceBudget) {
    const unsafe = args.evidenceBudget.claimRequirements.filter(
      c =>
        c.supportStatus === "prohibited" ||
        c.supportStatus === "conflicting" ||
        (c.claimClass === "price_cost" && c.supportStatus !== "supported")
    );
    for (const c of unsafe) blockedClaimIds.push(c.id);
    // If title implies price and price unsupported, demote to non-price framing
    if (/\b(price|cost|\$|budget)\b/i.test(title) && unsafe.some(c => c.claimClass === "price_cost")) {
      title = title.replace(/\b(price|cost|budget)\b/gi, "planning").replace(/\s+/g, " ").trim();
      evidenceGated = true;
      rationale += " Price/cost wording removed because evidence budget does not support numeric claims.";
    }
    if (unsafe.some(c => c.supportStatus === "prohibited")) {
      evidenceGated = true;
    }
  }

  // Never ship banned templates — regenerate to compressed question if somehow formed.
  if (isBannedTemplateTitle(title)) {
    title = compressQuestionToTitle(task.actualQuestion) || titleCaseWords(task.decisionOrAction);
    rationale = "Replaced banned template pattern with ReaderTask-derived natural phrasing.";
  }

  const recent = args.recentTitles || [];
  const family = computeTitlePatternFamily(title);
  const diversity = evaluateTitleDiversity(title, recent);

  // If diversity violated, prefer alternate phrasing (question form) once.
  let finalTitle = title;
  let diversityOk = diversity.ok;
  let diversityShare = diversity.share;
  if (!diversity.ok) {
    const alt = titleCaseWords(stripQuestionMark(task.actualQuestion)) + "?";
    if (!isBannedTemplateTitle(alt) && computeTitlePatternFamily(alt) !== family) {
      finalTitle = alt;
      const d2 = evaluateTitleDiversity(finalTitle, recent);
      diversityOk = d2.ok;
      diversityShare = d2.share;
      rationale += " Adjusted phrasing to respect ≤20% title-pattern diversity.";
    }
  }

  const clusterId = args.cluster?.id || null;
  const withoutHash = {
    id: proposalId(task.id, finalTitle),
    clusterId,
    canonicalReaderTaskId: task.id,
    title: finalTitle,
    patternFamily: computeTitlePatternFamily(finalTitle),
    readerQuestion: task.actualQuestion,
    rationale,
    evidenceGated,
    blockedClaimIds: [...blockedClaimIds].sort(),
    diversityOk,
    diversityShare,
    bannedTemplate: isBannedTemplateTitle(finalTitle),
    titleVersion: NATURAL_TITLE_VERSION,
    schemaVersion: "naturalTitleProposal.v1"
  };

  return {
    ...withoutHash,
    materialHash: materialTitleHash(withoutHash),
    pipelineVersions: createPipelineVersionStamp("M5")
  };
}

export function evaluateTitleDiversity(
  title: string,
  recentTitles: string[]
): { ok: boolean; share: number; family: TitlePatternFamily; count: number; total: number } {
  const family = computeTitlePatternFamily(title);
  const pool = [...recentTitles, title];
  const total = pool.length;
  const count = pool.filter(t => computeTitlePatternFamily(t) === family).length;
  const share = total === 0 ? 0 : count / total;
  // With tiny pools, allow the first few of a family; enforce once pool is meaningful.
  if (total < 5) return { ok: true, share, family, count, total };
  return { ok: share <= TITLE_DIVERSITY_MAX_SHARE + 1e-9, share, family, count, total };
}

/**
 * Non-template title for keyword-cluster engine path (no ReaderTask yet).
 * Used to delete banned production templates from runResearchCycle / custom topics.
 */
export function buildNaturalTitleFromKeyword(args: {
  primaryKeyword: string;
  format?: string;
  intent?: string;
  refinementTitle?: string | null;
}): string {
  if (args.refinementTitle && !isBannedTemplateTitle(args.refinementTitle)) {
    return args.refinementTitle;
  }
  const k = args.primaryKeyword.trim();
  const titled = titleCaseWords(k);

  // Comparison keywords
  const vs = k.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vs) {
    return `${titleCaseWords(vs[1]!)} vs ${titleCaseWords(vs[2]!)}: How to Choose`;
  }
  if (/\bvs\.?\b/i.test(k) || /\bversus\b/i.test(k)) {
    return `${titled}: How to Choose`;
  }
  if (args.intent === "local" || /\b(warner|georgia|local|near me)\b/i.test(k)) {
    if (/\bprinter|print shop\b/i.test(k)) {
      return "How to Choose a Custom Shirt Printer in Warner Robins";
    }
    return titled.startsWith("How ") ? titled : `How to Evaluate ${titled}`;
  }
  if (args.format === "how_to" || /^how\b/i.test(k)) {
    return titled.startsWith("How ") ? titled : `How to ${titled}`;
  }
  // Plain natural keyword title — no banned suffix templates.
  return titled;
}

export function assertNoBannedProductionTitle(title: string): void {
  if (isBannedTemplateTitle(title)) {
    throw new Error(`Banned template title blocked in production path: ${title}`);
  }
}
