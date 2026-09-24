/**
 * Sales-content limits: educational value must stand without brand stuffing.
 */

export interface SalesLimitsResult {
  ok: boolean;
  brandMentions: number;
  brandDensity: number;
  repeatedFactDensity: number;
  ctaCount: number;
  unrelatedLinks: number;
  reasons: string[];
}

export function assessSalesContentLimits(args: {
  bodyHtml: string;
  title: string;
  primaryKeyword: string;
  intent?: string;
  businessFacts?: string[];
  productTitles?: string[];
}): SalesLimitsResult {
  const text = args.bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const words = Math.max(1, text.split(/\s+/).filter(Boolean).length);
  const reasons: string[] = [];

  const brandMentions = (lower.match(/\blegends(\s+dtf)?(\s+prints)?\b/g) || []).length;
  const brandDensity = brandMentions / words;
  const locationMentions = (lower.match(/\bwarner robins\b|\bmiddle georgia\b/g) || []).length;
  // Count merchant turnaround *filler*, not legitimate decision-criteria mentions of turnaround.
  const turnaroundMentions = (lower.match(
    /\b(our |standard |typical |legends.{0,40})turnaround\b|\bproduction days?\b|\bmonday through friday\b/g
  ) || []).length;

  let factRepeats = 0;
  for (const fact of args.businessFacts || []) {
    const snippet = fact.slice(0, 40).toLowerCase();
    if (snippet.length < 16) continue;
    const count = lower.split(snippet).length - 1;
    if (count >= 2) factRepeats += 1;
  }
  const repeatedFactDensity = factRepeats / Math.max(1, (args.businessFacts || []).length || 1);

  const ctaCount = (lower.match(/\b(contact us|get a quote|order now|shop now|visit (us|our)|call (us|today)|start your order)\b/g) || []).length;
  const howLegendsHelp = /\bhow legends can help\b/i.test(text);

  let unrelatedLinks = 0;
  for (const product of args.productTitles || []) {
    if (/\buv\s*dtf\b/i.test(product) && !/\buv\s*dtf\b/i.test(`${args.primaryKeyword} ${args.title}`)) {
      unrelatedLinks += 1;
    }
  }

  const informational = !args.intent || args.intent === "informational" || args.intent === "navigational";
  const maxBrand = informational ? 4 : 8;
  const maxCta = informational ? 2 : 3;

  if (brandMentions > maxBrand || brandDensity > 0.02) {
    reasons.push(`Brand-reference density too high (${brandMentions} mentions).`);
  }
  if (locationMentions >= 4 || turnaroundMentions >= 5 || factRepeats >= 2) {
    reasons.push("Repeated location / turnaround / business-fact filler.");
  }
  if (howLegendsHelp && informational) {
    reasons.push("Generic “How Legends can help” section is not allowed by default on informational articles.");
  }
  if (ctaCount > maxCta) {
    reasons.push(`Too many CTAs (${ctaCount}; max ${maxCta} for this intent).`);
  }
  if (unrelatedLinks > 0) {
    reasons.push("Unrelated specialty-product link(s) inserted.");
  }

  // Educational value must stand without Legends mentions: strip brand and check residual substance
  const withoutBrand = text.replace(/\blegends(\s+dtf)?(\s+prints)?\b/gi, "").replace(/\bwarner robins\b|\bmiddle georgia\b/gi, "");
  const residualActionable = (withoutBrand.match(/\b(ask|compare|choose|measure|verify|step|criteria|trade-?off)\b/gi) || []).length;
  if (brandMentions >= 3 && residualActionable < 3) {
    reasons.push("Educational value does not stand without Legends mentions.");
  }

  return {
    ok: reasons.length === 0,
    brandMentions,
    brandDensity: Number(brandDensity.toFixed(4)),
    repeatedFactDensity: Number(repeatedFactDensity.toFixed(4)),
    ctaCount,
    unrelatedLinks,
    reasons
  };
}
