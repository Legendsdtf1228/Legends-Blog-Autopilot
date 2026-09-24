import sanitizeHtml from "sanitize-html";
import type {
  ArticleContent,
  FieldError,
  GeneratedArticle,
  NormalizationResult,
  ProductLink,
  Settings,
  ValidationResult
} from "./types.js";
import { ALLOWED_HTML_TAGS, CONTENT_LIMITS } from "./defaults.js";

export function countWords(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").trim().split(/\s+/).filter(Boolean).length;
}

/** Shorten text to maxLen at a sentence or word boundary; never split a word. */
export function shortenAtBoundary(input: string, maxLen: number): string {
  const text = String(input ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLen) return text;
  if (maxLen < 1) return "";

  const window = text.slice(0, maxLen);
  // Prefer the last sentence end inside the window when it keeps enough content.
  const sentenceCandidates = [". ", "! ", "? "]
    .map(mark => {
      const idx = window.lastIndexOf(mark);
      return idx >= 0 ? idx + 1 : -1; // include punctuation
    })
    .filter(idx => idx >= Math.floor(maxLen * 0.4));
  if (sentenceCandidates.length) {
    return text.slice(0, Math.max(...sentenceCandidates)).trim();
  }

  // Also allow sentence ending exactly at the cut.
  if (/[.!?]$/.test(window.trim())) return window.trim();

  let cut = window;
  // If we landed mid-word, roll back to previous whitespace.
  if (text[maxLen] && /[A-Za-z0-9]/.test(text[maxLen]!) && /[A-Za-z0-9]/.test(cut[cut.length - 1]!)) {
    const lastSpace = cut.lastIndexOf(" ");
    if (lastSpace > 0) cut = cut.slice(0, lastSpace);
  } else {
    cut = cut.replace(/\s+\S*$/, match => {
      // If the window already ends on whitespace, trim it.
      return /^\s+$/.test(match) ? "" : match;
    });
    cut = cut.trimEnd();
    if (text[maxLen] === " " || /\s/.test(text[maxLen] || "")) {
      // ok
    } else if (/[A-Za-z0-9]$/.test(cut) && text[maxLen] && /[A-Za-z0-9]/.test(text[maxLen]!)) {
      const lastSpace = cut.lastIndexOf(" ");
      if (lastSpace > 0) cut = cut.slice(0, lastSpace);
    }
  }
  return cut.trim().replace(/[,:;\-–—]+$/, "").trim();
}

export function slugify(value: string, max: number = CONTENT_LIMITS.handle.max): string {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "article";
}

export function sanitizeBodyHtml(html: string): string {
  return sanitizeHtml(String(html ?? ""), {
    allowedTags: [...ALLOWED_HTML_TAGS],
    allowedAttributes: {
      a: ["href", "title", "rel", "target"],
      img: ["src", "alt", "title", "width", "height"]
    },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer" }),
      b: "strong",
      i: "em"
    },
    exclusiveFilter(frame) {
      return frame.tag === "script" || frame.tag === "iframe" || frame.tag === "object" || frame.tag === "embed";
    }
  }).trim();
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanTags(tags: unknown): string[] {
  const list = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of list) {
    const t = cleanText(tag).slice(0, CONTENT_LIMITS.tag.max);
    if (t.length < CONTENT_LIMITS.tag.min) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= CONTENT_LIMITS.tags.max) break;
  }
  return out;
}

function cleanKeywordList(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return list.map(cleanText).filter(Boolean).map(k => k.slice(0, CONTENT_LIMITS.secondaryKeyword.max)).slice(0, 8);
}

export function fromGenerated(article: GeneratedArticle, author = "Legends DTF Prints"): ArticleContent {
  return {
    title: article.title,
    handle: article.handle,
    excerpt: article.summary,
    metaTitle: article.title,
    metaDescription: article.metaDescription,
    bodyHtml: article.bodyHtml,
    tags: article.tags,
    author,
    featuredImageUrl: null,
    featuredImageAlt: null,
    primaryKeyword: article.primaryKeyword,
    secondaryKeywords: [],
    topicFingerprint: article.topicFingerprint,
    rationale: article.rationale
  };
}

export function toGenerated(content: ArticleContent): GeneratedArticle {
  return {
    title: content.title,
    handle: content.handle,
    summary: content.excerpt,
    metaDescription: content.metaDescription,
    bodyHtml: content.bodyHtml,
    tags: content.tags,
    primaryKeyword: content.primaryKeyword,
    topicFingerprint: content.topicFingerprint,
    rationale: content.rationale
  };
}

export function normalizeArticle(
  input: Partial<ArticleContent> & { summary?: string },
  defaults?: { author?: string }
): NormalizationResult {
  const warnings: FieldError[] = [];
  const changed: string[] = [];

  let title = cleanText(input.title);
  if (!title) {
    title = "Untitled article";
    warnings.push({ field: "title", message: "Title was empty and was set to a placeholder." });
    changed.push("title");
  }
  if (title.length > CONTENT_LIMITS.title.max) {
    title = shortenAtBoundary(title, CONTENT_LIMITS.title.max);
    warnings.push({ field: "title", message: `Title shortened to ${CONTENT_LIMITS.title.max} characters.` });
    changed.push("title");
  }

  let handle = cleanText(input.handle);
  const slug = slugify(handle || title);
  if (slug !== handle) {
    handle = slug;
    changed.push("handle");
    if (input.handle) warnings.push({ field: "handle", message: "Handle was normalized to a URL-safe slug." });
  }

  let excerpt = cleanText(input.excerpt ?? input.summary);
  if (excerpt.length > CONTENT_LIMITS.excerpt.max) {
    excerpt = shortenAtBoundary(excerpt, CONTENT_LIMITS.excerpt.max);
    warnings.push({ field: "excerpt", message: `Excerpt shortened to ${CONTENT_LIMITS.excerpt.max} characters.` });
    changed.push("excerpt");
  }

  let metaTitle = cleanText(input.metaTitle) || title;
  if (metaTitle.length > CONTENT_LIMITS.metaTitle.max) {
    metaTitle = shortenAtBoundary(metaTitle, CONTENT_LIMITS.metaTitle.max);
    warnings.push({ field: "metaTitle", message: `Meta title shortened to ${CONTENT_LIMITS.metaTitle.max} characters.` });
    changed.push("metaTitle");
  }

  let metaDescription = cleanText(input.metaDescription);
  if (metaDescription.length > CONTENT_LIMITS.metaDescription.max) {
    const original = metaDescription;
    metaDescription = shortenAtBoundary(metaDescription, CONTENT_LIMITS.metaDescription.max);
    warnings.push({
      field: "metaDescription",
      message: `Meta description shortened from ${original.length} to ${metaDescription.length} characters (max ${CONTENT_LIMITS.metaDescription.max}).`
    });
    changed.push("metaDescription");
  }

  const rawBody = String(input.bodyHtml ?? "");
  const bodyHtml = sanitizeBodyHtml(rawBody);
  if (bodyHtml !== rawBody.trim()) changed.push("bodyHtml");

  const tags = cleanTags(input.tags);
  const author = cleanText(input.author) || defaults?.author || "Legends DTF Prints";
  let featuredImageAlt = cleanText(input.featuredImageAlt);
  if (featuredImageAlt.length > CONTENT_LIMITS.featuredImageAlt.max) {
    featuredImageAlt = shortenAtBoundary(featuredImageAlt, CONTENT_LIMITS.featuredImageAlt.max);
    changed.push("featuredImageAlt");
  }

  let primaryKeyword = cleanText(input.primaryKeyword);
  if (primaryKeyword.length > CONTENT_LIMITS.primaryKeyword.max) {
    primaryKeyword = shortenAtBoundary(primaryKeyword, CONTENT_LIMITS.primaryKeyword.max);
    changed.push("primaryKeyword");
  }

  let topicFingerprint = slugify(cleanText(input.topicFingerprint) || handle || title, CONTENT_LIMITS.topicFingerprint.max);
  let rationale = cleanText(input.rationale).slice(0, CONTENT_LIMITS.rationale.max);

  // Cap heading text lengths inside body
  const cappedBody = bodyHtml.replace(/<(h[2-4])(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_m, tag, attrs = "", inner) => {
    const text = cleanText(inner.replace(/<[^>]+>/g, ""));
    if (text.length <= CONTENT_LIMITS.heading.max) return `<${tag}${attrs}>${inner}</${tag}>`;
    return `<${tag}${attrs}>${shortenAtBoundary(text, CONTENT_LIMITS.heading.max)}</${tag}>`;
  });

  const content: ArticleContent = {
    title,
    handle,
    excerpt,
    metaTitle,
    metaDescription,
    bodyHtml: cappedBody,
    tags,
    author: author.slice(0, CONTENT_LIMITS.author.max),
    featuredImageUrl: cleanText(input.featuredImageUrl) || null,
    featuredImageAlt: featuredImageAlt || null,
    primaryKeyword,
    secondaryKeywords: cleanKeywordList(input.secondaryKeywords),
    topicFingerprint,
    rationale
  };

  return { content, warnings, changed };
}

export function validateArticle(
  input: Partial<ArticleContent> & { summary?: string },
  options?: { settings?: Settings; products?: ProductLink[]; requireReady?: boolean }
): ValidationResult {
  const { content, warnings } = normalizeArticle(input, { author: options?.settings?.authorName });
  const errors: FieldError[] = [];

  if (content.title.length < CONTENT_LIMITS.title.min) {
    errors.push({ field: "title", message: `Title must be at least ${CONTENT_LIMITS.title.min} characters.` });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(content.handle)) {
    errors.push({ field: "handle", message: "Handle must be a lowercase slug (letters, numbers, hyphens)." });
  }
  if (options?.requireReady) {
    if (content.excerpt.length < CONTENT_LIMITS.excerpt.min) {
      errors.push({ field: "excerpt", message: `Excerpt must be at least ${CONTENT_LIMITS.excerpt.min} characters.` });
    }
    if (content.metaDescription.length < CONTENT_LIMITS.metaDescription.min) {
      errors.push({ field: "metaDescription", message: `Meta description must be at least ${CONTENT_LIMITS.metaDescription.min} characters.` });
    }
    if (content.bodyHtml.length < CONTENT_LIMITS.bodyHtml.min) {
      errors.push({ field: "bodyHtml", message: "Body content is too short." });
    }
    if (!/<h2[ >]/i.test(content.bodyHtml) || !/<p[ >]/i.test(content.bodyHtml)) {
      errors.push({ field: "bodyHtml", message: "Body must include at least one heading (h2) and one paragraph." });
    }
  }

  if (content.metaDescription.length > CONTENT_LIMITS.metaDescription.max) {
    errors.push({ field: "metaDescription", message: `Meta description must be ${CONTENT_LIMITS.metaDescription.max} characters or fewer.` });
  }

  if (options?.settings) {
    const words = countWords(content.bodyHtml);
    const min = options.settings.wordCountMin * 0.8;
    const max = options.settings.wordCountMax * 1.25;
    if (options.requireReady && (words < min || words > max)) {
      errors.push({ field: "bodyHtml", message: `Word count ${words} is outside the allowed range (${Math.floor(min)}–${Math.ceil(max)}).` });
    }
  }

  if (/\b(guaranteed|cheapest|best in (?:the|all)|always in stock)\b/i.test(content.bodyHtml)) {
    errors.push({ field: "bodyHtml", message: "Body contains a prohibited unsupported claim." });
  }

  if (options?.products) {
    const hrefs = [...content.bodyHtml.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
    const allowed = new Set(options.products.map(p => p.url));
    // Also allow storefront root / blog / collections paths when storefront is known
    const storefront = options.settings?.storefrontUrl?.replace(/\/$/, "");
    for (const link of hrefs) {
      if (!link) continue;
      if (allowed.has(link)) continue;
      if (storefront && (link === storefront || link.startsWith(`${storefront}/`))) continue;
      if (link.startsWith("#") || link.startsWith("mailto:")) continue;
      errors.push({ field: "bodyHtml", message: `Body contains a link that was not supplied by the store: ${link}` });
      break;
    }
  }

  // Warnings about auto-fixes are not hard errors when requireReady and content is now valid
  void warnings;

  return { ok: errors.length === 0, errors, content };
}

/** Normalize + validate generated output before marking ready. Auto-shortens meta description. */
export function prepareGeneratedArticle(
  raw: GeneratedArticle,
  settings: Settings,
  products: ProductLink[]
): { content: ArticleContent; generated: GeneratedArticle; warnings: FieldError[] } {
  const normalized = normalizeArticle(fromGenerated(raw, settings.authorName), { author: settings.authorName });
  const validated = validateArticle(normalized.content, { settings, products, requireReady: true });
  if (!validated.ok || !validated.content) {
    const detail = validated.errors.map(e => `${e.field}: ${e.message}`).join("; ");
    const err = new Error(`Generated article failed validation: ${detail}`);
    (err as Error & { fieldErrors?: FieldError[]; generationError?: string }).fieldErrors = validated.errors;
    (err as Error & { generationError?: string }).generationError = detail;
    throw err;
  }
  return {
    content: validated.content,
    generated: toGenerated(validated.content),
    warnings: normalized.warnings
  };
}

export const testables = {
  countWords,
  shortenAtBoundary,
  sanitizeBodyHtml,
  normalizeArticle,
  validateArticle,
  prepareGeneratedArticle,
  slugify
};
