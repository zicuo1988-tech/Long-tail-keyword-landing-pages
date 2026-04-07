import axios from "axios";
import type { ProductFetchResult, ProductSummary } from "../types.js";

export interface ShopifyCredentials {
  storeUrl: string;
  accessToken: string;
  /** 对外展示的产品页基址（如 https://vertu.com）；不填则使用 storeUrl */
  publicStoreUrl?: string;
}

interface ShopifyVariant {
  price?: string;
  compare_at_price?: string | null;
  /** shopify | null | 第三方履约 handle；null 表示不跟踪库存，仍视为可售 */
  inventory_management?: string | null;
  /** deny：无库存不可售；continue：可继续售卖/预订 */
  inventory_policy?: string;
  /** 全地点聚合库存；与 inventory_policy deny 联用判断缺货 */
  inventory_quantity?: number | null;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  product_type?: string;
  tags?: string;
  images?: Array<{ src: string }>;
  variants?: ShopifyVariant[];
}

function normalizeStoreUrl(url: string): string {
  let normalized = (url || "").trim();
  if (!normalized) throw new Error("Shopify storeUrl is required");
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/+$/, "");
}

/** 产品详情 link 使用对外域名（如 vertu.com），API 仍用 storeUrl */
function resolveProductLinkBase(credentials: ShopifyCredentials): string {
  const pub = credentials.publicStoreUrl?.trim();
  if (pub) {
    return normalizeStoreUrl(pub);
  }
  return normalizeStoreUrl(credentials.storeUrl);
}

function createShopifyClient(credentials: ShopifyCredentials) {
  if (!credentials.accessToken?.trim()) {
    throw new Error("Shopify accessToken is required");
  }
  const storeUrl = normalizeStoreUrl(credentials.storeUrl);
  return axios.create({
    baseURL: `${storeUrl}/admin/api/2024-10`,
    headers: {
      "X-Shopify-Access-Token": credentials.accessToken.trim(),
    },
    // Shopify 请求直连，避免被系统 HTTP(S)_PROXY 转发后触发协议端口错误
    proxy: false,
    timeout: 30000,
  });
}

/** 至少一个变体可售则保留商品（与 WooCommerce 缺货过滤语义一致） */
function isVariantSellable(v: ShopifyVariant): boolean {
  const policy = (v.inventory_policy || "deny").toLowerCase();
  if (policy === "continue") {
    return true;
  }
  const im = v.inventory_management;
  if (im == null || im === "") {
    return true;
  }
  const qty = v.inventory_quantity;
  if (qty === undefined || qty === null) {
    return true;
  }
  return qty > 0;
}

function isShopifyProductSellable(product: ShopifyProduct): boolean {
  const variants = product.variants;
  if (!variants || variants.length === 0) {
    return false;
  }
  return variants.some(isVariantSellable);
}

function formatPriceRange(variants: ShopifyProduct["variants"]): {
  price?: string;
  originalPrice?: string;
  onSale: boolean;
  isPriceRange: boolean;
} {
  const prices = (variants || [])
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n));
  const comparePrices = (variants || [])
    .map((v) => Number(v.compare_at_price))
    .filter((n) => Number.isFinite(n));

  if (!prices.length) {
    return { onSale: false, isPriceRange: false };
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const isPriceRange = min !== max;
  const price = isPriceRange ? `$${min.toFixed(2)} - $${max.toFixed(2)}` : `$${min.toFixed(2)}`;

  let originalPrice: string | undefined;
  const minCompare = comparePrices.length ? Math.min(...comparePrices) : undefined;
  const onSale = minCompare !== undefined && minCompare > min;
  if (onSale && minCompare !== undefined) {
    originalPrice = `$${minCompare.toFixed(2)}`;
  }

  return { price, originalPrice, onSale, isPriceRange };
}

function toProductSummary(linkBaseUrl: string, product: ShopifyProduct): ProductSummary {
  const { price, originalPrice, onSale, isPriceRange } = formatPriceRange(product.variants);
  const firstTag = (product.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)[0];

  return {
    id: Number(product.id),
    name: product.title,
    link: `${linkBaseUrl}/products/${product.handle}`,
    imageUrl: product.images?.[0]?.src,
    category: product.product_type || undefined,
    categorySlug: product.product_type
      ? product.product_type.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
      : undefined,
    price,
    originalPrice,
    onSale,
    tag: firstTag || undefined,
    isPriceRange,
  };
}

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => lower.includes(t.toLowerCase()));
}

function filterProducts(products: ShopifyProduct[], keyword: string, targetCategory?: string): ShopifyProduct[] {
  const categoryTerms = (targetCategory || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const keywordTerms = keyword
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  return products.filter((p) => {
    const searchable = `${p.title} ${p.product_type || ""} ${p.tags || ""}`;
    if (categoryTerms.length) {
      return includesAny(searchable, categoryTerms);
    }
    if (!keywordTerms.length) return true;
    return includesAny(searchable, keywordTerms);
  });
}

export async function fetchRelatedProducts(
  credentials: ShopifyCredentials,
  keyword: string,
  targetCategory?: string
): Promise<ProductFetchResult> {
  const client = createShopifyClient(credentials);
  const linkBase = resolveProductLinkBase(credentials);

  const response = await client.get("/products.json", {
    params: { status: "active", limit: 250 },
  });

  const rawProducts: ShopifyProduct[] = Array.isArray(response.data?.products) ? response.data.products : [];
  const sellable = rawProducts.filter((p) => {
    const ok = isShopifyProductSellable(p);
    if (!ok) {
      console.log(`[Shopify] ⚠️ 过滤缺货/不可售产品: ${p.title} (id=${p.id})`);
    }
    return ok;
  });
  const matched = filterProducts(sellable, keyword, targetCategory);
  const products = matched.slice(0, 40).map((p) => toProductSummary(linkBase, p));

  return { products, relatedProducts: [] };
}

export async function searchProductsByName(
  credentials: ShopifyCredentials,
  productNames: string[]
): Promise<ProductSummary[]> {
  if (!productNames.length) return [];
  const client = createShopifyClient(credentials);
  const linkBase = resolveProductLinkBase(credentials);

  const response = await client.get("/products.json", {
    params: { status: "active", limit: 250 },
  });

  const rawProducts: ShopifyProduct[] = Array.isArray(response.data?.products) ? response.data.products : [];
  const sellable = rawProducts.filter((p) => {
    const ok = isShopifyProductSellable(p);
    if (!ok) {
      console.log(`[Shopify] ⚠️ 过滤缺货/不可售产品: ${p.title} (id=${p.id})`);
    }
    return ok;
  });
  const lowerNames = productNames.map((n) => n.toLowerCase());

  return sellable
    .filter((p) => lowerNames.some((name) => p.title.toLowerCase().includes(name)))
    .slice(0, 30)
    .map((p) => toProductSummary(linkBase, p));
}
