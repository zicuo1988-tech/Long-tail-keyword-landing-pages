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

export function resolveProductSource(payload: GenerationRequestPayload): ProductSource {
  if (payload.productSource === "shopify") {
    return "shopify";
  }
  if (payload.productSource === "wordpress") {
    return "wordpress";
  }
  if (payload.shopify?.storeUrl && payload.shopify?.accessToken) {
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
