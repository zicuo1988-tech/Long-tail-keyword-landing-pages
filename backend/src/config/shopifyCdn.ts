/**
 * Shopify Files CDN：文章配图、OG 封面等与 vertu.com  storefront 一致的素材域名。
 * 参考：https://cdn.shopify.com/s/files/1/0582/5501/6121/files/...
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

/** 模板4/5 Open Graph 封面（原 OSS 按 slug 生成的地址已失效） */
export function luxuryGuideOgCoverUrl(): string {
  const full = process.env.SHOPIFY_LUXURY_GUIDE_COVER_URL?.trim();
  if (full) return full;
  const fn = process.env.SHOPIFY_OG_COVER_FILENAME?.trim() || "Agent-Q-menu-banner.webp";
  const q = process.env.SHOPIFY_OG_IMAGE_QUERY?.trim() || "width=1200&height=630&crop=center";
  return shopifyCdnFileUrl(fn, q);
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
