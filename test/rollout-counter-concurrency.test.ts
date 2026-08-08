/**
 * Concurrent + rollback integration tests for transactional rollout counter.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createDb, migrate, getSettings, saveSettings, createArticle, updateArticle } from "../src/db.js";
import { defaultSettings } from "../src/defaults.js";
import { recordReviewedDraftForRollout, ROLLOUT_COUNTED_ACTION } from "../src/autopilot/rolloutProgress.js";
import {
  DEFAULT_RESEARCH_SETTINGS,
  evaluateCustomTopic,
  qualityGatesPassed,
  runQualityGates,
  saveEvidenceReport
} from "../src/research/index.js";

const databaseUrl = process.env.DATABASE_URL || "postgresql://legends:legends@localhost:5432/legends_blog";

async function seedEligibleArticle(db: ReturnType<typeof createDb>, handleSuffix: string): Promise<number> {
  const custom = evaluateCustomTopic("embroidery vs DTF for work shirts", {
    businessFacts: defaultSettings.facts,
    existingArticles: [],
    settings: DEFAULT_RESEARCH_SETTINGS
  });
  assert.equal(custom.ok, true);
  if (!custom.ok) throw new Error(custom.message);

  const paragraph =
    "Small-business owners choosing employee uniforms should compare embroidery and DTF using durability, detail, wash performance, and cost-per-piece criteria before they decide. Ask which method fits daily wear, verify artwork constraints, and choose the option that matches the job. ";
  const bodyHtml = `<h2>Decision criteria for work-shirt decoration</h2><p>${paragraph.repeat(20)}</p><h2>Trade-offs and exceptions</h2><p>${paragraph.repeat(15)}</p><p>When you are ready, review current product options on the storefront.</p>`;
  const title = "Embroidery vs. DTF Printing: Which Is Better for Work Shirts?";
  const metaDescription =
    "Embroidery vs DTF for work shirts: durability, detail, and cost guidance for uniform buyers choosing the right decoration method.";

  const evidence = runQualityGates({
    brief: custom.brief,
    draft: {
      title,
      handle: `embroidery-vs-dtf-${handleSuffix}`,
      excerpt: "Compare embroidery and DTF for work shirts with practical buyer guidance.",
      metaTitle: title.slice(0, 70),
      metaDescription,
      bodyHtml,
      primaryKeyword: "embroidery vs DTF for work shirts",
      secondaryKeywords: custom.brief.secondaryKeywords
    },
    storefrontUrl: "https://legendsdtf.com"
  });
  assert.equal(qualityGatesPassed(evidence), true, evidence.reviewFlags.join("; "));

  await db.query(
    `INSERT INTO research_opportunities(id, payload, status)
     VALUES ($1, $2::jsonb, 'used')
     ON CONFLICT (id) DO NOTHING`,
    [`opp-${handleSuffix}`, JSON.stringify({ id: `opp-${handleSuffix}` })]
  );
  custom.brief.opportunityId = `opp-${handleSuffix}`;
  const { saveBrief, attachBriefArticle } = await import("../src/research/store.js");
  const savedBrief = await saveBrief(db, { ...custom.brief, status: "generated" });

  const article = await createArticle(db, {
    title,
    handle: `rollout-concurrent-${handleSuffix}`,
    excerpt: "Compare embroidery and DTF for work shirts with practical buyer guidance.",
    metaTitle: title.slice(0, 70),
    metaDescription,
    bodyHtml,
    tags: ["embroidery", "DTF"],
    author: "Autopilot",
    primaryKeyword: "embroidery vs DTF for work shirts",
    secondaryKeywords: custom.brief.secondaryKeywords,
    topicFingerprint: `embroidery-vs-dtf-${handleSuffix}`,
    rationale: "concurrent rollout fixture"
  }, {
    status: "draft",
    source: "research",
    generationSettings: {
      decision: "AUTO_ELIGIBLE",
      countsTowardRollout: true,
      quarantined: false
    }
  });
  await attachBriefArticle(db, savedBrief.id!, article.id);
  await saveEvidenceReport(db, article.id, savedBrief.id!, evidence);
  await updateArticle(db, article.id, { status: "ready", merchantEdited: true });
  return article.id;
}

test("unique index enforces one rollout_draft_counted audit per article", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const { rows } = await db.query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
     WHERE indexname = 'audit_events_rollout_draft_counted_article_uidx'`
  );
  assert.equal(rows.length, 1);
  await db.end();
});

test("concurrent recordReviewedDraftForRollout on same article increments counter once", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const settings = await getSettings(db);
  const start = settings.promotionProgress.consecutiveReviewedDrafts;
  await saveSettings(db, {
    ...settings,
    enabled: false,
    draftOnlyMode: true,
    rolloutMode: "draft_only",
    promotionProgress: {
      ...settings.promotionProgress,
      consecutiveReviewedDrafts: start,
      autoPublishExplicitlyActivated: false
    }
  });

  const articleId = await seedEligibleArticle(db, `same-${Date.now()}`);
  const [a, b] = await Promise.all([
    recordReviewedDraftForRollout(db, articleId, { actor: "worker-a" }),
    recordReviewedDraftForRollout(db, articleId, { actor: "worker-b" })
  ]);

  const counted = [a, b].filter(r => r.counted);
  const idempotent = [a, b].filter(r => r.alreadyCounted || (!r.counted && r.reasons.some(x => /already counted/i.test(x))));
  assert.equal(counted.length, 1, "exactly one worker may count");
  assert.ok(idempotent.length >= 1, "loser must see already-counted / idempotent path");

  const after = (await getSettings(db)).promotionProgress.consecutiveReviewedDrafts;
  assert.equal(after, start + 1);

  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events WHERE article_id=$1 AND action=$2`,
    [articleId, ROLLOUT_COUNTED_ACTION]
  );
  assert.equal(Number(rows[0]!.n), 1);
  await db.end();
});

test("concurrent recordReviewedDraftForRollout on different articles increments by two", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const settings = await getSettings(db);
  const start = settings.promotionProgress.consecutiveReviewedDrafts;
  await saveSettings(db, {
    ...settings,
    enabled: false,
    draftOnlyMode: true,
    rolloutMode: "draft_only",
    promotionProgress: {
      ...settings.promotionProgress,
      consecutiveReviewedDrafts: start,
      autoPublishExplicitlyActivated: false
    }
  });

  const ts = Date.now();
  const idA = await seedEligibleArticle(db, `a-${ts}`);
  const idB = await seedEligibleArticle(db, `b-${ts}`);

  const [a, b] = await Promise.all([
    recordReviewedDraftForRollout(db, idA, { actor: "worker-a" }),
    recordReviewedDraftForRollout(db, idB, { actor: "worker-b" })
  ]);

  assert.equal(a.counted, true, a.reasons.join("; "));
  assert.equal(b.counted, true, b.reasons.join("; "));
  const after = (await getSettings(db)).promotionProgress.consecutiveReviewedDrafts;
  assert.equal(after, start + 2);
  await db.end();
});

test("rollback before commit leaves counter and audit unchanged", async () => {
  const db = createDb(databaseUrl);
  await migrate(db);
  const settings = await getSettings(db);
  const start = settings.promotionProgress.consecutiveReviewedDrafts;
  await saveSettings(db, {
    ...settings,
    enabled: false,
    draftOnlyMode: true,
    rolloutMode: "draft_only",
    promotionProgress: {
      ...settings.promotionProgress,
      consecutiveReviewedDrafts: start,
      autoPublishExplicitlyActivated: false
    }
  });

  const articleId = await seedEligibleArticle(db, `rollback-${Date.now()}`);
  const rolled = await recordReviewedDraftForRollout(db, articleId, {
    actor: "test",
    _testThrowBeforeCommit: true
  });
  assert.equal(rolled.counted, false);
  assert.ok(rolled.reasons.some(r => /roll/i.test(r)));

  const after = (await getSettings(db)).promotionProgress.consecutiveReviewedDrafts;
  assert.equal(after, start, "counter must not advance after rollback");

  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events WHERE article_id=$1 AND action=$2`,
    [articleId, ROLLOUT_COUNTED_ACTION]
  );
  assert.equal(Number(rows[0]!.n), 0, "rolled-back audit must not persist");

  // A subsequent normal call still counts once
  const ok = await recordReviewedDraftForRollout(db, articleId, { actor: "test" });
  assert.equal(ok.counted, true, ok.reasons.join("; "));
  assert.equal((await getSettings(db)).promotionProgress.consecutiveReviewedDrafts, start + 1);
  await db.end();
});
