/**
 * Pipeline version pins for editorial artifacts.
 * M1 foundation — stamp helpers available; mandatory stamping begins M2+.
 */
export const PIPELINE_VERSIONS = {
  provider: "provider.v2.approved-faq-and-seed-brainstorm",
  normalization: "normalization.v1.source-evidence-to-reader-task",
  clustering: "clustering.v1.semantic-reader-task",
  knowledgeRegistry: "knowledge.v1.approved-claim-budget",
  titleGeneration: "title.v1.reader-task-natural",
  decisionPolicy: "decision.v1.auto-only-generation",
  briefSchema: "brief.v2.intent-native-reader-task",
  generationPrompt: "generation.v1.writer-json",
  verificationRubric: "verification.v1.quality-gates",
  readerTaskSchema: "readerTask.v1"
} as const;

export type PipelineVersionKey = keyof typeof PIPELINE_VERSIONS;

export interface PipelineVersionStamp {
  stampedAt: string;
  versions: typeof PIPELINE_VERSIONS;
  /** Milestone that produced this stamp. */
  milestone: string;
}

export function createPipelineVersionStamp(milestone = "M1"): PipelineVersionStamp {
  return {
    stampedAt: new Date().toISOString(),
    versions: { ...PIPELINE_VERSIONS },
    milestone
  };
}

export function pipelineVersionSummary(stamp?: PipelineVersionStamp | null): string {
  if (!stamp) return "unstamped";
  return Object.entries(stamp.versions)
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}
