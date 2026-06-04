import assert from "node:assert/strict";
import { evaluateKeywordGate, pickFromPool } from "./keywordIntentGate.js";

{
  const r = evaluateKeywordGate("VERTU Agent Q review");
  assert.equal(r.tier, "A");
  assert.equal(r.allowed, true);
}

{
  const r = evaluateKeywordGate("charging cable for android phone");
  assert.equal(r.tier, "D");
  assert.equal(r.allowed, false);
}

{
  const r = evaluateKeywordGate("how to choose modular smartphone");
  assert.ok(["B", "C"].includes(r.tier));
  assert.equal(r.allowed, true);
}

{
  const r = evaluateKeywordGate("charging cable for android phone", { forceGenerate: true });
  assert.equal(r.allowed, true);
}

{
  const pool = ["a", "b", "c"];
  const picked = pickFromPool(pool, "test-seed", 2);
  assert.equal(picked.length, 2);
}

console.log("keywordIntentGate.test.ts: all assertions passed");
