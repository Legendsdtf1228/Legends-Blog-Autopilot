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
