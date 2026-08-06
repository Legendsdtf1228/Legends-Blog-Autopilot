import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";
import { listArticles } from "../db.js";
import type { ProductLink, Settings } from "../types.js";
import {
  getResearchProducts,
  IncompleteInventoryError,
  listAllShopifyBlogArticles,
  resolveBlog,
  ShopifyError
} from "../shopify.js";
import type { ExistingArticleRef } from "./overlap.js";
import type { FeaturedProduct } from "./types.js";

export { IncompleteInventoryError };

export interface ContentInventory {
  existing: ExistingArticleRef[];
  products: FeaturedProduct[];
  warnings: string[];
  counts: {
    localArticles: number;
    shopifyArticles: number;
    productPages: number;
    reservedOpportunities: number;
    pendingBriefs: number;
    total: number;
    truncated: boolean;
  };
}

const PAGE_SIZE = 50;

/** Page through every local article — never silently stop after the first page. */
export async function listAllLocalArticles(db: Db): Promise<{
  items: Awaited<ReturnType<typeof listArticles>>["items"];
  pagesRead: number;
  total: number;
}> {
  const items: Awaited<ReturnType<typeof listArticles>>["items"] = [];
  let page = 1;
  let total = 0;
  let pagesRead = 0;

  while (true) {
    const result = await listArticles(db, {
      page,
      pageSize: PAGE_SIZE,
      status: "all",
      sort: "created"
    });
    pagesRead++;
    total = result.total;
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) break;
    page += 1;
    if (pagesRead > 10_000) {
      throw new Error("Article inventory pagination exceeded safety limit; refusing to silently truncate.");
    }
  }

  if (items.length !== total && total > 0) {
    throw new Error(
      `Article inventory incomplete: loaded ${items.length} of ${total} records. Duplicate detection aborted.`
    );
  }

  return { items, pagesRead, total };
}

export async function listReservedOpportunityRefs(db: Db): Promise<ExistingArticleRef[]> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    payload: {
      proposedTitle?: string;
      proposedHandle?: string;
      cluster?: { primaryKeyword?: string; subcategory?: string };
    };
  }>(
    `SELECT id, status, payload
     FROM research_opportunities
     WHERE status IN ('reserved','approved')
     ORDER BY updated_at DESC`
  );
  return rows.map(r => ({
    id: null,
    title: r.payload.proposedTitle || r.payload.cluster?.primaryKeyword || r.id,
    handle: r.payload.proposedHandle || r.id,
    status: r.status,
    primaryKeyword: r.payload.cluster?.primaryKeyword || r.payload.proposedTitle || "",
    topicFingerprint: r.payload.cluster?.primaryKeyword || "",
    excerpt: r.payload.cluster?.subcategory || "",
    source: "reserved_opportunity" as const,
    shopifyArticleId: null,
    url: null
  }));
}

export async function listPendingBriefRefs(db: Db): Promise<ExistingArticleRef[]> {
  const { rows } = await db.query<{
    id: string;
    status: string;
    payload: {
      proposedTitle?: string;
      proposedHandle?: string;
      primaryKeyword?: string;
      whyDistinct?: string;
    };
  }>(
    `SELECT id, status, payload
     FROM article_briefs
     WHERE status IN ('pending_review','approved')
     ORDER BY updated_at DESC`
  );
  return rows.map(r => ({
    id: Number(r.id),
    title: r.payload.proposedTitle || r.payload.primaryKeyword || `brief-${r.id}`,
    handle: r.payload.proposedHandle || `brief-${r.id}`,
    status: r.status,
    primaryKeyword: r.payload.primaryKeyword || r.payload.proposedTitle || "",
    topicFingerprint: r.payload.primaryKeyword || "",
    excerpt: r.payload.whyDistinct || "",
    source: "pending_brief" as const,
    shopifyArticleId: null,
    url: null
  }));
}

export function productLinksToFeatured(products: ProductLink[]): FeaturedProduct[] {
  return products.map(p => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    url: p.url,
    description: p.description || "",
    productType: p.productType,
    options: p.options || [],
    retrievedAt: p.retrievedAt || new Date().toISOString()
  }));
}

export function productPagesAsInventory(products: FeaturedProduct[]): ExistingArticleRef[] {
  return products.map(p => ({
    id: null,
    title: p.title,
    handle: p.handle || "",
    status: "product_page",
    primaryKeyword: p.title,
    topicFingerprint: p.handle || p.title,
    excerpt: (p.description || "").slice(0, 280),
    source: "product_page" as const,
    shopifyArticleId: p.id ?? null,
    url: p.url
  }));
}

/**
 * Load the complete overlap/cannibalization inventory:
 * all local articles, reserved opportunities, pending briefs,
 * Shopify blog articles, and product pages.
 */
export async function loadContentInventory(args: {
  db: Db;
  config: AppConfig;
  settings: Settings;
}): Promise<ContentInventory> {
  const warnings: string[] = [];
  const { items: localArticles, total: localTotal } = await listAllLocalArticles(args.db);

  const localRefs: ExistingArticleRef[] = localArticles.map(a => ({
    id: a.id,
    title: a.title,
    handle: a.handle,
    status: a.status,
    primaryKeyword: a.primaryKeyword,
    topicFingerprint: a.topicFingerprint,
    excerpt: a.excerpt,
    source: "local_article" as const,
    shopifyArticleId: a.shopifyArticleId,
    url: a.shopifyUrl
  }));

  const [reserved, pending] = await Promise.all([
    listReservedOpportunityRefs(args.db),
    listPendingBriefRefs(args.db)
  ]);

  let products: FeaturedProduct[] = [];
  try {
    const productResult = await getResearchProducts(args.config, args.settings.storefrontUrl, {
      incompleteBehavior: "throw"
    });
    if (productResult.truncated) {
      throw new IncompleteInventoryError(
        productResult.warning || "Shopify product inventory was truncated.",
        "products",
        productResult.products.length,
        productResult.products.length
      );
    }
    products = productLinksToFeatured(productResult.products);
    if (productResult.warning) warnings.push(productResult.warning);
  } catch (error) {
    if (error instanceof IncompleteInventoryError) throw error;
    warnings.push(error instanceof Error ? error.message : "Product inventory failed");
  }

  let shopifyArticles: ExistingArticleRef[] = [];
  try {
    const blog = await resolveBlog(args.config, args.settings);
    const articleResult = await listAllShopifyBlogArticles(args.config, {
      blogId: blog.id,
      blogHandle: blog.handle,
      storefrontUrl: args.settings.storefrontUrl
    }, { incompleteBehavior: "throw" });
    if (articleResult.truncated) {
      throw new IncompleteInventoryError(
        articleResult.warning || "Shopify blog article inventory was truncated.",
        "articles",
        articleResult.articles.length,
        articleResult.articles.length
      );
    }
    if (articleResult.warning) warnings.push(articleResult.warning);
    shopifyArticles = articleResult.articles.map(a => ({
      id: null,
      title: a.title,
      handle: a.handle,
      status: a.isPublished ? "published_shopify" : "draft_shopify",
      primaryKeyword: a.title,
      topicFingerprint: a.handle,
      excerpt: a.bodySummary,
      source: "shopify_article" as const,
      shopifyArticleId: a.id,
      url: a.url
    }));
  } catch (error) {
    if (error instanceof IncompleteInventoryError) throw error;
    if (error instanceof ShopifyError) {
      warnings.push(error.message);
    } else {
      warnings.push(error instanceof Error ? error.message : "Shopify blog inventory failed");
    }
  }

  const productPages = productPagesAsInventory(products);
  const existing = [...localRefs, ...reserved, ...pending, ...shopifyArticles, ...productPages];

  return {
    existing,
    products,
    warnings,
    counts: {
      localArticles: localTotal,
      shopifyArticles: shopifyArticles.length,
      productPages: productPages.length,
      reservedOpportunities: reserved.length,
      pendingBriefs: pending.length,
      total: existing.length,
      truncated: false
    }
  };
}
