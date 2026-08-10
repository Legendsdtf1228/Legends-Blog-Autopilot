/**
 * SourceEvidence provider contract (M2).
 * Separate from legacy ResearchSignal providers — does not invent demand metrics.
 */
import type { SourceEvidence } from "../sourceEvidence.js";

export interface SourceEvidenceProviderContext {
  collectedAt: Date;
  region: string;
  env: NodeJS.ProcessEnv;
  /** Absolute or workspace-relative paths already resolved by caller. */
  approvedFaqPath?: string;
  seedKeywords?: string[];
}

export interface SourceEvidenceProviderResult {
  provider: string;
  providerVersion: string;
  available: boolean;
  reason?: string;
  evidence: SourceEvidence[];
  rejected: Array<{ sourceReference?: string; reasons: string[] }>;
}

export interface SourceEvidenceProvider {
  id: string;
  version: string;
  collect(ctx: SourceEvidenceProviderContext): Promise<SourceEvidenceProviderResult>;
}
