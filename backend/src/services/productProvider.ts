import type { GenerationRequestPayload, ProductFetchResult, ProductSummary } from "../types.js";
import {
  fetchRelatedProducts as fetchWordpressProducts,
  searchProductsByName as searchWordpressProductsByName,
} from "./wordpress.js";
import {
  fetchRelatedProducts as fetchShopifyProducts,
  searchProductsByName as searchShopifyProductsByName,
} from "./shopify.js";

export type ProductSource = "wordpress" | "shopify";

/** 用环境变量补全未填的 Shopify 店铺 URL / Token（便于只在服务端 .env 配置） */
export function mergeShopifyCredentialsFromEnv(payload: GenerationRequestPayload): void {
  const url = process.env.SHOPIFY_STORE_URL?.trim();
  const token = process.env.SHOPIFY_ACCESS_TOKEN?.trim();
  const publicUrl = process.env.SHOPIFY_PUBLIC_STORE_URL?.trim();
  if (!payload.shopify) {
    payload.shopify = { storeUrl: "", accessToken: "" };
  }
  if (!payload.shopify.storeUrl?.trim() && url) {
    payload.shopify.storeUrl = url;
  }
  if (!payload.shopify.accessToken?.trim() && token) {
    payload.shopify.accessToken = token;
  }
  if (publicUrl && !payload.shopify.publicStoreUrl?.trim()) {
    payload.shopify.publicStoreUrl = publicUrl;
  }
}

/**
 * 仅在明确选择 wordpress / shopify 时采用对应源；未指定时若已有完整 Shopify 凭据则走 Shopify。
 */
export function resolveProductSource(payload: GenerationRequestPayload): ProductSource {
  const explicit = payload.productSource?.trim();
  const hasShopify =
    Boolean(payload.shopify?.storeUrl?.trim()) && Boolean(payload.shopify?.accessToken?.trim());
  if (explicit === "shopify") {
    return "shopify";
  }
  if (explicit === "wordpress") {
    return "wordpress";
  }
  if (hasShopify) {
    return "shopify";
  }
  return "wordpress";
}

export async function fetchProductsBySource(
  payload: GenerationRequestPayload,
  keyword: string,
  targetCategory?: string
): Promise<ProductFetchResult> {
  const source = resolveProductSource(payload);
  if (source === "shopify") {
    if (!payload.shopify) {
      throw new Error("Shopify product source selected but shopify credentials are missing");
    }
    return fetchShopifyProducts(payload.shopify, keyword, targetCategory);
  }
  return fetchWordpressProducts(payload.wordpress, keyword, targetCategory);
}

export async function searchProductsBySource(
  payload: GenerationRequestPayload,
  productNames: string[]
): Promise<ProductSummary[]> {
  const source = resolveProductSource(payload);
  if (source === "shopify") {
    if (!payload.shopify) return [];
    return searchShopifyProductsByName(payload.shopify, productNames);
  }
  return searchWordpressProductsByName(payload.wordpress, productNames);
}
