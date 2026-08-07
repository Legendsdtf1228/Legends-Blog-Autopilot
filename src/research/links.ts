export interface InternalLinkCandidate {
  url: string;
  title: string;
  kind: "product" | "service" | "article" | "contact" | "other";
  anchorText: string;
}

export interface LinkValidationResult {
  url: string;
  ok: boolean;
  reason: string;
  kind: InternalLinkCandidate["kind"];
}

const STOREFRONT_HOST = /legendsdtf\.com$/i;

export function isValidInternalUrl(url: string, storefrontUrl: string): boolean {
  try {
    const u = new URL(url);
    const base = new URL(storefrontUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    if (u.hostname !== base.hostname && !STOREFRONT_HOST.test(u.hostname)) return false;
    if (!u.pathname || u.pathname === "/") return false;
    return true;
  } catch {
    return false;
  }
}

export function validateInternalLinks(
  links: InternalLinkCandidate[],
  storefrontUrl: string
): { results: LinkValidationResult[]; confidence: number; broken: number; trustBuilding: boolean } {
  const results = links.map(link => {
    const ok = isValidInternalUrl(link.url, storefrontUrl);
    return {
      url: link.url,
      ok,
      reason: ok ? "Valid storefront URL" : "Broken or unverified internal URL",
      kind: link.kind
    };
  });
  const broken = results.filter(r => !r.ok).length;
  const okCount = results.filter(r => r.ok).length;
  const trustBuilding = links.length === 0;
  const confidence = trustBuilding ? 0.75 : broken > 0 ? 0 : Math.min(1, okCount / Math.max(links.length, 1));
  return { results, confidence, broken, trustBuilding };
}

export function rejectUnrelatedProductLink(args: {
  productTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
}): boolean {
  const hay = `${args.primaryKeyword} ${args.secondaryKeywords.join(" ")}`.toLowerCase();
  const title = args.productTitle.toLowerCase();
  const tokens = title.split(/\s+/).filter(t => t.length > 3);
  return !tokens.some(t => hay.includes(t));
}

/** Stronger relevance check for forced / weakly related product inserts. */
export function assessInternalLinkRelevance(args: {
  primaryKeyword: string;
  title: string;
  readerQuestion?: string;
  productTitles: string[];
  bodyHtml?: string;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!args.productTitles.length) return { ok: true, reasons };

  const intentHay = `${args.primaryKeyword} ${args.title} ${args.readerQuestion || ""}`.toLowerCase();
  const body = (args.bodyHtml || "").replace(/<[^>]+>/g, " ").toLowerCase();
  let weakCount = 0;

  for (const product of args.productTitles) {
    const p = product.toLowerCase();
    const tokens = p.split(/\s+/).filter(t => t.length >= 3 && !/^(with|from|that|this|your|legends|the|and|for)$/.test(t));
    const intentOverlap = tokens.some(t => intentHay.includes(t));
    const bodyMentions = tokens.filter(t => body.includes(t)).length;

    // UV DTF product linked from apparel-printer / stories article is a known failure mode
    if (/\buv\s*dtf\b/i.test(product) && !/\buv\s*dtf\b/i.test(intentHay)) {
      weakCount += 1;
      reasons.push(`Product “${product}” is weakly related to the article intent (UV DTF vs apparel/printer topic).`);
      continue;
    }

    if (!intentOverlap && bodyMentions < 2) {
      weakCount += 1;
      reasons.push(`Product “${product}” appears inserted without clear topical relevance.`);
    }
  }

  if (weakCount > 0 && weakCount >= Math.ceil(args.productTitles.length / 2)) {
    reasons.push("Internal product links appear forced to satisfy link requirements.");
    return { ok: false, reasons };
  }
  return { ok: reasons.length === 0, reasons };
}
