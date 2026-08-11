/**
 * Select internal product links against the *current* keyword intent.
 * Never carry products chosen for a discarded seed framing.
 */
import { rejectUnrelatedProductLink } from "./links.js";

export interface ProductCandidate {
  id?: string;
  title: string;
  handle?: string;
  url: string;
  description?: string;
  productType?: string;
  options?: string[];
  retrievedAt?: string;
}

/** UV DTF is hard-surface decals — never feature it on apparel-printer / stories topics. */
export function isUvDtfProduct(title: string): boolean {
  return /\buv\s*dtf\b/i.test(title);
}

export function selectProductsForKeyword(args: {
  products: ProductCandidate[];
  primaryKeyword: string;
  secondaryKeywords?: string[];
  title?: string;
  readerQuestion?: string;
  nowIso?: string;
  limit?: number;
}): ProductCandidate[] {
  const keyword = args.primaryKeyword.toLowerCase();
  const secondary = args.secondaryKeywords || [];
  const intentHay = `${keyword} ${args.title || ""} ${args.readerQuestion || ""}`.toLowerCase();
  const allowUv = /\buv\s*dtf\b/i.test(intentHay);
  const limit = args.limit ?? 3;
  const nowIso = args.nowIso || new Date().toISOString();

  const scored = args.products
    .filter(p => {
      if (!allowUv && isUvDtfProduct(p.title)) return false;
      if (
        rejectUnrelatedProductLink({
          productTitle: p.title,
          primaryKeyword: args.primaryKeyword,
          secondaryKeywords: secondary
        })
      ) {
        // Soft-allow when a strong shared apparel/print token exists
        const t = p.title.toLowerCase();
        const strong =
          /\b(shirt|apparel|dtf|transfer|embroidery|gang|uniform|hoodie)\b/i.test(t) &&
          /\b(shirt|apparel|dtf|transfer|embroidery|printer|printing|uniform|custom)\b/i.test(keyword);
        if (!strong) return false;
      }
      return true;
    })
    .map(p => {
      const t = p.title.toLowerCase();
      const tokens = t.split(/\s+/).filter(w => w.length >= 3);
      const overlap = tokens.filter(tok => intentHay.includes(tok)).length;
      return { product: p, overlap };
    })
    .filter(x => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, limit)
    .map(x => ({
      id: x.product.id,
      title: x.product.title,
      handle: x.product.handle,
      url: x.product.url,
      description: x.product.description || "",
      productType: x.product.productType,
      options: x.product.options || [],
      retrievedAt: x.product.retrievedAt || nowIso
    }));

  return scored;
}
