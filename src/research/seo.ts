import type { ArticleBrief, SearchIntent } from "./types.js";

export interface SeoDeliverables {
  seoTitle: string;
  h1: string;
  urlHandle: string;
  metaDescription: string;
  excerpt: string;
  primaryKeyword: string;
  secondaryCluster: string[];
  searchIntent: SearchIntent;
  canonicalUrl: string | null;
  imageBrief: string;
  imageAltText: string;
  internalLinks: string[];
  structuredDataRecommendation: {
    type: "BlogPosting";
    headline: string;
    description: string;
    mainEntityOfPage: string | null;
    notes: string[];
  };
  validation: { ok: boolean; issues: string[] };
}

export function buildSeoDeliverables(args: {
  brief: Pick<
    ArticleBrief,
    | "proposedTitle"
    | "proposedH1"
    | "proposedHandle"
    | "primaryKeyword"
    | "secondaryKeywords"
    | "searchIntent"
    | "readerQuestion"
    | "internalLinks"
    | "targetAudienceLabel"
  >;
  storefrontUrl: string;
  blogHandle: string;
  metaDescription?: string;
  excerpt?: string;
}): SeoDeliverables {
  const base = String(args.storefrontUrl || "").replace(/\/+$/, "");
  const blog = String(args.blogHandle || "news").replace(/^\/+|\/+$/g, "");
  const handle = args.brief.proposedHandle.replace(/^\/+|\/+$/g, "");
  const canonicalUrl = base && blog && handle ? `${base}/blogs/${blog}/${handle}` : null;
  const seoTitle = args.brief.proposedTitle.slice(0, 70);
  const h1 = (args.brief.proposedH1 || args.brief.proposedTitle).slice(0, 120);
  const keyword = args.brief.primaryKeyword;
  const metaDescription = (args.metaDescription || buildMetaDescription({
    title: seoTitle,
    keyword,
    audience: args.brief.targetAudienceLabel,
    readerQuestion: args.brief.readerQuestion
  })).trim();
  const excerpt = (args.excerpt || metaDescription).slice(0, 320);
  const imageAltText = `${h1} — illustration for ${keyword}`.slice(0, 125);
  const imageBrief =
    `Create a realistic, edge-to-edge photo or production-floor visual related to “${keyword}” ` +
    `(no text overlays, badges, or stock collage). Alt text: ${imageAltText}`;

  const deliverables: SeoDeliverables = {
    seoTitle,
    h1,
    urlHandle: handle,
    metaDescription,
    excerpt,
    primaryKeyword: keyword,
    secondaryCluster: args.brief.secondaryKeywords,
    searchIntent: args.brief.searchIntent,
    canonicalUrl,
    imageBrief,
    imageAltText,
    internalLinks: args.brief.internalLinks,
    structuredDataRecommendation: {
      type: "BlogPosting",
      headline: h1,
      description: metaDescription,
      mainEntityOfPage: canonicalUrl,
      notes: [
        "Recommend BlogPosting JSON-LD with headline, description, datePublished, and mainEntityOfPage set to the canonical URL.",
        "Do not invent aggregateRating, offers, or FAQ answers that are not in the article."
      ]
    },
    validation: { ok: true, issues: [] }
  };
  deliverables.validation = validateSeoDeliverables(deliverables);
  return deliverables;
}

function buildMetaDescription(args: {
  title: string;
  keyword: string;
  audience: string;
  readerQuestion: string;
}): string {
  const base = `${args.title}: clear guidance on ${args.keyword} for ${args.audience}. ${args.readerQuestion}`;
  if (base.length <= 160 && base.length >= 145) return base;
  if (base.length > 160) return `${base.slice(0, 157).replace(/\s+\S*$/, "")}…`;
  const pad = " See current options from Legends DTF Prints.";
  return (base + pad).slice(0, 160);
}

export function validateSeoDeliverables(seo: SeoDeliverables): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!seo.seoTitle || seo.seoTitle.length < 25 || seo.seoTitle.length > 70) {
    issues.push(`SEO title length ${seo.seoTitle.length} should be 25–70.`);
  }
  if (/^a practical guide to\b/i.test(seo.seoTitle)) {
    issues.push("SEO title uses a generic Practical Guide pattern.");
  }
  if (!seo.h1 || seo.h1.length < 15) {
    issues.push("H1 is missing or too short.");
  }
  if (!seo.urlHandle || seo.urlHandle.length < 3) {
    issues.push("URL handle is missing.");
  }
  const metaLen = seo.metaDescription.trim().length;
  if (metaLen < 145 || metaLen > 160) {
    issues.push(`Meta description length ${metaLen} should normally be 145–160.`);
  }
  if (/\b(guaranteed|free shipping|same-day)\b/i.test(seo.metaDescription)) {
    issues.push("Meta description contains fabricated guarantee/price/deadline language.");
  }
  const kw = seo.primaryKeyword.toLowerCase().split(/\s+/).filter(Boolean)[0];
  if (kw && !seo.metaDescription.toLowerCase().includes(kw)) {
    issues.push("Meta description should naturally include the primary keyword.");
  }
  if (!seo.imageAltText.trim()) {
    issues.push("Image alt text recommendation is missing.");
  }
  if (!seo.canonicalUrl) {
    issues.push("Canonical URL could not be resolved from storefront/blog/handle.");
  }
  return { ok: issues.length === 0, issues };
}
