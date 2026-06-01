import {
  ARTICLE_IMAGE_PATTERN_PREFIX,
  ARTICLE_TOPIC_PATTERNS,
  buildFixedCategoryImages,
} from "../config/sanityImageSlots.js";
import {
  detectPrimaryCategory,
  isFlipPhoneIntent,
  type PrimaryProductCategory,
} from "./productCategory.js";

export interface SanityImageAssetLike {
  _id: string;
  originalFilename?: string;
  url: string;
}

export interface ArticleImageSearchContext {
  keyword: string;
  pageTitle: string;
  primaryCategory: PrimaryProductCategory;
  isFlipIntent: boolean;
  /** GROQ originalFilename match patterns（按优先级） */
  groqPatterns: string[];
  /** 用于对 originalFilename 打分的词元 */
  filenameTokens: string[];
  /** 与品类相关的固定分类图（作正文配图候选） */
  topicCategoryImageUrl?: string;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "your",
  "our",
  "how",
  "what",
  "why",
  "when",
  "where",
  "best",
  "top",
  "most",
  "guide",
  "guides",
  "review",
  "reviews",
  "list",
  "ranking",
  "complete",
  "ultimate",
  "luxury",
  "life",
  "vertu",
  "official",
  "store",
  "shop",
  "buy",
  "buying",
]);

const PRIMARY_FILENAME_HINTS: Record<PrimaryProductCategory, string[]> = {
  phone: ["phone", "smartphone", "mobile", "handset", "agent", "quantum", "flip", "fold"],
  watch: ["watch", "timepiece", "horology", "chronograph", "wrist"],
  ring: ["ring", "jewellery", "jewelry", "diamond", "aura"],
  earbud: ["earbud", "earphone", "headphone", "audio"],
  gift: ["gift", "present", "mother", "father", "christmas", "holiday"],
  general: ["luxury", "vertu", "premium"],
};

/** 主品类 → 分类四宫格里最贴近的正文配图（与固定分类图一致） */
function topicCategorySlotKey(primary: PrimaryProductCategory, isFlip: boolean): string | undefined {
  if (isFlip) return "phones";
  switch (primary) {
    case "phone":
      return "phones";
    case "watch":
      return "accessories";
    case "ring":
      return "accessories";
    case "earbud":
      return "accessories";
    case "gift":
      return "best-seller";
    default:
      return undefined;
  }
}

function extractFilenameTokens(keyword: string, pageTitle: string): string[] {
  const raw = `${keyword} ${pageTitle}`.toLowerCase();
  const words = raw.match(/\b[a-z][a-z0-9-]{2,}\b/g) || [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w) && w.length >= 3))].slice(0, 12);
}

function topicArticlePattern(primary: PrimaryProductCategory, isFlip: boolean): string[] {
  const patterns: string[] = [];
  if (isFlip) {
    patterns.push("landing-article-flip*", "landing-article-fold*", "*flip*phone*", "*fold*phone*");
  }
  const topicKey = primary === "general" ? undefined : primary;
  if (topicKey && ARTICLE_TOPIC_PATTERNS[topicKey as keyof typeof ARTICLE_TOPIC_PATTERNS]) {
    patterns.push(ARTICLE_TOPIC_PATTERNS[topicKey as keyof typeof ARTICLE_TOPIC_PATTERNS]!);
  }
  patterns.push(`${ARTICLE_IMAGE_PATTERN_PREFIX}${primary}*`, `${ARTICLE_IMAGE_PATTERN_PREFIX}*`);
  return patterns;
}

export function buildArticleImageSearchContext(keyword: string, pageTitle: string): ArticleImageSearchContext {
  const primaryCategory = detectPrimaryCategory(keyword, pageTitle);
  const isFlipIntent = isFlipPhoneIntent(keyword, pageTitle);
  const filenameTokens = extractFilenameTokens(keyword, pageTitle);

  const groqPatterns: string[] = [];
  for (const p of topicArticlePattern(primaryCategory, isFlipIntent)) {
    if (!groqPatterns.includes(p)) groqPatterns.push(p);
  }
  for (const hint of PRIMARY_FILENAME_HINTS[primaryCategory]) {
    const p = `*${hint}*`;
    if (!groqPatterns.includes(p)) groqPatterns.push(p);
  }
  for (const token of filenameTokens) {
    const p = `*${token}*`;
    if (!groqPatterns.includes(p)) groqPatterns.push(p);
  }

  const slotKey = topicCategorySlotKey(primaryCategory, isFlipIntent);
  const fixedCategories = buildFixedCategoryImages();
  const topicCategoryImageUrl = slotKey ? fixedCategories[slotKey] : undefined;

  return {
    keyword,
    pageTitle,
    primaryCategory,
    isFlipIntent,
    groqPatterns: groqPatterns.slice(0, 24),
    filenameTokens,
    topicCategoryImageUrl,
  };
}

function isMarketingSlotFilename(name: string): boolean {
  return (
    name.startsWith("landing-category-") ||
    name.startsWith("landing-craft-") ||
    name.startsWith("landing-og-")
  );
}

/** 越高越贴合关键词/品类 */
export function scoreAssetRelevance(asset: SanityImageAssetLike, ctx: ArticleImageSearchContext): number {
  const name = (asset.originalFilename || "").toLowerCase();
  let score = 0;

  if (!name) score -= 5;

  if (name.startsWith(`${ARTICLE_IMAGE_PATTERN_PREFIX}${ctx.primaryCategory}`)) score += 120;
  if (name.startsWith(ARTICLE_IMAGE_PATTERN_PREFIX)) score += 40;

  if (ctx.isFlipIntent && (name.includes("flip") || name.includes("fold"))) score += 80;

  for (const hint of PRIMARY_FILENAME_HINTS[ctx.primaryCategory]) {
    if (name.includes(hint)) score += 35;
  }

  for (const token of ctx.filenameTokens) {
    if (name.includes(token)) score += 25;
    if (token.length >= 6 && name.includes(token.slice(0, Math.min(6, token.length)))) score += 10;
  }

  if (isMarketingSlotFilename(name)) score -= 60;

  if (ctx.primaryCategory === "watch" && (name.includes("phone") || name.includes("mobile"))) score -= 25;
  if (ctx.primaryCategory === "phone" && name.includes("watch") && !name.includes("phone")) score -= 25;
  if (ctx.primaryCategory === "ring" && name.includes("phone") && !name.includes("ring")) score -= 20;

  return score;
}

export type ScoredSanityImageAsset = SanityImageAssetLike & { score: number };

export function rankArticleAssetsWithScores(
  assets: SanityImageAssetLike[],
  ctx: ArticleImageSearchContext
): ScoredSanityImageAsset[] {
  const byId = new Map<string, ScoredSanityImageAsset>();
  for (const asset of assets) {
    if (!asset?.url) continue;
    const prev = byId.get(asset._id);
    const score = scoreAssetRelevance(asset, ctx);
    if (!prev || score > prev.score) {
      byId.set(asset._id, { ...asset, score });
    }
  }
  return [...byId.values()].sort((a, b) => b.score - a.score);
}

export function rankArticleAssets(
  assets: SanityImageAssetLike[],
  ctx: ArticleImageSearchContext
): SanityImageAssetLike[] {
  return rankArticleAssetsWithScores(assets, ctx);
}

/** 稳定哈希，用于按关键词/标题轮换配图顺序 */
export function hashDiversitySeed(keyword: string, pageTitle: string): number {
  const raw = `${keyword}\0${pageTitle}`.toLowerCase();
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(h) || 1;
}

function seededRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 在保持相关性的前提下打散顺序：按得分分档、档内随机，再轮询各档取图，避免每页总是同一张首选图。
 */
export function pickDiverseRankedAssets(
  ranked: ScoredSanityImageAsset[],
  maxCount: number,
  diversitySeed: number
): ScoredSanityImageAsset[] {
  if (ranked.length === 0 || maxCount <= 0) return [];

  const rand = seededRandom(diversitySeed);
  const bandKey = (score: number) => Math.floor(score / 30);
  const bands = new Map<number, ScoredSanityImageAsset[]>();
  for (const asset of ranked) {
    const k = bandKey(asset.score);
    if (!bands.has(k)) bands.set(k, []);
    bands.get(k)!.push(asset);
  }

  const bandKeys = [...bands.keys()].sort((a, b) => b - a);
  for (const k of bandKeys) {
    shuffleInPlace(bands.get(k)!, rand);
  }

  const picked: ScoredSanityImageAsset[] = [];
  const pickedIds = new Set<string>();
  let round = 0;
  const maxRounds = Math.max(ranked.length, maxCount) * 2;

  while (picked.length < maxCount && round < maxRounds) {
    let addedThisRound = false;
    for (const k of bandKeys) {
      const band = bands.get(k)!;
      if (!band.length) continue;
      const candidate = band[round % band.length];
      if (candidate && !pickedIds.has(candidate._id)) {
        picked.push(candidate);
        pickedIds.add(candidate._id);
        addedThisRound = true;
        if (picked.length >= maxCount) break;
      }
    }
    round++;
    if (!addedThisRound) break;
  }

  const offset = diversitySeed % Math.max(1, ranked.length);
  const rotated = [...ranked.slice(offset), ...ranked.slice(0, offset)];
  for (const asset of rotated) {
    if (picked.length >= maxCount) break;
    if (!pickedIds.has(asset._id)) {
      picked.push(asset);
      pickedIds.add(asset._id);
    }
  }

  return picked.slice(0, maxCount);
}

export function getTopicAlignedCategoryFallback(ctx: ArticleImageSearchContext): string | undefined {
  return ctx.topicCategoryImageUrl;
}
