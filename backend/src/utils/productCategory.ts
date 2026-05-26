import type { ProductSummary } from "../types.js";

export type PrimaryProductCategory = "phone" | "watch" | "ring" | "earbud" | "gift" | "general";

const WATCH_RE =
  /\b(watch|watches|timepiece|timepieces|wristwatch|horology|chronograph|腕表|手表)\b/i;
const RING_RE =
  /\b(ring|rings|jewellery|jewelry|smart\s+ring|diamond\s+ring|首饰)\b/i;
const EARBUD_RE =
  /\b(earbud|earbuds|earphone|earphones|headphone|headphones|hearable|hearables|audio|耳机)\b/i;
const PHONE_RE =
  /\b(phone|phones|smartphone|smartphones|mobile|cellphone|cell\s+phone|handset|handsets)\b/i;
const GIFT_RE =
  /\b(gift|gifts|present|presents|mother'?s\s+day|father'?s\s+day|for\s+her|for\s+him|christmas|holiday)\b/i;

/** Flip / foldable phone intent (Quantum Flip, Ironflip — not bar phones). */
export const FLIP_PHONE_INTENT_RE =
  /\b(flip|flips|fold|folds|foldable|foldables|folding|clamshell|hinge)\b/i;

export function isFlipPhoneIntent(keyword: string, pageTitle = ""): boolean {
  const combined = `${keyword || ""} ${pageTitle || ""}`.trim().toLowerCase();
  if (!combined || !FLIP_PHONE_INTENT_RE.test(combined)) return false;
  if (WATCH_RE.test(combined) && !PHONE_RE.test(combined) && !FLIP_PHONE_INTENT_RE.test(combined)) {
    return false;
  }
  return true;
}

/** True only for VERTU foldable / flip-form-factor handsets (not Agent Q, Metavertu, Signature bar phones). */
export function isFlipFormFactorProductName(name: string): boolean {
  const n = (name || "").toLowerCase().replace(/<[^>]*>/g, "").trim();
  if (!n) return false;
  if (n.includes("quantum") && n.includes("flip")) return true;
  if (/\biron\s*flip\b/.test(n) || n.includes("ironflip") || n.includes("iron-flip")) return true;
  return false;
}

export function isFlipFormFactorProduct(product: ProductSummary): boolean {
  return isFlipFormFactorProductName(product.name || "");
}

export function filterToFlipPhonesOnly(products: ProductSummary[]): ProductSummary[] {
  return products.filter(isFlipFormFactorProduct);
}

export function filterProductNamesToFlipOnly(names: string[]): string[] {
  const filtered = names.filter((n) => isFlipFormFactorProductName(n));
  return filtered;
}

/** Detect dominant product category from keyword + page title (title-weighted). */
export function detectPrimaryCategory(keyword: string, pageTitle: string): PrimaryProductCategory {
  const title = (pageTitle || "").toLowerCase();
  const kw = (keyword || "").toLowerCase();
  const combined = `${kw} ${title}`;

  if (title && WATCH_RE.test(title)) return "watch";
  if (title && RING_RE.test(title) && !PHONE_RE.test(title)) return "ring";
  if (title && EARBUD_RE.test(title)) return "earbud";
  if (title && PHONE_RE.test(title)) return "phone";

  if (WATCH_RE.test(combined)) return "watch";
  if (RING_RE.test(combined) && !PHONE_RE.test(combined)) return "ring";
  if (EARBUD_RE.test(combined)) return "earbud";
  if (PHONE_RE.test(combined)) return "phone";
  if (GIFT_RE.test(combined)) return "gift";
  return "general";
}

export function isSpecificProductCategory(
  category: PrimaryProductCategory
): category is "phone" | "watch" | "ring" | "earbud" {
  return category === "phone" || category === "watch" || category === "ring" || category === "earbud";
}

function isPhoneProductName(name: string, categorySlug = ""): boolean {
  const n = name.toLowerCase();
  const c = categorySlug.toLowerCase();
  return (
    n.includes("phone") ||
    n.includes("smartphone") ||
    n.includes("mobile") ||
    n.includes("agent") ||
    n.includes("quantum") ||
    n.includes("metavertu") ||
    n.includes("ivertu") ||
    (n.includes("signature") && !n.includes("ring")) ||
    c.includes("phone")
  );
}

/** Whether a catalog item belongs to the given primary category. */
export function productMatchesPrimaryCategory(
  product: ProductSummary,
  primary: PrimaryProductCategory
): boolean {
  if (primary === "general" || primary === "gift") return true;

  const name = (product.name || "").toLowerCase();
  const cat = (product.category || "").toLowerCase();
  const slug = (product.categorySlug || "").toLowerCase();

  switch (primary) {
    case "phone":
      return isPhoneProductName(name, `${cat} ${slug}`);
    case "watch":
      return (
        (name.includes("watch") || name.includes("timepiece") || name.includes("grand")) &&
        !isPhoneProductName(name, cat)
      ) || cat.includes("watch") || slug.includes("watch");
    case "ring": {
      const hasRing =
        name.includes("ring") ||
        name.includes("jewellery") ||
        name.includes("jewelry") ||
        name.includes("diamond") ||
        name.includes("aura");
      return (hasRing || cat.includes("ring")) && !isPhoneProductName(name, cat);
    }
    case "earbud":
      return (
        name.includes("earbud") ||
        name.includes("earphone") ||
        name.includes("audio") ||
        name.includes("headphone") ||
        name.includes("ows") ||
        name.includes("phantom") ||
        cat.includes("earbud") ||
        slug.includes("earbud")
      );
    default:
      return true;
  }
}

export function filterProductsByPrimaryCategory(
  products: ProductSummary[],
  primary: PrimaryProductCategory
): ProductSummary[] {
  if (!isSpecificProductCategory(primary)) return products;
  const filtered = products.filter((p) => productMatchesPrimaryCategory(p, primary));
  return filtered.length > 0 ? filtered : products;
}

/** If >50% of products mismatch primary category, re-filter strictly. */
export function enforceCategoryConsistency(
  products: ProductSummary[],
  keyword: string,
  pageTitle: string
): { products: ProductSummary[]; primaryCategory: PrimaryProductCategory } {
  if (isFlipPhoneIntent(keyword, pageTitle)) {
    const flipOnly = filterToFlipPhonesOnly(products);
    if (flipOnly.length > 0) {
      console.log(
        `[productCategory] Flip gate: kept ${flipOnly.length} foldable SKU(s): ${flipOnly.map((p) => p.name).join(", ")}`
      );
      return { products: flipOnly, primaryCategory: "phone" };
    }
    console.warn(
      `[productCategory] Flip gate: no Quantum Flip / Ironflip in catalog for "${keyword}" — leaving list unchanged`
    );
  }

  const primaryCategory = detectPrimaryCategory(keyword, pageTitle);
  if (!isSpecificProductCategory(primaryCategory) || products.length === 0) {
    return { products, primaryCategory };
  }

  const matching = products.filter((p) => productMatchesPrimaryCategory(p, primaryCategory));
  const mismatchRatio = 1 - matching.length / products.length;

  if (mismatchRatio > 0.5 && matching.length > 0) {
    console.warn(
      `[productCategory] Category gate: ${Math.round(mismatchRatio * 100)}% products mismatch primary "${primaryCategory}" — keeping ${matching.length} aligned items`
    );
    return { products: matching, primaryCategory };
  }

  if (matching.length > 0) {
    return { products: matching, primaryCategory };
  }

  return { products: filterProductsByPrimaryCategory(products, primaryCategory), primaryCategory };
}

export function shouldAllowBespokeBackfill(
  primary: PrimaryProductCategory,
  keyword = "",
  pageTitle = ""
): boolean {
  if (isFlipPhoneIntent(keyword, pageTitle)) return false;
  return primary === "general" || primary === "phone" || primary === "gift";
}

export function shouldAllowPhoneBackfill(
  keyword: string,
  pageTitle: string,
  primary: PrimaryProductCategory
): boolean {
  if (isFlipPhoneIntent(keyword, pageTitle)) return false;
  if (isSpecificProductCategory(primary) && primary !== "phone") return false;
  const combined = `${keyword} ${pageTitle}`.toLowerCase();
  if (WATCH_RE.test(combined) || RING_RE.test(combined) || EARBUD_RE.test(combined)) return false;
  return /phone|mobile|smartphone|camera\s+phone|best phone/i.test(combined);
}

export function buildProductSectionTitle(
  primary: PrimaryProductCategory,
  isTemplate7: boolean,
  keyword = "",
  pageTitle = ""
): string {
  if (isFlipPhoneIntent(keyword, pageTitle)) {
    return isTemplate7 ? "Explore VERTU Foldables" : "Curated VERTU Quantum Flip";
  }
  if (isTemplate7) return "Explore Our Collection";
  switch (primary) {
    case "watch":
      return "Curated VERTU Timepieces";
    case "ring":
      return "Curated VERTU Rings & Jewellery";
    case "earbud":
      return "Curated VERTU Audio";
    case "phone":
      return "Curated VERTU Phones";
    default:
      return "Shop the collection";
  }
}

export function buildProductSectionIntro(
  keyword: string,
  pageTitle: string,
  primary: PrimaryProductCategory
): string {
  const safe = keyword.replace(/<[^>]*>/g, "").trim();
  const clipped = safe.length > 110 ? `${safe.slice(0, 107)}…` : safe;
  if (isFlipPhoneIntent(keyword, pageTitle)) {
    return `Foldable flagship models for “${clipped}”: explore VERTU Quantum Flip below, then read the full guide.`;
  }
  switch (primary) {
    case "watch":
      return `Curated VERTU timepieces for “${clipped}”: explore official models below, then read the full buying guide.`;
    case "ring":
      return `Curated VERTU rings and jewellery for “${clipped}”: shop the official selection below, then continue with the guide.`;
    case "earbud":
      return `Curated VERTU audio for “${clipped}”: compare official models below, then read the full guide.`;
    case "phone":
      return `Curated VERTU phones for “${clipped}”: shop the official selection below, then continue reading for the full guide.`;
    default:
      return `Curated VERTU models for “${clipped}”: shop the official selection below, then continue reading for the full guide.`;
  }
}

export interface TopicMismatchResult {
  mismatch: boolean;
  keywordCategories: string[];
  titleCategories: string[];
  contentCategories: string[];
  source: "keyword" | "title" | null;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  watch: ["watch", "timepiece", "horology", "chronograph", "wristwatch", "grand watch", "metawatch"],
  phone: ["phone", "mobile", "smartphone", "handset", "agent q", "quantum flip", "metavertu", "signature", "ivertu"],
  ring: ["ring", "jewellery", "jewelry", "diamond ring", "meta ring", "aura ring"],
  earbud: ["earbud", "earphone", "earphones", "audio", "phantom", "ows"],
};

function detectCategoriesInText(text: string): string[] {
  const lower = text.toLowerCase();
  const categories: string[] = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      categories.push(category);
    }
  }
  return categories;
}

function isTopicMismatch(expectedCats: string[], contentCats: string[]): boolean {
  if (expectedCats.length === 0) return false;
  const pairs: Array<[string, string]> = [
    ["watch", "phone"],
    ["phone", "watch"],
    ["watch", "ring"],
    ["phone", "ring"],
    ["watch", "earbud"],
    ["phone", "earbud"],
  ];
  for (const [expected, wrong] of pairs) {
    if (
      expectedCats.includes(expected) &&
      contentCats.includes(wrong) &&
      !contentCats.includes(expected)
    ) {
      return true;
    }
  }
  return false;
}

/** Returns whether article HTML topic mismatches keyword/title (for post-gen product re-filter). */
export function checkArticleTopicMismatch(
  content: string,
  keyword: string,
  pageTitle: string
): TopicMismatchResult {
  const empty: TopicMismatchResult = {
    mismatch: false,
    keywordCategories: [],
    titleCategories: [],
    contentCategories: [],
    source: null,
  };
  if (!content?.trim() || !keyword?.trim()) return empty;

  const keywordCategories = detectCategoriesInText(keyword);
  const titleCategories = pageTitle ? detectCategoriesInText(pageTitle) : [];
  const contentCategories = detectCategoriesInText(content);

  if (isTopicMismatch(keywordCategories, contentCategories)) {
    return { mismatch: true, keywordCategories, titleCategories, contentCategories, source: "keyword" };
  }
  if (titleCategories.length > 0 && isTopicMismatch(titleCategories, contentCategories)) {
    return { mismatch: true, keywordCategories, titleCategories, contentCategories, source: "title" };
  }
  return { ...empty, keywordCategories, titleCategories, contentCategories };
}
