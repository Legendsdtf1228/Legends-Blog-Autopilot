import test from "node:test";
import assert from "node:assert/strict";
import { testables } from "../src/writer.js";
import { defaultSettings } from "../src/defaults.js";
import type { GeneratedArticle } from "../src/types.js";

const words = Array.from({length: 850}, (_, i) => `word${i}`).join(" ");
const base: GeneratedArticle = { title: "A useful guide to custom DTF transfers", handle: "useful-guide-custom-dtf-transfers", summary: "A practical guide for preparing and ordering custom transfers from a reliable local print partner.", metaDescription: "Learn how to prepare artwork and order custom DTF transfers with practical tips from Legends DTF Prints in Warner Robins, Georgia.", bodyHtml: `<h2>Guide</h2><p>${words}</p>`, tags: ["DTF", "Artwork", "Printing"], primaryKeyword: "custom DTF transfers", topicFingerprint: "custom-dtf-prep", rationale: "Helps customers avoid common file preparation mistakes." };

test("content validator accepts structured factual content", () => {
  assert.doesNotThrow(() => testables.validateContent(base, defaultSettings, []));
});

test("content validator rejects invented links", () => {
  assert.throws(() => testables.validateContent({ ...base, bodyHtml: `${base.bodyHtml}<a href="https://bad.example">bad</a>` }, defaultSettings, []), /not supplied/);
});

test("word count strips HTML", () => assert.equal(testables.countWords("<h2>Hello there</h2><p>General Kenobi</p>"), 4));
