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

export async function getProductLinks(config: AppConfig, storefrontUrl?: string): Promise<{ products: ProductLink[]; warning?: string }> {
  const base = (storefrontUrl || config.STOREFRONT_URL).replace(/\/$/, "");
  try {
    const data = await graphql<{
      products: {
        nodes: Array<{
          id: string;
          title: string;
          handle: string;
          status: string;
          featuredImage?: { url: string; altText?: string | null } | null;
          totalInventory?: number | null;
        }>;
      };
    }>(config, `
      query ProductsForBlog($first: Int!) {
        products(first: $first, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id title handle status totalInventory
            featuredImage { url altText }
          }
        }
      }
    `, { first: 50 });

    const products = data.products.nodes
      .filter(p => p.status === "ACTIVE")
      .map(p => ({
        id: p.id,
        title: p.title,
        handle: p.handle,
        url: `${base}/products/${p.handle}`,
        imageUrl: p.featuredImage?.url ?? null,
        status: p.status,
        available: (p.totalInventory ?? 1) > 0
      }));
    return { products };
  } catch (error) {
    if (error instanceof ShopifyError && (error.code === "permission" || error.code === "auth")) {
      return {
        products: [],
        warning: "Product access is unavailable. Article generation will continue without product enrichment. Grant read_products and reconnect Shopify."
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

export const IDEMPOTENCY_NAMESPACE = "legends_blog_autopilot";
export const IDEMPOTENCY_KEY = "idempotency_key";

export const ARTICLE_CREATE_MUTATION = `
  mutation CreateAutopilotArticle($article: ArticleCreateInput!) {
    articleCreate(article: $article) {
      article {
        ${ARTICLE_GRAPHQL_FIELDS}
        metafield(namespace: "${IDEMPOTENCY_NAMESPACE}", key: "${IDEMPOTENCY_KEY}") { value }
      }
      userErrors { field message code }
    }
  }
`;

export const ARTICLE_UPDATE_MUTATION = `
  mutation UpdateAutopilotArticle($id: ID!, $article: ArticleUpdateInput!) {
    articleUpdate(id: $id, article: $article) {
      article {
        ${ARTICLE_GRAPHQL_FIELDS}
        metafield(namespace: "${IDEMPOTENCY_NAMESPACE}", key: "${IDEMPOTENCY_KEY}") { value }
      }
      userErrors { field message code }
    }
  }
`;

export const FIND_ARTICLES_QUERY = `
  query FindAutopilotArticles($first: Int!, $query: String!) {
    articles(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ${ARTICLE_GRAPHQL_FIELDS}
        metafield(namespace: "${IDEMPOTENCY_NAMESPACE}", key: "${IDEMPOTENCY_KEY}") { value }
      }
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

export function shopifyGidNumericId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const match = String(gid).match(/\/(\d+)\s*$/);
  return match?.[1] ?? null;
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
  metafield?: { value?: string | null } | null;
};

export type FoundShopifyArticle = ShopifyCreatedArticle & {
  idempotencyKey: string | null;
  url: string | null;
};

/**
 * Map a successful articleCreate/update payload into the app publish result.
 * Uses only Shopify-returned handles for public URL construction — no local fallbacks.
 */
export function mapArticleCreateResult(args: {
  created: ShopifyCreatedArticle;
  storefrontUrl: string;
  fallbackTitle?: string | null;
  fallbackBlogId?: string | null;
  idempotencyKey?: string;
  responseStatus?: string;
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
    responseStatus: args.responseStatus ?? "created",
    idempotencyKey: args.idempotencyKey ?? created.metafield?.value ?? undefined
  };
}

function seoMetafields(article: GeneratedArticle, idempotencyKey?: string) {
  const fields: Array<Record<string, string>> = [
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
  ];
  if (idempotencyKey) {
    fields.push({
      namespace: IDEMPOTENCY_NAMESPACE,
      key: IDEMPOTENCY_KEY,
      type: "single_line_text_field",
      value: idempotencyKey.slice(0, 255)
    });
  }
  return fields;
}

function toFoundArticle(node: ShopifyCreatedArticle, storefrontUrl: string): FoundShopifyArticle {
  const mapped = mapArticleCreateResult({ created: node, storefrontUrl, responseStatus: "found" });
  return {
    ...node,
    idempotencyKey: node.metafield?.value ?? null,
    url: mapped.url
  };
}

/** Find an article in the selected blog by exact handle. Never auto-adopts. */
export async function findArticleByHandle(
  config: AppConfig,
  blogId: string,
  handle: string,
  storefrontUrl: string
): Promise<FoundShopifyArticle | null> {
  const numericBlogId = shopifyGidNumericId(blogId);
  const exactHandle = String(handle || "").trim();
  if (!numericBlogId || !exactHandle) return null;

  const data = await graphql<{ articles: { nodes: ShopifyCreatedArticle[] } }>(
    config,
    FIND_ARTICLES_QUERY,
    { first: 10, query: `handle:${exactHandle} blog_id:${numericBlogId}` }
  );

  const match = data.articles.nodes.find(
    node => node.handle === exactHandle && (node.blog?.id === blogId || shopifyGidNumericId(node.blog?.id) === numericBlogId)
  );
  return match ? toFoundArticle(match, storefrontUrl) : null;
}

/** Find an article previously created by this app using the idempotency metafield. */
export async function findArticleByIdempotencyKey(
  config: AppConfig,
  blogId: string,
  idempotencyKey: string,
  storefrontUrl: string
): Promise<FoundShopifyArticle | null> {
  const numericBlogId = shopifyGidNumericId(blogId);
  const key = String(idempotencyKey || "").trim();
  if (!numericBlogId || !key) return null;

  const data = await graphql<{ articles: { nodes: ShopifyCreatedArticle[] } }>(
    config,
    FIND_ARTICLES_QUERY,
    { first: 50, query: `blog_id:${numericBlogId}` }
  );

  const match = data.articles.nodes.find(node => node.metafield?.value === key);
  return match ? toFoundArticle(match, storefrontUrl) : null;
}

async function updateShopifyArticle(
  config: AppConfig,
  shopifyArticleId: string,
  article: GeneratedArticle,
  authorName: string,
  settings: Settings,
  opts?: { imageUrl?: string | null; imageAlt?: string | null; isPublished?: boolean; publishDate?: string | null; idempotencyKey?: string; responseStatus?: string }
): Promise<PublishedArticleResult> {
  const articleInput: Record<string, unknown> = {
    title: article.title,
    author: { name: authorName },
    handle: article.handle,
    body: article.bodyHtml,
    summary: article.summary,
    isPublished: opts?.isPublished ?? !settings.draftOnlyMode,
    tags: article.tags,
    metafields: seoMetafields(article, opts?.idempotencyKey)
  };
  if (opts?.publishDate) articleInput.publishDate = opts.publishDate;
  if (opts?.imageUrl) {
    articleInput.image = { url: opts.imageUrl, altText: opts.imageAlt || article.title };
  }

  const data = await graphql<{
    articleUpdate: {
      article: null | ShopifyCreatedArticle;
      userErrors: Array<{ field?: string[]; message: string; code?: string }>;
    };
  }>(config, ARTICLE_UPDATE_MUTATION, { id: shopifyArticleId, article: articleInput });

  if (data.articleUpdate.userErrors.length) {
    const msg = data.articleUpdate.userErrors.map(e => {
      const field = e.field?.length ? `${e.field.join(".")}: ` : "";
      return `${field}${e.message}`;
    }).join("; ");
    const permanent = data.articleUpdate.userErrors.some(e => /taken|invalid|blank|too long|permission/i.test(e.message));
    throw new ShopifyError(
      `Shopify rejected article update (userErrors): ${msg}`,
      permanent ? "validation" : "unknown",
      !permanent
    );
  }
  if (!data.articleUpdate.article?.id) {
    throw new ShopifyError("Shopify did not update the article", "unknown", false);
  }

  return mapArticleCreateResult({
    created: data.articleUpdate.article,
    storefrontUrl: settings.storefrontUrl || config.STOREFRONT_URL,
    fallbackTitle: article.title,
    idempotencyKey: opts?.idempotencyKey,
    responseStatus: opts?.responseStatus ?? "updated"
  });
}

/** Pure decision helper for publish/create/recover — used by publishArticle and tests. */
export function choosePublishStrategy(args: {
  shopifyArticleId?: string | null;
  recoveredByKey?: { id: string } | null;
  byHandle?: { id: string; idempotencyKey?: string | null } | null;
  idempotencyKey?: string | null;
}): "update" | "recover" | "create" | "collision" {
  if (args.shopifyArticleId) return "update";
  if (args.recoveredByKey) return "recover";
  if (args.byHandle) {
    if (args.idempotencyKey && args.byHandle.idempotencyKey === args.idempotencyKey) return "recover";
    return "collision";
  }
  return "create";
}

export async function publishArticle(
  config: AppConfig,
  article: GeneratedArticle,
  authorName: string,
  settings: Settings,
  opts?: {
    imageUrl?: string | null;
    imageAlt?: string | null;
    isPublished?: boolean;
    publishDate?: string | null;
    idempotencyKey?: string;
    shopifyArticleId?: string | null;
  }
): Promise<PublishedArticleResult> {
  const blog = await resolveBlog(config, settings);
  const storefrontUrl = settings.storefrontUrl || config.STOREFRONT_URL;
  const key = opts?.idempotencyKey;

  // Linked articles always update — never create a duplicate.
  if (opts?.shopifyArticleId) {
    return updateShopifyArticle(config, opts.shopifyArticleId, article, authorName, settings, {
      ...opts,
      responseStatus: "updated"
    });
  }

  // Before create: recover via idempotency marker / matching handle marker.
  const recoveredByKey = key
    ? await findArticleByIdempotencyKey(config, blog.id, key, storefrontUrl)
    : null;
  const byHandle = await findArticleByHandle(config, blog.id, article.handle, storefrontUrl);
  const strategy = choosePublishStrategy({
    shopifyArticleId: null,
    recoveredByKey,
    byHandle,
    idempotencyKey: key
  });

  if (strategy === "recover") {
    const targetId = recoveredByKey?.id || byHandle!.id;
    return updateShopifyArticle(config, targetId, article, authorName, settings, {
      ...opts,
      responseStatus: "recovered"
    });
  }

  if (strategy === "collision" && byHandle) {
    throw new ShopifyError(
      `An article with handle "${article.handle}" already exists in Shopify (${byHandle.id}). Use “Link existing Shopify article” to adopt it intentionally — Autopilot will not overwrite it automatically.`,
      "validation",
      false
    );
  }

  const articleInput: Record<string, unknown> = {
    blogId: blog.id,
    title: article.title,
    author: { name: authorName },
    handle: article.handle,
    body: article.bodyHtml,
    summary: article.summary,
    isPublished: opts?.isPublished ?? !settings.draftOnlyMode,
    tags: article.tags,
    metafields: seoMetafields(article, key)
  };

  if (opts?.publishDate) articleInput.publishDate = opts.publishDate;
  if (opts?.imageUrl) {
    articleInput.image = {
      url: opts.imageUrl,
      altText: opts.imageAlt || article.title
    };
  }

  try {
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
      const handleTaken = data.articleCreate.userErrors.some(e => /taken|already been taken|handle/i.test(e.message));
      if (handleTaken && key) {
        const recovered = await recoverAfterCreateFailure(config, blog.id, article.handle, key, storefrontUrl);
        if (recovered) {
          return updateShopifyArticle(config, recovered.id, article, authorName, settings, {
            ...opts,
            responseStatus: "recovered"
          });
        }
      }
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
      storefrontUrl,
      fallbackTitle: article.title,
      fallbackBlogId: blog.id,
      idempotencyKey: key,
      responseStatus: "created"
    });
  } catch (error) {
    // Ambiguous network/server failure after a possible successful create: recover via marker.
    if (key && error instanceof ShopifyError && (error.retryable || error.code === "network" || error.code === "server")) {
      const recovered = await recoverAfterCreateFailure(config, blog.id, article.handle, key, storefrontUrl);
      if (recovered) {
        return updateShopifyArticle(config, recovered.id, article, authorName, settings, {
          ...opts,
          responseStatus: "recovered"
        });
      }
    }
    throw error;
  }
}

async function recoverAfterCreateFailure(
  config: AppConfig,
  blogId: string,
  handle: string,
  idempotencyKey: string,
  storefrontUrl: string
): Promise<FoundShopifyArticle | null> {
  const byKey = await findArticleByIdempotencyKey(config, blogId, idempotencyKey, storefrontUrl);
  if (byKey) return byKey;
  const byHandle = await findArticleByHandle(config, blogId, handle, storefrontUrl);
  if (byHandle && byHandle.idempotencyKey === idempotencyKey) return byHandle;
  return null;
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
