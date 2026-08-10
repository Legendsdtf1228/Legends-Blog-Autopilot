/**
 * Approved customer FAQ import — real first-party SourceEvidence (not seeds).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

interface ApprovedFaqRecord {
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
  approvedBy?: string;
  approvedAt?: string;
  metrics?: Record<string, number | null>;
}

function resolveFaqPath(ctx: SourceEvidenceProviderContext): string {
  const fromEnv = ctx.env.APPROVED_FAQ_IMPORT_PATH || ctx.approvedFaqPath;
  if (fromEnv) return resolve(fromEnv);
  return resolve(process.cwd(), DEFAULT_APPROVED_FAQ_PATH);
}

export const approvedFaqImportProvider: SourceEvidenceProvider = {
  id: APPROVED_FAQ_PROVIDER_ID,
  version: APPROVED_FAQ_PROVIDER_VERSION,
  async collect(ctx: SourceEvidenceProviderContext): Promise<SourceEvidenceProviderResult> {
    const path = resolveFaqPath(ctx);
    let rawText: string;
    try {
      rawText = await readFile(path, "utf8");
    } catch {
      return {
        provider: APPROVED_FAQ_PROVIDER_ID,
        providerVersion: APPROVED_FAQ_PROVIDER_VERSION,
        available: false,
        reason: `Approved FAQ import unavailable at ${path}`,
        evidence: [],
        rejected: []
      };
    }

    let records: ApprovedFaqRecord[];
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (!Array.isArray(parsed)) {
        return {
          provider: APPROVED_FAQ_PROVIDER_ID,
          providerVersion: APPROVED_FAQ_PROVIDER_VERSION,
          available: false,
          reason: "Approved FAQ file must be a JSON array",
          evidence: [],
          rejected: [{ reasons: ["root value is not an array"] }]
        };
      }
      records = parsed as ApprovedFaqRecord[];
    } catch {
      return {
        provider: APPROVED_FAQ_PROVIDER_ID,
        providerVersion: APPROVED_FAQ_PROVIDER_VERSION,
        available: false,
        reason: "Approved FAQ file is not valid JSON",
        evidence: [],
        rejected: [{ reasons: ["JSON parse failure"] }]
      };
    }

    const evidence: SourceEvidence[] = [];
    const rejected: SourceEvidenceProviderResult["rejected"] = [];
    const seenRefs = new Set<string>();

    for (const row of records) {
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
          description: `Approved customer FAQ import (${sourceReference}); no customer PII retained.`,
          approvedBy: row.approvedBy || "merchant",
          approvedAt: row.approvedAt,
          importPath: path
        },
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
      reason: `Loaded ${evidence.length} approved FAQ evidence record(s) from ${path}`,
      evidence,
      rejected
    };
  }
};
