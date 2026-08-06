import type { AppConfig } from "./config.js";
import { redactSecrets } from "./config.js";
import type { GeneratedArticle, ProductLink, Settings } from "./types.js";

type GraphqlResponse<T> = { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }> };

type CachedToken = { value: string; expiresAt: number; scope?: string };
const tokenCache = new Map<string, CachedToken>();

const REQUIRED_SCOPES = ["read_products", "read_content", "write_content"] as const;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class ShopifyError extends Error {
  constructor(
    message: string,
    public readonly code: "auth" | "permission" | "validation" | "rate_limit" | "server" | "network" | "unknown",
    public readonly retryable: boolean,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

function summarizeHttpError(status: number, body: string): string {
  const cleaned = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (status === 401 || status === 403) return `Shopify permission/auth error (${status}): ${cleaned || "access denied"}`;
  if (status === 429) return `Shopify rate limit (429). Wait and retry.`;
  if (status >= 500) return `Shopify server error (${status}).`;
  return `Shopify HTTP ${status}: ${cleaned || "request failed"}`;
}

async function getAccessToken(config: AppConfig, forceRefresh = false): Promise<{ token: string; scope?: string }> {
  const cached = tokenCache.get(config.SHOPIFY_SHOP);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) {
    return { token: cached.value, scope: cached.scope };
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.SHOPIFY_CLIENT_ID,
    client_secret: config.SHOPIFY_CLIENT_SECRET
  });
  const response = await fetch(`https://${config.SHOPIFY_SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ShopifyError(
      summarizeHttpError(response.status, text),
      response.status === 401 || response.status === 403 ? "auth" : response.status === 429 ? "rate_limit" : "server",
      response.status === 429 || response.status >= 500,
      response.status
    );
  }
  const json = await response.json() as { access_token?: string; expires_in?: number; scope?: string };
  if (!json.access_token) throw new ShopifyError("Shopify authentication returned no access token", "auth", false);
  tokenCache.set(config.SHOPIFY_SHOP, {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 86_399) * 1000,
    scope: json.scope
  });
  return { token: json.access_token, scope: json.scope };
}

async function graphqlOnce<T>(config: AppConfig, query: string, variables: Record<string, unknown>, token: string): Promise<{ data: T; status: number }> {
  const response = await fetch(`https://${config.SHOPIFY_SHOP}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 401) throw new ShopifyError("Shopify access token expired or invalid", "auth", true, 401);
  if (response.status === 429) throw new ShopifyError("Shopify rate limit", "rate_limit", true, 429);
  if (response.status >= 500) throw new ShopifyError(summarizeHttpError(response.status, await response.text()), "server", true, response.status);
  if (!response.ok) throw new ShopifyError(summarizeHttpError(response.status, await response.text()), "unknown", false, response.status);

  const json = await response.json() as GraphqlResponse<T>;
  if (json.errors?.length) {
    const msg = json.errors.map(e => e.message).join("; ");
    const code = json.errors.some(e => /access|permission|scope/i.test(e.message)) ? "permission" : "unknown";
    // Top-level GraphQL errors are distinct from mutation userErrors.
    throw new ShopifyError(`Shopify GraphQL error: ${msg}`, code, false, response.status);
  }
  if (!json.data) throw new ShopifyError("Shopify returned no data", "unknown", false, response.status);
  return { data: json.data, status: response.status };
}

export async function graphql<T>(config: AppConfig, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let authRetried = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { token } = await getAccessToken(config, authRetried && attempt > 0);
      const { data } = await graphqlOnce<T>(config, query, variables, token);
      return data;
    } catch (error) {
      if (error instanceof ShopifyError && error.code === "auth" && !authRetried) {
        authRetried = true;
        await getAccessToken(config, true);
        continue;
      }
      if (error instanceof ShopifyError && error.retryable && attempt < 3) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw error;
    }
  }
  throw new ShopifyError("Shopify request failed after retries", "network", true);
}

export async function listBlogs(config: AppConfig): Promise<Array<{ id: string; title: string; handle: string }>> {
  const data = await graphql<{ blogs: { nodes: Array<{ id: string; title: string; handle: string }> } }>(config, `
    query AutopilotBlogs($first: Int!) {
      blogs(first: $first) { nodes { id title handle } }
    }
  `, { first: 50 });
  return data.blogs.nodes;
}

export async function resolveBlog(config: AppConfig, settings: Settings): Promise<{ id: string; title: string; handle: string }> {
  const blogs = await listBlogs(config);
  const selected =
    (settings.shopifyBlogId && blogs.find(b => b.id === settings.shopifyBlogId)) ||
    blogs.find(b => b.handle === (settings.shopifyBlogHandle || "news")) ||
    blogs.find(b => b.handle === "news") ||
    blogs.find(b => b.title.toLowerCase() === "news") ||
    blogs[0];
  if (!selected) throw new ShopifyError("No Shopify blog was found. Create a blog under Online Store > Blog posts first.", "validation", false);
  return selected;
}

/** Hard caps prevent unbounded memory use; exceeding them with more pages available is an incomplete inventory. */
export const RESEARCH_PRODUCT_INVENTORY_HARD_LIMIT = 2000;
export const RESEARCH_ARTICLE_INVENTORY_HARD_LIMIT = 5000;

export class IncompleteInventoryError extends Error {
  readonly truncated = true as const;

  constructor(
    message: string,
    public readonly kind: "products" | "articles",
    public readonly loaded: number,
    public readonly hardLimit: number
  ) {
    super(message);
    this.name = "IncompleteInventoryError";
  }
}

/** Throw when a Shopify pagination hard limit would silently truncate overlap inventory. */
export function assertShopifyInventoryComplete(args: {
  kind: "products" | "articles";
  loaded: number;
  hasNextPage: boolean;
  hardLimit: number;
}): void {
  if (args.hasNextPage && args.loaded >= args.hardLimit) {
    throw new IncompleteInventoryError(
      `Shopify ${args.kind} inventory incomplete: loaded ${args.loaded} of at least ${args.loaded + 1}+ records ` +
        `(hard limit ${args.hardLimit}) but more pages remain. Duplicate detection aborted.`,
      args.kind,
      args.loaded,
      args.hardLimit
    );
  }
}

export async function getProductLinks(config: AppConfig, storefrontUrl?: string): Promise<{ products: ProductLink[]; warning?: string }> {
  // Same completeness rules as research inventory — never silently truncate a capped catalog.
  return getResearchProducts(config, storefrontUrl, { incompleteBehavior: "throw" });
}

export interface ResearchProductFetchOptions {
  hardLimit?: number;
  /** Default `throw` — overlap inventory must not silently truncate. */
  incompleteBehavior?: "throw" | "error_result";
}

/** Paginated Shopify product fetch with description, type, and options for locked fact sheets. */
export async function getResearchProducts(
  config: AppConfig,
  storefrontUrl?: string,
  opts?: ResearchProductFetchOptions
): Promise<{ products: ProductLink[]; warning?: string; truncated?: boolean }> {
  const hardLimit = opts?.hardLimit ?? RESEARCH_PRODUCT_INVENTORY_HARD_LIMIT;
  const incompleteBehavior = opts?.incompleteBehavior ?? "throw";
  const base = (storefrontUrl || config.STOREFRONT_URL).replace(/\/$/, "");
  const retrievedAt = new Date().toISOString();
  try {
    const products: ProductLink[] = [];
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const data: {
        products: {
          pageInfo: { hasNextPage: boolean; endCursor?: string | null };
          nodes: Array<{
            id: string;
            title: string;
            handle: string;
            status: string;
            description?: string | null;
            productType?: string | null;
            featuredImage?: { url: string; altText?: string | null } | null;
            totalInventory?: number | null;
            options?: Array<{ name: string; values: string[] }> | null;
          }>;
        };
      } = await graphql(config, `
        query ProductsForResearch($first: Int!, $after: String) {
          products(first: $first, after: $after, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id title handle status description productType totalInventory
              featuredImage { url altText }
              options { name values }
            }
          }
        }
      `, { first: 50, after: cursor });

      for (const p of data.products.nodes.filter(n => n.status === "ACTIVE")) {
        const optionSummary = (p.options || [])
          .map(o => `${o.name}: ${(o.values || []).slice(0, 12).join(", ")}`)
          .filter(Boolean);
        products.push({
          id: p.id,
          title: p.title,
          handle: p.handle,
          url: `${base}/products/${p.handle}`,
          imageUrl: p.featuredImage?.url ?? null,
          status: p.status,
          available: (p.totalInventory ?? 1) > 0,
          description: (p.description || "").trim(),
          productType: (p.productType || "").trim() || undefined,
          options: optionSummary,
          retrievedAt
        });
      }
      hasNext = Boolean(data.products.pageInfo.hasNextPage && data.products.pageInfo.endCursor);
      cursor = data.products.pageInfo.endCursor ?? null;
      try {
        assertShopifyInventoryComplete({
          kind: "products",
          loaded: products.length,
          hasNextPage: hasNext,
          hardLimit
        });
      } catch (error) {
        if (error instanceof IncompleteInventoryError && incompleteBehavior === "error_result") {
          return { products, truncated: true, warning: error.message };
        }
        throw error;
      }
    }
    return { products, truncated: false };
  } catch (error) {
    if (error instanceof IncompleteInventoryError) throw error;
    if (error instanceof ShopifyError && (error.code === "permission" || error.code === "auth")) {
      return {
        products: [],
        warning: "Product access is unavailable. Article generation will continue without product enrichment. Grant read_products and reconnect Shopify."
      };
    }
    throw error;
  }
}

export interface ShopifyBlogArticleRef {
  id: string;
  title: string;
  handle: string;
  blogHandle: string;
  isPublished: boolean;
  bodySummary: string;
  url: string | null;
}

export interface ResearchArticleFetchOptions {
  hardLimit?: number;
  incompleteBehavior?: "throw" | "error_result";
}

/** Paginate all articles from a Shopify blog for overlap/cannibalization checks. */
export async function listAllShopifyBlogArticles(
  config: AppConfig,
  args: { blogId: string; blogHandle: string; storefrontUrl: string },
  opts?: ResearchArticleFetchOptions
): Promise<{ articles: ShopifyBlogArticleRef[]; warning?: string; truncated?: boolean }> {
  const hardLimit = opts?.hardLimit ?? RESEARCH_ARTICLE_INVENTORY_HARD_LIMIT;
  const incompleteBehavior = opts?.incompleteBehavior ?? "throw";
  const base = normalizeStorefrontUrl(args.storefrontUrl);
  try {
    const articles: ShopifyBlogArticleRef[] = [];
    let cursor: string | null = null;
    let hasNext = true;
    while (hasNext) {
      const data: {
        blog: {
          articles: {
            pageInfo: { hasNextPage: boolean; endCursor?: string | null };
            nodes: Array<{
              id: string;
              title: string;
              handle: string;
              isPublished: boolean;
              body?: string | null;
            }>;
          };
        } | null;
      } = await graphql(config, `
        query BlogArticlesForResearch($blogId: ID!, $first: Int!, $after: String) {
          blog(id: $blogId) {
            articles(first: $first, after: $after) {
              pageInfo { hasNextPage endCursor }
              nodes { id title handle isPublished body }
            }
          }
        }
      `, { blogId: args.blogId, first: 50, after: cursor });

      const nodes = data.blog?.articles.nodes || [];
      for (const a of nodes) {
        const summary = (a.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
        articles.push({
          id: a.id,
          title: a.title,
          handle: a.handle,
          blogHandle: args.blogHandle,
          isPublished: a.isPublished,
          bodySummary: summary,
          url: a.handle ? `${base}/blogs/${args.blogHandle}/${a.handle}` : null
        });
      }
      hasNext = Boolean(data.blog?.articles.pageInfo.hasNextPage && data.blog.articles.pageInfo.endCursor);
      cursor = data.blog?.articles.pageInfo.endCursor ?? null;
      try {
        assertShopifyInventoryComplete({
          kind: "articles",
          loaded: articles.length,
          hasNextPage: hasNext,
          hardLimit
        });
      } catch (error) {
        if (error instanceof IncompleteInventoryError && incompleteBehavior === "error_result") {
          return { articles, truncated: true, warning: error.message };
        }
        throw error;
      }
    }
    return { articles, truncated: false };
  } catch (error) {
    if (error instanceof IncompleteInventoryError) throw error;
    if (error instanceof ShopifyError && (error.code === "permission" || error.code === "auth")) {
      return {
        articles: [],
        warning: "Shopify blog article access unavailable for overlap checks. Grant read_content."
      };
    }
    throw error;
  }
}

export async function searchProducts(config: AppConfig, query: string, storefrontUrl?: string): Promise<ProductLink[]> {
  const base = (storefrontUrl || config.STOREFRONT_URL).replace(/\/$/, "");
  const q = query.trim() ? `status:active ${query.trim()}` : "status:active";
  const data = await graphql<{
    products: { nodes: Array<{ id: string; title: string; handle: string; status: string; featuredImage?: { url: string } | null }> };
  }>(config, `
    query SearchProducts($first: Int!, $query: String!) {
      products(first: $first, query: $query, sortKey: RELEVANCE) {
        nodes { id title handle status featuredImage { url } }
      }
    }
  `, { first: 20, query: q });
  return data.products.nodes
    .filter(p => p.status === "ACTIVE")
    .map(p => ({
      id: p.id,
      title: p.title,
      handle: p.handle,
      url: `${base}/products/${p.handle}`,
      imageUrl: p.featuredImage?.url ?? null,
      status: p.status,
      available: true
    }));
}

/** Fields supported on Admin GraphQL Article (public store URL is built in app code). */
export const ARTICLE_GRAPHQL_FIELDS = `
  id
  handle
  title
  isPublished
  publishedAt
  blog {
    id
    handle
  }
`.trim();

export const ARTICLE_CREATE_MUTATION = `
  mutation CreateAutopilotArticle($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        ${ARTICLE_GRAPHQL_FIELDS}
      }
      userErrors { field message code }
    }
  }
`;

export function normalizeStorefrontUrl(storefrontUrl: string): string {
  return String(storefrontUrl || "").trim().replace(/\/+$/, "");
}

/**
 * Build the customer-facing article URL from storefront + blog/article handles.
 * Returns null when handles are missing — publication can still succeed with Shopify ID only.
 * Never uses the permanent .myshopify.com admin domain as the public URL.
 */
export function buildPublicArticleUrl(args: {
  storefrontUrl: string;
  blogHandle?: string | null;
  articleHandle?: string | null;
}): string | null {
  const base = normalizeStorefrontUrl(args.storefrontUrl);
  const blogHandle = String(args.blogHandle || "").trim().replace(/^\/+|\/+$/g, "");
  const articleHandle = String(args.articleHandle || "").trim().replace(/^\/+|\/+$/g, "");
  if (!base || !blogHandle || !articleHandle) return null;
  return `${base}/blogs/${blogHandle}/${articleHandle}`;
}

export type PublishedArticleResult = {
  id: string;
  handle: string | null;
  title: string | null;
  isPublished: boolean | null;
  publishedAt: string | null;
  url: string | null;
  blogId: string | null;
  blogHandle: string | null;
  responseStatus: string;
  idempotencyKey?: string;
};

export type ShopifyCreatedArticle = {
  id: string;
  handle?: string | null;
  title?: string | null;
  isPublished?: boolean | null;
  publishedAt?: string | null;
  blog?: { id?: string | null; handle?: string | null } | null;
};

/**
 * Map a successful articleCreate payload into the app publish result.
 * Uses only Shopify-returned handles for public URL construction — no local fallbacks.
 */
export function mapArticleCreateResult(args: {
  created: ShopifyCreatedArticle;
  storefrontUrl: string;
  fallbackTitle?: string | null;
  fallbackBlogId?: string | null;
  idempotencyKey?: string;
}): PublishedArticleResult {
  const created = args.created;
  if (!created.id) throw new ShopifyError("Shopify did not create the article", "unknown", false);

  const blogHandle = created.blog?.handle ?? null;
  const articleHandle = created.handle ?? null;
  const url = buildPublicArticleUrl({
    storefrontUrl: args.storefrontUrl,
    blogHandle,
    articleHandle
  });

  return {
    id: created.id,
    handle: articleHandle,
    title: created.title ?? args.fallbackTitle ?? null,
    isPublished: created.isPublished ?? null,
    publishedAt: created.publishedAt ?? null,
    url,
    blogId: created.blog?.id ?? args.fallbackBlogId ?? null,
    blogHandle,
    responseStatus: "created",
    idempotencyKey: args.idempotencyKey
  };
}

export async function publishArticle(
  config: AppConfig,
  article: GeneratedArticle,
  authorName: string,
  settings: Settings,
  opts?: { imageUrl?: string | null; imageAlt?: string | null; isPublished?: boolean; publishDate?: string | null; idempotencyKey?: string }
): Promise<PublishedArticleResult> {
  const blog = await resolveBlog(config, settings);
  const articleInput: Record<string, unknown> = {
    blogId: blog.id,
    title: article.title,
    author: { name: authorName },
    handle: article.handle,
    body: article.bodyHtml,
    summary: article.summary,
    isPublished: opts?.isPublished ?? !settings.draftOnlyMode,
    tags: article.tags,
    metafields: [
      {
        namespace: "global",
        key: "description_tag",
        type: "single_line_text_field",
        value: article.metaDescription.slice(0, 160)
      },
      {
        namespace: "global",
        key: "title_tag",
        type: "single_line_text_field",
        value: (article.title || "").slice(0, 70)
      }
    ]
  };

  if (opts?.publishDate) articleInput.publishDate = opts.publishDate;
  if (opts?.imageUrl) {
    articleInput.image = {
      url: opts.imageUrl,
      altText: opts.imageAlt || article.title
    };
  }

  const data = await graphql<{
    articleCreate: {
      article: null | ShopifyCreatedArticle;
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  }>(config, ARTICLE_CREATE_MUTATION, { article: articleInput });

  if (data.articleCreate.userErrors.length) {
    const msg = data.articleCreate.userErrors.map(e => {
      const field = e.field?.length ? `${e.field.join(".")}: ` : "";
      return `${field}${e.message}`;
    }).join("; ");
    const permanent = data.articleCreate.userErrors.some(e => /taken|invalid|blank|too long|permission/i.test(e.message));
    throw new ShopifyError(
      `Shopify rejected article (userErrors): ${msg}`,
      permanent ? "validation" : "unknown",
      !permanent
    );
  }
  if (!data.articleCreate.article?.id) {
    throw new ShopifyError("Shopify did not create the article", "unknown", false);
  }

  return mapArticleCreateResult({
    created: data.articleCreate.article,
    storefrontUrl: settings.storefrontUrl || config.STOREFRONT_URL,
    fallbackTitle: article.title,
    fallbackBlogId: blog.id,
    idempotencyKey: opts?.idempotencyKey
  });
}

export async function verifyShopify(config: AppConfig, settings?: Settings) {
  const [{ token, scope }, shopData, blogs] = await Promise.all([
    getAccessToken(config, true),
    graphql<{ shop: { name: string; primaryDomain?: { url?: string } | null; myshopifyDomain?: string } }>(
      config,
      `query VerifyShop { shop { name myshopifyDomain primaryDomain { url } } }`,
      {}
    ),
    listBlogs(config)
  ]);

  void token;
  const granted = new Set((scope || "").split(",").map(s => s.trim()).filter(Boolean));
  const missingScopes = REQUIRED_SCOPES.filter(s => granted.size > 0 && !granted.has(s));
  const selected = settings
    ? await resolveBlog(config, settings).catch(() => null)
    : blogs.find(b => b.handle === "news") || blogs[0] || null;

  let productsOk = false;
  let productsWarning: string | undefined;
  try {
    const { products, warning } = await getProductLinks(config, settings?.storefrontUrl);
    productsOk = products.length > 0 || !warning;
    productsWarning = warning;
  } catch (error) {
    productsWarning = error instanceof Error ? error.message : String(error);
  }

  return {
    ok: missingScopes.length === 0 && Boolean(selected),
    shop: shopData.shop.name,
    myshopifyDomain: shopData.shop.myshopifyDomain || config.SHOPIFY_SHOP,
    primaryDomain: shopData.shop.primaryDomain?.url ?? null,
    scopesGranted: [...granted],
    scopesRequired: [...REQUIRED_SCOPES],
    missingScopes,
    blogs,
    selectedBlog: selected,
    productsOk,
    productsWarning,
    nextAction: missingScopes.length
      ? `Update the Shopify app scopes to include: ${missingScopes.join(", ")}, then reinstall/reconnect.`
      : !selected
        ? "Create a News blog in Online Store > Blog posts, or select a blog in Settings."
        : productsWarning
          ? productsWarning
          : "Shopify connection looks healthy."
  };
}

export function safeShopifyErrorMessage(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return String(redactSecrets(msg));
}

export { REQUIRED_SCOPES };
