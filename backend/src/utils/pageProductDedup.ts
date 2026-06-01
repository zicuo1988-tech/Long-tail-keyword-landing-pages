import type { ProductSummary } from "../types.js";

export type PageProductSections = {
  topProducts: ProductSummary[];
  products: ProductSummary[];
  productsRow2: ProductSummary[];
  relatedProducts: ProductSummary[];
};

export type DedupePageProductOptions = {
  templateType: string;
  logPrefix?: string;
};

const TOP_MAX = 3;
const ROW_MAX = 4;
const TEMPLATE7_PRODUCTS_MAX = 10;

function productsMainMax(templateType: string): number {
  return templateType === "template-7" ? TEMPLATE7_PRODUCTS_MAX : ROW_MAX;
}

type SectionAssignResult = {
  result: ProductSummary[];
  skipped: ProductSummary[];
  backfilled: ProductSummary[];
};

function assignSection(
  list: ProductSummary[],
  max: number,
  seenIds: Set<number>,
  pool: ProductSummary[]
): SectionAssignResult {
  const result: ProductSummary[] = [];
  const skipped: ProductSummary[] = [];

  for (const p of list) {
    if (result.length >= max) break;
    if (seenIds.has(p.id)) {
      skipped.push(p);
      continue;
    }
    seenIds.add(p.id);
    result.push(p);
  }

  const backfilled: ProductSummary[] = [];
  if (result.length < max) {
    for (const p of pool) {
      if (result.length >= max) break;
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        result.push(p);
        backfilled.push(p);
      }
    }
  }

  return { result, skipped, backfilled };
}

/**
 * Template 7 main grid: merge rows without Top Picks ids (rail stays separate).
 */
export function buildTemplate7ProductsForRender(
  productsRow1: ProductSummary[],
  productsRow2: ProductSummary[],
  productsRow3: ProductSummary[],
  excludeIds: Set<number>,
  max = TEMPLATE7_PRODUCTS_MAX
): ProductSummary[] {
  const combined = [...productsRow1, ...productsRow2, ...productsRow3];
  const byId = new Map<number, ProductSummary>();
  for (const p of combined) {
    if (!excludeIds.has(p.id) && !byId.has(p.id)) {
      byId.set(p.id, p);
    }
  }
  return Array.from(byId.values()).slice(0, max);
}

/**
 * Fill template-7 main grid up to max, skipping excluded and already-present ids.
 */
export function fillTemplate7MainGrid(
  list: ProductSummary[],
  pool: ProductSummary[],
  excludeIds: Set<number>,
  max = TEMPLATE7_PRODUCTS_MAX
): ProductSummary[] {
  const seen = new Set<number>([...excludeIds, ...list.map((p) => p.id)]);
  const filled = [...list];
  for (const p of pool) {
    if (filled.length >= max) break;
    if (!seen.has(p.id)) {
      seen.add(p.id);
      filled.push(p);
    }
  }
  return filled;
}

/**
 * Page-wide product dedup: topProducts → products → productsRow2 → relatedProducts.
 * Later sections drop duplicate ids and backfill from pool when below max.
 */
export function dedupePageProductSections(
  sections: PageProductSections,
  pool: ProductSummary[],
  options: DedupePageProductOptions
): PageProductSections {
  const { templateType, logPrefix = "" } = options;
  const seenIds = new Set<number>();
  const mainMax = productsMainMax(templateType);

  const top = assignSection(sections.topProducts, TOP_MAX, seenIds, pool);
  const products = assignSection(sections.products, mainMax, seenIds, pool);
  const row2 = assignSection(sections.productsRow2, ROW_MAX, seenIds, pool);
  const related = assignSection(sections.relatedProducts, ROW_MAX, seenIds, pool);

  const allSkipped = [...top.skipped, ...products.skipped, ...row2.skipped, ...related.skipped];
  const allBackfilled = [
    ...top.backfilled,
    ...products.backfilled,
    ...row2.backfilled,
    ...related.backfilled,
  ];

  if (logPrefix && (allSkipped.length > 0 || allBackfilled.length > 0)) {
    const prefix = logPrefix.endsWith(" ") ? logPrefix : `${logPrefix} `;
    if (allSkipped.length > 0) {
      console.log(
        `${prefix}[pageProductDedup] ${templateType} 移除重复商品 ${allSkipped.length} 个: ${allSkipped.map((p) => `${p.name}(id=${p.id})`).join(", ")}`
      );
    }
    if (allBackfilled.length > 0) {
      console.log(
        `${prefix}[pageProductDedup] ${templateType} 从池补足 ${allBackfilled.length} 个: ${allBackfilled.map((p) => `${p.name}(id=${p.id})`).join(", ")}`
      );
    }
  }

  return {
    topProducts: top.result,
    products: products.result,
    productsRow2: row2.result,
    relatedProducts: related.result,
  };
}
