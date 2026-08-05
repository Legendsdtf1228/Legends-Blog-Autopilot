import type { AppConfig } from "./config.js";
import type { GeneratedArticle, ProductLink } from "./types.js";

type GraphqlResponse<T> = { data?: T; errors?: Array<{message: string}> };

async function graphql<T>(config: AppConfig, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://${config.SHOPIFY_SHOP}/admin/api/${config.SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": config.SHOPIFY_ADMIN_ACCESS_TOKEN },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`Shopify HTTP ${response.status}: ${await response.text()}`);
  const json = await response.json() as GraphqlResponse<T>;
  if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors.map(e => e.message).join("; ")}`);
  if (!json.data) throw new Error("Shopify returned no data");
  return json.data;
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
  const data = await graphql<{articleCreate: {article: null | {id: string; handle: string; onlineStoreUrl?: string}; userErrors: Array<{field?: string[]; message: string; code?: string}>}}>(config, `
    mutation CreateAutopilotArticle($article: ArticleCreateInput!) {
      articleCreate(article: $article) {
        article { id handle onlineStoreUrl }
        userErrors { field message code }
      }
    }
  `, {
    article: {
      blogId: config.SHOPIFY_BLOG_ID,
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
  const data = await graphql<{shop: {name: string}; blog: null | {title: string}}>(config, `query Verify($id: ID!) { shop { name } blog(id: $id) { title } }`, { id: config.SHOPIFY_BLOG_ID });
  if (!data.blog) throw new Error("SHOPIFY_BLOG_ID was not found or cannot be accessed");
  return { shop: data.shop.name, blog: data.blog.title };
}
