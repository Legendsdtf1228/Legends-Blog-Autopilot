/**
 * OpportunityCluster — semantic ReaderTask consolidation (M3).
 * Does not create research opportunities.
 */
import type { PipelineVersionStamp } from "./versioning.js";
import type { ReaderTask, ReaderTaskConfidence } from "./readerTask.js";
import type { SearchIntent } from "./types.js";

export const OPPORTUNITY_CLUSTER_SCHEMA_VERSION = "opportunityCluster.v1";
export const SEMANTIC_CLUSTERING_VERSION = "clustering.v1.semantic-reader-task";

export type OpportunityClusterStatus =
  | "active"
  | "needs_review"
  | "superseded"
  | "split"
  | "merged_away";

export type ClusterDemandStatus = "verified" | "observed" | "inferred_seed" | "unavailable";

export interface ClusterMemberRecord {
  readerTaskId: string;
  semanticFingerprint: string;
  joinReason: string;
  isCanonical: boolean;
  joinedAtClusteringVersion: string;
}

export interface ClusterConflictRecord {
  leftTaskId: string;
  rightTaskId: string;
  reasons: string[];
}

export interface ClusterReviewCandidate {
  leftTaskId: string;
  rightTaskId: string;
  similarityScore: number;
  explanation: string;
  reasons: string[];
}

export interface OpportunityCluster {
  id: string;
  canonicalReaderTaskId: string;
  semanticFingerprint: string;
  clusteringVersion: string;
  status: OpportunityClusterStatus;
  memberReaderTaskIds: string[];
  supportingSourceEvidenceIds: string[];
  canonicalAudience: string;
  canonicalSituation: string;
  canonicalProblem: string;
  canonicalQuestion: string;
  canonicalDecision: string;
  canonicalIntent: SearchIntent | "unknown";
  canonicalDesiredOutcome: string;
  mergedEvidenceSummary: string;
  similarityExplanation: string;
  mergeConfidence: number;
  requiresManualReview: boolean;
  demandStatus: ClusterDemandStatus;
  confidence: ReaderTaskConfidence;
  wordingVariants: string[];
  conflicts: ClusterConflictRecord[];
  materialHash: string;
  schemaVersion: string;
  pipelineVersions: PipelineVersionStamp;
  createdAt?: string;
  updatedAt?: string;
}

export interface SemanticComparisonResult {
  leftTaskId: string;
  rightTaskId: string;
  score: number;
  keywordOverlap: number;
  hardConflicts: string[];
  softConflicts: string[];
  signals: Record<string, number>;
  decision: "merge" | "review" | "separate";
  explanation: string;
}

export interface ClusteringThresholds {
  /** Auto-merge when score >= mergeMin and no hard conflicts. */
  mergeMin: number;
  /** Ambiguous band requiring review (not auto-merged). */
  reviewMin: number;
}

/** Declared floors for automatic merge eligibility (in addition to mergeMin). */
export const MERGE_AUDIENCE_FLOOR = 0.45;
export const MERGE_DECISION_FLOOR = 0.55;

export const DEFAULT_CLUSTERING_THRESHOLDS: ClusteringThresholds = {
  mergeMin: 0.78,
  reviewMin: 0.55
};

/** Input task enriched with evidence IDs for clustering. */
export interface ClusterableReaderTask {
  task: ReaderTask;
  supportingSourceEvidenceIds: string[];
  /** Active approval present on supporting evidence (optional hint). */
  hasActiveApprovedEvidence?: boolean;
  /** True when task should be excluded from active clustering (stale/revoked). */
  inactive?: boolean;
  inactiveReason?: string;
}
