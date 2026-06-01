import { createClient, type SanityClient } from "@sanity/client";
import {
  ARTICLE_IMAGE_PATTERN_PREFIX,
  CATEGORY_IMAGE_SLOTS,
  CRAFT_IMAGE_SLOTS,
  DEFAULT_SANITY_DATASET,
  DEFAULT_SANITY_PROJECT_ID,
  OG_COVER_PATTERN,
  buildFixedCategoryImages,
  collectSlotFallbackUrls,
  type ImageSlot,
} from "../config/sanityImageSlots.js";
import { getArticleImageUrlsFromEnv, luxuryGuideOgCoverUrl } from "../config/shopifyCdn.js";
import {
  buildArticleImageSearchContext,
  rankArticleAssets,
  type SanityImageAssetLike,
} from "../utils/articleImageMatching.js";

export interface SanityImageAsset {
  _id: string;
  originalFilename?: string;
  url: string;
  width?: number;
  height?: number;
}

export interface SanityImageConfig {
  projectId?: string;
  dataset?: string;
  token?: string;
  apiVersion?: string;
}

export interface LandingImageBundle {
  articleUrls: string[];
  categoryImages: Record<string, string>;
  craftImages: Record<string, string>;
  ogCoverUrl: string;
  stats: {
    apiHits: number;
    fallbacks: number;
    source: "api" | "env" | "mixed";
  };
}

const CACHE_TTL_MS = 15 * 60 * 1000;

type CacheEntry<T> = { value: T; expiresAt: number };

const queryCache = new Map<string, CacheEntry<unknown>>();

function resolveSanityConfig(overrides?: SanityImageConfig): {
  projectId: string;
  dataset: string;
  token: string;
  apiVersion: string;
} | null {
  const projectId = (
    overrides?.projectId ||
    process.env.SANITY_PROJECT_ID ||
    DEFAULT_SANITY_PROJECT_ID
  ).trim();
  const dataset = (
    overrides?.dataset ||
    process.env.SANITY_DATASET ||
    DEFAULT_SANITY_DATASET
  ).trim();
  const token = (
    overrides?.token ||
    process.env.SANITY_READ_TOKEN ||
    process.env.SANITY_API_TOKEN ||
    ""
  ).trim();
  const apiVersion = (overrides?.apiVersion || process.env.SANITY_API_VERSION || "2023-10-01").trim();
  if (!projectId || !dataset || !token) {
    return null;
  }
  return { projectId, dataset, token, apiVersion };
}

function getSanityClient(config?: SanityImageConfig): SanityClient | null {
  const resolved = resolveSanityConfig(config);
  if (!resolved) return null;
  return createClient({
    projectId: resolved.projectId,
    dataset: resolved.dataset,
    apiVersion: resolved.apiVersion,
    token: resolved.token,
    useCdn: false,
  });
}

function isSanityImageUrl(url: string): boolean {
  return /^https?:\/\/cdn\.sanity\.io\/images\//i.test(url);
}

function normalizeAssetUrl(url: unknown): string {
  if (typeof url !== "string" || !url.trim()) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
}

/** 在 Sanity CDN url 上追加或合并 query 参数 */
export function appendSanityImageParams(baseUrl: string, params: Record<string, string | number>): string {
  if (!baseUrl?.trim()) return "";
  try {
    const u = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) {
      u.searchParams.set(k, String(v));
    }
    return u.toString();
  } catch {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return `${baseUrl}${sep}${qs}`;
  }
}

async function fetchGroq<T>(
  query: string,
  params: Record<string, unknown>,
  config?: SanityImageConfig
): Promise<T | null> {
  const client = getSanityClient(config);
  if (!client) return null;

  const resolved = resolveSanityConfig(config)!;
  const cacheKey = JSON.stringify({ query, params, projectId: resolved.projectId, dataset: resolved.dataset });
  const cached = queryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T;
  }

  try {
    const result = await client.fetch<T>(query, params);
    queryCache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[SanityImageLibrary] GROQ fetch error: ${message}`);
    return null;
  }
}

export async function listRecentAssets(
  limit = 100,
  config?: SanityImageConfig
): Promise<SanityImageAsset[]> {
  const query = `*[_type == "sanity.imageAsset"] | order(_updatedAt desc)[0...$limit]{
    _id,
    originalFilename,
    url,
    "width": metadata.dimensions.width,
    "height": metadata.dimensions.height
  }`;
  const result = await fetchGroq<SanityImageAsset[]>(query, { limit }, config);
  return Array.isArray(result)
    ? result
        .map((a) => ({ ...a, url: normalizeAssetUrl(a.url) }))
        .filter((a) => a?.url && isSanityImageUrl(a.url))
    : [];
}

export async function findAssetsByPattern(
  pattern: string,
  limit = 40,
  config?: SanityImageConfig
): Promise<SanityImageAsset[]> {
  const query = `*[
    _type == "sanity.imageAsset" &&
    originalFilename match $pattern
  ] | order(_updatedAt desc)[0...$limit]{
    _id,
    originalFilename,
    url
  }`;
  const result = await fetchGroq<SanityImageAsset[]>(query, { pattern, limit }, config);
  return Array.isArray(result)
    ? result
        .map((a) => ({ ...a, url: normalizeAssetUrl(a.url) }))
        .filter((a) => a?.url && isSanityImageUrl(a.url))
    : [];
}

export async function getAssetById(
  assetId: string,
  config?: SanityImageConfig
): Promise<SanityImageAsset | null> {
  const query = `*[_id == $assetId][0]{
    _id,
    originalFilename,
    url,
    "width": metadata.dimensions.width,
    "height": metadata.dimensions.height
  }`;
  const result = await fetchGroq<SanityImageAsset | null>(query, { assetId }, config);
  if (!result?.url) return null;
  const url = normalizeAssetUrl(result.url);
  return url && isSanityImageUrl(url) ? { ...result, url } : null;
}

async function findFirstAssetForSlot(
  slot: ImageSlot,
  config?: SanityImageConfig
): Promise<SanityImageAsset | null> {
  const patterns = [slot.pattern, ...(slot.loosePatterns || [])];
  for (const pattern of patterns) {
    const assets = await findAssetsByPattern(pattern, 1, config);
    if (assets[0]) return assets[0];
  }
  return null;
}

function toCategoryUrl(baseUrl: string, slotKey: string): string {
  const w = slotKey === "phones" ? 900 : 520;
  return appendSanityImageParams(baseUrl, { w, q: 86, auto: "format", fit: "max" });
}

function toCraftUrl(baseUrl: string): string {
  return appendSanityImageParams(baseUrl, { w: 900, h: 900, q: 80, auto: "format", fit: "crop" });
}

function toArticleUrl(baseUrl: string): string {
  return appendSanityImageParams(baseUrl, { w: 800, h: 450, q: 80, auto: "format", fit: "crop" });
}

function toOgUrl(baseUrl: string): string {
  return appendSanityImageParams(baseUrl, { w: 1200, h: 630, q: 85, auto: "format", fit: "crop" });
}

function ensureSlotMapComplete(
  map: Record<string, string>,
  slots: ImageSlot[]
): { map: Record<string, string>; extraFallbacks: number } {
  let extraFallbacks = 0;
  for (const slot of slots) {
    if (!map[slot.key]?.trim() && slot.fallbackUrl) {
      map[slot.key] = slot.fallbackUrl;
      extraFallbacks += 1;
    }
  }
  return { map, extraFallbacks };
}

async function resolveSlotMap(
  slots: ImageSlot[],
  transform: (url: string, slot: ImageSlot) => string,
  config?: SanityImageConfig
): Promise<{ map: Record<string, string>; apiHits: number; fallbacks: number }> {
  const map: Record<string, string> = {};
  let apiHits = 0;
  let fallbacks = 0;

  await Promise.all(
    slots.map(async (slot) => {
      if (slot.fixedOnly && slot.fallbackUrl) {
        map[slot.key] = slot.fallbackUrl;
        fallbacks += 1;
        return;
      }
      const asset = await findFirstAssetForSlot(slot, config);
      if (asset?.url) {
        map[slot.key] = transform(asset.url, slot);
        apiHits += 1;
      } else if (slot.fallbackUrl) {
        map[slot.key] = slot.fallbackUrl;
        fallbacks += 1;
      }
    })
  );

  const completed = ensureSlotMapComplete(map, slots);
  fallbacks += completed.extraFallbacks;

  return { map: completed.map, apiHits, fallbacks };
}

function mergeArticleUrlPools(pools: string[][]): string[] {
  const merged: string[] = [];
  for (const pool of pools) {
    for (const u of pool) {
      const trimmed = u?.trim();
      if (trimmed && isSanityImageUrl(trimmed)) merged.push(trimmed);
    }
  }
  return [...new Set(merged)];
}

async function fetchAssetsForPatterns(
  patterns: string[],
  config?: SanityImageConfig,
  perPattern = 20
): Promise<SanityImageAsset[]> {
  const seen = new Map<string, SanityImageAsset>();
  const batches = await Promise.all(
    patterns.map((pattern) => findAssetsByPattern(pattern, perPattern, config))
  );
  for (const batch of batches) {
    for (const asset of batch) {
      if (asset?._id && asset.url && !seen.has(asset._id)) {
        seen.set(asset._id, asset);
      }
    }
  }
  return [...seen.values()];
}

export async function getArticleImageUrls(options: {
  keyword: string;
  pageTitle: string;
  config?: SanityImageConfig;
  maxUrls?: number;
}): Promise<string[]> {
  const maxUrls = options.maxUrls ?? 12;
  const envFallback = getArticleImageUrlsFromEnv();
  const slotFallbacks = collectSlotFallbackUrls().map(toArticleUrl);
  const ctx = buildArticleImageSearchContext(options.keyword, options.pageTitle);

  const topicAlignedCategoryUrl = ctx.topicCategoryImageUrl
    ? toArticleUrl(ctx.topicCategoryImageUrl)
    : "";

  if (!resolveSanityConfig(options.config)) {
    const offline = mergeArticleUrlPools([
      topicAlignedCategoryUrl ? [topicAlignedCategoryUrl] : [],
      envFallback,
      slotFallbacks,
    ]).slice(0, maxUrls);
    console.log(
      `[SanityImageLibrary] 正文配图（离线）品类=${ctx.primaryCategory} flip=${ctx.isFlipIntent} 共 ${offline.length} 张`
    );
    return offline;
  }

  const patternAssets = await fetchAssetsForPatterns(ctx.groqPatterns, options.config, 24);
  let ranked = rankArticleAssets(patternAssets as SanityImageAssetLike[], ctx);

  if (ranked.length < maxUrls) {
    const recent = await listRecentAssets(100, options.config);
    ranked = rankArticleAssets(
      [...ranked, ...recent.filter((a) => !isMarketingSlotFilename((a.originalFilename || "").toLowerCase()))],
      ctx
    );
  }

  const rankedUrls = ranked.map((a) => toArticleUrl(a.url));

  const unique = mergeArticleUrlPools([
    topicAlignedCategoryUrl ? [topicAlignedCategoryUrl] : [],
    rankedUrls,
    envFallback,
    slotFallbacks,
  ]).slice(0, maxUrls);

  console.log(
    `[SanityImageLibrary] 正文配图 品类=${ctx.primaryCategory} flip=${ctx.isFlipIntent} API候选=${patternAssets.length} 输出=${unique.length} 张` +
      (unique[0] ? ` 首选=${unique[0].slice(0, 72)}...` : "")
  );

  if (unique.length > 0) return unique;

  return mergeArticleUrlPools([envFallback, slotFallbacks]).slice(0, maxUrls);
}

function isMarketingSlotFilename(name: string): boolean {
  return (
    name.startsWith("landing-category-") ||
    name.startsWith("landing-craft-") ||
    name.startsWith("landing-og-")
  );
}

export async function resolveLandingImages(options: {
  keyword: string;
  pageTitle: string;
  config?: SanityImageConfig;
}): Promise<LandingImageBundle> {
  let apiHits = 0;
  let fallbacks = 0;

  const config = options.config;
  const hasApi = Boolean(resolveSanityConfig(config));

  if (!hasApi) {
    console.warn(
      "[SanityImageLibrary] 未配置 SANITY_READ_TOKEN / SANITY_API_TOKEN，使用槽位 fallback 与 env 配图"
    );
  }

  const categoryImages = buildFixedCategoryImages();
  const categoryFallbackCount = Object.keys(categoryImages).length;

  const [craftResult, articleUrls] = await Promise.all([
    resolveSlotMap(CRAFT_IMAGE_SLOTS, (url) => toCraftUrl(url), config),
    getArticleImageUrls({
      keyword: options.keyword,
      pageTitle: options.pageTitle,
      config,
    }),
  ]);

  apiHits += craftResult.apiHits;
  fallbacks += categoryFallbackCount + craftResult.fallbacks;

  const imgCtx = buildArticleImageSearchContext(options.keyword, options.pageTitle);

  let ogCoverUrl = "";
  if (hasApi) {
    const ogPatterns = [
      `landing-og-${imgCtx.primaryCategory}*`,
      OG_COVER_PATTERN,
      ...(imgCtx.isFlipIntent ? ["landing-og-flip*", "*og*flip*"] : []),
    ];
    const ogAssets = await fetchAssetsForPatterns(ogPatterns, config, 5);
    const ogRanked = rankArticleAssets(ogAssets as SanityImageAssetLike[], imgCtx);
    if (ogRanked[0]?.url) {
      ogCoverUrl = toOgUrl(ogRanked[0].url);
      apiHits += 1;
    }
  }

  if (!ogCoverUrl) {
    ogCoverUrl = luxuryGuideOgCoverUrl();
    if (ogCoverUrl) fallbacks += 1;
  }
  if (!ogCoverUrl && articleUrls[0]) {
    ogCoverUrl = articleUrls[0];
  }
  if (!ogCoverUrl) {
    const slotOg = collectSlotFallbackUrls()[0];
    if (slotOg) ogCoverUrl = toOgUrl(slotOg);
  }

  const source: LandingImageBundle["stats"]["source"] =
    !hasApi ? "env" : fallbacks > 0 && apiHits > 0 ? "mixed" : apiHits > 0 ? "api" : "env";

  console.log(
    `[SanityImageLibrary] 图库解析完成: API 命中 ${apiHits} 槽位, fallback ${fallbacks}, 正文配图 ${articleUrls.length} 张, 分类 ${Object.keys(categoryImages).length}/4（固定 CDN）, 工艺 ${Object.keys(craftResult.map).length}/3, source=${source}`
  );

  return {
    articleUrls,
    categoryImages,
    craftImages: craftResult.map,
    ogCoverUrl,
    stats: { apiHits, fallbacks, source },
  };
}
