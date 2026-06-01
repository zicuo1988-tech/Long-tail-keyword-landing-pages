import assert from "node:assert/strict";
import type { ProductSummary } from "../types.js";
import {
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

// Top Picks 与第二排重叠时应从第二排移除
{
  const pool = [p(1), p(2), p(3), p(4), p(5), p(6), p(7), p(8)];
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
  assert.deepEqual(result.topProducts.map((x) => x.id), [5, 6, 7]);
  assert.ok(!result.productsRow2.some((x) => [5, 6, 7].includes(x.id)), "row2 must not repeat top ids");
  assertAllUnique(collectPageIds(result), "template-5 overlap");
}

// 模板7 主网格不包含 Top Picks id
{
  const topIds = new Set([1, 2, 3]);
  const grid = buildTemplate7ProductsForRender(
    [p(1), p(4)],
    [p(2), p(5)],
    [p(3), p(6)],
    topIds
  );
  assert.deepEqual(grid.map((x) => x.id), [4, 5, 6]);
  assert.ok(grid.every((x) => !topIds.has(x.id)));
}

// 模板7 整页去重：rail + 主网格 + 第二排
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
}

// fillTemplate7MainGrid 排除 Top Picks
{
  const filled = fillTemplate7MainGrid([p(4), p(5)], [p(1), p(2), p(3), p(6), p(7)], new Set([1, 2, 3]), 10);
  assert.equal(filled.length, 4);
  assert.deepEqual(filled.map((x) => x.id), [4, 5, 6, 7]);
  assert.ok(filled.every((x) => ![1, 2, 3].includes(x.id)));
}

// 池子补足第一排
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
  assert.ok(result.topProducts.some((x) => x.id === 1));
  assert.equal(result.products.length, 4);
  assert.ok(!result.products.some((x) => x.id === 1));
  assertAllUnique(collectPageIds(result), "template-1 backfill");
}

console.log("pageProductDedup.test.ts: all assertions passed");
