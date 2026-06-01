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

/** 每排商品区目标数量（硬上限，不得超过） */
export const PRODUCTS_PER_ROW = 4;

const TOP_MAX = PRODUCTS_PER_ROW;

type SectionKey = keyof PageProductSections;

type SectionAssignResult = {
  result: ProductSummary[];
  skipped: ProductSummary[];
  backfilled: ProductSummary[];
};

function usesThirdProductRow(templateType: string): boolean {
  return templateType !== "template-5" && templateType !== "template-6";
}

/** 先填满各排商品区，再分配 Top Picks，避免顶部占满池子导致下面每排不足 4 个 */
function getSectionAssignOrder(templateType: string): SectionKey[] {
  const order: SectionKey[] = ["products", "productsRow2"];
  if (usesThirdProductRow(templateType)) {
    order.push("relatedProducts");
  }
  order.push("topProducts");
  return order;
}

function getSectionMax(key: SectionKey): number {
  return PRODUCTS_PER_ROW;
}

function collectReservedIds(
  sections: PageProductSections,
  assignOrder: SectionKey[],
  currentKey: SectionKey
): Set<number> {
  const currentIdx = assignOrder.indexOf(currentKey);
  const reserved = new Set<number>();
  for (let i = currentIdx + 1; i < assignOrder.length; i++) {
    for (const p of sections[assignOrder[i]]) {
      reserved.add(p.id);
    }
  }
  return reserved;
}

function assignSection(
  list: ProductSummary[],
  max: number,
  seenIds: Set<number>,
  pool: ProductSummary[],
  reservedIds: Set<number>
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
      if (seenIds.has(p.id) || reservedIds.has(p.id)) continue;
      seenIds.add(p.id);
      result.push(p);
      backfilled.push(p);
    }
  }

  return { result: result.slice(0, max), skipped, backfilled };
}

/**
 * Template 7 主网格：合并三排（不含 Top Picks），最多 4 个。
 */
export function buildTemplate7ProductsForRender(
  productsRow1: ProductSummary[],
  productsRow2: ProductSummary[],
  productsRow3: ProductSummary[],
  excludeIds: Set<number>,
  max = PRODUCTS_PER_ROW
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
 * 补足主网格至 max（默认 4），排除 Top Picks 与已有 id。
 */
export function fillTemplate7MainGrid(
  list: ProductSummary[],
  pool: ProductSummary[],
  excludeIds: Set<number>,
  max = PRODUCTS_PER_ROW
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
  return filled.slice(0, max);
}

/**
 * 页面级去重 + 每排最多 4 个；尽量从池子补足至 4。
 */
export function dedupePageProductSections(
  sections: PageProductSections,
  pool: ProductSummary[],
  options: DedupePageProductOptions
): PageProductSections {
  const { templateType, logPrefix = "" } = options;
  const seenIds = new Set<number>();
  const assignOrder = getSectionAssignOrder(templateType);

  const out: PageProductSections = {
    topProducts: [],
    products: [],
    productsRow2: [],
    relatedProducts: [],
  };

  const allSkipped: ProductSummary[] = [];
  const allBackfilled: ProductSummary[] = [];

  for (const key of assignOrder) {
    const max = getSectionMax(key);
    const reserved = collectReservedIds(sections, assignOrder, key);
    const assigned = assignSection(sections[key], max, seenIds, pool, reserved);
    out[key] = assigned.result;
    allSkipped.push(...assigned.skipped);
    allBackfilled.push(...assigned.backfilled);
  }

  if (!usesThirdProductRow(templateType)) {
    out.relatedProducts = [];
  }

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

  if (logPrefix) {
    const prefix = logPrefix.endsWith(" ") ? logPrefix : `${logPrefix} `;
    console.log(
      `${prefix}[pageProductDedup] ${templateType} 各排数量: products=${out.products.length}, row2=${out.productsRow2.length}, related=${out.relatedProducts.length}, top=${out.topProducts.length}（每排上限 ${PRODUCTS_PER_ROW}）`
    );
  }

  return out;
}
