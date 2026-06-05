import assert from "node:assert/strict";
import {
  evaluateKeywordGate,
  isBrandStrongKeyword,
  pickFromPool,
} from "./keywordIntentGate.js";

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

{
  assert.equal(isBrandStrongKeyword("VERTU Agent Q price"), true);
  const r = evaluateKeywordGate("VERTU Agent Q official store");
  assert.equal(r.brandStrong, true);
  assert.equal(r.allowed, true);
  assert.equal(r.forceLongShell, false);
  assert.ok(["A", "B"].includes(r.tier));
}

{
  const r = evaluateKeywordGate("VERTU phone case");
  assert.equal(r.brandStrong, true);
  assert.equal(r.allowed, true);
}

console.log("keywordIntentGate.test.ts: all assertions passed");
