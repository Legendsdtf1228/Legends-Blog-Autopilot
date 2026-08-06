import OpenAI from "openai";
import { z } from "zod";
import type { GeneratedArticle, GenerationSettings, ProductLink, Settings } from "./types.js";
import { prepareGeneratedArticle, toGenerated } from "./content.js";
import { CONTENT_LIMITS } from "./defaults.js";

const articleSchema = z.object({
  title: z.string().min(10).max(200),
  handle: z.string().min(3).max(160),
  summary: z.string().min(20).max(500),
  metaDescription: z.string().min(20).max(400),
  bodyHtml: z.string().min(200),
  tags: z.array(z.string()).min(1).max(12),
  primaryKeyword: z.string().min(2).max(100),
  topicFingerprint: z.string().min(3).max(120),
  rationale: z.string().min(10).max(500)
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "handle", "summary", "metaDescription", "bodyHtml", "tags", "primaryKeyword", "topicFingerprint", "rationale"],
  properties: {
    title: { type: "string" },
    handle: { type: "string" },
    summary: { type: "string" },
    metaDescription: { type: "string" },
    bodyHtml: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    primaryKeyword: { type: "string" },
    topicFingerprint: { type: "string" },
    rationale: { type: "string" }
  }
} as const;

export class OpenAIAppError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_key" | "billing" | "permission" | "rate_limit" | "model_unavailable" | "invalid_output" | "unknown",
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "OpenAIAppError";
  }
}

function classifyOpenAIError(error: unknown): OpenAIAppError {
  const anyErr = error as { status?: number; code?: string; message?: string; error?: { code?: string; type?: string; message?: string } };
  const status = anyErr?.status;
  const code = anyErr?.code || anyErr?.error?.code || "";
  const message = anyErr?.error?.message || anyErr?.message || (error instanceof Error ? error.message : String(error));

  if (status === 401 || /invalid_api_key|incorrect api key/i.test(message)) {
    return new OpenAIAppError("OpenAI API key is invalid. Check OPENAI_API_KEY in Railway.", "invalid_key", false);
  }
  if (status === 429 || /rate.?limit/i.test(message) || code === "rate_limit_exceeded") {
    return new OpenAIAppError("OpenAI rate limit reached. Wait and retry.", "rate_limit", true);
  }
  if (/insufficient_quota|billing|payment/i.test(message) || code === "insufficient_quota") {
    return new OpenAIAppError("OpenAI billing/quota issue. Check the project billing settings.", "billing", false);
  }
  if (status === 403 || /permission|forbidden/i.test(message)) {
    return new OpenAIAppError("OpenAI permission denied for this key/project.", "permission", false);
  }
  if (/model .* not found|does not exist|model_not_found|invalid model/i.test(message) || code === "model_not_found") {
    return new OpenAIAppError(`Configured OpenAI model is unavailable: ${message}`, "model_unavailable", false);
  }
  return new OpenAIAppError(message.slice(0, 500), "unknown", status ? status >= 500 : false);
}

function lengthHint(settings: Settings, gen?: GenerationSettings): string {
  const length = gen?.desiredLength || settings.defaultArticleLength;
  if (length === "short") return "600-800";
  if (length === "long") return "1400-1800";
  if (length === "custom") return `${settings.wordCountMin}-${settings.wordCountMax}`;
  return `${settings.wordCountMin}-${settings.wordCountMax}`;
}

function parseArticleJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new OpenAIAppError("OpenAI returned malformed JSON", "invalid_output", false);
  }
}

function repairArticleShape(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    title: String(raw.title ?? raw.Title ?? ""),
    handle: String(raw.handle ?? raw.slug ?? ""),
    summary: String(raw.summary ?? raw.excerpt ?? ""),
    metaDescription: String(raw.metaDescription ?? raw.meta_description ?? raw.seoDescription ?? ""),
    bodyHtml: String(raw.bodyHtml ?? raw.body_html ?? raw.html ?? ""),
    tags: Array.isArray(raw.tags) ? raw.tags : String(raw.tags ?? "").split(",").map(s => s.trim()).filter(Boolean),
    primaryKeyword: String(raw.primaryKeyword ?? raw.primary_keyword ?? ""),
    topicFingerprint: String(raw.topicFingerprint ?? raw.topic_fingerprint ?? raw.handle ?? ""),
    rationale: String(raw.rationale ?? raw.reason ?? "Generated article")
  };
}

export async function generateArticle(args: {
  apiKey: string;
  model: string;
  settings: Settings;
  products: ProductLink[];
  recentTopics: string[];
  generation?: GenerationSettings;
  section?: "full" | "title" | "excerpt" | "seo" | "body";
  existing?: GeneratedArticle;
}): Promise<GeneratedArticle> {
  const { apiKey, model, settings, products, recentTopics, generation, section = "full", existing } = args;
  const client = new OpenAI({ apiKey });

  const instructions = `You are the senior content editor for ${settings.businessName}. Write accurate Shopify blog content.
Brand voice: ${generation?.brandVoice || settings.brandVoice}
Target audience: ${generation?.targetAudience || settings.targetAudience}
Accuracy over hype. Treat supplied business facts and product links as the only authoritative business information.
Never invent prices, discounts, equipment specifications, turnaround promises, testimonials, statistics, certifications, policies, addresses, phone numbers, or product URLs.
Never include customer names, orders, secrets, or private business data.
Do not mention being AI. Avoid keyword stuffing.
Produce semantic HTML using only p, h2, h3, ul, ol, li, strong, em, and a tags. Do not include an h1.
Use 1–3 supplied product links naturally when relevant; use no other invented product links.
Call to action guidance: ${generation?.callToAction || settings.defaultCta}
Meta description MUST be ${CONTENT_LIMITS.metaDescription.min}-${CONTENT_LIMITS.metaDescription.max} characters.`;

  const sectionNote =
    section === "title" ? "Regenerate only title, handle, primaryKeyword, topicFingerprint, and rationale. Keep other fields identical to existing."
      : section === "excerpt" ? "Regenerate only summary. Keep other fields identical to existing."
        : section === "seo" ? "Regenerate only metaDescription and optionally refine title/handle for SEO. Keep bodyHtml identical."
          : section === "body" ? "Regenerate only bodyHtml and tags. Preserve title/handle/summary/metaDescription unless empty."
            : "Generate a complete finished article.";

  const input = {
    date: new Date().toISOString().slice(0, 10),
    section,
    sectionNote,
    articleType: generation?.articleType || "educational guide",
    topic: generation?.topic || null,
    primaryKeyword: generation?.primaryKeyword || settings.primaryKeywordDefault,
    secondaryKeywords: generation?.secondaryKeywords || settings.secondaryKeywordsDefault,
    desiredWords: lengthHint(settings, generation),
    businessFacts: settings.facts,
    contentPillars: settings.contentPillars,
    availableProductLinks: products.map(p => ({ title: p.title, url: p.url })),
    productFocus: generation?.productFocus || [],
    internalLinking: generation?.internalLinking !== false,
    recentTopicsToAvoid: recentTopics,
    existingArticle: existing || null,
    draftOnly: generation?.draftOnly ?? settings.draftOnlyMode
  };

  async function callModel(repairHint?: string) {
    try {
      const response = await client.responses.create({
        model,
        store: false,
        instructions: repairHint ? `${instructions}\n\nRepair previous output: ${repairHint}` : instructions,
        input: JSON.stringify(input),
        text: { format: { type: "json_schema", name: "shopify_blog_article", strict: true, schema: jsonSchema } }
      });
      if (!response.output_text) throw new OpenAIAppError("OpenAI returned no article text", "invalid_output", false);
      return response.output_text;
    } catch (error) {
      if (error instanceof OpenAIAppError) throw error;
      throw classifyOpenAIError(error);
    }
  }

  let text = await callModel();
  let parsed: GeneratedArticle | null = null;
  try {
    const raw = repairArticleShape(parseArticleJson(text) as Record<string, unknown>);
    parsed = articleSchema.parse(raw) as GeneratedArticle;
  } catch (error) {
    text = await callModel(`Previous output failed schema validation (${error instanceof Error ? error.message : String(error)}). Return valid JSON only.`);
    try {
      const raw = repairArticleShape(parseArticleJson(text) as Record<string, unknown>);
      parsed = articleSchema.parse(raw) as GeneratedArticle;
    } catch (err) {
      throw new OpenAIAppError(
        `Generated output remained invalid after one repair attempt: ${err instanceof Error ? err.message : String(err)}`,
        "invalid_output",
        false
      );
    }
  }

  // Preserve merchant/existing fields on partial regen
  if (existing && section !== "full") {
    if (section === "title") {
      parsed = {
        ...existing,
        title: parsed.title,
        handle: parsed.handle,
        primaryKeyword: parsed.primaryKeyword,
        topicFingerprint: parsed.topicFingerprint,
        rationale: parsed.rationale
      };
    } else if (section === "excerpt") {
      parsed = { ...existing, summary: parsed.summary };
    } else if (section === "seo") {
      parsed = {
        ...existing,
        metaDescription: parsed.metaDescription,
        title: parsed.title || existing.title,
        handle: parsed.handle || existing.handle
      };
    } else if (section === "body") {
      parsed = { ...existing, bodyHtml: parsed.bodyHtml, tags: parsed.tags.length ? parsed.tags : existing.tags };
    }
  }

  const prepared = prepareGeneratedArticle(parsed, settings, products);
  return prepared.generated;
}

export async function diagnoseOpenAI(apiKey: string, preferredModel: string) {
  const client = new OpenAI({ apiKey });
  const result: {
    ok: boolean;
    keyConfigured: boolean;
    models: string[];
    preferredModel: string;
    preferredAvailable: boolean | null;
    errorCode?: string;
    message: string;
    nextAction: string;
  } = {
    ok: false,
    keyConfigured: Boolean(apiKey),
    models: [],
    preferredModel,
    preferredAvailable: null,
    message: "",
    nextAction: ""
  };

  if (!apiKey) {
    result.message = "OPENAI_API_KEY is not configured.";
    result.nextAction = "Set OPENAI_API_KEY in Railway environment variables.";
    result.errorCode = "invalid_key";
    return result;
  }

  try {
    const list = await client.models.list();
    result.models = list.data.map(m => m.id).sort();
    result.preferredAvailable = result.models.includes(preferredModel);
    result.ok = true;
    result.message = result.preferredAvailable
      ? `OpenAI connected. Preferred model ${preferredModel} is available.`
      : `OpenAI connected, but preferred model ${preferredModel} was not listed for this project.`;
    result.nextAction = result.preferredAvailable
      ? "No action needed."
      : "Pick a verified available model in Settings, or update OPENAI_MODEL.";
    return result;
  } catch (error) {
    const classified = classifyOpenAIError(error);
    result.errorCode = classified.code;
    result.message = classified.message;
    result.nextAction =
      classified.code === "invalid_key" ? "Replace OPENAI_API_KEY with a valid project key."
        : classified.code === "billing" ? "Fix billing/quota in the OpenAI dashboard."
          : classified.code === "rate_limit" ? "Wait briefly, then retry diagnostics."
            : classified.code === "model_unavailable" ? "Choose a different model in Settings."
              : "Check OpenAI project access and try again.";

    // Fallback probe with a tiny request when models.list is unsupported
    if (classified.code === "unknown" || classified.code === "permission") {
      try {
        await client.responses.create({
          model: preferredModel,
          store: false,
          input: "Reply with OK",
          text: { format: { type: "text" } }
        });
        result.ok = true;
        result.preferredAvailable = true;
        result.message = `OpenAI key works with model ${preferredModel} (model listing unavailable).`;
        result.nextAction = "No action needed.";
        result.errorCode = undefined;
      } catch (probeError) {
        const probe = classifyOpenAIError(probeError);
        result.errorCode = probe.code;
        result.message = probe.message;
        result.preferredAvailable = probe.code === "model_unavailable" ? false : null;
        result.nextAction =
          probe.code === "model_unavailable"
            ? "Select a different verified model. Do not keep guessing models automatically."
            : result.nextAction;
      }
    }
    return result;
  }
}

export { articleSchema, toGenerated };
export const testables = {
  classifyOpenAIError,
  repairArticleShape,
  parseArticleJson
};
