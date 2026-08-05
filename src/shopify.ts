import type { AppConfig } from "./config.js";
import type { GeneratedArticle, ProductLink } from "./types.js";

type GraphqlResponse<T> = { data?: T; errors?: Array<{message: string}> };

type CachedToken = { value: string; expiresAt: number };
const tokenCache = new Map<string, CachedToken>();
const blogCache = new Map<string, string>();

async function getAccessToken(config: AppConfig, forceRefresh = false): Promise<string> {
  const cached = tokenCache.get(config.SHOPIFY_SHOP);
  if (!forceRefresh && cached && cached.expiresAt > Date.now() + 60_000) return cached.value;

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
  if (!response.ok) throw new Error(`Shopify authentication failed (${response.status}): ${await response.text()}`);
  const json = await response.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Shopify authentication returned no access token");
  tokenCache.set(config.SHOPIFY_SHOP, {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 86_399) * 1000
  });
  return json.access_token;
}

async function graphql<T>(config: AppConfig, query: string, variables: Record<string, unknown>, retryAuth = true): Promise<T> {
  const token = await getAccessToken(config);
  const response = await fetch(`https://${config.SHOPIFY_SHOP}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 401 && retryAuth) {
    await getAccessToken(config, true);
    return graphql<T>(config, query, variables, false);
  }
  if (!response.ok) throw new Error(`Shopify HTTP ${response.status}: ${await response.text()}`);
  const json = await response.json() as GraphqlResponse<T>;
  if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors.map(e => e.message).join("; ")}`);
  if (!json.data) throw new Error("Shopify returned no data");
  return json.data;
}

async function getBlog(config: AppConfig): Promise<{id: string; title: string; handle: string}> {
  const cachedId = blogCache.get(config.SHOPIFY_SHOP);
  const data = await graphql<{blogs: {nodes: Array<{id: string; title: string; handle: string}>}}>(config, `
    query AutopilotBlogs($first: Int!) {
      blogs(first: $first) { nodes { id title handle } }
    }
  `, { first: 20 });
  const blog = (cachedId && data.blogs.nodes.find(item => item.id === cachedId))
    || data.blogs.nodes.find(item => item.handle === "news")
    || data.blogs.nodes[0];
  if (!blog) throw new Error("No Shopify blog was found. Create a blog under Online Store > Blog posts first.");
  blogCache.set(config.SHOPIFY_SHOP, blog.id);
  return blog;
}

export async function getProductLinks(config: AppConfig): Promise<ProductLink[]> {
  const data = await graphql<{products: {nodes: Array<{title: string; handle: string; status: string}>}}>(config, `
    query ProductsForBlog($first: Int!) {
      products(first: $first, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
        nodes { title handle status }
      }
    }
  `, { first: 40 });
  return data.products.nodes.map(p => ({ title: p.title, url: `${config.STOREFRONT_URL.replace(/\/$/, "")}/products/${p.handle}` }));
}

export async function publishArticle(config: AppConfig, article: GeneratedArticle, authorName: string) {
  const blog = await getBlog(config);
  const data = await graphql<{articleCreate: {article: null | {id: string; handle: string; onlineStoreUrl?: string}; userErrors: Array<{field?: string[]; message: string; code?: string}>}}>(config, `
    mutation CreateAutopilotArticle($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id handle onlineStoreUrl }
        userErrors { field message code }
      }
    }
  `, {
    article: {
      blogId: blog.id,
      title: article.title,
      author: { name: authorName },
      handle: article.handle,
      body: article.bodyHtml,
      summary: article.summary,
      isPublished: true,
      tags: article.tags,
      metafields: [{
        namespace: "global",
        key: "description_tag",
        type: "single_line_text_field",
        value: article.metaDescription
      }]
    }
  });
  if (data.articleCreate.userErrors.length) throw new Error(`Shopify rejected article: ${data.articleCreate.userErrors.map(e => e.message).join("; ")}`);
  if (!data.articleCreate.article) throw new Error("Shopify did not create the article");
  const created = data.articleCreate.article;
  return { id: created.id, url: created.onlineStoreUrl ?? `${config.STOREFRONT_URL.replace(/\/$/, "")}/blogs/news/${created.handle}` };
}

export async function verifyShopify(config: AppConfig): Promise<{shop: string; blog: string}> {
  const [data, blog] = await Promise.all([
    graphql<{shop: {name: string}}>(config, `query VerifyShop { shop { name } }`, {}),
    getBlog(config)
  ]);
  return { shop: data.shop.name, blog: blog.title };
}
