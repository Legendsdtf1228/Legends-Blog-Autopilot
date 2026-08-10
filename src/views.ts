import type { ArticleRecord, OverviewStats, Settings } from "./types.js";
import type { AppConfig } from "./config.js";
import type { ArticleBrief, EvidenceReport, MerchantInterview, OverlapMatch, ResearchOpportunity } from "./research/types.js";
import { AUDIENCE_LABELS, CONTENT_PILLARS, FORMAT_LABELS } from "./research/pillars.js";

export const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]!);

export const checked = (value: boolean) => (value ? "checked" : "");
export const selected = (a: string, b: string) => (a === b ? "selected" : "");

function nav(active: string) {
  const items = [
    ["/", "Overview"],
    ["/research", "Research"],
    ["/articles", "Articles"],
    ["/articles/new", "New Article"],
    ["/schedule", "Schedule"],
    ["/history", "History"],
    ["/settings", "Settings"],
    ["/diagnostics", "Diagnostics"]
  ] as const;
  return `<nav class="nav" aria-label="Primary">${items
    .map(([href, label]) => {
      const isActive =
        href === "/"
          ? active === "/"
          : href === "/articles"
            ? active === "/articles" || /^\/articles\/\d+/.test(active)
            : href === "/research"
              ? active === "/research" || active.startsWith("/research/")
              : active === href || active.startsWith(`${href}/`);
      return `<a href="${href}" class="${isActive ? "active" : ""}">${label}</a>`;
    })
    .join("")}</nav>`;
}

export function layout(opts: {
  title?: string;
  active: string;
  content: string;
  config: AppConfig;
  notice?: string;
  error?: string;
  embedded?: boolean;
  csrf?: string;
}) {
  const notice = opts.notice ? `<div class="notice" role="status">${esc(opts.notice)}</div>` : "";
  const error = opts.error ? `<div class="notice error" role="alert">${esc(opts.error)}</div>` : "";
  const csrf = opts.csrf ? `<meta name="csrf-token" content="${esc(opts.csrf)}">` : "";
  const appBridge = `
    <meta name="shopify-api-key" content="${esc(opts.config.SHOPIFY_CLIENT_ID)}" />
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <script src="/assets/app.js" defer></script>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(opts.title || "Legends Blog Autopilot")}</title>
  ${csrf}
  ${appBridge}
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body data-embedded="${opts.embedded ? "1" : "0"}">
  <a class="skip" href="#main">Skip to content</a>
  <header class="top">
    <div class="top-inner">
      <div>
        <div class="brand">LEGENDS BLOG AUTOPILOT</div>
        <div class="sub">Shopify content control for Legends DTF Prints</div>
      </div>
      <div class="top-actions">
        <a class="ghost" href="/logout">Sign out</a>
      </div>
    </div>
    ${nav(opts.active)}
  </header>
  <main id="main" class="wrap">
    ${notice}${error}
    ${opts.content}
  </main>
</body>
</html>`;
}

export function loginPage(config: AppConfig, opts?: { error?: string; next?: string }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Sign in · Legends Blog Autopilot</title>
  <link rel="stylesheet" href="/assets/app.css">
  <meta name="shopify-api-key" content="${esc(config.SHOPIFY_CLIENT_ID)}" />
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  </head><body class="login-body">
  <main class="login-card">
    <div class="brand">LEGENDS BLOG AUTOPILOT</div>
    <p class="muted">Standalone admin login for Railway. Embedded Shopify Admin uses session tokens automatically.</p>
    ${opts?.error ? `<div class="notice error">${esc(opts.error)}</div>` : ""}
    <form method="post" action="/login" class="stack">
      <input type="hidden" name="next" value="${esc(opts?.next || "/")}">
      <label>Username<input name="username" autocomplete="username" value="admin" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">Sign in</button>
    </form>
  </main>
  <script>
    (async function(){
      try {
        if (window.shopify?.idToken) {
          const token = await window.shopify.idToken();
          const res = await fetch('/api/auth/session-token', { method:'POST', headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body:'{}' });
          if (res.ok) location.replace('/');
        }
      } catch {}
    })();
  </script>
  </body></html>`;
}

export function statusBadge(status: string) {
  return `<span class="status ${esc(status)}">${esc(status)}</span>`;
}

export function formatWhen(date: Date | string | null | undefined, timezone: string) {
  if (!date) return "—";
  try {
    return new Date(date).toLocaleString("en-US", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" });
  } catch {
    return String(date);
  }
}

export function overviewPage(args: {
  settings: Settings;
  stats: OverviewStats;
  shopifyOk?: boolean;
  openaiOk?: boolean;
  shopName?: string;
  blogName?: string;
  csrf?: string;
  latestCycle?: { decision: string; collectedAt: string; reasons: string[] } | null;
  publishedLast7Days?: number;
}) {
  const { settings, stats } = args;
  const kill = settings.killSwitch.paused
    ? `<div class="notice error"><strong>Kill switch active:</strong> ${esc(settings.killSwitch.reason || "paused")}<br><span class="muted">${esc(settings.killSwitch.recoveryStep || "")}</span></div>`
    : "";
  const promo = settings.promotionProgress;
  const promoNeed = settings.promotionThresholds;
  return `
  ${kill}
  <div class="grid stats">
    <section class="card"><div class="muted">Rollout mode</div><div class="metric" style="font-size:1.2rem">${esc(settings.rolloutMode)}</div><div class="muted">${settings.enabled ? "Publish scheduler armed" : "Publish scheduler paused"} · ${settings.draftOnlyMode ? "draft-only" : "live"}</div></section>
    <section class="card"><div class="muted">Shopify</div><div class="metric" style="font-size:1.4rem">${esc(args.shopName || settings.businessName)}</div><div class="muted">Blog: ${esc(args.blogName || settings.shopifyBlogHandle)} · ${args.shopifyOk === false ? "Check diagnostics" : "Connected"}</div></section>
    <section class="card"><div class="muted">Latest research cycle</div><div class="metric" style="font-size:1.1rem">${esc(args.latestCycle?.decision || "No cycle yet")}</div><div class="muted">${args.latestCycle ? esc(args.latestCycle.reasons[0] || args.latestCycle.collectedAt) : `Cadence ${settings.researchCadence} · windows ${settings.firstTime}/${settings.secondTime}`}</div></section>
    <section class="card"><div class="muted">Published (7d)</div><div class="metric">${args.publishedLast7Days ?? 0}</div><div class="muted">Cap ${settings.frequencyLimits.maxPublishedPerRolling7Days} · min spacing ${settings.frequencyLimits.minHoursBetweenPublishes}h · max/cycle ${settings.frequencyLimits.maxArticlesPerCycle}</div></section>
  </div>
  <section class="card">
    <h3>Quality thresholds & promotion</h3>
    <p class="muted">Opportunity ≥ ${settings.research.autoThresholds.overallOpportunityScore}, specificity ≥ ${settings.research.autoThresholds.topicSpecificity}, uniqueness ≥ ${settings.research.autoThresholds.uniqueness}, factual ≥ ${settings.research.autoThresholds.factualConfidence}, quality ≥ ${settings.research.autoThresholds.articleQuality}. Research may run twice daily without publishing.</p>
    <p class="muted">Promotion progress: ${promo.consecutiveReviewedDrafts}/${promoNeed.minConsecutiveReviewedDrafts} reviewed drafts · ${Math.round(promo.merchantApprovalRate * 100)}% / ${Math.round(promoNeed.minMerchantApprovalRate * 100)}% approval · ${promo.shadowAutoDays}/${promoNeed.minShadowAutoDays} SHADOW_AUTO days · explicit activation ${promo.autoPublishExplicitlyActivated ? "yes" : "no"}.</p>
  </section>
  <div class="grid three">
    <section class="card"><div class="muted">Drafts / ready</div><div class="metric">${stats.draftCount}</div></section>
    <section class="card"><div class="muted">Scheduled</div><div class="metric">${stats.scheduledCount}</div></section>
    <section class="card"><div class="muted">Published</div><div class="metric">${stats.publishedCount}</div></section>
  </div>
  <div class="grid two">
    <section class="card">
      <h2>Recent successes</h2>
      ${stats.recentSuccesses.length ? `<ul class="list">${stats.recentSuccesses.map(a => `<li><a href="/articles/${a.id}">${esc(a.title)}</a> ${statusBadge(a.status)}</li>`).join("")}</ul>` : `<p class="muted">No published articles yet.</p>`}
    </section>
    <section class="card">
      <h2>Recent failures</h2>
      ${stats.recentFailures.length ? `<ul class="list">${stats.recentFailures.map(a => `<li><a href="/articles/${a.id}">${esc(a.title)}</a> <span class="muted">${esc((a.lastError || "").slice(0, 80))}</span></li>`).join("")}</ul>` : `<p class="muted">No failures.</p>`}
      <div class="actions">
        <form method="post" action="/autopilot/pause"><input type="hidden" name="_csrf" value="${esc(args.csrf || "")}"><input type="hidden" name="enabled" value="0"><button class="danger" type="submit">Emergency pause</button></form>
        <a class="button" href="/articles/new">New article</a>
      </div>
    </section>
  </div>`;
}

export function articlesListPage(args: {
  items: ArticleRecord[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  timezone: string;
}) {
  const pages = Math.max(1, Math.ceil(args.total / args.pageSize));
  const empty = !args.items.length
    ? `<div class="empty"><h2>No articles yet</h2><p class="muted">Create a manual draft or generate one with AI.</p><a class="button primary" href="/articles/new">New article</a></div>`
    : "";

  const cards = args.items
    .map(
      a => `<article class="article-card">
      <div class="article-card-top">${statusBadge(a.status)}<span class="muted">${formatWhen(a.updatedAt, args.timezone)}</span></div>
      <h3><a href="/articles/${a.id}">${esc(a.title || "Untitled")}</a></h3>
      <p class="muted">${esc((a.excerpt || "").slice(0, 140))}</p>
      <div class="article-card-meta">
        <span>${esc(a.author || "—")}</span>
        ${a.shopifyUrl ? `<a href="${esc(a.shopifyUrl)}" target="_blank" rel="noreferrer">View on store</a>` : ""}
      </div>
    </article>`
    )
    .join("");

  return `
  <section class="card">
    <div class="toolbar">
      <form method="get" action="/articles" class="filters">
        <input type="search" name="q" placeholder="Search articles" value="${esc(args.q)}" aria-label="Search articles">
        <select name="status" aria-label="Status filter">
          ${["all", "idea", "draft", "ready", "scheduled", "publishing", "published", "failed", "archived"]
            .map(s => `<option value="${s}" ${selected(args.status, s)}>${s}</option>`)
            .join("")}
        </select>
        <button type="submit">Filter</button>
      </form>
      <a class="button primary" href="/articles/new">New article</a>
    </div>
    ${empty || `<div class="article-grid">${cards}</div>`}
    <div class="pager muted">Page ${args.page} of ${pages} · ${args.total} total
      ${args.page > 1 ? `<a href="/articles?page=${args.page - 1}&q=${encodeURIComponent(args.q)}&status=${encodeURIComponent(args.status)}">Previous</a>` : ""}
      ${args.page < pages ? `<a href="/articles?page=${args.page + 1}&q=${encodeURIComponent(args.q)}&status=${encodeURIComponent(args.status)}">Next</a>` : ""}
    </div>
  </section>`;
}

export function articleEditorPage(args: {
  article?: ArticleRecord | null;
  settings: Settings;
  mode: "new" | "edit";
  fieldErrors?: Array<{ field: string; message: string }>;
  csrf: string;
  evidenceReport?: EvidenceReport | null;
}) {
  const a = args.article;
  const err = (field: string) => args.fieldErrors?.find(e => e.field === field)?.message;
  const fieldError = (field: string) => (err(field) ? `<div class="field-error">${esc(err(field))}</div>` : "");
  const evidence = args.evidenceReport
    ? `<section class="card"><h3>Evidence report</h3>
        <p class="muted">Generated ${esc(args.evidenceReport.generatedAt)}</p>
        <ul>${args.evidenceReport.qualityGateResults.map(g => `<li>${g.ok ? "✓" : "✗"} <strong>${esc(g.gate)}</strong>: ${esc(g.detail)}</li>`).join("")}</ul>
        <h4>Shopify facts used</h4>
        <ul>${args.evidenceReport.shopifyFactsUsed.map(f => `<li>${esc(f)}</li>`).join("") || "<li class=\"muted\">None</li>"}</ul>
        <h4>Sources</h4>
        <ul>${args.evidenceReport.sourcesUsed.map(s => `<li>${esc(s.provider)} — ${esc(s.detail)} (${esc(s.collectedAt)})</li>`).join("")}</ul>
      </section>`
    : "";

  return `
  ${evidence}
  <form method="post" action="${a ? `/articles/${a.id}` : "/articles"}" class="grid editor" id="article-form">
    <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
    <section class="card">
      <h2>${a ? "Edit article" : "New article"}</h2>
      ${a ? `<div class="meta-row">${statusBadge(a.status)} <span class="muted">Updated ${formatWhen(a.updatedAt, args.settings.timezone)}</span></div>` : ""}
      ${a?.lastError ? `<div class="notice error">${esc(a.lastError)}</div>` : ""}
      ${a?.generationError ? `<div class="notice error">Generation: ${esc(a.generationError)}</div>` : ""}
      <label>Title<input name="title" value="${esc(a?.title || "")}" required maxlength="120">${fieldError("title")}</label>
      <label>Handle<input name="handle" value="${esc(a?.handle || "")}" maxlength="120">${fieldError("handle")}</label>
      <label>Excerpt<textarea name="excerpt" rows="3">${esc(a?.excerpt || "")}</textarea>${fieldError("excerpt")}</label>
      <label>Body HTML<textarea name="bodyHtml" rows="18" class="code">${esc(a?.bodyHtml || "")}</textarea>${fieldError("bodyHtml")}</label>
      <div class="row">
        <label>Meta title<input name="metaTitle" value="${esc(a?.metaTitle || "")}" maxlength="70">${fieldError("metaTitle")}</label>
        <label>Meta description<textarea name="metaDescription" rows="3" maxlength="160">${esc(a?.metaDescription || "")}</textarea>${fieldError("metaDescription")}</label>
      </div>
      <div class="row">
        <label>Tags (comma separated)<input name="tags" value="${esc((a?.tags || []).join(", "))}"></label>
        <label>Author<input name="author" value="${esc(a?.author || args.settings.authorName)}"></label>
      </div>
      <div class="row">
        <label>Featured image URL<input name="featuredImageUrl" value="${esc(a?.featuredImageUrl || "")}"></label>
        <label>Image alt text<input name="featuredImageAlt" value="${esc(a?.featuredImageAlt || "")}" maxlength="200"></label>
      </div>
      ${a?.featuredImageUrl ? `<div class="image-preview"><img src="${esc(a.featuredImageUrl)}" alt="${esc(a.featuredImageAlt || "")}"></div>` : ""}
      <div class="row">
        <label>Primary keyword<input name="primaryKeyword" value="${esc(a?.primaryKeyword || "")}"></label>
        <label>Secondary keywords<input name="secondaryKeywords" value="${esc((a?.secondaryKeywords || []).join(", "))}"></label>
      </div>
      <label>Publication time (local ${esc(args.settings.timezone)})<input type="datetime-local" name="scheduledForLocal" value="${a?.scheduledFor ? toLocalInput(a.scheduledFor, args.settings.timezone) : ""}"></label>
      <div class="actions">
        <button type="submit" name="intent" value="save">Save draft</button>
        <button type="submit" name="intent" value="ready" class="primary">Mark ready</button>
      </div>
    </section>
    <aside class="card side">
      <h2>Actions</h2>
      ${a ? `
      <div class="stack actions-col">
        <button form="regen-full" class="primary" type="submit">Regenerate full article</button>
        <button form="regen-title" type="submit">Regenerate title</button>
        <button form="regen-excerpt" type="submit">Regenerate excerpt</button>
        <button form="regen-seo" type="submit">Regenerate SEO</button>
        <button form="regen-body" type="submit">Regenerate body</button>
        <button form="publish-now" class="primary" type="submit">Publish immediately</button>
        <button form="schedule" type="submit">Schedule publication</button>
        <button form="cancel-schedule" type="submit">Cancel schedule</button>
        <button form="duplicate" type="submit">Duplicate</button>
        <button form="archive" type="submit">Archive</button>
        <button form="retry" type="submit">Retry failed</button>
        <a class="button" href="/articles/${a.id}/preview" target="_blank">Preview</a>
        ${a.shopifyUrl ? `<a class="button" href="${esc(a.shopifyUrl)}" target="_blank" rel="noreferrer">Shopify URL</a>` : ""}
      </div>
      <p class="muted">Partial regeneration preserves merchant-edited fields. Full regeneration asks for confirmation.</p>
      ` : `
      <div class="stack">
        <p class="muted">Save a draft first, or use AI generate on the New Article page.</p>
      </div>`}
      <h2>Preview</h2>
      <div class="preview-tabs">
        <button type="button" data-preview="desktop" class="active">Desktop</button>
        <button type="button" data-preview="mobile">Mobile</button>
      </div>
      <iframe id="preview-frame" class="preview desktop" title="Article preview" sandbox=""></iframe>
    </aside>
  </form>
  ${a ? `
  <form id="regen-full" method="post" action="/articles/${a.id}/regenerate" onsubmit="return confirm('Regenerate the full article? Unsaved merchant edits in fields not marked protected may be replaced.')"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><input type="hidden" name="section" value="full"></form>
  <form id="regen-title" method="post" action="/articles/${a.id}/regenerate"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><input type="hidden" name="section" value="title"></form>
  <form id="regen-excerpt" method="post" action="/articles/${a.id}/regenerate"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><input type="hidden" name="section" value="excerpt"></form>
  <form id="regen-seo" method="post" action="/articles/${a.id}/regenerate"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><input type="hidden" name="section" value="seo"></form>
  <form id="regen-body" method="post" action="/articles/${a.id}/regenerate"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><input type="hidden" name="section" value="body"></form>
  <form id="publish-now" method="post" action="/articles/${a.id}/publish" onsubmit="return confirm('Publish this article to Shopify now?')"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"></form>
  <form id="schedule" method="post" action="/articles/${a.id}/schedule"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"></form>
  <form id="cancel-schedule" method="post" action="/articles/${a.id}/cancel-schedule"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"></form>
  <form id="duplicate" method="post" action="/articles/${a.id}/duplicate"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"></form>
  <form id="archive" method="post" action="/articles/${a.id}/archive" onsubmit="return confirm('Archive this article?')"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"></form>
  <form id="retry" method="post" action="/articles/${a.id}/retry"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"></form>
  ` : ""}`;
}

function toLocalInput(date: Date, timezone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch {
    return "";
  }
}

export function newArticlePage(args: { settings: Settings; csrf: string; productsWarning?: string }) {
  return `
  <div class="grid two">
    <section class="card">
      <h2>Create manually</h2>
      <p class="muted">Start a blank draft and edit every field yourself.</p>
      <form method="post" action="/articles">
        <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
        <input type="hidden" name="intent" value="save">
        <label>Title<input name="title" required placeholder="Article title"></label>
        <label>Topic / notes<textarea name="excerpt" rows="3" placeholder="Optional starting excerpt"></textarea></label>
        <div class="actions"><button class="primary" type="submit">Create draft</button></div>
      </form>
    </section>
    <section class="card">
      <h2>Generate with AI</h2>
      ${args.productsWarning ? `<div class="notice error">${esc(args.productsWarning)}</div>` : ""}
      <form method="post" action="/articles/generate" class="stack">
        <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
        <label>Topic<input name="topic" placeholder="e.g. Preparing artwork for gang sheets"></label>
        <label>Article type<input name="articleType" value="educational guide"></label>
        <label>Primary keyword<input name="primaryKeyword" value="${esc(args.settings.primaryKeywordDefault)}"></label>
        <label>Secondary keywords<input name="secondaryKeywords" value="${esc(args.settings.secondaryKeywordsDefault.join(", "))}"></label>
        <label>Desired length
          <select name="desiredLength">
            <option value="short">Short</option>
            <option value="medium" selected>Medium</option>
            <option value="long">Long</option>
            <option value="custom">Custom (settings)</option>
          </select>
        </label>
        <label>Call to action<textarea name="callToAction" rows="2">${esc(args.settings.defaultCta)}</textarea></label>
        <label class="toggle"><input type="checkbox" name="internalLinking" checked> Use product internal links when available</label>
        <label class="toggle"><input type="checkbox" name="draftOnly" ${checked(args.settings.draftOnlyMode)}> Save as draft only (do not publish)</label>
        <div class="actions"><button class="primary" type="submit">Generate article</button></div>
      </form>
    </section>
  </div>`;
}

export function settingsPage(args: {
  settings: Settings;
  config: AppConfig;
  blogs: Array<{ id: string; title: string; handle: string }>;
  csrf: string;
  openaiModels?: string[];
}) {
  const s = args.settings;
  const secret = (configured: boolean) => configured ? "Configured" : "Not configured";
  return `
  <form method="post" action="/settings" class="grid two">
    <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
    <section class="card">
      <h2>Publishing & store</h2>
      <label class="toggle"><input type="checkbox" name="enabled" ${checked(s.enabled)}> Automatic publishing enabled (Autopilot)</label>
      <label class="toggle"><input type="checkbox" name="draftOnlyMode" ${checked(s.draftOnlyMode)}> Draft-only mode (generate without publishing)</label>
      <div class="row">
        <label>Cadence<select name="cadence"><option value="daily" ${selected(s.cadence, "daily")}>Once daily</option><option value="twice_daily" ${selected(s.cadence, "twice_daily")}>Twice daily</option></select></label>
        <label>Timezone<input name="timezone" value="${esc(s.timezone)}"></label>
      </div>
      <div class="row">
        <label>First publish time<input type="time" name="firstTime" value="${esc(s.firstTime)}"></label>
        <label>Second publish time<input type="time" name="secondTime" value="${esc(s.secondTime)}"></label>
      </div>
      <label>Selected Shopify blog
        <select name="shopifyBlogId">
          <option value="">Prefer News / first available</option>
          ${args.blogs.map(b => `<option value="${esc(b.id)}" ${selected(s.shopifyBlogId || "", b.id)}>${esc(b.title)} (${esc(b.handle)})</option>`).join("")}
        </select>
      </label>
      <input type="hidden" name="shopifyBlogHandle" value="${esc(s.shopifyBlogHandle)}">
      <label>Storefront URL<input name="storefrontUrl" value="${esc(s.storefrontUrl)}"></label>
      <label>Business name<input name="businessName" value="${esc(s.businessName)}"></label>
      <label>Default author<input name="authorName" value="${esc(s.authorName)}"></label>
      <label>Retry limit<input type="number" name="retryLimit" min="1" max="8" value="${s.retryLimit}"></label>
    </section>
    <section class="card">
      <h2>Brand & AI</h2>
      <label>Brand voice<textarea name="brandVoice" rows="3">${esc(s.brandVoice)}</textarea></label>
      <label>Target audience<textarea name="targetAudience" rows="2">${esc(s.targetAudience)}</textarea></label>
      <label>Default CTA<textarea name="defaultCta" rows="2">${esc(s.defaultCta)}</textarea></label>
      <label>Approved business facts (one per line)<textarea name="facts" rows="8">${esc(s.facts.join("\n"))}</textarea></label>
      <label>Content pillars (one per line)<textarea name="contentPillars" rows="6">${esc(s.contentPillars.join("\n"))}</textarea></label>
      <div class="row">
        <label>Min words<input type="number" name="wordCountMin" value="${s.wordCountMin}"></label>
        <label>Max words<input type="number" name="wordCountMax" value="${s.wordCountMax}"></label>
      </div>
      <label>OpenAI model
        <input name="openaiModel" list="model-list" value="${esc(s.openaiModel || args.config.OPENAI_MODEL)}" placeholder="${esc(args.config.OPENAI_MODEL)}">
        <datalist id="model-list">${(args.openaiModels || []).map(m => `<option value="${esc(m)}"></option>`).join("")}</datalist>
      </label>
      <label class="toggle"><input type="checkbox" name="enableAiImages" ${checked(s.enableAiImages)}> Enable optional AI image generation</label>
      <h3>Topic research</h3>
      <label class="toggle"><input type="checkbox" name="researchEnabled" ${checked(s.research.enabled)}> Enable research cycles</label>
      <label>Rollout mode
        <select name="rolloutMode">
          <option value="paused" ${selected(s.rolloutMode, "paused")}>PAUSED</option>
          <option value="observe" ${selected(s.rolloutMode, "observe")}>OBSERVE</option>
          <option value="draft_only" ${selected(s.rolloutMode, "draft_only")}>DRAFT_ONLY</option>
          <option value="shadow_auto" ${selected(s.rolloutMode, "shadow_auto")}>SHADOW_AUTO</option>
          <option value="auto_publish" ${selected(s.rolloutMode, "auto_publish")}>AUTO_PUBLISH (explicit only)</option>
        </select>
      </label>
      <label>Research cadence
        <select name="researchCadence">
          <option value="daily" ${selected(s.researchCadence, "daily")}>Once daily</option>
          <option value="twice_daily" ${selected(s.researchCadence, "twice_daily")}>Twice daily</option>
        </select>
      </label>
      <label>Research region<input name="researchRegion" value="${esc(s.research.region)}"></label>
      <label>Freshness max days<input name="researchFreshnessMaxDays" type="number" min="1" max="365" value="${esc(s.research.freshnessMaxDays)}"></label>
      <h3>Publish frequency limits</h3>
      <div class="row">
        <label>Max published / 7 days<input type="number" name="maxPublishedPerRolling7Days" min="0" max="50" value="${s.frequencyLimits.maxPublishedPerRolling7Days}"></label>
        <label>Min hours between publishes<input type="number" name="minHoursBetweenPublishes" min="0" max="168" value="${s.frequencyLimits.minHoursBetweenPublishes}"></label>
        <label>Max articles / cycle<input type="number" name="maxArticlesPerCycle" min="1" max="5" value="${s.frequencyLimits.maxArticlesPerCycle}"></label>
      </div>
      <label class="toggle"><input type="checkbox" name="researchRequireInterview" ${checked(s.research.requireInterviewForFirstPerson)}> Require merchant interview for first-person stories</label>
      <label class="toggle"><input type="checkbox" name="activateAutoPublish" ${checked(false)}> Explicitly activate AUTO_PUBLISH (only after promotion gates)</label>
      <p class="muted">Promotion requires ${s.promotionThresholds.minConsecutiveReviewedDrafts} reviewed drafts, ${Math.round(s.promotionThresholds.minMerchantApprovalRate * 100)}% approval, and ${s.promotionThresholds.minShadowAutoDays} SHADOW_AUTO days. Current: ${s.promotionProgress.consecutiveReviewedDrafts} drafts · ${Math.round(s.promotionProgress.merchantApprovalRate * 100)}% · ${s.promotionProgress.shadowAutoDays} days.</p>
      <label class="toggle"><input type="checkbox" name="clearKillSwitch" ${checked(false)}> Clear kill switch (after remediation)</label>
      <h3>Secrets (Railway only)</h3>
      <ul class="list muted">
        <li>OPENAI_API_KEY: ${secret(Boolean(args.config.OPENAI_API_KEY))}</li>
        <li>SHOPIFY_CLIENT_SECRET: ${secret(Boolean(args.config.SHOPIFY_CLIENT_SECRET))}</li>
        <li>ADMIN_PASSWORD: ${secret(Boolean(args.config.ADMIN_PASSWORD))}</li>
      </ul>
      <div class="actions"><button class="primary" type="submit">Save settings</button></div>
    </section>
  </form>`;
}

export function diagnosticsPage(args: {
  health: unknown;
  shopify: unknown;
  openai: unknown;
  scheduler: unknown;
  csrf: string;
}) {
  return `
  <div class="grid two">
    <section class="card">
      <h2>Health</h2>
      <pre class="code-block">${esc(JSON.stringify(args.health, null, 2))}</pre>
      <div class="actions">
        <form method="post" action="/diagnostics/shopify"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><button type="submit">Run Shopify diagnostics</button></form>
        <form method="post" action="/diagnostics/openai"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><button type="submit">Run OpenAI diagnostics</button></form>
        <form method="post" action="/diagnostics/scheduler"><input type="hidden" name="_csrf" value="${esc(args.csrf)}"><button type="submit">Run scheduler diagnostics</button></form>
      </div>
    </section>
    <section class="card">
      <h2>Shopify</h2>
      <pre class="code-block">${esc(JSON.stringify(args.shopify, null, 2))}</pre>
      <h2>OpenAI</h2>
      <pre class="code-block">${esc(JSON.stringify(args.openai, null, 2))}</pre>
      <h2>Scheduler</h2>
      <pre class="code-block">${esc(JSON.stringify(args.scheduler, null, 2))}</pre>
    </section>
  </div>`;
}

export function researchPage(args: {
  settings: Settings;
  csrf: string;
  cycle: { collectedAt: string; missingProviders: Array<{ provider: string; reason: string }>; signalCount: number } | null;
  opportunities: ResearchOpportunity[];
  pillars: typeof CONTENT_PILLARS;
  sourceHealth?: {
    providers: Array<{
      provider: string;
      available: boolean;
      reason: string | null;
      lastCollectedAt: string | null;
    }>;
    sourceCountByType: Array<{ sourceType: string; count: number }>;
    readerTaskCount: number;
    acceptedReaderTaskCount: number;
    rejectedNormalizationCount: number;
    recentRejectionReasons: Array<{ reason: string; count: number }>;
  } | null;
}) {
  const missing = args.cycle?.missingProviders?.length
    ? `<div class="notice">${args.cycle.missingProviders.map(m => `<div><strong>${esc(m.provider)}</strong>: ${esc(m.reason)}</div>`).join("")}</div>`
    : `<p class="muted">No missing providers recorded yet.</p>`;

  const sourceHealth = args.sourceHealth;
  const sourceHealthCard = sourceHealth
    ? `<section class="card">
        <h3>Source evidence health (M2)</h3>
        <p class="muted">First-party ingestion status. Seed brainstorming is never validated demand. Generation pipeline unchanged.</p>
        <div class="row" style="gap:1.5rem;flex-wrap:wrap">
          <div><strong>${esc(String(sourceHealth.acceptedReaderTaskCount))}</strong> accepted ReaderTasks · ${esc(String(sourceHealth.readerTaskCount))} total</div>
          <div><strong>${esc(String(sourceHealth.rejectedNormalizationCount))}</strong> normalization rejections</div>
        </div>
        <h4>Providers</h4>
        <ul>${sourceHealth.providers.length
          ? sourceHealth.providers.map(p =>
              `<li><strong>${esc(p.provider)}</strong>: ${p.available ? "available" : "unavailable"}
                ${p.lastCollectedAt ? ` · last ${esc(new Date(p.lastCollectedAt).toLocaleString("en-US", { timeZone: args.settings.timezone }))}` : ""}
                ${p.reason ? `<div class="muted">${esc(p.reason)}</div>` : ""}</li>`
            ).join("")
          : "<li class=\"muted\">No ingestion runs yet. Use “Ingest approved sources”.</li>"}</ul>
        <h4>Sources by type</h4>
        <ul>${sourceHealth.sourceCountByType.length
          ? sourceHealth.sourceCountByType.map(s => `<li>${esc(s.sourceType)}: ${esc(String(s.count))}</li>`).join("")
          : "<li class=\"muted\">None</li>"}</ul>
        ${sourceHealth.recentRejectionReasons.length
          ? `<h4>Recent rejection reasons</h4><ul>${sourceHealth.recentRejectionReasons.map(r =>
              `<li>${esc(r.reason)}: ${esc(String(r.count))}</li>`
            ).join("")}</ul>`
          : ""}
        <form method="post" action="/research/ingest-sources" class="actions" style="margin-top:0.75rem">
          <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
          <button type="submit" ${args.settings.research.enabled ? "" : "disabled"}>Ingest approved sources</button>
        </form>
      </section>`
    : "";

  const failureSummary = (() => {
    const counts = new Map<string, number>();
    for (const o of args.opportunities) {
      if (o.decision !== "REJECTED" && o.decision !== "NEEDS_MERCHANT_INPUT" && o.decision !== "DRAFT_ONLY") {
        continue;
      }
      const missing = o.editorialDecision?.missingEvidence || [];
      if (missing.length) {
        for (const m of missing) {
          counts.set(m, (counts.get(m) || 0) + 1);
        }
      } else {
        const key = `${o.decision}:${o.contentPromiseClass || "unclassified"}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    if (!counts.size) return "";
    const items = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, n]) => `<li>${esc(k)}: ${n}</li>`)
      .join("");
    return `<section class="card"><h3>Common editorial failure classes</h3><ul>${items}</ul></section>`;
  })();

  const rows = args.opportunities.slice(0, 25).map(o => `
    <tr>
      <td><a href="/research/opportunities/${esc(o.id)}">${esc(o.proposedTitle)}</a>
        <div class="muted">${esc(o.editorialDecision?.originalKeyword && o.editorialDecision.originalKeyword !== o.cluster.primaryKeyword
          ? `Refined from: ${o.editorialDecision.originalKeyword}`
          : "")}</div>
        <div class="muted">${esc((o.decisionReasons || []).slice(0, 2).join(" · "))}</div>
      </td>
      <td>${esc(o.cluster.pillar)}</td>
      <td>${esc(o.cluster.primaryKeyword)}</td>
      <td>${esc(o.contentPromiseClass || "—")}</td>
      <td>${esc((o.editorialDecision?.missingEvidence || []).join("; ") || "—")}</td>
      <td>${esc(o.scores.opportunityScore.toFixed(3))}</td>
      <td>${esc(o.decision || "—")}${o.editorialDecision?.replacedByOtherTopic ? " (replaced)" : ""}</td>
      <td>${esc(o.status)}</td>
      <td>${o.editorialDecision?.merchantInputWouldUnlock ? "Yes" : "No"}</td>
    </tr>`).join("") || `<tr><td colspan="9" class="muted">No opportunities yet. Run a research cycle.</td></tr>`;

  return `
  <section class="card">
    <div class="row" style="justify-content:space-between;gap:1rem;flex-wrap:wrap">
      <div>
        <h2>Topic research</h2>
        <p class="muted">Search-demand opportunities across all content pillars. Draft-only until merchant review.</p>
      </div>
      <form method="post" action="/research/run">
        <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
        <button class="primary" type="submit" ${args.settings.research.enabled ? "" : "disabled"}>Run research cycle</button>
      </form>
    </div>
    ${args.cycle ? `<p><strong>${esc(args.cycle.signalCount)}</strong> signals · collected ${esc(new Date(args.cycle.collectedAt).toLocaleString("en-US", { timeZone: args.settings.timezone }))}</p>` : ""}
    ${missing}
  </section>
  ${sourceHealthCard}
  ${failureSummary}
  <section class="card">
    <h3>Approved content pillars</h3>
    <ul>${args.pillars.map(p => `<li><strong>${esc(p.label)}</strong> — ${esc(p.subcategories.slice(0, 3).join(", "))}</li>`).join("")}</ul>
    <p class="muted">Target balance: DTF 25% · Garment 20% · Design 15% · Business 15% · Entrepreneurship 15% · Story 10% (configurable in settings JSON).</p>
  </section>
  <section class="card">
    <h3>Ranked opportunities</h3>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Topic</th><th>Pillar</th><th>Keyword</th><th>Promise</th><th>Missing evidence</th><th>Score</th><th>Decision</th><th>Status</th><th>Merchant input?</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>
  <section class="card">
    <h3>Enter my own topic</h3>
    <form method="post" action="/research/custom" class="stack">
      <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
      <label>Topic<input name="topic" required placeholder="e.g. Cotton vs polyester for school spirit wear"></label>
      <div class="actions"><button type="submit">Build brief from custom topic</button></div>
    </form>
  </section>`;
}

export function researchOverlapRejectedPage(args: {
  topic: string;
  overlap: OverlapMatch;
  csrf: string;
}) {
  const match = args.overlap;
  const link = match.url
    ? `<a href="${esc(match.url)}" target="_blank" rel="noreferrer">${esc(match.title)}</a>`
    : match.articleId
      ? `<a href="/articles/${esc(match.articleId)}">${esc(match.title)}</a>`
      : esc(match.title);

  return `
  <section class="card">
    <h2>Topic overlaps existing content</h2>
    <p><strong>This topic substantially overlaps an existing article.</strong></p>
    <p>Entered topic: <em>${esc(args.topic)}</em></p>
    <dl class="detail-list">
      <dt>Matching content</dt><dd>${link}</dd>
      <dt>Handle / ID</dt><dd>${esc(match.handle)}${match.shopifyArticleId ? ` · Shopify ${esc(match.shopifyArticleId)}` : ""}</dd>
      <dt>Status / source</dt><dd>${esc(match.status)}${match.source ? ` (${esc(match.source)})` : ""}</dd>
      <dt>Overlap score</dt><dd>${esc(String(match.score))}</dd>
      <dt>Reason</dt><dd>${esc(match.reason)}</dd>
    </dl>
    <p>Refine the angle so it answers a meaningfully different question, or choose a researched opportunity instead.</p>
    <form method="post" action="/research/custom" class="stack">
      <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
      <label>Refined topic<input name="topic" required value="${esc(args.topic)}"></label>
      <div class="actions">
        <button class="primary" type="submit">Try refined topic</button>
        <a class="ghost" href="/research">Back to research</a>
      </div>
    </form>
  </section>`;
}

export function briefReviewPage(args: {
  brief: ArticleBrief;
  csrf: string;
  interview?: MerchantInterview | null;
}) {
  const b = args.brief;
  const interviewGate = b.requiresInterview && !args.interview?.completed
    ? `<div class="notice error">Merchant interview answers are required before generation for this first-person / story topic.</div>
       <p><a class="primary" href="/research/briefs/${b.id}/interview">Answer interview questions</a></p>`
    : "";

  return `
  <section class="card">
    <h2>Article brief</h2>
    <p class="muted">${esc(b.dataCollectedLabel)}</p>
    ${interviewGate}
    <dl class="detail-list">
      <dt>Content pillar</dt><dd>${esc(b.pillar)}</dd>
      <dt>Target audience</dt><dd>${esc(b.targetAudienceLabel)}</dd>
      <dt>Subcategory</dt><dd>${esc(b.subcategory)}</dd>
      <dt>Primary keyword</dt><dd>${esc(b.primaryKeyword)}</dd>
      <dt>Secondary cluster</dt><dd>${esc(b.secondaryKeywords.join(", ") || "—")}</dd>
      <dt>Reader question</dt><dd>${esc(b.readerQuestion || "—")}</dd>
      <dt>Search intent</dt><dd>${esc(b.searchIntent)}</dd>
      <dt>Decision</dt><dd>${esc(b.decision || "DRAFT_ONLY")} ${b.automaticPublishingEligible ? "(auto-eligible)" : "(not auto-eligible)"}</dd>
      <dt>Decision reasons</dt><dd>${esc((b.decisionReasons || []).join(" · ") || "—")}</dd>
      <dt>Original topic</dt><dd>${esc(b.editorialDecision?.originalKeyword || b.primaryKeyword)}</dd>
      <dt>Refined topic</dt><dd>${esc(b.editorialDecision?.refinedKeyword || "—")}</dd>
      <dt>Content promise class</dt><dd>${esc(b.contentPromiseClass || b.editorialDecision?.contentPromiseClass || "—")}</dd>
      <dt>Missing evidence</dt><dd>${esc((b.editorialDecision?.missingEvidence || []).join("; ") || "—")}</dd>
      <dt>Merchant input would unlock</dt><dd>${b.editorialDecision?.merchantInputWouldUnlock ? "Yes" : "No"}</dd>
      <dt>Evidence confidence</dt><dd>${esc(String(b.evidenceConfidence ?? "—"))}</dd>
      <dt>Topic specificity / uniqueness</dt><dd>${esc(String(b.topicSpecificity ?? "—"))} / ${esc(String(b.uniqueness ?? "—"))}</dd>
      <dt>Demand class</dt><dd>${esc(b.demandClass || "editorial_business_opportunity")}</dd>
      <dt>Geographic target</dt><dd>${esc(b.geographicTarget)}</dd>
      <dt>Demand evidence</dt><dd>${esc(b.demandEvidence)}</dd>
      <dt>Proposed H1</dt><dd>${esc(b.proposedH1 || b.proposedTitle)}</dd>
      <dt>Conversion path</dt><dd>${esc(b.conversionPath || "—")}</dd>
      <dt>Estimated competition</dt><dd>${esc(b.estimatedCompetition)}</dd>
      <dt>Conversion relevance</dt><dd>${esc(b.conversionRelevance)}</dd>
      <dt>Closest existing article</dt><dd>${esc(b.closestExistingTitle || "None")}</dd>
      <dt>Overlap score</dt><dd>${esc(String(b.overlapScore))}</dd>
      <dt>Why distinct</dt><dd>${esc(b.whyDistinct)}</dd>
      <dt>Proposed format</dt><dd>${esc(FORMAT_LABELS[b.format])}</dd>
      <dt>Freshness class</dt><dd>${esc(b.freshnessClass)}</dd>
      <dt>Interview required</dt><dd>${b.requiresInterview ? "Yes" : "No"}</dd>
      <dt>Proposed title</dt><dd>${esc(b.proposedTitle)}</dd>
      <dt>Proposed handle</dt><dd>${esc(b.proposedHandle)}</dd>
      <dt>Products to feature</dt><dd>${esc(b.productsToFeature.map(p => p.title).join(", ") || "None (trust-building OK)")}</dd>
      <dt>Internal links</dt><dd>${esc(b.internalLinks.join(", ") || "—")}</dd>
      <dt>External sources</dt><dd>${esc(b.externalSources.map(s => s.url).join(", ") || "—")}</dd>
      <dt>Opportunity score</dt><dd>${esc(String(b.scores.opportunityScore))}</dd>
    </dl>
    <h3>Proposed outline</h3>
    <ol>${b.proposedOutline.map(item => `<li>${esc(item)}</li>`).join("")}</ol>
    ${b.seoDeliverables ? `<h3>SEO deliverables</h3>
    <dl class="detail-list">
      <dt>SEO title</dt><dd>${esc(b.seoDeliverables.seoTitle)}</dd>
      <dt>H1</dt><dd>${esc(b.seoDeliverables.h1)}</dd>
      <dt>Canonical</dt><dd>${esc(b.seoDeliverables.canonicalUrl || "—")}</dd>
      <dt>Meta description</dt><dd>${esc(b.seoDeliverables.metaDescription)} <span class="muted">(${b.seoDeliverables.metaDescription.length} chars)</span></dd>
      <dt>Image brief / alt</dt><dd>${esc(b.seoDeliverables.imageBrief)}<br><span class="muted">${esc(b.seoDeliverables.imageAltText)}</span></dd>
      <dt>Structured data</dt><dd>${esc(b.seoDeliverables.structuredDataRecommendation.type)} · ${esc(b.seoDeliverables.structuredDataRecommendation.notes[0] || "")}</dd>
      <dt>SEO validation</dt><dd>${b.seoDeliverables.validation.ok ? "Pass" : esc(b.seoDeliverables.validation.issues.join("; "))}</dd>
    </dl>` : ""}
    <h3>Legends facts (approved)</h3>
    <ul>${(b.factSheet.legendsFacts || b.factSheet.businessFacts).map(f => `<li>${esc(f)}</li>`).join("") || "<li class=\"muted\">No Legends facts locked</li>"}</ul>
    <h3>External facts</h3>
    <ul>${(b.factSheet.externalFacts || []).map(f => `<li>${esc(f.claim)} — <a href="${esc(f.sourceUrl)}" target="_blank" rel="noreferrer">${esc(f.sourceTitle || f.publisher)}</a> <span class="muted">(${esc(f.retrievedAt)})</span></li>`).join("") || "<li class=\"muted\">No external facts locked (source-free articles must avoid technical/statistical claims)</li>"}</ul>
    <p class="muted">${esc(b.factSheet.reviewFlags.join(" · "))}</p>
    <p class="muted">Failed gates: ${esc((b.failedGates || []).join(", ") || "none")}</p>
    <div class="actions" style="flex-wrap:wrap;gap:.5rem">
      <form method="post" action="/research/briefs/${b.id}/approve-generate">
        <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
        <button class="primary" type="submit" ${b.requiresInterview && !args.interview?.completed ? "disabled" : ""}>Approve and Generate</button>
      </form>
      <form method="post" action="/research/briefs/${b.id}/choose-another">
        <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
        <button type="submit">Choose Another Opportunity</button>
      </form>
      <a class="ghost" href="/research">Back to research</a>
    </div>
  </section>`;
}

export function interviewPage(args: {
  brief: ArticleBrief;
  interview: MerchantInterview;
  csrf: string;
}) {
  const fields = args.interview.questions.map(q => `
    <label>${esc(q.question)}
      <textarea name="${esc(q.id)}" rows="3" required minlength="8">${esc(q.answer || "")}</textarea>
    </label>`).join("");

  return `
  <section class="card">
    <h2>Merchant interview</h2>
    <p>Answer from real experience only. These answers become the locked source material for “${esc(args.brief.proposedTitle)}”. Do not invent details.</p>
    <form method="post" action="/research/briefs/${args.brief.id}/interview" class="stack">
      <input type="hidden" name="_csrf" value="${esc(args.csrf)}">
      ${fields}
      <div class="actions"><button class="primary" type="submit">Save interview answers</button></div>
    </form>
  </section>`;
}
