import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.join(__dirname, "../../../frontend");

const files = [
  "default-template.html",
  "template-2.html",
  "template-3.html",
  "template-4.html",
  "template-5.html",
  "template-6.html",
];

const quickAnswerBlock = `
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
  c = c.replace(
    /<div class="accordion-question">/g,
    '<h3 class="faq-question accordion-question">'
  );
  c = c.replace(
    /(<h3 class="faq-question accordion-question">[\s\S]*?)<\/div>(\s*<div class="accordion-answer">)/g,
    "$1</h3>$2"
  );

  if (!c.includes("QUICK_ANSWER_HTML")) {
    c = c.replace(
      /(<h1 class="ll-page-title[^"]*"[^>]*>\{\{PAGE_TITLE\}\}<\/h1>)/,
      `$1${quickAnswerBlock}`
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

  if (file === "template-6.html") {
    c = c.replace(
      /    <!-- Citations Structured Data -->[\s\S]*?\{\{\/if\}\}\s*\n\s*\{\{#if HOWTO_STRUCTURED_DATA\}\}/,
      "    {{#if HOWTO_STRUCTURED_DATA}}"
    );
    c = c.replace(
      '<body class="template-6 layout-seo-trust">',
      '<body class="template-6 layout-seo-trust {{LAYOUT_PRIORITY_CLASS}}">'
    );
    if (!c.includes('id="main-content"')) {
      c = c.replace(
        "    <!-- Content Section: answer-first for organic search -->",
        '    <main id="main-content">\n    <article class="ll-article">\n    <!-- Content Section: answer-first for organic search -->'
      );
      c = c.replace(
        "    {{#if references.length}}",
        "    </article>\n    </main>\n\n    {{#if references.length}}"
      );
    }
    if (!c.includes("ll-layout-stack")) {
      c = c.replace(
        "    </div>\n\n    {{#if topProducts.length}}",
        '    </div>\n\n    <div class="ll-layout-stack">\n    {{#if topProducts.length}}'
      );
      const compEnd = "    {{/if}}\n\n    {{#if references.length}}";
      if (c.includes(compEnd)) {
        c = c.replace(compEnd, "    {{/if}}\n    </div>\n\n    {{#if references.length}}");
      }
    }
  }

  if (file === "template-5.html") {
    c = c.replace(
      '<body class="template-5 layout-conversion">',
      '<body class="template-5 layout-conversion {{LAYOUT_PRIORITY_CLASS}}">'
    );
  }

  if (file === "template-4.html") {
    c = c.replace(
      '<body class="template-4 layout-ranking">',
      '<body class="template-4 layout-ranking {{LAYOUT_PRIORITY_CLASS}}">'
    );
  }

  writeFileSync(fullPath, c, "utf8");
  console.log("patched", file);
}
