import assert from "node:assert/strict";
import type { ProductSummary } from "../types.js";
import {
  PRODUCTS_PER_ROW,
  buildTemplate7ProductsForRender,
  dedupePageProductSections,
  fillTemplate7MainGrid,
} from "./pageProductDedup.js";

function p(id: number, name?: string): ProductSummary {
  return { id, name: name ?? `Product ${id}`, link: `https://example.com/p/${id}` };
}

function collectPageIds(sections: {
  topProducts: ProductSummary[];
  products: ProductSummary[];
  productsRow2: ProductSummary[];
  relatedProducts: ProductSummary[];
}): number[] {
  return [
    ...sections.topProducts,
    ...sections.products,
    ...sections.productsRow2,
    ...sections.relatedProducts,
  ].map((x) => x.id);
}

function assertAllUnique(ids: number[], label: string): void {
  const set = new Set(ids);
  assert.equal(set.size, ids.length, `${label}: duplicate ids in [${ids.join(", ")}]`);
}

function assertRowMax(len: number, label: string): void {
  assert.ok(len <= PRODUCTS_PER_ROW, `${label}: row has ${len} items, max ${PRODUCTS_PER_ROW}`);
}

// 各排硬上限 4，且优先填满 products / row2 再分配 top
{
  const pool = Array.from({ length: 16 }, (_, i) => p(i + 1));
  const result = dedupePageProductSections(
    {
      topProducts: [p(5), p(6), p(7)],
      products: [p(1), p(2), p(3), p(4)],
      productsRow2: [p(5), p(6), p(7), p(8)],
      relatedProducts: [],
    },
    pool,
    { templateType: "template-5" }
  );
  assert.equal(result.products.length, 4);
  assert.equal(result.productsRow2.length, 4);
  assertRowMax(result.topProducts.length, "top");
  assert.ok(!result.productsRow2.some((x) => [1, 2, 3, 4].includes(x.id)));
  assert.ok(result.topProducts.every((x) => ![1, 2, 3, 4, 5, 6, 7, 8].includes(x.id)));
  assertAllUnique(collectPageIds(result), "template-5 overlap");
}

// 输入超过 4 个时截断
{
  const pool = Array.from({ length: 20 }, (_, i) => p(i + 1));
  const result = dedupePageProductSections(
    {
      topProducts: [p(1), p(2), p(3), p(4), p(5)],
      products: [p(1), p(2), p(3), p(4), p(5)],
      productsRow2: [p(1), p(2), p(3), p(4), p(5)],
      relatedProducts: [p(1), p(2), p(3), p(4), p(5)],
    },
    pool,
    { templateType: "template-1" }
  );
  assertRowMax(result.products.length, "products");
  assertRowMax(result.productsRow2.length, "row2");
  assertRowMax(result.relatedProducts.length, "related");
  assertRowMax(result.topProducts.length, "top");
}

// 模板7 主网格不包含 Top Picks id，且最多 4 个
{
  const topIds = new Set([1, 2, 3]);
  const grid = buildTemplate7ProductsForRender(
    [p(1), p(4)],
    [p(2), p(5)],
    [p(3), p(6)],
    topIds
  );
  assert.deepEqual(grid.map((x) => x.id), [4, 5, 6]);
  assert.ok(grid.length <= PRODUCTS_PER_ROW);
  assert.ok(grid.every((x) => !topIds.has(x.id)));
}

// 模板7 整页去重
{
  const pool = Array.from({ length: 20 }, (_, i) => p(i + 1));
  const top = [p(1), p(2), p(3)];
  const main = buildTemplate7ProductsForRender([p(1), p(4)], [p(5)], [p(6)], new Set(top.map((x) => x.id)));
  const result = dedupePageProductSections(
    {
      topProducts: top,
      products: main,
      productsRow2: [p(2), p(7), p(8), p(9)],
      relatedProducts: [],
    },
    pool,
    { templateType: "template-7" }
  );
  assertAllUnique(collectPageIds(result), "template-7 full page");
  assert.ok(!result.products.some((x) => [1, 2, 3].includes(x.id)));
  assertRowMax(result.products.length, "t7 products");
  assertRowMax(result.productsRow2.length, "t7 row2");
}

// fillTemplate7MainGrid 排除 Top Picks，最多 4
{
  const filled = fillTemplate7MainGrid([p(4), p(5)], [p(1), p(2), p(3), p(6), p(7)], new Set([1, 2, 3]));
  assert.equal(filled.length, 4);
  assert.deepEqual(filled.map((x) => x.id), [4, 5, 6, 7]);
  assert.ok(filled.every((x) => ![1, 2, 3].includes(x.id)));
}

// 池子补足第一排至 4（products 优先保留 id=1，top 从池中另选）
{
  const pool = [p(10), p(11), p(12), p(13), p(14), p(15), p(16)];
  const result = dedupePageProductSections(
    {
      topProducts: [p(1)],
      products: [p(1)],
      productsRow2: [],
      relatedProducts: [],
    },
    pool,
    { templateType: "template-1" }
  );
  assert.equal(result.products.length, 4);
  assert.equal(result.products[0].id, 1);
  assert.ok(!result.topProducts.some((x) => x.id === 1));
  assertAllUnique(collectPageIds(result), "template-1 backfill");
}

console.log("pageProductDedup.test.ts: all assertions passed");
