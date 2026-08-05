import OpenAI from "openai";
import { z } from "zod";
import type { GeneratedArticle, ProductLink, Settings } from "./types.js";

const articleSchema = z.object({
  title: z.string().min(20).max(100),
  handle: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  summary: z.string().min(80).max(300),
  metaDescription: z.string().min(120).max(160),
  bodyHtml: z.string().min(2500),
  tags: z.array(z.string().min(2).max(40)).min(3).max(8),
  primaryKeyword: z.string().min(3).max(80),
  topicFingerprint: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  rationale: z.string().min(20).max(300)
});

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title","handle","summary","metaDescription","bodyHtml","tags","primaryKeyword","topicFingerprint","rationale"],
  properties: {
    title: { type: "string" }, handle: { type: "string" }, summary: { type: "string" },
    metaDescription: { type: "string" }, bodyHtml: { type: "string" },
    tags: { type: "array", items: { type: "string" } }, primaryKeyword: { type: "string" },
    topicFingerprint: { type: "string" }, rationale: { type: "string" }
  }
} as const;

function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
}

function validateContent(article: GeneratedArticle, settings: Settings, products: ProductLink[]): void {
  const words = countWords(article.bodyHtml);
  if (words < settings.wordCountMin * 0.8 || words > settings.wordCountMax * 1.25) throw new Error(`Generated article word count ${words} is outside the safety range`);
  if (/\b(guaranteed|cheapest|best in (?:the|all)|always in stock)\b/i.test(article.bodyHtml)) throw new Error("Article contains a prohibited unsupported claim");
  if (!/<h2[ >]/i.test(article.bodyHtml) || !/<p[ >]/i.test(article.bodyHtml)) throw new Error("Article HTML is missing required structure");
  const hrefs = [...article.bodyHtml.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
  const allowed = new Set(products.map(p => p.url));
  if (hrefs.some(link => link && !allowed.has(link))) throw new Error("Article contains a link that was not supplied by the store");
  if (/<script|<iframe|javascript:/i.test(article.bodyHtml)) throw new Error("Article contains unsafe HTML");
}

export async function generateArticle(args: {
  apiKey: string; model: string; settings: Settings; products: ProductLink[]; recentTopics: string[];
}): Promise<GeneratedArticle> {
  const { apiKey, model, settings, products, recentTopics } = args;
  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model,
    store: false,
    instructions: `You are the autonomous senior content editor for Legends DTF Prints. Select one useful, purchase-relevant topic and write the finished Shopify article. Accuracy is more important than hype. Treat the supplied business facts and product links as the only authoritative business information. Never invent prices, discounts, equipment specifications, turnaround promises, testimonials, statistics, certifications, policies, addresses, phone numbers, or product URLs. Do not mention being AI. Do not keyword-stuff. Avoid topics that overlap recent posts. Produce semantic HTML using only p, h2, h3, ul, ol, li, strong, em, and a tags. Do not include an h1 because Shopify renders the title. Use 1–3 supplied product links naturally when relevant; use no other links. Give practical, specific advice. End with a natural Legends DTF call to action.`,
    input: JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      targetAudience: "custom apparel buyers, small businesses, schools, teams, creators, and heat-transfer customers in Warner Robins and Middle Georgia",
      desiredWords: `${settings.wordCountMin}-${settings.wordCountMax}`,
      businessFacts: settings.facts,
      contentPillars: settings.contentPillars,
      availableProductLinks: products,
      recentTopicsToAvoid: recentTopics
    }),
    text: { format: { type: "json_schema", name: "shopify_blog_article", strict: true, schema: jsonSchema } }
  });
  if (!response.output_text) throw new Error("OpenAI returned no article text");
  const parsed = articleSchema.parse(JSON.parse(response.output_text)) as GeneratedArticle;
  validateContent(parsed, settings, products);
  return parsed;
}

export const testables = { countWords, validateContent };
