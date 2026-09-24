/**
 * Broad evaluation corpus for autonomous editorial controls.
 * Feature-based — no production exact-title quarantines.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assessSalesContentLimits,
  assessTechnicalAccuracy,
  assessTemplateFiller,
  classifyContentPromise,
  evaluatePreGeneration,
  buildEvidenceBudget,
  assessBriefDepth
} from "../src/research/index.js";
import { LOCAL_SMALL_BUSINESS_STORIES_FIXTURE } from "./fixtures/local-small-business-stories.js";

function evalTopic(partial: {
  keyword: string;
  title: string;
  audience?: string;
  question?: string;
  outline?: string[];
  format?: string;
  intent?: string;
  pillar?: string;
  interviewComplete?: boolean;
  hasVerifiedPrices?: boolean;
  hasTechnicalFacts?: boolean;
  disableAutoRefine?: boolean;
}) {
  return evaluatePreGeneration({
    primaryKeyword: partial.keyword,
    proposedTitle: partial.title,
    audienceLabel: partial.audience || "Middle Georgia apparel buyers",
    readerQuestion: partial.question || `What should a buyer know about ${partial.keyword}?`,
    outline: partial.outline || [
      `Decision criteria for ${partial.keyword}`,
      `Trade-offs and exceptions`,
      `Questions to ask before you commit`,
      `A practical next step`
    ],
    whyDistinct: "Distinct buyer decision with clear criteria",
    conversionPath: "Trust-building article; no direct product pitch required.",
    format: partial.format,
    intent: partial.intent,
    pillar: partial.pillar,
    interviewComplete: partial.interviewComplete,
    hasVerifiedPrices: partial.hasVerifiedPrices,
    hasTechnicalFacts: partial.hasTechnicalFacts,
    hasLocalFacts: true,
    disableAutoRefine: partial.disableAutoRefine
  });
}

test("corpus: firsthand story without firsthand evidence → NEEDS_MERCHANT_INPUT", () => {
  const r = evalTopic({
    keyword: "leaving a 9-to-5 for a print shop",
    title: "Leaving a 9-to-5: Honest Lessons From Building a Print Business",
    format: "first_person_story",
    pillar: "honest_entrepreneurship",
    question: "What should someone know before quitting for a print shop?",
    interviewComplete: false,
    disableAutoRefine: true
  });
  assert.equal(r.decision, "NEEDS_MERCHANT_INPUT");
  assert.ok(r.contentPromise.requiresFirsthand);
  assert.ok(r.merchantInputWouldUnlock || r.trace.merchantInputWouldUnlock);
});

test("corpus: cost guide without verified costs → REJECTED", () => {
  const r = evalTopic({
    keyword: "DTF transfer cost breakdown",
    title: "DTF Transfer Cost and Break-Even Guide for New Brands",
    format: "how_to",
    question: "How do I estimate DTF transfer costs and break-even?",
    hasVerifiedPrices: false,
    disableAutoRefine: true
  });
  assert.equal(r.decision, "REJECTED");
  assert.ok(r.contentPromise.requiresVerifiedNumbers);
});

test("corpus: comparison without criteria → REJECTED", () => {
  const r = evalTopic({
    keyword: "embroidery vs DTF",
    title: "Embroidery vs DTF: Which Is Best?",
    format: "comparison",
    outline: ["Introduction", "Key points", "Next steps", "Conclusion"],
    question: "Tell me about embroidery and DTF.",
    disableAutoRefine: true
  });
  assert.ok(r.decision === "REJECTED" || !r.evidenceBudget.supportsCentralPromise);
});

test("corpus: how-to without actionable steps → REJECTED or refine", () => {
  const r = evalTopic({
    keyword: "how to order custom shirts",
    title: "How to Order Custom Shirts: A Practical Guide",
    format: "how_to",
    outline: ["What custom shirts mean", "Common mistakes", "How Legends can help", "Next steps"],
    question: "Custom shirts overview.",
    disableAutoRefine: true
  });
  assert.ok(r.decision === "REJECTED" || !r.depth.ok);
});

test("corpus: technical guide with UV DTF category errors fails technical rules", () => {
  const findings = assessTechnicalAccuracy(`
    <p>UV DTF is a great apparel decoration method for shirts and hoodies.
    Press UV DTF onto fabric with a heat press using temperature and pressure.</p>
  `);
  assert.ok(findings.some(f => f.gate === "uv_dtf_service_category"));
  assert.ok(findings.some(f => f.gate === "uv_dtf_pressing_guidance"));
});

test("corpus: local article with no genuine local value fails depth", () => {
  const promise = classifyContentPromise({
    title: "Local Printing Tips",
    primaryKeyword: "local printing tips",
    intent: "local"
  });
  const budget = buildEvidenceBudget({
    contentPromise: promise,
    hasLocalFacts: false,
    outline: ["What local printing tips means", "Common mistakes", "How Legends can help", "Next steps"]
  });
  const depth = assessBriefDepth({
    audienceLabel: "everyone",
    readerQuestion: "tips",
    proposedTitle: "Local Printing Tips",
    primaryKeyword: "local printing tips",
    outline: ["What local printing tips means", "Common mistakes", "How Legends can help", "Next steps"],
    whyDistinct: "x",
    contentPromise: promise,
    evidenceBudget: budget
  });
  assert.equal(depth.ok, false);
});

test("corpus: educational article overloaded with sales links fails sales limits", () => {
  const body = `<h2>Guide</h2><p>${"Legends DTF Prints in Warner Robins Middle Georgia can help. Contact us. Order now. Visit us. ".repeat(20)}</p>`;
  const sales = assessSalesContentLimits({
    bodyHtml: body,
    title: "Artwork Preparation for DTF",
    primaryKeyword: "DTF artwork preparation",
    intent: "informational",
    businessFacts: ["Legends DTF Prints is located in Warner Robins, Georgia and serves Middle Georgia."],
    productTitles: ["UV DTF Gang Sheet Builder"]
  });
  assert.equal(sales.ok, false);
});

test("corpus: generic template with merchant facts inserted fails template detection", () => {
  const body = `
    <h2>What local small-business stories means</h2>
    <p>In today’s competitive market, when it comes to apparel, there are many factors to consider.</p>
    <h2>Common mistakes</h2>
    <p>At the end of the day, whether you are a small business or a school, Legends DTF Prints in Warner Robins can help.</p>
    <h2>How Legends can help</h2>
    <p>Legends DTF Prints. Warner Robins. Middle Georgia.</p>
  `;
  const template = assessTemplateFiller({
    title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    primaryKeyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    bodyHtml: body,
    outline: ["What X means", "Common mistakes", "How Legends can help", "Next steps"]
  });
  assert.equal(template.ok, false);
});

test("corpus: fixture story/checklist framing is REJECTED without auto-refine", () => {
  const r = evalTopic({
    keyword: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.primaryKeyword,
    title: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.title,
    audience: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.audienceLabel,
    question: LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.readerQuestion,
    outline: [...LOCAL_SMALL_BUSINESS_STORIES_FIXTURE.outline],
    format: "checklist",
    disableAutoRefine: true
  });
  assert.equal(r.decision, "REJECTED");
});

test("corpus: strong evidence-supported informational comparison can be AUTO_ELIGIBLE", () => {
  const r = evalTopic({
    keyword: "embroidery vs DTF for work shirts",
    title: "Embroidery vs. DTF Printing: Which Is Better for Work Shirts?",
    audience: "Small-business owners purchasing employee uniforms",
    question: "Should I choose embroidery or DTF printing for employee work shirts?",
    format: "comparison",
    outline: [
      "Decision criteria: durability, detail, cost-per-piece, and feel",
      "Side-by-side trade-offs for daily workwear",
      "When embroidery is the better fit",
      "When DTF is the better fit",
      "A practical next step after you choose"
    ],
    hasTechnicalFacts: true,
    disableAutoRefine: true
  });
  assert.equal(r.decision, "AUTO_ELIGIBLE");
});

test("corpus: strong local-commercial article can be AUTO_ELIGIBLE", () => {
  const r = evalTopic({
    keyword: "how to choose a local custom shirt printer",
    title: "How to Choose a Custom Shirt Printer in Warner Robins: 9 Questions to Ask",
    audience: "Middle Georgia businesses, schools, teams, and clothing brands",
    question: "How should I compare local custom-apparel printers before placing an order?",
    format: "checklist",
    intent: "local",
    outline: [
      "Clarify the job-to-be-done behind choosing a printer",
      "Questions to ask before you commit",
      "How to compare options against your constraints",
      "Red flags and conditions that change the answer",
      "Your next concrete step"
    ],
    hasLocalFacts: true,
    disableAutoRefine: true
  });
  assert.equal(r.decision, "AUTO_ELIGIBLE");
  assert.equal(r.contentPromise.primaryClass, "local_commercial");
});

test("corpus: legitimate NEEDS_MERCHANT_INPUT stays out of automatic generation", () => {
  const r = evalTopic({
    keyword: "print shop ownership reality",
    title: "Print Shop Ownership Reality: What I Learned",
    format: "first_person_story",
    pillar: "honest_entrepreneurship",
    question: "What is print shop ownership really like day to day?",
    interviewComplete: false,
    disableAutoRefine: true
  });
  assert.equal(r.decision, "NEEDS_MERCHANT_INPUT");
  assert.equal(r.okToGenerate, false);
});

test("corpus: incoherent story keyword auto-refines to supportable local angle", () => {
  const r = evalTopic({
    keyword: "local small-business stories",
    title: "Local Small-Business Stories: A Decision Checklist for Apparel Buyers",
    audience: "Apparel buyers",
    format: "checklist",
    disableAutoRefine: false
  });
  assert.ok(r.refined);
  assert.equal(r.refined!.keyword, "how to choose a local custom shirt printer");
  assert.notEqual(r.decision, "DRAFT_ONLY");
});
