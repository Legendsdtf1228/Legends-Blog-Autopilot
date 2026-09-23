import assert from "node:assert/strict";
import test from "node:test";
import { buildIntentReaderQuestion, buildNaturalTitle } from "../src/research/naturalLanguage.js";

const FORBIDDEN_TEMPLATES = [
  /which option fits your apparel project/i,
  /honest lessons from building a print business/i,
  /practical questions local buyers should ask/i,
  /a decision checklist for apparel buyers/i,
  /what .* buyers should know/i,
  /what buyers should know/i
];

test("M5 titles use a specific reader question when available", () => {
  const title = buildNaturalTitle({
    primaryKeyword: "embroidery vs DTF for work shirts",
    readerQuestion: "Should I choose embroidery or DTF printing for employee work shirts?",
    format: "comparison",
    intent: "commercial"
  });

  assert.match(title, /Embroidery or DTF Printing for Employee Work Shirts: How to Choose/);
  assert.ok(title.length <= 120);
  assert.ok(FORBIDDEN_TEMPLATES.every(pattern => !pattern.test(title)));
});

test("M5 fallback titles remain natural and vary by candidate", () => {
  const topics = [
    "custom shirts for school spirit wear",
    "gang sheet planning for small orders",
    "pricing custom shirts for a new brand",
    "choosing a local custom shirt printer",
    "artwork preparation for DTF transfers",
    "cotton versus polyester work shirts"
  ];
  const titles = topics.map((primaryKeyword, index) =>
    buildNaturalTitle({
      primaryKeyword,
      format: index % 2 ? "how_to" : "comparison",
      intent: index % 2 ? "informational" : "commercial",
      variantKey: `m5-${index}-${primaryKeyword}`
    })
  );

  assert.equal(new Set(titles).size, titles.length);
  assert.ok(titles.every(title => title.length >= 20 && title.length <= 120));
  assert.ok(titles.every(title => FORBIDDEN_TEMPLATES.every(pattern => !pattern.test(title))));
});

test("M5 reader-question fallback describes intent without asserting evidence", () => {
  const question = buildIntentReaderQuestion({
    primaryKeyword: "cotton vs polyester shirts for custom printing",
    audienceLabel: "People comparing garment options for a custom apparel order",
    format: "comparison",
    intent: "commercial"
  });

  assert.match(question, /Which differences matter most/i);
  assert.doesNotMatch(question, /what should .* know about/i);
});

test("canonical ReaderTask question can drive the title without becoming answer evidence", () => {
  const title = buildNaturalTitle({
    primaryKeyword: "shirt fabric",
    readerTask: {
      audience: "People comparing garment options for a custom apparel order",
      actualQuestion: "Which shirt fabric works better for my custom print project?",
      decisionOrAction: "choose a fabric",
      situation: "the order must balance feel and print performance",
      problem: "the buyer is unsure which fabric fits the order"
    },
    format: "comparison",
    intent: "commercial"
  });

  assert.equal(title, "Which Shirt Fabric Works Better for My Custom Print Project?");
});