import assert from "node:assert/strict";
import {
  adaptCssForSanityFragment,
  extractPublishHtml,
} from "./htmlPublishExtract.js";

{
  const css = "body.template-3 .ai-article-body table { border: 1px solid #e8e8e8; }";
  const adapted = adaptCssForSanityFragment(css);
  assert.match(adapted, /:is\(body, \.ll-landing-root\)\.template-3/);
}

{
  const html = `<!DOCTYPE html><html><head><style>
body.template-2 .content { color: red; }
</style></head><body class="template-2 layout-conversion"><div class="content ai-article-body"><table><tr><td>A</td></tr></table></div></body></html>`;
  const { bodyHtml } = extractPublishHtml(html);
  assert.match(bodyHtml, /ll-landing-root template-2 layout-conversion/);
  assert.match(bodyHtml, /:is\(body, \.ll-landing-root\)\.template-2/);
  assert.match(bodyHtml, /<style>/);
  assert.match(bodyHtml, /<table/);
}

console.log("htmlPublishExtract.test.ts OK");
