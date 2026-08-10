/**
 * M2 ingestion orchestration: collect SourceEvidence → persist → normalize ReaderTasks.
 * Does not mutate opportunities, titles, briefs, clustering, or rollout state.
 */
import type { Db } from "../db.js";
import { normalizeSourceEvidenceToReaderTask } from "./normalizeReaderTask.js";
import { approvedFaqImportProvider } from "./providers/approvedFaqImport.js";
import { seedBrainstormEvidenceProvider } from "./providers/seedBrainstormEvidence.js";
import type { SourceEvidenceProvider } from "./providers/sourceEvidenceContract.js";
import type { SourceEvidence } from "./sourceEvidence.js";
import {
  persistReaderTaskNormalization,
  persistSourceEvidenceBatch,
  recordSourceIngestionRun
} from "./sourceEvidenceStore.js";

export interface SourceIngestionOptions {
  includeSeedBrainstorm?: boolean;
  seedKeywords?: string[];
  approvedFaqPath?: string;
  region?: string;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  providers?: SourceEvidenceProvider[];
}

export interface SourceIngestionResult {
  collectedAt: string;
  providerResults: Array<{
    provider: string;
    available: boolean;
    reason?: string;
    evidenceCount: number;
    rejectedCount: number;
  }>;
  persisted: { inserted: number; updated: number };
  readerTasksAccepted: number;
  readerTasksRejected: number;
  /** Evidence IDs that supported an accepted ReaderTask. */
  acceptedEvidenceIds: string[];
}

function groupEvidenceForNormalization(evidence: SourceEvidence[]): SourceEvidence[][] {
  // M2: group only by identical source question text (not M3 semantic clustering).
  const map = new Map<string, SourceEvidence[]>();
  for (const row of evidence) {
    const key = row.normalizedQuestion.toLowerCase().replace(/\s+/g, " ").trim();
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.values()];
}

export async function runSourceEvidenceIngestion(
  db: Db,
  options: SourceIngestionOptions = {}
): Promise<SourceIngestionResult> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const providers: SourceEvidenceProvider[] = options.providers || [
    approvedFaqImportProvider,
    ...(options.includeSeedBrainstorm ? [seedBrainstormEvidenceProvider] : [])
  ];

  const allEvidence: SourceEvidence[] = [];
  const providerResults: SourceIngestionResult["providerResults"] = [];
  let inserted = 0;
  let updated = 0;

  for (const provider of providers) {
    const result = await provider.collect({
      collectedAt: now,
      region: options.region || "Middle Georgia",
      env,
      approvedFaqPath: options.approvedFaqPath,
      seedKeywords: options.seedKeywords
    });
    providerResults.push({
      provider: result.provider,
      available: result.available,
      reason: result.reason,
      evidenceCount: result.evidence.length,
      rejectedCount: result.rejected.length
    });
    allEvidence.push(...result.evidence);

    const persisted = await persistSourceEvidenceBatch(db, result.evidence);
    inserted += persisted.inserted;
    updated += persisted.updated;
    await recordSourceIngestionRun(db, {
      provider: result.provider,
      available: result.available,
      reason: result.reason,
      collectedAt: now.toISOString(),
      insertedCount: persisted.inserted,
      updatedCount: persisted.updated,
      rejectedCount: result.rejected.length,
      detail: {
        rejected: result.rejected,
        evidenceIds: result.evidence.map(e => e.id)
      }
    });
  }

  let readerTasksAccepted = 0;
  let readerTasksRejected = 0;
  const acceptedEvidenceIds: string[] = [];

  for (const group of groupEvidenceForNormalization(allEvidence)) {
    const normalized = normalizeSourceEvidenceToReaderTask(group);
    await persistReaderTaskNormalization(db, {
      task: normalized.task,
      accepted: normalized.accepted,
      reasons: normalized.reasons,
      supportingEvidenceIds: normalized.supportingEvidenceIds
    });
    if (normalized.accepted) {
      readerTasksAccepted += 1;
      acceptedEvidenceIds.push(...normalized.supportingEvidenceIds);
    } else {
      readerTasksRejected += 1;
    }
  }

  return {
    collectedAt: now.toISOString(),
    providerResults,
    persisted: { inserted, updated },
    readerTasksAccepted,
    readerTasksRejected,
    acceptedEvidenceIds
  };
}
