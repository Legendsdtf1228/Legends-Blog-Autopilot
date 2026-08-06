import type { ResearchProviderId, ResearchSignal } from "../types.js";

export interface ProviderContext {
  collectedAt: Date;
  region: string;
  storefrontUrl: string;
  businessFacts: string[];
  existingTopics: string[];
  products: Array<{ title: string; url: string; handle?: string; description?: string }>;
  env: NodeJS.ProcessEnv;
}

export interface ProviderResult {
  provider: ResearchProviderId;
  available: boolean;
  reason?: string;
  signals: ResearchSignal[];
}

export interface ResearchProvider {
  id: ResearchProviderId;
  collect(ctx: ProviderContext): Promise<ProviderResult>;
}
