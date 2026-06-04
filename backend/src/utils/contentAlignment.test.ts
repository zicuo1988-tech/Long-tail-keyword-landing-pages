import assert from "node:assert/strict";
import {
  buildAlignmentRetryPrompt,
  evaluateContentAlignment,
  findOffListProductMentions,
  mergeUserPrompt,
} from "./contentAlignment.js";
import {
  buildGatedProductPool,
  isComparisonIntent,
  resolveExternalComparisonBranch,
} from "./productCategory.js";
import type { ProductSummary } from "../types.js";

assert.equal(isComparisonIntent("smart ring vs smart watch", ""), true);
assert.equal(isComparisonIntent("luxury smartphone", "Best Phone"), false);
assert.equal(resolveExternalComparisonBranch("luxury smartwatch", "Best Watches", "watch"), "watch");
assert.equal(resolveExternalComparisonBranch("VERTU flip phone", "", "phone"), "phone");

function p(id: number, name: string, cat = ""): ProductSummary {
  return { id, name, link: "https://example.com/p", category: cat };
}

{
  const pool = [
    p(1, "Grand Watch", "watch"),
    p(2, "Agent Q", "phone"),
  ];
  const gated = buildGatedProductPool(pool, "luxury smartwatch", "Guide", "watch");
  assert.equal(gated.length, 1);
  assert.ok(gated[0].name.includes("Watch"));
}

// watch keyword + phone-heavy body → needsRetry
{
  const result = evaluateContentAlignment({
    articleContent:
      "<p>The Agent Q smartphone offers Snapdragon power while luxury watches are elsewhere.</p>",
    keyword: "luxury smartwatch",
    pageTitle: "Best Luxury Smartwatch Guide",
    availableProductNames: ["Grand Watch", "Metawatch"],
    primaryCategory: "watch",
  });
  assert.equal(result.needsRetry, true);
  assert.ok(result.reasons.some((r) => r.includes("topic mismatch") || r.includes("cross-category")));
}

// aligned watch copy → pass (includes takeaway + question H2)
{
  const result = evaluateContentAlignment({
    articleContent: `<h2>What should you look for in a luxury smartwatch?</h2>
<p>Start with Grand Watch or Metawatch if horology matters—these should top your shortlist when you compare luxury smartwatches for daily wear.</p>
<p>Grand Watch and Metawatch timepieces define VERTU horology.</p>`,
    keyword: "luxury smartwatch",
    pageTitle: "Best Luxury Smartwatch",
    availableProductNames: ["Grand Watch", "Metawatch"],
    primaryCategory: "watch",
  });
  assert.equal(result.needsRetry, false);
}

// spec stacking → needsRetry
{
  const result = evaluateContentAlignment({
    articleContent: `<h2>How to choose?</h2>
<p>You should consider build quality and service before buying.</p>
<ol>
<li>16GB RAM - 512GB storage</li>
<li>50MP camera - 64MP telephoto</li>
<li>5655 mAh - 65W charging</li>
</ol>`,
    keyword: "luxury phone",
    pageTitle: "Best Luxury Phone",
    availableProductNames: ["Agent Q"],
    primaryCategory: "phone",
  });
  assert.ok(result.reasons.some((r) => r.includes("spec list stacking")));
}

// off-list product mention
{
  const off = findOffListProductMentions(
    "<p>Consider Agent Q for everyday carry.</p>",
    ["Aura Ring", "AI Diamond Ring"]
  );
  assert.ok(off.some((n) => n.toLowerCase().includes("agent")));
}

// mergeUserPrompt
{
  const merged = mergeUserPrompt("My brief", "Fix category.");
  assert.ok(merged?.includes("My brief"));
  assert.ok(merged?.includes("Fix category."));
}

// retry prompt includes products
{
  const prompt = buildAlignmentRetryPrompt(
    ["topic mismatch"],
    ["Grand Watch"],
    "watch",
    "luxury watch"
  );
  assert.ok(prompt.includes("Grand Watch"));
  assert.ok(prompt.includes("watch"));
}

console.log("contentAlignment.test.ts: all tests passed");
