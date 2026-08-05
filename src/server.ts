import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { createDb, getSettings, insertManualJob, listJobs, migrate, saveSettings } from "./db.js";
import { AutopilotWorker } from "./scheduler.js";
import { verifyShopify } from "./shopify.js";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
await migrate(db);
const worker = new AutopilotWorker(db, config);
worker.start();

const app = express();
app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.json({ limit: "100kb" }));

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Basic ")) {
    const [, password = ""] = Buffer.from(auth.slice(6), "base64").toString().split(":", 2);
    if (safeEqual(password, config.ADMIN_PASSWORD)) return next();
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Legends Blog Autopilot"');
  return res.status(401).send("Authentication required");
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]!);
const checked = (value: boolean) => value ? "checked" : "";
const selected = (a: string, b: string) => a === b ? "selected" : "";

function layout(content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Legends Blog Autopilot</title><style>
  :root{--ink:#17191c;--muted:#69717d;--paper:#f5f2ea;--card:#fff;--orange:#ef6c35;--green:#1f7651;--line:#dedbd3}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}.top{background:#16181a;color:#fff;padding:24px 0;border-bottom:5px solid var(--orange)}main,.top>div{width:min(1120px,calc(100% - 32px));margin:auto}.brand{font-size:24px;font-weight:850;letter-spacing:-.03em}.sub{color:#bfc4ca;margin-top:2px}.grid{display:grid;grid-template-columns:1.05fr .95fr;gap:20px;margin:24px auto}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;box-shadow:0 4px 14px #00000009}.wide{grid-column:1/-1}h2{margin:0 0 16px;font-size:18px}label{display:block;font-weight:700;margin:13px 0 5px}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;padding:10px 11px;border:1px solid #c9c7c1;border-radius:8px;background:#fff}textarea{min-height:145px;resize:vertical}.toggle{display:flex;gap:10px;align-items:center;margin-bottom:14px}.toggle input{width:auto;accent-color:var(--green)}button{border:0;border-radius:9px;padding:11px 16px;background:var(--ink);color:white;font-weight:800;cursor:pointer}.primary{background:var(--green)}.danger{background:#9e342c}.actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.status{display:inline-flex;padding:4px 9px;border-radius:999px;font-weight:800;font-size:12px;background:#e8e8e5}.published{background:#dcefe4;color:#145d3d}.failed{background:#f7dedb;color:#8b2d28}.running{background:#fff0c7;color:#795b00}.metric{font-size:30px;font-weight:850}.muted{color:var(--muted)}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #ece9e2;vertical-align:top}th{font-size:12px;text-transform:uppercase;color:var(--muted)}a{color:#176a4a}.notice{padding:11px 13px;border-radius:8px;background:#e6f2ea;color:#185b3e;margin-bottom:16px}.error{background:#f8dfdc;color:#852e28}@media(max-width:780px){.grid{grid-template-columns:1fr}.wide{grid-column:auto}.row{grid-template-columns:1fr}table{font-size:12px}.hide-mobile{display:none}}
  </style></head><body><header class="top"><div><div class="brand">LEGENDS BLOG AUTOPILOT</div><div class="sub">Hands-off Shopify content for Legends DTF Prints</div></div></header><main>${content}</main></body></html>`;
}

app.get("/health", async (_req, res) => {
  try { await db.query("SELECT 1"); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); }
});

app.use(requireAdmin);

app.get("/", async (req, res) => {
  const [settings, jobs] = await Promise.all([getSettings(db), listJobs(db)]);
  const published = jobs.filter(j => j.status === "published").length;
  const nextLabel = settings.cadence === "daily" ? settings.firstTime : `${settings.firstTime} & ${settings.secondTime}`;
  const message = req.query.saved ? '<div class="notice">Settings saved.</div>' : req.query.queued ? '<div class="notice">A publish-now job was queued.</div>' : "";
  const rows = jobs.map(job => `<tr><td><span class="status ${esc(job.status)}">${esc(job.status)}</span></td><td>${esc(new Date(job.scheduled_for).toLocaleString("en-US", {timeZone: settings.timezone}))}</td><td>${job.article ? esc(job.article.title) : '<span class="muted">Waiting to generate</span>'}</td><td class="hide-mobile">${esc(job.attempts)}</td><td>${job.shopify_url ? `<a href="${esc(job.shopify_url)}" target="_blank" rel="noreferrer">View</a>` : job.error ? `<span title="${esc(job.error)}">Error</span>` : "—"}</td></tr>`).join("");
  res.send(layout(`${message}<div class="grid">
    <section class="card"><h2>Autopilot status</h2><div class="row"><div><div class="muted">Current state</div><div class="metric">${settings.enabled ? "Live" : "Paused"}</div></div><div><div class="muted">Publishing schedule</div><div class="metric" style="font-size:22px">${esc(nextLabel)}</div><div class="muted">${esc(settings.timezone)}</div></div></div>
      <form method="post" action="/publish-now" class="actions"><button class="primary">Publish now</button></form></section>
    <section class="card"><h2>Recent activity</h2><div class="metric">${published}</div><div class="muted">published in the latest ${jobs.length} jobs</div><p class="muted">Failed jobs retry automatically up to four times with backoff.</p></section>
    <section class="card wide"><h2>Settings</h2><form method="post" action="/settings">
      <label class="toggle"><input type="checkbox" name="enabled" ${checked(settings.enabled)}> Automatic publishing enabled</label>
      <div class="row"><div><label>Cadence</label><select name="cadence"><option value="daily" ${selected(settings.cadence,"daily")}>Once daily</option><option value="twice_daily" ${selected(settings.cadence,"twice_daily")}>Twice daily</option></select></div><div><label>Timezone</label><input name="timezone" value="${esc(settings.timezone)}"></div></div>
      <div class="row"><div><label>First publish time</label><input type="time" name="firstTime" value="${esc(settings.firstTime)}"></div><div><label>Second publish time</label><input type="time" name="secondTime" value="${esc(settings.secondTime)}"></div></div>
      <div class="row"><div><label>Minimum words</label><input type="number" name="wordCountMin" min="500" max="2500" value="${settings.wordCountMin}"></div><div><label>Maximum words</label><input type="number" name="wordCountMax" min="700" max="3000" value="${settings.wordCountMax}"></div></div>
      <label>Article author</label><input name="authorName" value="${esc(settings.authorName)}">
      <div class="row"><div><label>Approved business facts (one per line)</label><textarea name="facts">${esc(settings.facts.join("\n"))}</textarea></div><div><label>Content pillars (one per line)</label><textarea name="contentPillars">${esc(settings.contentPillars.join("\n"))}</textarea></div></div>
      <div class="actions"><button>Save settings</button></div></form></section>
    <section class="card wide"><h2>Publishing history</h2><div style="overflow:auto"><table><thead><tr><th>Status</th><th>Scheduled</th><th>Article</th><th class="hide-mobile">Attempts</th><th>Result</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No jobs yet.</td></tr>'}</tbody></table></div></section>
  </div>`));
});

const settingsSchema = z.object({
  enabled: z.string().optional().transform(Boolean), cadence: z.enum(["daily", "twice_daily"]),
  timezone: z.string().min(3).max(80), firstTime: z.string().regex(/^\d{2}:\d{2}$/), secondTime: z.string().regex(/^\d{2}:\d{2}$/),
  authorName: z.string().min(2).max(100), wordCountMin: z.coerce.number().int().min(500).max(2500), wordCountMax: z.coerce.number().int().min(700).max(3000),
  facts: z.string().transform(v => v.split(/\r?\n/).map(s => s.trim()).filter(Boolean)), contentPillars: z.string().transform(v => v.split(/\r?\n/).map(s => s.trim()).filter(Boolean))
}).refine(v => v.wordCountMax >= v.wordCountMin, "Maximum words must be at least minimum words");

app.post("/settings", async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).send(layout(`<div class="grid"><section class="card wide"><div class="notice error">${esc(parsed.error.issues.map(i => i.message).join("; "))}</div><a href="/">Return to settings</a></section></div>`));
  await saveSettings(db, parsed.data);
  res.redirect("/?saved=1");
});

app.post("/publish-now", async (_req, res) => { await insertManualJob(db); void worker.tick(); res.redirect("/?queued=1"); });
app.get("/api/status", async (_req, res) => res.json({ settings: await getSettings(db), jobs: await listJobs(db, 20) }));
app.get("/api/verify-shopify", async (_req, res) => { try { res.json({ ok: true, ...(await verifyShopify(config)) }); } catch (error) { res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) }); } });

const server = app.listen(config.PORT, () => console.log(`Legends Blog Autopilot listening on ${config.PORT}`));
async function shutdown() { worker.stop(); server.close(); await db.end(); }
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
