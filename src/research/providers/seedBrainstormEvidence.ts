/**
 * Seed brainstorming evidence — never validated demand, never AUTO_ELIGIBLE input.
 */
import {
  stampSourceEvidence,
  validateSourceEvidence,
  type SourceEvidence
} from "../sourceEvidence.js";
import type {
  SourceEvidenceProvider,
  SourceEvidenceProviderContext,
  SourceEvidenceProviderResult
} from "./sourceEvidenceContract.js";

export const SEED_BRAINSTORM_PROVIDER_ID = "seed_brainstorm";
export const SEED_BRAINSTORM_PROVIDER_VERSION = "seed_brainstorm.v1";

/** Optional brainstorm seeds for M2 tests / local exploration. Not search demand. */
export const DEFAULT_BRAINSTORM_SEEDS = [
  "embroidery vs DTF for work shirts",
  "cotton vs polyester shirts for custom printing"
];

export const seedBrainstormEvidenceProvider: SourceEvidenceProvider = {
  id: SEED_BRAINSTORM_PROVIDER_ID,
  version: SEED_BRAINSTORM_PROVIDER_VERSION,
  async collect(ctx: SourceEvidenceProviderContext): Promise<SourceEvidenceProviderResult> {
    const keywords = (ctx.seedKeywords?.length ? ctx.seedKeywords : DEFAULT_BRAINSTORM_SEEDS)
      .map(k => k.trim())
      .filter(Boolean);

    const evidence: SourceEvidence[] = [];
    const rejected: SourceEvidenceProviderResult["rejected"] = [];

    for (const keyword of keywords) {
      const sourceReference = `seed:${keyword.toLowerCase()}`;
      const candidate = stampSourceEvidence({
        provider: SEED_BRAINSTORM_PROVIDER_ID,
        providerVersion: SEED_BRAINSTORM_PROVIDER_VERSION,
        sourceType: "seed_brainstorm",
        sourceReference,
        collectedAt: ctx.collectedAt.toISOString(),
        periodStart: null,
        periodEnd: null,
        geographicRelevance: ctx.region || null,
        normalizedProblem: `Brainstorm exploration around “${keyword}” without verified demand.`,
        normalizedQuestion: `What open questions exist around “${keyword}”?`,
        evidenceSummary: "Seed catalog brainstorming candidate only — not validated search demand.",
        metrics: {},
        confidence: "low",
        freshness: "unknown",
        provenance: {
          description: "Seed catalog brainstorming input; explicit non-demand provenance.",
          brainstormOnly: true
        },
        approval: null,
        audienceHint: "buyers",
        situationHint: "unspecified",
        decisionHint: "explore",
        desiredOutcomeHint: "brainstorm"
      });
      const validation = validateSourceEvidence(candidate);
      if (!validation.ok) {
        rejected.push({ sourceReference, reasons: validation.reasons });
        continue;
      }
      evidence.push(candidate);
    }

    return {
      provider: SEED_BRAINSTORM_PROVIDER_ID,
      providerVersion: SEED_BRAINSTORM_PROVIDER_VERSION,
      available: true,
      reason: `Brainstorm-only seed evidence (${evidence.length}); not validated demand.`,
      evidence,
      rejected
    };
  }
};
