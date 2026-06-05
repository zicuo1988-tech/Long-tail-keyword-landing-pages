import {
  classifySearchIntent,
  getLayoutPriority,
  shouldIncludeReferences,
} from "./searchIntentClassifier.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  classifySearchIntent("how to install nodejs", "How to Install Node.js", "how-to") ===
    "informational",
  "how-to should be informational"
);

assert(
  classifySearchIntent("best luxury phone", "Best Luxury Phone 2026", "best") ===
    "transactional",
  "best titleType should be transactional"
);

assert(
  classifySearchIntent("iphone vs samsung", "iPhone vs Samsung Comparison", "comparison") ===
    "evaluative",
  "comparison should be evaluative"
);

assert(getLayoutPriority("transactional") === "commerce-first", "transactional layout");
assert(getLayoutPriority("evaluative") === "comparison-first", "evaluative layout");
assert(
  shouldIncludeReferences("informational", "template-4") === true,
  "informational template-4 refs"
);

console.log("searchIntentClassifier.test.ts: all passed");
