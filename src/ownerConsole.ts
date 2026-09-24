import type { Router } from "express";
import type { Db } from "./db.js";
import type { AuthedRequest } from "./auth.js";
import { getSettings, recordAudit } from "./db.js";
import { submitInterviewAnswerAsPendingKnowledge } from "./research/knowledgeStore.js";
import type { KnowledgeClass } from "./research/knowledgeRegistry.js";

type Row = Record<string, any>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string => v == null ? "" : String(v);
const esc = (v: unknown): string => str(v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fmt = (v: unknown): string => v ? new Date(str(v)).toLocaleDateString("en-US", { timeZone: "UTC" }) : "Not scheduled";
const cell = (v: unknown): string => `<span>${esc(v || "—")}</span>`;
const badge = (v: unknown): string => `<span class="badge">${esc(v || "unavailable")}</span>`;
const link = (id: unknown): string => encodeURIComponent(str(id));

function shell(title: string, content: string, csrf: string): string {
  const nav = [["", "Overview"], ["pipeline", "Pipeline"], ["research", "Research"], ["knowledge", "Knowledge"], ["questions", "Questions"], ["calendar", "Calendar"], ["settings", "Settings"], ["activity", "Activity"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${esc(title)} · Legends Owner Console</title><link rel="stylesheet" href="/assets/owner-console.css"></head>
  <body><header><strong>LEGENDS <small>OWNER CONSOLE</small></strong><span>Draft only · Production paused · No auto-publish</span></header>
  <div class="layout"><nav aria-label="Owner console">${nav.map(([route, label]) => `<a href="/owner/${route}">${label}</a>`).join("")}<hr><a href="/">M5 application</a></nav>
  <main><div class="eyebrow">Owner workspace / M5</div><h1>${esc(title)}</h1><div class="lock">Production is paused. This workspace cannot approve knowledge, override evidence gates, or publish.</div>${content}</main></div>
  <footer>ReaderTask, clustering, evidence, knowledge, titles, briefs, and rollout decisions remain in M5.</footer></body></html>`;
}
const panel = (title: string, body: string) => `<section class="panel"><h2>${esc(title)}</h2>${body}</section>`;
const empty = (message: string) => `<p class="muted">${esc(message)}</p>`;
const table = (heads: string[], rows: string[][]) => rows.length
  ? `<div class="scroll"><table><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  : empty("No M5 records yet. No sample data is shown.");

async function preference(db: Db): Promise<Row> {
  const { rows } = await db.query<{ value: Row }>("SELECT value FROM owner_console_preferences WHERE singleton=true");
  return rows[0]?.value ?? { frequency: "weekly", geography: "US", tone: "practical", depth: "standard", notifications: true };
}

export function mountOwnerConsole(router: Router, db: Db, csrf: (req: any) => string, checkCsrf: (req: any, res: any) => boolean): void {
  router.get("/", async (req, res) => {
    const [clusters, packets, entries, briefs, settings] = await Promise.all([
      db.query<{ n: string }>("SELECT count(*)::text n FROM opportunity_clusters WHERE status IN ('active','needs_review')"),
      db.query<{ n: string }>("SELECT count(*)::text n FROM merchant_interview_packets WHERE completion_status='open'"),
      db.query<{ n: string }>("SELECT count(*)::text n FROM knowledge_entries WHERE approval_state='PENDING_APPROVAL'"),
      db.query<{ n: string }>("SELECT count(*)::text n FROM article_briefs"),
      getSettings(db)
    ]);
    const counts = [["Pipeline briefs", briefs], ["Active research clusters", clusters], ["Questions needing an answer", packets], ["Pending knowledge entries", entries]];
    res.send(shell("Owner overview", `<div class="grid">${counts.map(([label, result]) => panel(str(label), `<strong class="count">${esc((result as { rows: { n: string }[] }).rows[0]?.n ?? "0")}</strong>`)).join("")}</div>
      ${panel("Next safe action", `<p>Review source evidence and owner scope before moving a draft forward.</p><p>Authoritative M5 rollout: ${badge(settings.rolloutMode)} · console mode: ${badge("draft_only")} · publishing: ${badge("disabled")}</p><a class="button" href="/owner/pipeline">Open pipeline →</a>`)}`, csrf(req)));
  });

  router.get("/pipeline", async (req, res) => {
    const { rows } = await db.query<Row>(`SELECT b.id, b.status, b.payload, b.updated_at, o.payload opportunity,
      a.title article_title FROM article_briefs b LEFT JOIN research_opportunities o ON o.id=b.opportunity_id
      LEFT JOIN articles a ON a.id=b.article_id ORDER BY b.updated_at DESC LIMIT 200`);
    const items = rows.map(r => {
      const p = obj(r.payload), o = obj(r.opportunity);
      return [ `<a href="/owner/pipeline/${link(r.id)}">${esc(r.article_title || p.proposedTitle || o.proposedTitle || "Untitled brief")}</a>`,
        badge(r.status), cell(p.targetAudienceLabel || p.audience), badge(p.decision || "review"), cell(p.readerQuestion || o.readerQuestion) ];
    });
    res.send(shell("Content pipeline", panel("M5 article briefs", table(["Brief", "Stage", "Audience", "Decision", "Reader question"], items)), csrf(req)));
  });

  router.get("/pipeline/:id", async (req, res) => {
    const { rows } = await db.query<Row>(`SELECT b.*, o.payload opportunity, a.title article_title
      FROM article_briefs b LEFT JOIN research_opportunities o ON o.id=b.opportunity_id
      LEFT JOIN articles a ON a.id=b.article_id WHERE b.id=$1`, [req.params.id]);
    if (!rows[0]) return res.status(404).send(shell("Brief not found", empty("No M5 brief has that identifier."), csrf(req)));
    const b = rows[0], p = obj(b.payload), o = obj(b.opportunity);
    const budget = p.clusterId ? await db.query<Row>("SELECT payload FROM cluster_evidence_budgets WHERE cluster_id=$1", [p.clusterId]) : { rows: [] };
    const ev = obj(budget.rows[0]?.payload);
    const lines = (values: unknown) => arr(values).length ? `<ul>${arr(values).map(x => `<li>${esc(typeof x === "string" ? x : JSON.stringify(x))}</li>`).join("")}</ul>` : empty("None recorded.");
    res.send(shell(str(b.article_title || p.proposedTitle || o.proposedTitle || "Brief detail"),
      `<a href="/owner/pipeline">← Pipeline</a><div class="grid">${panel("Framing", `<dl><dt>Reader question</dt><dd>${esc(p.readerQuestion || o.readerQuestion)}</dd><dt>Audience</dt><dd>${esc(p.targetAudienceLabel || p.audience)}</dd><dt>Decision</dt><dd>${badge(p.decision || b.status)}</dd><dt>Provenance</dt><dd>${esc(p.readerQuestionProvenance || "M5 article brief")}</dd></dl>`)}
      ${panel("Evidence boundary", `<p>Readiness: ${badge(obj(ev.evidenceReadiness).status || "unavailable")}</p><h3>Approved facts</h3>${lines(ev.approvedFacts)}<h3>Blocked claims</h3>${lines([ ...arr(ev.unsupportedClaims), ...arr(ev.prohibitedClaims) ])}<h3>Contradictions</h3>${lines(ev.conflictingClaims)}`)}
      ${panel("Draft outline", lines(p.proposedOutline))}${panel("Constraints", lines([ ...arr(p.failedGates), ...arr(obj(p.factSheet).reviewFlags) ]))}</div>`, csrf(req)));
  });

  router.get("/research", async (req, res) => {
    const { rows } = await db.query<Row>(`SELECT c.id,c.status,c.canonical_question,c.canonical_audience,c.merge_confidence,
      c.requires_manual_review,c.updated_at,b.readiness_status,b.payload budget
      FROM opportunity_clusters c LEFT JOIN cluster_evidence_budgets b ON b.cluster_id=c.id
      WHERE c.status IN ('active','needs_review') ORDER BY c.updated_at DESC LIMIT 200`);
    res.send(shell("ReaderTask research", panel("M5 clusters · review before drafting",
      table(["Question", "Audience", "Cluster", "Evidence", "Review"], rows.map(r =>
        [cell(r.canonical_question), cell(r.canonical_audience), badge(r.status), badge(r.readiness_status), cell(arr(obj(obj(r.budget).evidenceReadiness).blockingReasons).join("; ") || (r.requires_manual_review ? "Manual review required" : ""))]))), csrf(req)));
  });

  router.get("/knowledge", async (req, res) => {
    const { rows } = await db.query<Row>("SELECT payload FROM knowledge_entries ORDER BY updated_at DESC LIMIT 200");
    res.send(shell("Knowledge ledger", panel("M5 approval, scope and public-use state",
      table(["Claim", "Class", "Approval", "Scope", "Public use"], rows.map(r => {
        const p = obj(r.payload);
        return [cell(p.exactApprovedFact || p.normalizedClaim), cell(p.knowledgeClass), badge(p.approvalState),
          cell(obj(p.scope).applicableNotes || obj(p.scope).geographic), badge(p.approvalState === "APPROVED" && p.publicUsageAllowed === true ? "allowed" : "blocked")];
      }))), csrf(req)));
  });

  router.get("/questions", async (req, res) => {
    const { rows } = await db.query<Row>(`SELECT q.id,q.prompt,q.payload,p.completion_status,p.payload packet
      FROM merchant_interview_questions q JOIN merchant_interview_packets p ON p.id=q.packet_id
      WHERE p.completion_status IN ('open','answered_pending_approval')
      ORDER BY p.updated_at DESC,q.created_at LIMIT 200`);
    const cards = rows.map(r => panel(str(r.prompt), `<p>Required scope: ${esc(obj(r.payload).requiredScope || "Product, geography and effective date")}</p>
      <p>Impacted clusters: ${esc(arr(obj(r.packet).affectedClusterIds).join(", ") || "Not specified")}</p>
      <p>State: ${badge(r.completion_status === "open" ? "awaiting answer" : "answer pending review")}</p>
      ${r.completion_status === "open" ? `<form method="post" action="/owner/questions/${link(r.id)}/answer"><input type="hidden" name="_csrf" value="${esc(csrf(req))}">
        <label>Answer<textarea name="answer" required maxlength="4000"></textarea></label>
        <label>Scope<input name="scope" required maxlength="500" placeholder="Product, audience, region, exclusions"></label>
        <label>Effective date<input type="date" name="effectiveDate" required></label>
        <label><input type="checkbox" name="publicUsePermission"> Permission for possible future public use (does not approve the claim)</label>
        <button type="submit">Save pending answer</button></form>` : ""}`)).join("");
    res.send(shell("Merchant questions", cards || empty("No open M5 interview questions."), csrf(req)));
  });

  router.post("/questions/:id/answer", async (req, res) => {
    if (!checkCsrf(req, res)) return;
    const answer = str(req.body.answer).trim(), scope = str(req.body.scope).trim(), date = str(req.body.effectiveDate);
    if (!answer || answer.length > 4000 || !scope || scope.length > 500 || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)
      return res.status(400).send(shell("Invalid answer", empty("Answer, scope and a valid effective date are required."), csrf(req)));
    const { rows } = await db.query<{ packet_id: string; knowledge_class: KnowledgeClass; completion_status: string }>(
        `SELECT p.id packet_id,p.knowledge_class,p.completion_status FROM merchant_interview_questions q
         JOIN merchant_interview_packets p ON p.id=q.packet_id WHERE q.id=$1`, [req.params.id]);
    const item = rows[0];
    if (!item || item.completion_status !== "open")
      return res.status(item ? 409 : 404).send(shell("Question unavailable", empty("This question is not awaiting an answer."), csrf(req)));
    // Use M5's canonical pending-knowledge path; never set approval or public-use flags here.
    await submitInterviewAnswerAsPendingKnowledge(db, {
        packetId: item.packet_id, questionId: req.params.id, answerText: answer,
        knowledgeClass: item.knowledge_class, sourceReference: `merchant-interview:${item.packet_id}:${req.params.id}`,
        actor: `owner-console:${(req as AuthedRequest).auth?.user || "merchant"}`,
        scope: { applicableNotes: `${scope}; effective date: ${date}; public-use permission requested: ${Boolean(req.body.publicUsePermission)}` }
    });
    await recordAudit(db, { actor: (req as AuthedRequest).auth?.user || "merchant", action: "owner_answer_pending_review", detail: { questionId: req.params.id } });
    res.redirect(303, "/owner/questions");
  });

  router.get("/calendar", async (req, res) => {
    const { rows } = await db.query<Row>("SELECT id,title,status,scheduled_for FROM articles WHERE scheduled_for IS NOT NULL ORDER BY scheduled_for LIMIT 200");
    res.send(shell("Publishing calendar", panel("Read-only M5 schedule · production paused",
      table(["Date", "Article", "Status"], rows.map(r => [cell(fmt(r.scheduled_for)), cell(r.title), badge(r.status)]))), csrf(req)));
  });

  router.get("/settings", async (req, res) => {
    const p = await preference(db);
    const select = (key: string, options: string[]) => `<label>${esc(key)}<select name="${esc(key)}">${options.map(o => `<option value="${esc(o)}" ${p[key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
    res.send(shell("Safe drafting preferences", panel("Owner controls", `<p>Operating mode: ${badge("draft_only")} · Emergency pause: ${badge("locked on")} · Publishing: ${badge("disabled")}</p>
      <form method="post" action="/owner/settings"><input type="hidden" name="_csrf" value="${esc(csrf(req))}">
      ${select("frequency", ["weekly", "twice_weekly", "monthly"])}${select("geography", ["US", "North America", "Global"])}
      ${select("tone", ["practical", "warm", "technical"])}${select("depth", ["brief", "standard", "deep"])}
      <label><input type="checkbox" name="notifications" ${p.notifications ? "checked" : ""}> Owner notifications preference</label>
      <button type="submit">Save safe preferences</button></form>`), csrf(req)));
  });

  router.post("/settings", async (req, res) => {
    if (!checkCsrf(req, res)) return;
    const allowed: Record<string, string[]> = { frequency: ["weekly", "twice_weekly", "monthly"], geography: ["US", "North America", "Global"], tone: ["practical", "warm", "technical"], depth: ["brief", "standard", "deep"] };
    if (Object.keys(req.body).some(k => ![...Object.keys(allowed), "notifications", "_csrf"].includes(k)) ||
      Object.entries(allowed).some(([k, values]) => !values.includes(req.body[k])))
      return res.status(400).send(shell("Invalid preferences", empty("Production controls cannot be changed here."), csrf(req)));
    const value = Object.fromEntries(Object.keys(allowed).map(k => [k, req.body[k]]));
    await db.query(`INSERT INTO owner_console_preferences(singleton,value) VALUES (true,$1::jsonb)
      ON CONFLICT(singleton) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`, [JSON.stringify({ ...value, notifications: req.body.notifications === "on" })]);
    await recordAudit(db, { actor: (req as AuthedRequest).auth?.user || "merchant", action: "owner_preferences_updated", detail: {} });
    res.redirect(303, "/owner/settings");
  });

  router.get("/activity", async (req, res) => {
    const { rows } = await db.query<Row>(`SELECT created_at,actor,action FROM audit_events
      UNION ALL SELECT created_at,actor,action FROM knowledge_audit_events
      ORDER BY created_at DESC LIMIT 100`);
    res.send(shell("Activity", panel("Sanitized M5 audit trail", table(["When", "Actor", "Action"],
      rows.map(r => [cell(fmt(r.created_at)), cell(r.actor), cell(str(r.action).replaceAll("_", " "))]))), csrf(req)));
  });
}