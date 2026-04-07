/**
 * 配图 URL 策略（本文件仍含 Shopify Files / OSS 兼容逻辑，名称历史原因保留）
 *
 * 1) 长文正文配图白名单（优先）：Shopify Admin 商品接口返回的 `images[0].src`（真实可访问）。
 *
 * 2) Sanity 侧（与主站 Studio 一致）：文档 `image` 字段 → asset → GROQ 取 `asset.url` 即 CDN 绝对地址；
 *    前台再用 `urlFor` / `buildImageUrl` 加宽高与 `?w=&q=&auto=format` 等参数。无单独「自定义路径表」。
 *    若要在本引擎里用同一批素材作备用，把 GROQ 或前端生成好的 **完整 https://cdn.sanity.io/images/...** 填进环境变量即可。
 *
 * 3) 环境变量备用列表（合并去重）：`ARTICLE_IMAGE_URLS`、`SANITY_ARTICLE_IMAGE_URLS`、`SHOPIFY_ARTICLE_IMAGE_URLS`（逗号分隔，任填 Sanity 或 Shopify 商品图 URL）。
 *
 * 4) OG 封面：`SHOPIFY_LUXURY_GUIDE_COVER_URL` 或 `SANITY_OG_COVER_URL`（任选其一，填完整 URL，可为 Sanity CDN）。
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

/**
 * 长文配图 / OG 的备用 URL：合并 `ARTICLE_IMAGE_URLS`、`SANITY_ARTICLE_IMAGE_URLS`、`SHOPIFY_ARTICLE_IMAGE_URLS`（去重）。
 * Sanity 素材请粘贴 GROQ/`urlFor` 得到的完整 `cdn.sanity.io` 地址（含查询参数亦可）。
 */
export function getArticleImageUrlsFromEnv(): string[] {
  const merged = [
    ...parseCommaSeparatedImageUrls(process.env.ARTICLE_IMAGE_URLS),
    ...parseCommaSeparatedImageUrls(process.env.SANITY_ARTICLE_IMAGE_URLS),
    ...parseCommaSeparatedImageUrls(process.env.SHOPIFY_ARTICLE_IMAGE_URLS),
  ];
  return [...new Set(merged)];
}

/** 模板4/5 Open Graph 封面（完整 URL；可为 Sanity CDN 或商品图） */
export function luxuryGuideOgCoverUrl(): string {
  const full =
    process.env.SHOPIFY_LUXURY_GUIDE_COVER_URL?.trim() || process.env.SANITY_OG_COVER_URL?.trim();
  if (full) return full;
  const fromEnvList = getArticleImageUrlsFromEnv();
  if (fromEnvList.length > 0) return fromEnvList[0];
  const fn = process.env.SHOPIFY_OG_COVER_FILENAME?.trim();
  if (fn) {
    const q = process.env.SHOPIFY_OG_IMAGE_QUERY?.trim() || "width=1200&height=630&crop=center";
    return shopifyCdnFileUrl(fn, q);
  }
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
