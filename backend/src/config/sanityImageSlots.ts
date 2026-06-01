/**
 * Sanity Media 命名约定（originalFilename，小写）：
 *
 * 分类区（4 张）：
 *   landing-category-phones*
 *   landing-category-accessories*
 *   landing-category-new*
 *   landing-category-best-seller*
 *
 * 工艺区（3 张）：
 *   landing-craft-1* / landing-craft-2* / landing-craft-3*
 *
 * OG 封面：
 *   landing-og-cover*
 *
 * 正文配图（按品类）：
 *   landing-article-phone* / landing-article-watch* / landing-article-ring* / landing-article-earbud*
 *   landing-article-*（通用）
 */

export interface ImageSlot {
  key: string;
  alt: string;
  pattern: string;
  /** API 主 pattern 无匹配时尝试的宽松 pattern（适配未按 landing-* 命名的素材） */
  loosePatterns?: string[];
  /** 为 true 时始终使用 fallbackUrl（分类区四宫格与线上一致，不走图库替换） */
  fixedOnly?: boolean;
  /** 迁移期 fallback / 固定展示 URL */
  fallbackUrl?: string;
}

/** 与 fallback CDN URL 一致，env 未配置时仍可查询图库 */
export const DEFAULT_SANITY_PROJECT_ID = "e0gp1l2g";
export const DEFAULT_SANITY_DATASET = "production";

/** 分类四宫格：与线上一致的固定 Sanity CDN（Phones / Acc / New / Best Seller） */
export const CATEGORY_IMAGE_SLOTS: ImageSlot[] = [
  {
    key: "phones",
    alt: "phones",
    pattern: "landing-category-phones*",
    fixedOnly: true,
    fallbackUrl:
      "https://cdn.sanity.io/images/e0gp1l2g/production/42fadc1189fd18fe3c4669a12341d045bf01e102-2000x1200.webp?w=900&q=86&auto=format&fit=max",
  },
  {
    key: "accessories",
    alt: "accessories",
    pattern: "landing-category-accessories*",
    fixedOnly: true,
    fallbackUrl:
      "https://cdn.sanity.io/images/e0gp1l2g/production/67885393a5e02f72217e8665aa4b3223a07dcf4a-2000x1200.webp?w=520&q=86&auto=format&fit=max",
  },
  {
    key: "new",
    alt: "new products",
    pattern: "landing-category-new*",
    fixedOnly: true,
    fallbackUrl:
      "https://cdn.sanity.io/images/e0gp1l2g/production/6b5b785af5638f48ee908f7eff549fbe3586d5fa-2000x1200.webp?w=520&q=86&auto=format&fit=max",
  },
  {
    key: "best-seller",
    alt: "best sellers",
    pattern: "landing-category-best-seller*",
    fixedOnly: true,
    fallbackUrl:
      "https://cdn.sanity.io/images/e0gp1l2g/production/4ff0cc50d53e4e44aeee062cb2c9e8d3906bda23-2000x1200.webp?w=520&q=86&auto=format&fit=max",
  },
];

/** 分类区固定图（生成时直接使用，与改版前 HTML 硬编码一致） */
export function buildFixedCategoryImages(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const slot of CATEGORY_IMAGE_SLOTS) {
    if (slot.fallbackUrl) map[slot.key] = slot.fallbackUrl;
  }
  return map;
}

export const CRAFT_IMAGE_SLOTS: ImageSlot[] = [
  {
    key: "craft-1",
    alt: "craft 1",
    pattern: "landing-craft-1*",
    loosePatterns: ["*craft*1*", "*craftsmanship*", "*exquisite*"],
    fallbackUrl:
      "https://cdn.sanity.io/images/e0gp1l2g/production/94b90af420294bbf8a7f07d191c431837af3e341-1500x1500.png?w=900&h=900&q=80&auto=format&fit=crop",
  },
  {
    key: "craft-2",
    alt: "craft 2",
    pattern: "landing-craft-2*",
    loosePatterns: ["*craft*2*", "*bespoke*", "*personal*"],
    fallbackUrl:
      "https://cdn.sanity.io/images/e0gp1l2g/production/d4abc00172ddf6e8db5b8d99ae66bcf4b7fcd231-1500x1500.png?w=900&h=900&q=80&auto=format&fit=crop",
  },
  {
    key: "craft-3",
    alt: "craft 3",
    pattern: "landing-craft-3*",
    loosePatterns: ["*craft*3*", "*ruby*"],
    fallbackUrl:
      "https://cdn.sanity.io/images/e0gp1l2g/production/6514cbe487d44df8ddc748c9c3a12475f32104d3-1500x1500.png?w=900&h=900&q=80&auto=format&fit=crop",
  },
];

export const OG_COVER_PATTERN = "landing-og-cover*";

export const ARTICLE_IMAGE_PATTERN_PREFIX = "landing-article-";

export const ARTICLE_TOPIC_PATTERNS: Record<string, string> = {
  phone: "landing-article-phone*",
  watch: "landing-article-watch*",
  ring: "landing-article-ring*",
  earbud: "landing-article-earbud*",
};

/** 槽位 fallback + 营销图 URL，保证正文配图白名单永不为空 */
export function collectSlotFallbackUrls(): string[] {
  const urls: string[] = [];
  for (const slot of [...CATEGORY_IMAGE_SLOTS, ...CRAFT_IMAGE_SLOTS]) {
    if (slot.fallbackUrl) urls.push(slot.fallbackUrl);
  }
  return [...new Set(urls)];
}

export function detectArticleTopicPattern(keyword: string, pageTitle: string): string | undefined {
  const text = `${keyword} ${pageTitle}`.toLowerCase();
  if (/\b(phone|smartphone|mobile|cell)\b/.test(text)) return ARTICLE_TOPIC_PATTERNS.phone;
  if (/\b(watch|smartwatch|smart-watch|timepiece)\b/.test(text)) return ARTICLE_TOPIC_PATTERNS.watch;
  if (/\b(ring|jewellery|jewelry)\b/.test(text)) return ARTICLE_TOPIC_PATTERNS.ring;
  if (/\b(earbud|earphone|headphone|audio)\b/.test(text)) return ARTICLE_TOPIC_PATTERNS.earbud;
  return undefined;
}
