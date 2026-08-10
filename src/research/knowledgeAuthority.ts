/**
 * Source authority, scope match, and contradiction precedence (M4).
 */
import type {
  ClaimClass,
  GeographicKnowledgeScope,
  KnowledgeEntry,
  KnowledgeSourceType,
  ProcessSurfaceScope
} from "./knowledgeRegistry.js";
import { sourceTypeCanSatisfyClaims } from "./knowledgeRegistry.js";

/** Higher = more authoritative for conflict resolution. */
export function sourceAuthorityRank(sourceType: KnowledgeSourceType): number {
  switch (sourceType) {
    case "public_government_standards":
      return 100;
    case "manufacturer_documentation":
      return 90;
    case "authoritative_technical_source":
      return 80;
    case "approved_business_fact_or_policy":
      return 70;
    case "approved_merchant_firsthand":
      return 65;
    case "active_first_party_customer_evidence":
      return 60;
    case "inferred_seed":
      return 10;
    case "model_inference":
      return 5;
    case "template_example":
      return 3;
    case "unsupported_assertion":
      return 0;
    default:
      return 0;
  }
}

export function processSurfacesCompatible(
  knowledgeSurface: ProcessSurfaceScope,
  claimSurface: ProcessSurfaceScope
): boolean {
  // Specific process knowledge may support a general/unspecified claim surface.
  // Specific claims require matching (or general) knowledge — never cross UV vs apparel.
  if (knowledgeSurface === "uv_dtf_hard_surface" && claimSurface === "apparel_dtf") return false;
  if (knowledgeSurface === "apparel_dtf" && claimSurface === "uv_dtf_hard_surface") return false;
  if (knowledgeSurface === "embroidery" && (claimSurface === "apparel_dtf" || claimSurface === "uv_dtf_hard_surface")) {
    return false;
  }
  if (claimSurface === "unspecified" || claimSurface === "general") return true;
  if (knowledgeSurface === "unspecified") return false;
  if (knowledgeSurface === "general") return true;
  return knowledgeSurface === claimSurface;
}

export function geographyCompatible(
  knowledgeGeo: GeographicKnowledgeScope,
  claimGeo: GeographicKnowledgeScope
): { ok: boolean; reason?: string } {
  if (claimGeo === "local") {
    if (knowledgeGeo === "local") return { ok: true };
    if (knowledgeGeo === "national" || knowledgeGeo === "global") {
      return { ok: false, reason: "national/global facts do not satisfy local claims without local evidence" };
    }
    return { ok: false, reason: "unspecified geography cannot satisfy local claims" };
  }
  if (knowledgeGeo === "local") {
    return { ok: false, reason: "local facts must not be promoted to national/global/unspecified claims" };
  }
  return { ok: true };
}

export function claimClassAllowsSource(
  claimClass: ClaimClass,
  entry: Pick<KnowledgeEntry, "sourceType" | "firsthand" | "publicUsageAllowed">
): { ok: boolean; reason?: string } {
  if (!sourceTypeCanSatisfyClaims(entry.sourceType)) {
    return { ok: false, reason: `${entry.sourceType} cannot satisfy claims` };
  }

  switch (claimClass) {
    case "merchant_experience":
      if (entry.sourceType !== "approved_merchant_firsthand" || entry.firsthand !== true) {
        return { ok: false, reason: "firsthand merchant claims require approved_merchant_firsthand" };
      }
      return { ok: true };
    case "customer_result":
      if (
        entry.sourceType !== "active_first_party_customer_evidence" &&
        entry.sourceType !== "approved_merchant_firsthand"
      ) {
        return { ok: false, reason: "customer-result claims require approved customer or firsthand evidence" };
      }
      if (entry.publicUsageAllowed !== true) {
        return { ok: false, reason: "customer-result claims require public usage permission" };
      }
      return { ok: true };
    case "price_cost":
    case "turnaround":
    case "merchant_policy":
      if (
        entry.sourceType !== "approved_business_fact_or_policy" &&
        entry.sourceType !== "approved_merchant_firsthand" &&
        entry.sourceType !== "manufacturer_documentation" &&
        entry.sourceType !== "authoritative_technical_source"
      ) {
        return { ok: false, reason: `${claimClass} requires approved business/policy or authoritative pricing source` };
      }
      return { ok: true };
    case "technical":
    case "safety_compliance":
    case "product_behavior":
      if (
        entry.sourceType !== "authoritative_technical_source" &&
        entry.sourceType !== "manufacturer_documentation" &&
        entry.sourceType !== "public_government_standards" &&
        entry.sourceType !== "approved_merchant_firsthand" &&
        entry.sourceType !== "approved_business_fact_or_policy"
      ) {
        return { ok: false, reason: "technical/safety claims require authoritative or approved shop sources" };
      }
      return { ok: true };
    case "local_claim":
      return { ok: true };
    case "comparison_recommendation":
    case "general_educational":
    case "time_sensitive":
      return { ok: true };
    default:
      return { ok: true };
  }
}

export interface ContradictionRecord {
  leftEntryId: string;
  rightEntryId: string;
  leftRevisionId: string;
  rightRevisionId: string;
  reasons: string[];
  /** Winner entry id when precedence resolves; null if unresolved material conflict. */
  winnerEntryId: string | null;
  unresolved: boolean;
}

function approvalRank(state: KnowledgeEntry["approvalState"]): number {
  return state === "APPROVED" ? 10 : 0;
}

function effectiveDateMs(entry: KnowledgeEntry): number {
  if (entry.effectiveFrom) {
    const t = Date.parse(entry.effectiveFrom);
    if (!Number.isNaN(t)) return t;
  }
  if (entry.approvedAt) {
    const t = Date.parse(entry.approvedAt);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function confidenceRank(c: KnowledgeEntry["confidence"]): number {
  switch (c) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

/**
 * Deterministic precedence: authority → approval → scope match score → effective date → revision → confidence.
 * Does not silently prefer the source that makes writing easier.
 */
export function resolveKnowledgePrecedence(
  left: KnowledgeEntry,
  right: KnowledgeEntry,
  scopeMatchLeft: number,
  scopeMatchRight: number
): { winner: KnowledgeEntry | null; reasons: string[] } {
  const reasons: string[] = [];
  const pairs: Array<[string, number, number]> = [
    ["authority", sourceAuthorityRank(left.sourceType), sourceAuthorityRank(right.sourceType)],
    ["approval", approvalRank(left.approvalState), approvalRank(right.approvalState)],
    ["scopeMatch", scopeMatchLeft, scopeMatchRight],
    ["effectiveDate", effectiveDateMs(left), effectiveDateMs(right)],
    ["revision", left.revisionId.localeCompare(right.revisionId), 0], // placeholder replaced below
    ["confidence", confidenceRank(left.confidence), confidenceRank(right.confidence)]
  ];
  // revision: prefer lexicographically greater revision id only as last-resort tie-break after content age
  pairs[4] = ["revision", left.revisionId < right.revisionId ? 0 : 1, left.revisionId < right.revisionId ? 1 : 0];

  for (const [label, a, b] of pairs) {
    if (a > b) {
      reasons.push(`${label}: prefer ${left.id}`);
      return { winner: left, reasons };
    }
    if (b > a) {
      reasons.push(`${label}: prefer ${right.id}`);
      return { winner: right, reasons };
    }
  }
  reasons.push("equal precedence; material contradiction unresolved");
  return { winner: null, reasons };
}

/** Detect factual disagreement between two facts on the same normalized claim family. */
export function factsContradict(leftFact: string, rightFact: string): boolean {
  const a = leftFact.trim().toLowerCase();
  const b = rightFact.trim().toLowerCase();
  if (!a || !b || a === b) return false;

  // Opposite polarity cues
  const neg = /\b(not|never|no|cannot|can't|won't|does not|do not)\b/;
  if (neg.test(a) !== neg.test(b) && shareClaimTokens(a, b)) return true;

  // Numeric disagreement when both state numbers for similar units
  const numsA = a.match(/\$?\d+(?:\.\d+)?/g) || [];
  const numsB = b.match(/\$?\d+(?:\.\d+)?/g) || [];
  if (numsA.length && numsB.length && shareClaimTokens(a, b)) {
    const setA = new Set(numsA.map(n => n.replace("$", "")));
    const setB = new Set(numsB.map(n => n.replace("$", "")));
    const overlap = [...setA].some(n => setB.has(n));
    if (!overlap) return true;
  }

  // Process surface clash markers
  const uv = /\buv\s*dtf\b|\bhard[- ]surface\b/;
  const apparel = /\bapparel\s*dtf\b|\bgarment\b|\bt-?shirt\b/;
  if ((uv.test(a) && apparel.test(b)) || (apparel.test(a) && uv.test(b))) return true;

  // Direct local vs national framing
  if (
    (/\blocal\b|\bwarner robins\b|\bmiddle georgia\b/.test(a) && /\bnational\b|\bus[- ]wide\b/.test(b)) ||
    (/\blocal\b|\bwarner robins\b|\bmiddle georgia\b/.test(b) && /\bnational\b|\bus[- ]wide\b/.test(a))
  ) {
    return true;
  }

  return false;
}

function shareClaimTokens(a: string, b: string): boolean {
  const tok = (s: string) =>
    new Set(
      s
        .split(/[^a-z0-9]+/)
        .filter(t => t.length > 3 && !STOP.has(t))
    );
  const A = tok(a);
  const B = tok(b);
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared >= 2;
}

const STOP = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "will",
  "your",
  "their",
  "about",
  "into",
  "for",
  "and",
  "the",
  "are",
  "was",
  "were"
]);

export function claimRelevanceScore(
  claimText: string,
  entry: Pick<KnowledgeEntry, "normalizedClaim" | "exactApprovedFact" | "knowledgeClass">,
  contextText = ""
): number {
  const claim = `${claimText} ${contextText}`.toLowerCase();
  const fact = `${entry.normalizedClaim} ${entry.exactApprovedFact}`.toLowerCase();
  const claimTokens = [...new Set(claim.split(/[^a-z0-9]+/).filter(t => t.length > 3 && !STOP.has(t)))];
  if (!claimTokens.length) return 0;
  let hits = 0;
  for (const t of claimTokens) {
    if (fact.includes(t)) hits++;
  }
  const ratio = hits / claimTokens.length;
  // Also measure how much of the fact is grounded in the claim/context (prevents one-token stretch).
  const factTokens = [...new Set(fact.split(/[^a-z0-9]+/).filter(t => t.length > 3 && !STOP.has(t)))];
  let factHits = 0;
  for (const t of factTokens) {
    if (claim.includes(t)) factHits++;
  }
  const factRatio = factTokens.length ? factHits / factTokens.length : 0;
  const score = Math.max(ratio, factRatio);
  // Require meaningful overlap — keyword sprinkle must not attach irrelevant knowledge.
  if (hits < 2 && factHits < 2 && score < 0.28) return 0;
  if (score < 0.22) return 0;
  return score;
}

/** Knowledge classes that may satisfy a claim class when scope also matches. */
export function knowledgeClassAligns(claimClass: ClaimClass, knowledgeClass: KnowledgeEntry["knowledgeClass"]): boolean {
  switch (claimClass) {
    case "price_cost":
      return knowledgeClass === "pricing_cost_facts" || knowledgeClass === "equipment_startup_costs";
    case "turnaround":
    case "merchant_policy":
      return (
        knowledgeClass === "fulfillment_turnaround" ||
        knowledgeClass === "legends_policies" ||
        knowledgeClass === "dtf_shop_operations"
      );
    case "merchant_experience":
    case "customer_result":
      return knowledgeClass === "print_shop_growth_lessons" || knowledgeClass === "dtf_shop_operations";
    case "local_claim":
      return knowledgeClass === "local_customer_needs";
    case "technical":
    case "product_behavior":
    case "safety_compliance":
      return (
        knowledgeClass === "technical_specifications" ||
        knowledgeClass === "artwork_preparation_failures" ||
        knowledgeClass === "garment_selection" ||
        knowledgeClass === "uv_dtf_vs_apparel_dtf"
      );
    case "comparison_recommendation":
      return (
        knowledgeClass === "garment_selection" ||
        knowledgeClass === "embroidery_vs_dtf" ||
        knowledgeClass === "uv_dtf_vs_apparel_dtf" ||
        knowledgeClass === "general_authoritative_education"
      );
    case "general_educational":
      return true;
    case "time_sensitive":
      return knowledgeClass === "pricing_cost_facts" || knowledgeClass === "legends_policies" || knowledgeClass === "fulfillment_turnaround";
    default:
      return false;
  }
}

export function hasUsableNumericEvidence(text: string): boolean {
  return /\$?\d+(?:\.\d+)?/.test(text);
}
