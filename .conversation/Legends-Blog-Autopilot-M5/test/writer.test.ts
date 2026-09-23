import test from "node:test";
import assert from "node:assert/strict";
import { testables } from "../src/content.js";
import { defaultSettings } from "../src/defaults.js";
import type { GeneratedArticle } from "../src/types.js";

const words = Array.from({ length: 850 }, (_, i) => `word${i}`).join(" ");
const base: GeneratedArticle = {
  title: "A useful guide to custom DTF transfers",
  handle: "useful-guide-custom-dtf-transfers",
  summary: "A practical guide for preparing and ordering custom transfers from a reliable local print partner in Middle Georgia.",
  metaDescription: "Learn how to prepare artwork and order custom DTF transfers with practical tips from Legends DTF Prints in Warner Robins, Georgia.",
  bodyHtml: `<h2>Guide</h2><p>${words}</p>`,
  tags: ["DTF", "Artwork", "Printing"],
  primaryKeyword: "custom DTF transfers",
  topicFingerprint: "custom-dtf-prep",
  rationale: "Helps customers avoid common file preparation mistakes."
};

test("shortenAtBoundary never cuts a word in half", () => {
  const text = "Legends DTF Prints helps schools order spirit wear for Friday night games.";
  const short = testables.shortenAtBoundary(text, 40);
  assert.ok(short.length <= 40);
  assert.equal(short.includes("Fri"), false); // would be partial "Friday"
  assert.equal(/\s/.test(short.slice(-1)) || /[a-z]$/i.test(short.slice(-1)), true);
  // Ensure we did not end with a partial word from the next token
  assert.ok(!text.startsWith(short + text[short.length]!?.match(/[a-z]/i)?.[0]));
  const nextChar = text[short.length];
  if (nextChar && /[A-Za-z0-9]/.test(nextChar)) {
    assert.fail("shortened text ends mid-word");
  }
});

test("shortenAtBoundary prefers sentence boundaries", () => {
  const text = "First sentence ends here. Second sentence is longer and should be dropped when needed.";
  const short = testables.shortenAtBoundary(text, 50);
  assert.equal(short, "First sentence ends here.");
});

test("normalizeArticle auto-shortens oversized meta descriptions", () => {
  const oversized = "A".repeat(80) + " useful tips for DTF transfers and gang sheets from Legends DTF Prints in Warner Robins Georgia today.";
  assert.ok(oversized.length > 160);
  const result = testables.normalizeArticle({
    ...base,
    metaDescription: oversized
  });
  assert.ok(result.content.metaDescription.length <= 160);
  assert.ok(result.changed.includes("metaDescription"));
  assert.ok(result.warnings.some(w => w.field === "metaDescription"));
});

test("prepareGeneratedArticle accepts oversized meta description without throwing", () => {
  const oversized = {
    ...base,
    metaDescription: "Learn practical DTF transfer artwork preparation, heat press tips, and ordering guidance for schools and small businesses from Legends DTF Prints in Warner Robins, Georgia this season with extra words."
  };
  assert.ok(oversized.metaDescription.length > 160);
  const prepared = testables.prepareGeneratedArticle(oversized, defaultSettings, []);
  assert.ok(prepared.generated.metaDescription.length <= 160);
  assert.equal(prepared.content.metaDescription.length <= 160, true);
});

test("sanitizeBodyHtml strips scripts and keeps safe tags", () => {
  const dirty = `<h2>Hi</h2><p>Hello</p><script>alert(1)</script><a href="https://legendsdtf.com/products/x">link</a>`;
  const clean = testables.sanitizeBodyHtml(dirty);
  assert.equal(clean.includes("script"), false);
  assert.match(clean, /<h2>/);
  assert.match(clean, /<a /);
});

test("validateContent rejects invented links via validateArticle", () => {
  const result = testables.validateArticle(
    { ...base, bodyHtml: `${base.bodyHtml}<a href="https://bad.example">bad</a>` },
    { settings: defaultSettings, products: [], requireReady: true }
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => /link/i.test(e.message)));
});

test("word count strips HTML", () => {
  assert.equal(testables.countWords("<h2>Hello there</h2><p>General Kenobi</p>"), 4);
});

test("oversized meta description cannot break a ready job pipeline", () => {
  const generated: GeneratedArticle = {
    ...base,
    metaDescription: "x".repeat(300)
  };
  assert.doesNotThrow(() => {
    const prepared = testables.prepareGeneratedArticle(generated, defaultSettings, [
      { title: "Gang Sheet", url: "https://legendsdtf.com/products/gang-sheet" }
    ]);
    assert.ok(prepared.generated.metaDescription.length <= 160);
  });
});
