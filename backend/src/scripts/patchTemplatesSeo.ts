import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, "../../../frontend");

/** Safe batch patches — template-6 layout is hand-maintained; do not wrap main/article here. */
const files = [
  "default-template.html",
  "template-2.html",
  "template-3.html",
  "template-4.html",
  "template-5.html",
];

const quickAnswerAfterH1 = `
{{#if QUICK_ANSWER_HTML}}
<section class="ll-quick-answer" aria-label="Quick answer">
  {{{QUICK_ANSWER_HTML}}}
</section>
{{/if}}`;

for (const file of files) {
  const fullPath = path.join(frontendDir, file);
  let c = readFileSync(fullPath, "utf8");

  c = c.replace(
    /<h2 class="woocommerce-loop-product__title">/g,
    '<h3 class="woocommerce-loop-product__title product-card-title">'
  );
  c = c.replace(
    /(<h3 class="woocommerce-loop-product__title product-card-title">[\s\S]*?)<\/h2>/g,
    "$1</h3>"
  );

  if (!c.includes("QUICK_ANSWER_HTML")) {
    c = c.replace(
      /(<h1 class="ll-page-title[^"]*"[^>]*>\{\{PAGE_TITLE\}\}<\/h1>)/,
      `$1${quickAnswerAfterH1}`
    );
  }

  if (!c.includes("HELPFUL_FEEDBACK_HTML")) {
    c = c.replace("{{{PAGE_UX_SCRIPT}}}", "{{{HELPFUL_FEEDBACK_HTML}}}\n{{{PAGE_UX_SCRIPT}}}");
  }

  if (file === "default-template.html") {
    c = c.replace(
      '<meta name="author" content="VERTU" />',
      '<meta name="author" content="{{META_AUTHOR}}" />'
    );
  }

  writeFileSync(fullPath, c, "utf8");
  console.log("patched", file);
}

console.log("template-6.html skipped — edit manually to preserve layout");
