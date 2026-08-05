export type Cadence = "daily" | "twice_daily";

export interface Settings {
  enabled: boolean;
  cadence: Cadence;
  timezone: string;
  firstTime: string;
  secondTime: string;
  authorName: string;
  wordCountMin: number;
  wordCountMax: number;
  facts: string[];
  contentPillars: string[];
}

export interface ProductLink {
  title: string;
  url: string;
}

export interface GeneratedArticle {
  title: string;
  handle: string;
  summary: string;
  metaDescription: string;
  bodyHtml: string;
  tags: string[];
  primaryKeyword: string;
  topicFingerprint: string;
  rationale: string;
}

export interface Job {
  id: number;
  slot_key: string;
  scheduled_for: Date;
  status: string;
  attempts: number;
}
