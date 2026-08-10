/**
 * Customer FAQ import — production APPROVED evidence only.
 * Never defaults approvedBy to "merchant". Missing approval → reject.
 * Template/example records belong in fixtures and use the pending provider.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  computeEvidenceContentHash,
  validateEvidenceApproval,
  type EvidenceApprovalMethod,
  type EvidenceApprovalRecord,
  type EvidenceApprovalState
} from "../evidenceApproval.js";
import {
  computeFreshness,
  stampSourceEvidence,
  validateSourceEvidence,
  type SourceEvidence
} from "../sourceEvidence.js";
import type {
  SourceEvidenceProvider,
  SourceEvidenceProviderContext,
  SourceEvidenceProviderResult
} from "./sourceEvidenceContract.js";

export const APPROVED_FAQ_PROVIDER_ID = "approved_customer_faq_import";
export const APPROVED_FAQ_PROVIDER_VERSION = "approved_faq.v1";
export const DEFAULT_APPROVED_FAQ_PATH = "data/approved/customer-faq.v1.json";
export const DEFAULT_PENDING_FAQ_TEMPLATE_PATH = "data/fixtures/customer-faq.templates.json";
export const PENDING_FAQ_PROVIDER_ID = "pending_faq_template_import";
export const PENDING_FAQ_PROVIDER_VERSION = "pending_faq.v1";

export interface FaqImportRecord {
  id: string;
  audience: string;
  situation: string;
  problem: string;
  question: string;
  decisionOrAction: string;
  desiredOutcome: string;
  stakes?: string;
  constraints?: string[];
  geographicRelevance?: string;
  evidenceSummary: string;
  periodStart?: string;
  periodEnd?: string;
  legendsRelevance?: string;
  approvalState?: EvidenceApprovalState;
  approvedBy?: string | null;
  approvedAt?: string | null;
  approvalMethod?: EvidenceApprovalMethod | null;
  contentHash?: string;
  publicUsageAllowed?: boolean;
  usageScope?: string;
  templateExample?: boolean;
  metrics?: Record<string, number | null>;
}

function resolveFaqPath(ctx: SourceEvidenceProviderContext, fallback: string): string {
  const fromEnv = ctx.env.APPROVED_FAQ_IMPORT_PATH || ctx.approvedFaqPath;
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), fallback);
}

function resolvePendingPath(ctx: SourceEvidenceProviderContext): string {
  const fromEnv = ctx.env.PENDING_FAQ_TEMPLATE_PATH || ctx.pendingFaqPath;
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), DEFAULT_PENDING_FAQ_TEMPLATE_PATH);
}

async function readFaqArray(
  path: string,
  provider: string,
  providerVersion: string
): Promise<
  | { ok: true; records: FaqImportRecord[] }
  | { ok: false; result: SourceEvidenceProviderResult }
> {
  let rawText: string;
  try {
    rawText = await readFile(path, "utf8");
  } catch {
    return {
      ok: false,
      result: {
        provider,
        providerVersion,
        available: false,
        reason: `FAQ import unavailable at ${path}`,
        evidence: [],
        rejected: []
      }
    };
  }

  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        result: {
          provider,
          providerVersion,
          available: false,
          reason: "FAQ file must be a JSON array",
          evidence: [],
          rejected: [{ reasons: ["root value is not an array"] }]
        }
      };
    }
    return { ok: true, records: parsed as FaqImportRecord[] };
  } catch {
    return {
      ok: false,
      result: {
        provider,
        providerVersion,
        available: false,
        reason: "FAQ file is not valid JSON",
        evidence: [],
        rejected: [{ reasons: ["JSON parse failure"] }]
      }
    };
  }
}

function buildContentHashInput(row: FaqImportRecord, sourceReference: string) {
  return {
    sourceReference,
    normalizedProblem: String(row.problem || "").trim(),
    normalizedQuestion: String(row.question || "").trim(),
    evidenceSummary: String(row.evidenceSummary || "").trim(),
    audienceHint: row.audience,
    situationHint: row.situation,
    decisionHint: row.decisionOrAction,
    desiredOutcomeHint: row.desiredOutcome,
    stakesHint: row.stakes,
    constraintsHint: row.constraints || [],
    legendsRelevanceHint: row.legendsRelevance,
    periodStart: row.periodStart || null,
    periodEnd: row.periodEnd || null,
    geographicRelevance: row.geographicRelevance || null,
    metrics: row.metrics || {}
  };
}

/**
 * Production APPROVED-only importer. Rejects missing approval fields.
 * Never defaults approvedBy.
 */
export const approvedFaqImportProvider: SourceEvidenceProvider = {
  id: APPROVED_FAQ_PROVIDER_ID,
  version: APPROVED_FAQ_PROVIDER_VERSION,
  async collect(ctx: SourceEvidenceProviderContext): Promise<SourceEvidenceProviderResult> {
    const path = resolveFaqPath(ctx, DEFAULT_APPROVED_FAQ_PATH);
    const loaded = await readFaqArray(path, APPROVED_FAQ_PROVIDER_ID, APPROVED_FAQ_PROVIDER_VERSION);
    if (!loaded.ok) return loaded.result;

    const evidence: SourceEvidence[] = [];
    const rejected: SourceEvidenceProviderResult["rejected"] = [];
    const seenRefs = new Set<string>();

    for (const row of loaded.records) {
      if (!row || typeof row !== "object") {
        rejected.push({ reasons: ["malformed record: not an object"] });
        continue;
      }
      const sourceReference = String(row.id || "").trim();
      if (!sourceReference) {
        rejected.push({ reasons: ["malformed record: missing id/sourceReference"] });
        continue;
      }
      if (seenRefs.has(sourceReference)) {
        rejected.push({
          sourceReference,
          reasons: ["duplicate source reference within import batch"]
        });
        continue;
      }
      seenRefs.add(sourceReference);

      if (row.templateExample === true) {
        rejected.push({
          sourceReference,
          reasons: ["templateExample records cannot be ingested as production-approved evidence"]
        });
        continue;
      }

      const contentInput = buildContentHashInput(row, sourceReference);
      const expectedContentHash = computeEvidenceContentHash(contentInput);

      const approval: EvidenceApprovalRecord = {
        approvalState: row.approvalState || "PENDING_APPROVAL",
        approvedBy: row.approvedBy ?? null,
        approvedAt: row.approvedAt ?? null,
        approvalMethod: row.approvalMethod ?? null,
        contentHash: row.contentHash || expectedContentHash,
        publicUsageAllowed: row.publicUsageAllowed === true,
        usageScope: row.usageScope || "",
        revokedAt: null,
        revokedBy: null,
        revokeReason: null
      };

      // Never invent or default approvedBy — absence is a hard reject for APPROVED.
      const approvalCheck = validateEvidenceApproval(approval, {
        requireApproved: true,
        periodStart: row.periodStart || null,
        periodEnd: row.periodEnd || null,
        now: ctx.collectedAt,
        expectedContentHash
      });
      if (!approvalCheck.ok || approval.approvalState !== "APPROVED") {
        rejected.push({
          sourceReference,
          reasons: approvalCheck.reasons.length
            ? approvalCheck.reasons
            : ["approvalState must be APPROVED for production FAQ import"]
        });
        continue;
      }

      // Bind approval to the computed content hash (authoritative).
      approval.contentHash = expectedContentHash;

      const periodEnd = row.periodEnd || null;
      const candidate = stampSourceEvidence({
        provider: APPROVED_FAQ_PROVIDER_ID,
        providerVersion: APPROVED_FAQ_PROVIDER_VERSION,
        sourceType: "approved_customer_faq",
        sourceReference,
        collectedAt: ctx.collectedAt.toISOString(),
        periodStart: row.periodStart || null,
        periodEnd,
        geographicRelevance: row.geographicRelevance || ctx.region || null,
        normalizedProblem: String(row.problem || "").trim(),
        normalizedQuestion: String(row.question || "").trim(),
        evidenceSummary: String(row.evidenceSummary || "").trim(),
        metrics: row.metrics || {},
        confidence: "high",
        freshness: computeFreshness(periodEnd, ctx.collectedAt),
        provenance: {
          description: `Merchant-approved customer FAQ (${sourceReference}); no customer PII retained.`,
          approvedBy: approval.approvedBy!,
          approvedAt: approval.approvedAt!,
          approvalMethod: approval.approvalMethod!,
          importPath: path,
          contentHash: approval.contentHash,
          publicUsageAllowed: true,
          usageScope: approval.usageScope
        },
        approval,
        audienceHint: row.audience,
        situationHint: row.situation,
        decisionHint: row.decisionOrAction,
        desiredOutcomeHint: row.desiredOutcome,
        stakesHint: row.stakes,
        constraintsHint: row.constraints || [],
        legendsRelevanceHint: row.legendsRelevance
      });

      const validation = validateSourceEvidence(candidate);
      if (!validation.ok) {
        rejected.push({ sourceReference, reasons: validation.reasons });
        continue;
      }
      evidence.push(candidate);
    }

    return {
      provider: APPROVED_FAQ_PROVIDER_ID,
      providerVersion: APPROVED_FAQ_PROVIDER_VERSION,
      available: true,
      reason:
        evidence.length === 0
          ? `No production-approved FAQ evidence at ${path} (${rejected.length} rejected/pending).`
          : `Loaded ${evidence.length} merchant-approved FAQ evidence record(s) from ${path}`,
      evidence,
      rejected
    };
  }
};

/**
 * Pending/template FAQ importer — for merchant review display only.
 * Never produces high confidence or observed demand.
 */
export const pendingFaqTemplateProvider: SourceEvidenceProvider = {
  id: PENDING_FAQ_PROVIDER_ID,
  version: PENDING_FAQ_PROVIDER_VERSION,
  async collect(ctx: SourceEvidenceProviderContext): Promise<SourceEvidenceProviderResult> {
    const path = resolvePendingPath(ctx);
    const loaded = await readFaqArray(path, PENDING_FAQ_PROVIDER_ID, PENDING_FAQ_PROVIDER_VERSION);
    if (!loaded.ok) return loaded.result;

    const evidence: SourceEvidence[] = [];
    const rejected: SourceEvidenceProviderResult["rejected"] = [];
    const seenRefs = new Set<string>();

    for (const row of loaded.records) {
      if (!row || typeof row !== "object") {
        rejected.push({ reasons: ["malformed record: not an object"] });
        continue;
      }
      const sourceReference = String(row.id || "").trim();
      if (!sourceReference) {
        rejected.push({ reasons: ["malformed record: missing id/sourceReference"] });
        continue;
      }
      if (seenRefs.has(sourceReference)) {
        rejected.push({
          sourceReference,
          reasons: ["duplicate source reference within import batch"]
        });
        continue;
      }
      seenRefs.add(sourceReference);

      const contentInput = buildContentHashInput(row, sourceReference);
      const contentHash = computeEvidenceContentHash(contentInput);
      const approval: EvidenceApprovalRecord = {
        approvalState: "PENDING_APPROVAL",
        approvedBy: null,
        approvedAt: null,
        approvalMethod: "fixture_template",
        contentHash,
        publicUsageAllowed: false,
        usageScope: "template_review_only",
        revokedAt: null,
        revokedBy: null,
        revokeReason: null
      };

      const periodEnd = row.periodEnd || null;
      const candidate = stampSourceEvidence({
        provider: PENDING_FAQ_PROVIDER_ID,
        providerVersion: PENDING_FAQ_PROVIDER_VERSION,
        sourceType: "pending_faq_template",
        sourceReference,
        collectedAt: ctx.collectedAt.toISOString(),
        periodStart: row.periodStart || null,
        periodEnd,
        geographicRelevance: row.geographicRelevance || ctx.region || null,
        normalizedProblem: String(row.problem || "").trim(),
        normalizedQuestion: String(row.question || "").trim(),
        evidenceSummary: String(row.evidenceSummary || "").trim(),
        metrics: {},
        confidence: "unknown",
        freshness: computeFreshness(periodEnd, ctx.collectedAt),
        provenance: {
          description: `Pending FAQ template (${sourceReference}) — not merchant-approved; review only.`,
          importPath: path,
          contentHash,
          publicUsageAllowed: false,
          usageScope: "template_review_only",
          templateExample: true
        },
        approval,
        audienceHint: row.audience,
        situationHint: row.situation,
        decisionHint: row.decisionOrAction,
        desiredOutcomeHint: row.desiredOutcome,
        stakesHint: row.stakes,
        constraintsHint: row.constraints || [],
        legendsRelevanceHint: row.legendsRelevance
      });

      const validation = validateSourceEvidence(candidate);
      if (!validation.ok) {
        rejected.push({ sourceReference, reasons: validation.reasons });
        continue;
      }
      evidence.push(candidate);
    }

    return {
      provider: PENDING_FAQ_PROVIDER_ID,
      providerVersion: PENDING_FAQ_PROVIDER_VERSION,
      available: true,
      reason: `Loaded ${evidence.length} pending FAQ template(s) for merchant review from ${path}`,
      evidence,
      rejected
    };
  }
};
