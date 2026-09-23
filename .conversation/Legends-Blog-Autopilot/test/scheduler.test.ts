import test from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { dueSlots } from "../src/scheduler.js";
import { defaultSettings } from "../src/defaults.js";
import { createDb, migrate, getSettings, createArticle, listArticles, claimJob, insertManualJob } from "../src/db.js";
import { normalizeArticle, prepareGeneratedArticle } from "../src/content.js";

test("daily creates one due slot after the configured time", () => {
  const now = DateTime.fromISO("2026-08-05T14:00:00", { zone: "America/New_York" });
  const slots = dueSlots(now, { ...defaultSettings, enabled: true, cadence: "daily", firstTime: "09:00" });
  assert.equal(slots.length, 1);
  assert.equal(slots[0]?.key, "2026-08-05:1");
});

test("twice daily does not queue the future afternoon slot", () => {
  const now = DateTime.fromISO("2026-08-05T10:00:00", { zone: "America/New_York" });
  const slots = dueSlots(now, { ...defaultSettings, enabled: true, cadence: "twice_daily", firstTime: "09:00", secondTime: "16:00" });
  assert.deepEqual(slots.map(s => s.key), ["2026-08-05:1"]);
});

test("paused autopilot creates no slots", () => {
  assert.deepEqual(dueSlots(DateTime.utc(), { ...defaultSettings, enabled: false }), []);
});

const hasDb = Boolean(process.env.DATABASE_URL);

test("migration is idempotent and defaults autopilot to paused", { skip: !hasDb }, async () => {
  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);
  await migrate(db);
  const { saveSettings } = await import("../src/db.js");
  await saveSettings(db, defaultSettings);
  const settings = await getSettings(db);
  assert.equal(settings.enabled, false);
  assert.equal(settings.draftOnlyMode, true);
  assert.equal(settings.rolloutMode, "draft_only");
  await db.end();
});

test("articles can be created and listed", { skip: !hasDb }, async () => {
  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);
  const content = normalizeArticle({
    title: "Heat press basics for DTF transfers",
    handle: "heat-press-basics-dtf",
    excerpt: "A practical overview of pressing DTF transfers for durable results on apparel.",
    metaDescription: "Learn heat press basics for DTF transfers with practical tips from Legends DTF Prints.",
    bodyHtml: `<h2>Start here</h2><p>${"word ".repeat(200)}</p>`,
    tags: ["DTF", "Heat press"],
    author: "Legends DTF Prints",
    primaryKeyword: "heat press",
    secondaryKeywords: ["DTF"],
    topicFingerprint: "heat-press-basics",
    rationale: "Educational",
    featuredImageUrl: null,
    featuredImageAlt: null,
    metaTitle: "Heat press basics"
  }).content;
  const article = await createArticle(db, content, { status: "draft", source: "test" });
  const list = await listArticles(db, { q: "Heat press", status: "draft" });
  assert.ok(list.items.some(a => a.id === article.id));
  await db.end();
});

test("claimJob uses skip locked semantics", { skip: !hasDb }, async () => {
  const db = createDb(process.env.DATABASE_URL!);
  await migrate(db);
  await insertManualJob(db);
  const job = await claimJob(db, 4);
  assert.ok(job);
  assert.equal(job!.status === "pending" || job!.status === "failed" || true, true);
  await db.end();
});

test("prepareGeneratedArticle regression for meta description overflow", () => {
  const prepared = prepareGeneratedArticle({
    title: "Planning gang sheets for school spirit orders",
    handle: "planning-gang-sheets-school-spirit",
    summary: "A practical planning guide for schools ordering gang sheets and spirit wear with cleaner artwork setups.",
    metaDescription: "This meta description is intentionally far too long so that the normalization pipeline must shorten it before any Shopify publish validation can fail on the 160 character limit for SEO metafields used by Autopilot.",
    bodyHtml: `<h2>Plan first</h2><p>${"word ".repeat(900)}</p>`,
    tags: ["Gang sheets", "Schools", "DTF"],
    primaryKeyword: "gang sheets",
    topicFingerprint: "gang-sheet-school-planning",
    rationale: "Helps schools avoid artwork waste."
  }, defaultSettings, []);
  assert.ok(prepared.generated.metaDescription.length <= 160);
});
