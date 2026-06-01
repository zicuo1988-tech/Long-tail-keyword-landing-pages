import assert from "node:assert/strict";
import {
  hashDiversitySeed,
  pickDiverseRankedAssets,
  type ScoredSanityImageAsset,
} from "./articleImageMatching.js";

function asset(id: string, score: number): ScoredSanityImageAsset {
  return { _id: id, url: `https://cdn.sanity.io/images/test/${id}.jpg`, score };
}

{
  const ranked = [
    asset("a", 120),
    asset("b", 115),
    asset("c", 110),
    asset("d", 50),
    asset("e", 45),
    asset("f", 40),
  ];
  const seed1 = hashDiversitySeed("luxury phones", "Best luxury phones 2026");
  const seed2 = hashDiversitySeed("luxury watches", "Best luxury watches 2026");
  const pick1 = pickDiverseRankedAssets(ranked, 4, seed1);
  const pick2 = pickDiverseRankedAssets(ranked, 4, seed2);
  assert.equal(pick1.length, 4);
  assert.equal(new Set(pick1.map((x) => x._id)).size, 4);
  assert.notDeepEqual(
    pick1.map((x) => x._id),
    pick2.map((x) => x._id),
    "different keywords should rotate image order"
  );
}

console.log("articleImageMatching.test.ts: all assertions passed");
