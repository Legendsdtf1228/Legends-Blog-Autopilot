import express from "express";
import path from "node:path";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";
import { DateTime } from "luxon";
import { z } from "zod";
import { loadConfig, redactSecrets } from "./config.js";
import {
  cancelScheduledArticle,
  createArticle,
  createDb,
  duplicateArticle,
  getArticle,
  getOverviewStats,
  getSettings,
  insertManualJob,
  linkArticleToShopify,
  listArticles,
  listAudit,
  listJobs,
  migrate,
  recentTopicContext,
  recordAudit,
  saveSettings,
  scheduleArticleJob,
  updateArticle
} from "./db.js";
import { AutopilotWorker } from "./scheduler.js";
import {
  findArticleByHandle,
  getProductLinks,
  listBlogs,
  publishArticle,
  resolveBlog,
  searchProducts,
  verifyShopify,
  safeShopifyErrorMessage
} from "./shopify.js";
import { diagnoseOpenAI, generateArticle } from "./writer.js";
import { fromGenerated, normalizeArticle, toGenerated, validateArticle } from "./content.js";
import { mergeSettings } from "./defaults.js";
import {
  clearSessionCookie,
  createAuthMiddleware,
  createDbSession,
  csrfTokenFromSession,
  destroyDbSession,
  parseCookies,
  setSessionCookie,
  verifyCsrf,
  verifyShopifySessionToken,
  type AuthedRequest
} from "./auth.js";
import {
  articleEditorPage,
  articlesListPage,
  diagnosticsPage,
  layout,
  linkShopifyPage,
  loginPage,
  newArticlePage,
  overviewPage,
  settingsPage,
  esc
} from "./views.js";
import type { ArticleContent, GenerationSettings, Settings } from "./types.js";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrate(db);
const worker = new AutopilotWorker(db, config);
worker.start();

const app = express();
app.disable("x-powered-by");
if (config.TRUST_PROXY) app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", "https://cdn.shopify.com", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      "img-src": ["'self'", "data:", "https:"],
      "connect-src": ["'self'", "https://cdn.shopify.com"],
      "frame-ancestors": ["https://admin.shopify.com", "https://*.myshopify.com", "'self'"],
      "base-uri": ["'self'"]
    }
  },
  // Allow embedding in Shopify Admin
  frameguard: false,
  crossOriginEmbedderPolicy: false
}));

app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://cdn.shopify.com 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://cdn.shopify.com",
    "frame-ancestors https://admin.shopify.com https://*.myshopify.com 'self'",
    "base-uri 'self'"
  ].join("; "));
  next();
});

app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use("/assets", express.static(path.join(process.cwd(), "public/assets"), { maxAge: "1h" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error("Only PNG, JPEG, WebP, or GIF images are allowed"));
    }
    cb(null, true);
  }
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

function actor(req: AuthedRequest): string {
  return req.auth?.user || "unknown";
}

function isEmbedded(req: express.Request): boolean {
  return Boolean(req.query.embedded || req.query.shop || req.headers["sec-fetch-dest"] === "iframe");
}

function csrfKey(req: AuthedRequest): string {
  const sid = parseCookies(req.headers.cookie).lba_session;
  if (sid) return sid;
  if (req.auth?.mode === "basic") return `basic:${req.auth.user}`;
  if (req.auth?.mode === "shopify_session_token") return `shopify:${req.auth.shop || req.auth.user}`;
  return "anonymous";
}

function getCsrf(req: AuthedRequest): string {
  return csrfTokenFromSession(csrfKey(req), config.SESSION_SECRET);
}

function requireCsrf(req: AuthedRequest, res: express.Response): boolean {
  // Bearer Shopify session-token requests are CSRF-resistant (custom header)
  if (req.auth?.mode === "shopify_session_token") return true;
  if (req.headers.authorization?.startsWith("Bearer ")) return true;
  const token = String(req.body?._csrf || req.headers["x-csrf-token"] || "");
  if (verifyCsrf(csrfKey(req), token, config.SESSION_SECRET)) return true;
  res.status(403).send(layout({
    active: "/",
    config,
    content: `<section class="card"><div class="notice error">Invalid CSRF token. Reload the page and try again.</div><a href="/">Back</a></section>`
  }));
  return false;
}

function parseTags(value: unknown): string[] {
  return String(value ?? "").split(",").map(s => s.trim()).filter(Boolean);
}

function bodyToContent(body: Record<string, unknown>, settings: Settings): Partial<ArticleContent> {
  return {
    title: String(body.title ?? ""),
    handle: String(body.handle ?? ""),
    excerpt: String(body.excerpt ?? ""),
    metaTitle: String(body.metaTitle ?? body.title ?? ""),
    metaDescription: String(body.metaDescription ?? ""),
    bodyHtml: String(body.bodyHtml ?? ""),
    tags: parseTags(body.tags),
    author: String(body.author ?? settings.authorName),
    featuredImageUrl: String(body.featuredImageUrl ?? "") || null,
    featuredImageAlt: String(body.featuredImageAlt ?? "") || null,
    primaryKeyword: String(body.primaryKeyword ?? ""),
    secondaryKeywords: parseTags(body.secondaryKeywords),
    topicFingerprint: String(body.topicFingerprint ?? ""),
    rationale: String(body.rationale ?? "")
  };
}

function localToUtc(local: string, timezone: string): Date | null {
  if (!local) return null;
  const dt = DateTime.fromISO(local, { zone: timezone });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

// ---- Public health ----
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "legends-blog-autopilot", ts: new Date().toISOString() });
});

app.get("/ready", async (_req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, database: true });
  } catch (error) {
    res.status(503).json({ ok: false, database: false, error: "database unavailable" });
  }
});

// ---- Login (standalone) ----
app.get("/login", (req, res) => {
  res.send(loginPage(config, { next: String(req.query.next || "/"), error: req.query.error ? String(req.query.error) : undefined }));
});

app.post("/login", loginLimiter, async (req, res) => {
  const username = String(req.body.username || "");
  const password = String(req.body.password || "");
  const next = String(req.body.next || "/");
  if (username === config.ADMIN_USERNAME && password === config.ADMIN_PASSWORD) {
    const sid = await createDbSession(db, { user: username, mode: "session" });
    setSessionCookie(res, config, sid, false);
    await recordAudit(db, { actor: username, action: "login_standalone", detail: {} });
    return res.redirect(next.startsWith("/") ? next : "/");
  }
  return res.redirect(`/login?error=${encodeURIComponent("Invalid username or password")}&next=${encodeURIComponent(next)}`);
});

app.post("/api/auth/session-token", apiLimiter, async (req, res) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const verified = await verifyShopifySessionToken(token, config);
    const sid = await createDbSession(db, {
      user: verified.sub || "shopify-user",
      mode: "shopify_session_token",
      shop: verified.shop
    });
    setSessionCookie(res, config, sid, true);
    await recordAudit(db, { actor: verified.sub || "shopify-user", action: "login_shopify_session_token", detail: { shop: verified.shop } });
    res.json({ ok: true, shop: verified.shop });
  } catch (error) {
    res.setHeader("X-Shopify-Retry-Invalid-Session-Request", "1");
    res.status(401).json({ ok: false, error: "Invalid Shopify session token" });
  }
});

app.get("/logout", async (req, res) => {
  const sid = parseCookies(req.headers.cookie).lba_session;
  if (sid) await destroyDbSession(db, sid);
  clearSessionCookie(res, config);
  res.redirect("/login");
});

const requireAuth = createAuthMiddleware(config, db);

app.use(apiLimiter);
app.use(requireAuth);

// ---- Overview ----
app.get("/", async (req: AuthedRequest, res) => {
  const [settings, stats] = await Promise.all([getSettings(db), getOverviewStats(db)]);
  let shopifyOk: boolean | undefined;
  let openaiOk: boolean | undefined;
  let shopName: string | undefined;
  let blogName: string | undefined;
  try {
    const v = await verifyShopify(config, settings);
    shopifyOk = v.ok;
    shopName = v.shop;
    blogName = v.selectedBlog?.title;
  } catch {
    shopifyOk = false;
  }
  try {
    const o = await diagnoseOpenAI(config.OPENAI_API_KEY, settings.openaiModel || config.OPENAI_MODEL);
    openaiOk = o.ok;
  } catch {
    openaiOk = false;
  }

  res.send(layout({
    active: "/",
    config,
    embedded: isEmbedded(req),
    csrf: getCsrf(req),
    notice: req.query.notice ? String(req.query.notice) : undefined,
    error: req.query.error ? String(req.query.error) : undefined,
    content: overviewPage({ settings, stats, shopifyOk, openaiOk, shopName, blogName, csrf: getCsrf(req) })
  }));
});

app.post("/autopilot/pause", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const settings = await getSettings(db);
  settings.enabled = false;
  await saveSettings(db, settings);
  worker.emergencyPause(true);
  await recordAudit(db, { actor: actor(req), action: "emergency_pause" });
  res.redirect("/?notice=" + encodeURIComponent("Autopilot paused."));
});

// ---- Articles ----
app.get("/articles", async (req: AuthedRequest, res) => {
  const settings = await getSettings(db);
  const q = String(req.query.q || "");
  const status = String(req.query.status || "all");
  const page = Number(req.query.page || 1);
  const result = await listArticles(db, {
    q,
    status: status as never,
    page,
    pageSize: 20,
    sort: "updated"
  });
  res.send(layout({
    active: "/articles",
    config,
    embedded: isEmbedded(req),
    csrf: getCsrf(req),
    notice: req.query.notice ? String(req.query.notice) : undefined,
    error: req.query.error ? String(req.query.error) : undefined,
    content: articlesListPage({
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      q,
      status,
      timezone: settings.timezone
    })
  }));
});

app.get("/articles/new", async (req: AuthedRequest, res) => {
  const settings = await getSettings(db);
  const { warning } = await getProductLinks(config, settings.storefrontUrl).catch(() => ({ products: [], warning: "Product lookup failed." }));
  res.send(layout({
    active: "/articles/new",
    config,
    embedded: isEmbedded(req),
    csrf: getCsrf(req),
    content: newArticlePage({ settings, csrf: getCsrf(req), productsWarning: warning })
  }));
});

app.post("/articles", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const settings = await getSettings(db);
  const raw = bodyToContent(req.body, settings);
  const normalized = normalizeArticle(raw, { author: settings.authorName });
  const intent = String(req.body.intent || "save");
  const requireReady = intent === "ready";
  const validated = validateArticle(normalized.content, { settings, requireReady });
  if (!validated.ok || !validated.content) {
    return res.status(400).send(layout({
      active: "/articles/new",
      config,
      error: "Please fix the highlighted fields.",
      content: articleEditorPage({
        article: {
          ...normalized.content,
          id: 0,
          status: "draft",
          scheduledFor: null,
          publishedAt: null,
          shopifyBlogId: null,
          shopifyArticleId: null,
          shopifyHandle: null,
          shopifyUrl: null,
          shopifyResponseStatus: null,
          generationError: null,
          lastError: null,
          idempotencyKey: null,
          source: "manual",
          merchantEdited: true,
          merchantEditedFields: [],
          generationSettings: null,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        settings,
        mode: "new",
        fieldErrors: validated.errors,
        csrf: getCsrf(req)
      })
    }));
  }
  const article = await createArticle(db, validated.content, {
    status: requireReady ? "ready" : "draft",
    source: "manual"
  });
  await recordAudit(db, { actor: actor(req), action: "article_created", articleId: article.id });
  res.redirect(`/articles/${article.id}?notice=${encodeURIComponent("Draft saved.")}`);
});

app.post("/articles/generate", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const settings = await getSettings(db);
  const generation: GenerationSettings = {
    topic: String(req.body.topic || ""),
    articleType: String(req.body.articleType || "educational guide"),
    primaryKeyword: String(req.body.primaryKeyword || settings.primaryKeywordDefault),
    secondaryKeywords: parseTags(req.body.secondaryKeywords),
    desiredLength: (String(req.body.desiredLength || "medium") as GenerationSettings["desiredLength"]),
    callToAction: String(req.body.callToAction || settings.defaultCta),
    internalLinking: Boolean(req.body.internalLinking),
    draftOnly: Boolean(req.body.draftOnly) || settings.draftOnlyMode,
    brandVoice: settings.brandVoice,
    targetAudience: settings.targetAudience
  };

  const placeholder = await createArticle(db, {
    title: generation.topic || "Generating…",
    handle: "generating",
    author: settings.authorName,
    primaryKeyword: generation.primaryKeyword || "",
    excerpt: "",
    metaTitle: "",
    metaDescription: "",
    bodyHtml: "",
    tags: [],
    featuredImageUrl: null,
    featuredImageAlt: null,
    secondaryKeywords: generation.secondaryKeywords || [],
    topicFingerprint: "",
    rationale: ""
  }, { status: "generating", source: "ai", generationSettings: generation as never });

  try {
    const { products, warning } = await getProductLinks(config, settings.storefrontUrl);
    const recentTopics = await recentTopicContext(db);
    const model = settings.openaiModel || config.OPENAI_MODEL;
    const generated = await generateArticle({
      apiKey: config.OPENAI_API_KEY,
      model,
      settings,
      products,
      recentTopics,
      generation
    });
    const updated = await updateArticle(db, placeholder.id, {
      ...normalizeArticle(fromGenerated(generated, settings.authorName), { author: settings.authorName }).content,
      status: "ready",
      generationError: null,
      lastError: warning || null
    });
    await recordAudit(db, {
      actor: actor(req),
      action: "article_generated",
      articleId: placeholder.id,
      detail: { warning, model }
    });
    res.redirect(`/articles/${updated!.id}?notice=${encodeURIComponent(warning ? `Generated with warning: ${warning}` : "Article generated.")}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateArticle(db, placeholder.id, {
      status: "failed",
      generationError: message,
      lastError: message
    });
    await recordAudit(db, { actor: actor(req), action: "article_generation_failed", articleId: placeholder.id, detail: { error: message } });
    res.redirect(`/articles/${placeholder.id}?error=${encodeURIComponent(message)}`);
  }
});

app.get("/articles/:id", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [article, settings] = await Promise.all([getArticle(db, id), getSettings(db)]);
  if (!article) return res.status(404).send(layout({ active: "/articles", config, content: `<section class="card"><p>Article not found.</p></section>` }));
  res.send(layout({
    active: "/articles",
    config,
    embedded: isEmbedded(req),
    csrf: getCsrf(req),
    notice: req.query.notice ? String(req.query.notice) : undefined,
    error: req.query.error ? String(req.query.error) : undefined,
    content: articleEditorPage({ article, settings, mode: "edit", csrf: getCsrf(req) })
  }));
});

app.post("/articles/:id", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const settings = await getSettings(db);
  const existing = await getArticle(db, id);
  if (!existing) return res.status(404).send("Not found");
  if (existing.status === "publishing") {
    return res.redirect(`/articles/${id}?error=${encodeURIComponent("Article is publishing and cannot be edited right now.")}`);
  }

  const raw = bodyToContent(req.body, settings);
  const normalized = normalizeArticle(raw, { author: settings.authorName });
  const intent = String(req.body.intent || "save");
  const requireReady = intent === "ready";
  const validated = validateArticle(normalized.content, { settings, requireReady });
  if (!validated.ok || !validated.content) {
    return res.status(400).send(layout({
      active: "/articles",
      config,
      error: "Please fix validation errors.",
      content: articleEditorPage({
        article: { ...existing, ...normalized.content },
        settings,
        mode: "edit",
        fieldErrors: validated.errors,
        csrf: getCsrf(req)
      })
    }));
  }

  const editedFields = ["title", "excerpt", "bodyHtml", "metaTitle", "metaDescription", "handle", "tags", "author", "featuredImageUrl", "featuredImageAlt"]
    .filter(field => String((existing as never)[field] ?? "") !== String((validated.content as never)[field] ?? ""));

  const scheduledFor = localToUtc(String(req.body.scheduledForLocal || ""), settings.timezone);
  const status = existing.status === "published" ? "published" : requireReady ? "ready" : existing.status === "scheduled" ? "scheduled" : "draft";

  await updateArticle(db, id, {
    ...validated.content,
    status,
    scheduledFor: scheduledFor ?? existing.scheduledFor,
    merchantEdited: true,
    merchantEditedFields: [...new Set([...existing.merchantEditedFields, ...editedFields])]
  });
  await recordAudit(db, { actor: actor(req), action: "article_updated", articleId: id, detail: { editedFields } });
  res.redirect(`/articles/${id}?notice=${encodeURIComponent("Saved.")}`);
});

app.get("/articles/:id/preview", async (req, res) => {
  const article = await getArticle(db, Number(req.params.id));
  if (!article) return res.status(404).send("Not found");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(article.title)}</title>
    <style>body{font:18px/1.6 Georgia,serif;max-width:720px;margin:40px auto;padding:0 16px;color:#222}
    h1{font-size:2rem;line-height:1.2}.excerpt{color:#555;font-style:italic}img{max-width:100%}</style></head>
    <body><h1>${esc(article.title)}</h1><p class="excerpt">${esc(article.excerpt)}</p>${article.bodyHtml}</body></html>`);
});

app.post("/articles/:id/regenerate", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const section = String(req.body.section || "full") as "full" | "title" | "excerpt" | "seo" | "body";
  const settings = await getSettings(db);
  const existing = await getArticle(db, id);
  if (!existing) return res.status(404).send("Not found");

  if (section === "full" && existing.merchantEdited && !req.body.confirm) {
    // soft confirm already via browser confirm; proceed
  }

  try {
    await updateArticle(db, id, { status: "generating" });
    const { products } = await getProductLinks(config, settings.storefrontUrl);
    const recentTopics = await recentTopicContext(db);
    const generated = await generateArticle({
      apiKey: config.OPENAI_API_KEY,
      model: settings.openaiModel || config.OPENAI_MODEL,
      settings,
      products,
      recentTopics,
      section,
      existing: toGenerated(existing),
      generation: (existing.generationSettings || {}) as GenerationSettings
    });

    // Preserve merchant-edited fields on partial regen
    const normalized = normalizeArticle(fromGenerated(generated, existing.author || settings.authorName), { author: settings.authorName }).content;
    const protectedFields = new Set(existing.merchantEditedFields);
    const merged = { ...normalized };
    if (section !== "full") {
      if (section === "title") {
        merged.excerpt = existing.excerpt;
        merged.metaDescription = existing.metaDescription;
        merged.metaTitle = existing.metaTitle;
        merged.bodyHtml = existing.bodyHtml;
        merged.tags = existing.tags;
      } else if (section === "excerpt") {
        merged.title = existing.title;
        merged.handle = existing.handle;
        merged.metaDescription = existing.metaDescription;
        merged.metaTitle = existing.metaTitle;
        merged.bodyHtml = existing.bodyHtml;
        merged.tags = existing.tags;
      } else if (section === "seo") {
        merged.bodyHtml = existing.bodyHtml;
        merged.excerpt = existing.excerpt;
        if (protectedFields.has("title")) merged.title = existing.title;
        if (protectedFields.has("handle")) merged.handle = existing.handle;
      } else if (section === "body") {
        merged.title = existing.title;
        merged.handle = existing.handle;
        merged.excerpt = existing.excerpt;
        merged.metaDescription = existing.metaDescription;
        merged.metaTitle = existing.metaTitle;
      }
    }

    await updateArticle(db, id, { ...merged, status: "ready", generationError: null, lastError: null });
    await recordAudit(db, { actor: actor(req), action: "article_regenerated", articleId: id, detail: { section } });
    res.redirect(`/articles/${id}?notice=${encodeURIComponent(`Regenerated ${section}.`)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateArticle(db, id, { status: "failed", generationError: message, lastError: message });
    res.redirect(`/articles/${id}?error=${encodeURIComponent(message)}`);
  }
});

app.post("/articles/:id/publish", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const settings = await getSettings(db);
  const article = await getArticle(db, id);
  if (!article) return res.status(404).send("Not found");

  const validated = validateArticle(article, { settings, requireReady: true });
  if (!validated.ok) {
    return res.redirect(`/articles/${id}?error=${encodeURIComponent(validated.errors.map(e => e.message).join("; "))}`);
  }

  const idempotencyKey = article.idempotencyKey || `publish:${id}`;
  try {
    await updateArticle(db, id, { status: "publishing", idempotencyKey });
    const published = await publishArticle(config, toGenerated(validated.content!), article.author || settings.authorName, settings, {
      imageUrl: article.featuredImageUrl,
      imageAlt: article.featuredImageAlt,
      isPublished: true,
      idempotencyKey,
      shopifyArticleId: article.shopifyArticleId
    });
    await updateArticle(db, id, {
      status: published.isPublished === false ? "draft" : "published",
      shopifyArticleId: published.id,
      shopifyUrl: published.url,
      shopifyHandle: published.handle,
      shopifyBlogId: published.blogId,
      shopifyResponseStatus: published.responseStatus,
      publishedAt: published.isPublished === false ? article.publishedAt : new Date(),
      lastError: null,
      idempotencyKey
    });
    await recordAudit(db, {
      actor: actor(req),
      action: article.shopifyArticleId ? "article_updated_shopify" : "article_published_manual",
      articleId: id,
      detail: { url: published.url, responseStatus: published.responseStatus, shopifyId: published.id }
    });
    const notice = published.responseStatus === "recovered"
      ? "Recovered existing Shopify article and linked it (no duplicate create)."
      : published.responseStatus === "updated"
        ? "Updated existing Shopify article."
        : "Published to Shopify.";
    res.redirect(`/articles/${id}?notice=${encodeURIComponent(notice)}`);
  } catch (error) {
    const message = safeShopifyErrorMessage(error);
    await updateArticle(db, id, { status: "failed", lastError: message, idempotencyKey });
    await recordAudit(db, { actor: actor(req), action: "article_publish_failed", articleId: id, detail: { error: message } });
    res.redirect(`/articles/${id}?error=${encodeURIComponent(message)}`);
  }
});

app.get("/articles/:id/link-shopify", async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const [article, settings] = await Promise.all([getArticle(db, id), getSettings(db)]);
  if (!article) return res.status(404).send("Not found");
  res.send(layout({
    active: "/articles",
    config,
    embedded: isEmbedded(req),
    csrf: getCsrf(req),
    content: linkShopifyPage({ article, settings, csrf: getCsrf(req) })
  }));
});

app.post("/articles/:id/link-shopify/search", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const [article, settings] = await Promise.all([getArticle(db, id), getSettings(db)]);
  if (!article) return res.status(404).send("Not found");
  try {
    const blog = await resolveBlog(config, settings);
    const found = await findArticleByHandle(config, blog.id, article.handle, settings.storefrontUrl || config.STOREFRONT_URL);
    if (!found) {
      return res.send(layout({
        active: "/articles",
        config,
        csrf: getCsrf(req),
        content: linkShopifyPage({
          article,
          settings,
          csrf: getCsrf(req),
          error: `No Shopify article with exact handle “${article.handle}” was found in blog “${blog.title}”.`
        })
      }));
    }
    await recordAudit(db, {
      actor: actor(req),
      action: "shopify_link_candidate_shown",
      articleId: id,
      detail: { shopifyArticleId: found.id, handle: found.handle }
    });
    res.send(layout({
      active: "/articles",
      config,
      csrf: getCsrf(req),
      content: linkShopifyPage({
        article,
        settings,
        csrf: getCsrf(req),
        candidate: {
          id: found.id,
          title: found.title ?? null,
          handle: found.handle ?? null,
          isPublished: found.isPublished ?? null,
          url: found.url,
          blogHandle: found.blog?.handle ?? null
        }
      })
    }));
  } catch (error) {
    res.send(layout({
      active: "/articles",
      config,
      csrf: getCsrf(req),
      content: linkShopifyPage({
        article,
        settings,
        csrf: getCsrf(req),
        error: safeShopifyErrorMessage(error)
      })
    }));
  }
});

app.post("/articles/:id/link-shopify/confirm", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const confirmed = String(req.body.confirm || "") === "1";
  const shopifyArticleId = String(req.body.shopifyArticleId || "");
  const [article, settings] = await Promise.all([getArticle(db, id), getSettings(db)]);
  if (!article) return res.status(404).send("Not found");
  if (!confirmed || !shopifyArticleId) {
    return res.redirect(`/articles/${id}/link-shopify?error=${encodeURIComponent("Confirmation required before linking.")}`);
  }

  try {
    const blog = await resolveBlog(config, settings);
    const found = await findArticleByHandle(config, blog.id, article.handle, settings.storefrontUrl || config.STOREFRONT_URL);
    if (!found || found.id !== shopifyArticleId) {
      return res.send(layout({
        active: "/articles",
        config,
        csrf: getCsrf(req),
        content: linkShopifyPage({
          article,
          settings,
          csrf: getCsrf(req),
          error: "The Shopify article could not be re-verified. Search again and confirm the exact match."
        })
      }));
    }

    const linked = await linkArticleToShopify(db, id, {
      shopifyArticleId: found.id,
      shopifyBlogId: found.blog?.id ?? blog.id,
      shopifyHandle: found.handle ?? null,
      shopifyUrl: found.url,
      isPublished: Boolean(found.isPublished),
      publishedAt: found.publishedAt ?? null,
      responseStatus: "linked"
    });
    await recordAudit(db, {
      actor: actor(req),
      action: "shopify_article_linked",
      articleId: id,
      detail: {
        shopifyArticleId: found.id,
        handle: found.handle,
        url: found.url,
        isPublished: found.isPublished
      }
    });
    res.redirect(`/articles/${linked!.id}?notice=${encodeURIComponent("Linked existing Shopify article. Future publishes will use articleUpdate.")}`);
  } catch (error) {
    res.redirect(`/articles/${id}/link-shopify?error=${encodeURIComponent(safeShopifyErrorMessage(error))}`);
  }
});

app.post("/articles/:id/schedule", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const settings = await getSettings(db);
  const article = await getArticle(db, id);
  if (!article) return res.status(404).send("Not found");
  const when = article.scheduledFor || localToUtc(String(req.body.scheduledForLocal || ""), settings.timezone);
  if (!when) return res.redirect(`/articles/${id}?error=${encodeURIComponent("Set a publication time before scheduling.")}`);
  const validated = validateArticle(article, { settings, requireReady: true });
  if (!validated.ok) return res.redirect(`/articles/${id}?error=${encodeURIComponent(validated.errors.map(e => e.message).join("; "))}`);

  const jobId = await scheduleArticleJob(db, id, when, `sched-${id}-${when.toISOString()}`);
  await recordAudit(db, { actor: actor(req), action: "article_scheduled", articleId: id, jobId, detail: { when } });
  res.redirect(`/articles/${id}?notice=${encodeURIComponent("Scheduled.")}`);
});

app.post("/articles/:id/cancel-schedule", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const updated = await cancelScheduledArticle(db, id);
  if (!updated) return res.redirect(`/articles/${id}?error=${encodeURIComponent("Article is not scheduled or is already publishing.")}`);
  await recordAudit(db, { actor: actor(req), action: "schedule_cancelled", articleId: id });
  res.redirect(`/articles/${id}?notice=${encodeURIComponent("Schedule cancelled.")}`);
});

app.post("/articles/:id/duplicate", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const copy = await duplicateArticle(db, Number(req.params.id));
  if (!copy) return res.status(404).send("Not found");
  await recordAudit(db, { actor: actor(req), action: "article_duplicated", articleId: copy.id });
  res.redirect(`/articles/${copy.id}?notice=${encodeURIComponent("Duplicated.")}`);
});

app.post("/articles/:id/archive", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  await cancelScheduledArticle(db, id).catch(() => null);
  await updateArticle(db, id, { status: "archived", scheduledFor: null });
  await recordAudit(db, { actor: actor(req), action: "article_archived", articleId: id });
  res.redirect(`/articles?notice=${encodeURIComponent("Archived.")}`);
});

app.post("/articles/:id/retry", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  const article = await getArticle(db, id);
  if (!article) return res.status(404).send("Not found");
  await updateArticle(db, id, { status: "ready", lastError: null });
  await insertManualJob(db, id);
  void worker.tick();
  await recordAudit(db, { actor: actor(req), action: "article_retry_queued", articleId: id });
  res.redirect(`/articles/${id}?notice=${encodeURIComponent("Retry queued.")}`);
});

app.post("/articles/:id/image", upload.single("image"), async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const id = Number(req.params.id);
  if (!req.file) return res.redirect(`/articles/${id}?error=${encodeURIComponent("No image uploaded.")}`);
  // Store as data URL for draft preview; Shopify publish uses URL field. Production can swap to staged uploads.
  const dataUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
  if (dataUrl.length > 1_500_000) {
    return res.redirect(`/articles/${id}?error=${encodeURIComponent("Image too large after encoding. Use an image URL instead.")}`);
  }
  await updateArticle(db, id, {
    featuredImageUrl: dataUrl,
    featuredImageAlt: String(req.body.alt || ""),
    merchantEdited: true
  });
  res.redirect(`/articles/${id}?notice=${encodeURIComponent("Image saved.")}`);
});

// ---- Schedule / History / Settings / Diagnostics ----
app.get("/schedule", async (req: AuthedRequest, res) => {
  const settings = await getSettings(db);
  const { items } = await listArticles(db, { status: "scheduled", sort: "scheduled", pageSize: 50 });
  const rows = items.map(a => `<tr><td>${esc(formatDate(a.scheduledFor, settings.timezone))}</td><td><a href="/articles/${a.id}">${esc(a.title)}</a></td><td>${esc(a.status)}</td></tr>`).join("");
  res.send(layout({
    active: "/schedule",
    config,
    embedded: isEmbedded(req),
    content: `<section class="card"><h2>Schedule / Calendar</h2>
      <p class="muted">Times shown in ${esc(settings.timezone)}. Stored in UTC.</p>
      <div style="overflow:auto"><table style="width:100%;border-collapse:collapse">
      <thead><tr><th>When</th><th>Article</th><th>Status</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">No scheduled articles.</td></tr>`}</tbody></table></div></section>`
  }));
});

app.get("/history", async (req: AuthedRequest, res) => {
  const [jobs, audit, settings] = await Promise.all([listJobs(db, 50), listAudit(db, 50), getSettings(db)]);
  const jobRows = jobs.map(j => `<tr><td>${esc(j.status)}</td><td>${esc(formatDate(j.scheduled_for, settings.timezone))}</td><td>${esc(j.attempts)}</td><td>${j.shopify_url ? `<a href="${esc(j.shopify_url)}" target="_blank" rel="noreferrer">View</a>` : esc((j.error || "").slice(0, 80))}</td></tr>`).join("");
  const auditRows = audit.map(a => `<tr><td>${esc(formatDate(a.created_at, settings.timezone))}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.article_id || "—")}</td></tr>`).join("");
  res.send(layout({
    active: "/history",
    config,
    embedded: isEmbedded(req),
    content: `<div class="grid two">
      <section class="card"><h2>Publishing jobs</h2><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Status</th><th>Scheduled</th><th>Attempts</th><th>Result</th></tr></thead><tbody>${jobRows || `<tr><td colspan="4" class="muted">No jobs.</td></tr>`}</tbody></table></div></section>
      <section class="card"><h2>Audit trail</h2><div style="overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Article</th></tr></thead><tbody>${auditRows || `<tr><td colspan="4" class="muted">No events.</td></tr>`}</tbody></table></div></section>
    </div>`
  }));
});

function formatDate(value: unknown, timezone: string) {
  if (!value) return "—";
  try { return new Date(String(value)).toLocaleString("en-US", { timeZone: timezone }); } catch { return String(value); }
}

app.get("/settings", async (req: AuthedRequest, res) => {
  const settings = await getSettings(db);
  let blogs: Array<{ id: string; title: string; handle: string }> = [];
  try { blogs = await listBlogs(config); } catch { blogs = []; }
  res.send(layout({
    active: "/settings",
    config,
    embedded: isEmbedded(req),
    csrf: getCsrf(req),
    notice: req.query.saved ? "Settings saved." : undefined,
    content: settingsPage({ settings, config, blogs, csrf: getCsrf(req) })
  }));
});

app.post("/settings", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  const current = await getSettings(db);
  let blogs: Array<{ id: string; title: string; handle: string }> = [];
  try { blogs = await listBlogs(config); } catch { /* ignore */ }

  const parsed = z.object({
    enabled: z.string().optional(),
    draftOnlyMode: z.string().optional(),
    enableAiImages: z.string().optional(),
    cadence: z.enum(["daily", "twice_daily"]),
    timezone: z.string().min(3).max(80),
    firstTime: z.string().regex(/^\d{2}:\d{2}$/),
    secondTime: z.string().regex(/^\d{2}:\d{2}$/),
    authorName: z.string().min(2).max(100),
    businessName: z.string().min(2).max(120),
    storefrontUrl: z.string().url(),
    shopifyBlogId: z.string().optional(),
    shopifyBlogHandle: z.string().optional(),
    brandVoice: z.string().max(2000),
    targetAudience: z.string().max(2000),
    defaultCta: z.string().max(2000),
    facts: z.string(),
    contentPillars: z.string(),
    wordCountMin: z.coerce.number().int().min(300).max(2500),
    wordCountMax: z.coerce.number().int().min(400).max(3000),
    retryLimit: z.coerce.number().int().min(1).max(8),
    openaiModel: z.string().max(100).optional()
  }).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).send(layout({
      active: "/settings",
      config,
      error: parsed.error.issues.map(i => i.message).join("; "),
      content: settingsPage({ settings: current, config, blogs, csrf: getCsrf(req) })
    }));
  }

  const blog = blogs.find(b => b.id === parsed.data.shopifyBlogId);
  const next = mergeSettings({
    ...current,
    enabled: Boolean(parsed.data.enabled),
    draftOnlyMode: Boolean(parsed.data.draftOnlyMode),
    enableAiImages: Boolean(parsed.data.enableAiImages),
    cadence: parsed.data.cadence,
    timezone: parsed.data.timezone,
    firstTime: parsed.data.firstTime,
    secondTime: parsed.data.secondTime,
    authorName: parsed.data.authorName,
    businessName: parsed.data.businessName,
    storefrontUrl: parsed.data.storefrontUrl,
    shopifyBlogId: parsed.data.shopifyBlogId || null,
    shopifyBlogHandle: blog?.handle || parsed.data.shopifyBlogHandle || current.shopifyBlogHandle,
    brandVoice: parsed.data.brandVoice,
    targetAudience: parsed.data.targetAudience,
    defaultCta: parsed.data.defaultCta,
    facts: parsed.data.facts.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    contentPillars: parsed.data.contentPillars.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    wordCountMin: parsed.data.wordCountMin,
    wordCountMax: parsed.data.wordCountMax,
    retryLimit: parsed.data.retryLimit,
    openaiModel: parsed.data.openaiModel || null
  });

  if (next.enabled) worker.emergencyPause(false);
  await saveSettings(db, next);
  await recordAudit(db, { actor: actor(req), action: "settings_updated", detail: { enabled: next.enabled, draftOnlyMode: next.draftOnlyMode } });
  res.redirect("/settings?saved=1");
});

app.get("/diagnostics", async (req: AuthedRequest, res) => {
  const settings = await getSettings(db);
  const health = { ok: true, ready: true };
  let shopify: unknown = { ok: false, message: "Not run yet. Use the button below." };
  let openai: unknown = { ok: false, message: "Not run yet. Use the button below." };
  if (req.query.shopify === "1") {
    try { shopify = await verifyShopify(config, settings); }
    catch (error) { shopify = { ok: false, error: safeShopifyErrorMessage(error), nextAction: "Check Shopify credentials and scopes." }; }
  }
  if (req.query.openai === "1") {
    openai = await diagnoseOpenAI(config.OPENAI_API_KEY, settings.openaiModel || config.OPENAI_MODEL);
  }
  const scheduler = {
    ...worker.getDiagnostics(),
    autopilotEnabled: settings.enabled,
    draftOnlyMode: settings.draftOnlyMode,
    nextAction: settings.enabled
      ? (settings.draftOnlyMode ? "Autopilot will generate drafts only until draft-only mode is disabled." : "Autopilot will publish on cadence.")
      : "Autopilot is paused. Enable it in Settings when release checks pass."
  };
  res.send(layout({
    active: "/diagnostics",
    config,
    embedded: isEmbedded(req),
    csrf: getCsrf(req),
    content: diagnosticsPage({ health, shopify, openai, scheduler, csrf: getCsrf(req) })
  }));
});

app.post("/diagnostics/shopify", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  res.redirect("/diagnostics?shopify=1");
});
app.post("/diagnostics/openai", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  res.redirect("/diagnostics?openai=1");
});
app.post("/diagnostics/scheduler", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  res.redirect("/diagnostics");
});

// ---- JSON APIs ----
app.get("/api/status", async (_req, res) => {
  res.json(redactSecrets({
    settings: await getSettings(db),
    jobs: await listJobs(db, 20),
    overview: await getOverviewStats(db),
    scheduler: worker.getDiagnostics()
  }));
});

app.get("/api/verify-shopify", async (_req, res) => {
  try {
    const settings = await getSettings(db);
    res.json(await verifyShopify(config, settings));
  } catch (error) {
    res.status(502).json({ ok: false, error: safeShopifyErrorMessage(error) });
  }
});

app.get("/api/diagnostics/openai", async (_req, res) => {
  const settings = await getSettings(db);
  res.json(await diagnoseOpenAI(config.OPENAI_API_KEY, settings.openaiModel || config.OPENAI_MODEL));
});

app.get("/api/products", async (req, res) => {
  try {
    const settings = await getSettings(db);
    const q = String(req.query.q || "");
    if (q) return res.json({ products: await searchProducts(config, q, settings.storefrontUrl) });
    const result = await getProductLinks(config, settings.storefrontUrl);
    res.json(result);
  } catch (error) {
    res.status(502).json({ products: [], warning: safeShopifyErrorMessage(error) });
  }
});

app.post("/publish-now", async (req: AuthedRequest, res) => {
  if (!requireCsrf(req, res)) return;
  await insertManualJob(db);
  void worker.tick();
  await recordAudit(db, { actor: actor(req), action: "publish_now_queued" });
  res.redirect("/history?notice=" + encodeURIComponent("Publish-now job queued."));
});

// Error handler — never leak stacks/secrets
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(JSON.stringify(redactSecrets({ event: "request_error", error: err instanceof Error ? err.message : String(err) })));
  if (res.headersSent) return;
  res.status(500).send(layout({
    active: "/",
    config,
    content: `<section class="card"><div class="notice error">Something went wrong. Try again or check Diagnostics.</div><a href="/">Back to overview</a></section>`
  }));
});

const server = app.listen(config.PORT, () => {
  console.log(JSON.stringify({ event: "listening", port: config.PORT }));
});

async function shutdown() {
  worker.stop();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.end();
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
