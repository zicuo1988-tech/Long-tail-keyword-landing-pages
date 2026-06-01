/**
 * 配图 URL 策略（文件名历史保留）：
 * - 内容图（正文配图 / OG）统一只读取 Sanity CDN 图片。
 * - Shopify Files / OSS 相关函数仅保留兼容，不参与内容图来源决策。
 */

const DEFAULT_FILES_BASE = "https://cdn.shopify.com/s/files/1/0582/5501/6121/files";

/** 旧 OSS 文件名与 Shopify Files 中实际文件名不一致时的映射 */
const LEGACY_OSS_TO_SHOPIFY_FILE: Record<string, string> = {
  "vertupen.webp": "03.webp",
};

export function getShopifyCdnFilesBase(): string {
  return (process.env.SHOPIFY_CDN_FILES_BASE || DEFAULT_FILES_BASE).replace(/\/+$/, "");
}

function resolveShopifyFileName(fileName: string): string {
  const base = fileName.includes("/") ? fileName.split("/").pop() || fileName : fileName;
  return LEGACY_OSS_TO_SHOPIFY_FILE[base] ?? base;
}

/**
 * @param fileName — Shopify Files 中的文件名，如 Agent-Q-menu-banner.webp
 * @param imageQuery — 覆盖默认的裁剪/尺寸参数
 */
export function shopifyCdnFileUrl(fileName: string, imageQuery?: string): string {
  const name = resolveShopifyFileName(fileName);
  const base = getShopifyCdnFilesBase();
  const q =
    imageQuery?.trim() ||
    process.env.SHOPIFY_CDN_IMAGE_QUERY?.trim() ||
    "width=800&height=450&crop=center";
  const qs = q.replace(/^\?/, "");
  const v = process.env.SHOPIFY_CDN_FILES_V?.trim();
  const query = v ? `v=${v}&${qs}` : qs;
  return `${base}/${encodeURIComponent(name)}?${query}`;
}

function parseCommaSeparatedImageUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//i.test(s));
}

function isSanityImageUrl(url: string): boolean {
  return /^https?:\/\/cdn\.sanity\.io\/images\//i.test(url);
}

/** 长文配图备用 URL：仅读取 SANITY_ARTICLE_IMAGE_URLS，并过滤为 Sanity CDN 图片。 */
export function getArticleImageUrlsFromEnv(): string[] {
  const merged = [...parseCommaSeparatedImageUrls(process.env.SANITY_ARTICLE_IMAGE_URLS)];
  const sanityOnly = merged.filter(isSanityImageUrl);
  return [...new Set(sanityOnly)];
}

/** 模板4/5 Open Graph 封面：仅允许使用 SANITY_OG_COVER_URL（Sanity CDN 图片）。 */
export function luxuryGuideOgCoverUrl(): string {
  const fromSanityOg = process.env.SANITY_OG_COVER_URL?.trim() || "";
  if (fromSanityOg && isSanityImageUrl(fromSanityOg)) {
    return fromSanityOg;
  }
  const fromEnvList = getArticleImageUrlsFromEnv();
  if (fromEnvList.length > 0) return fromEnvList[0];
  return "";
}

/** 将正文中已失效的 OSS 图片 URL 转为 Shopify Files CDN（按路径最后一段文件名匹配） */
export function rewriteVertuOssContentToShopifyCdn(html: string): string {
  if (!html || !html.includes("vertu-website-oss")) return html;
  return html.replace(
    /https:\/\/vertu-website-oss\.vertu\.com\/\d{4}\/\d{2}\/([^"'\\\s>)]+)/gi,
    (_full, pathPart: string) => {
      const rawName = pathPart.split("/").pop() || pathPart;
      let fileName = rawName;
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        /* keep raw */
      }
      return shopifyCdnFileUrl(fileName);
    }
  );
}
