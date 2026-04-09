import { marked } from "marked";

/**
 * Detect AI output that used Markdown instead of HTML (## headings, **bold**, etc.).
 * Hybrid outputs (Markdown headings + HTML <figure>/<table>) are common and must still be normalised.
 */
export function looksLikeMarkdownFragment(fragment: string): boolean {
  const t = fragment.trim();
  if (!t) return false;

  const head = t.slice(0, 6000);
  const hasHtmlHeadings = /<\s*h[1-6][\s>]/i.test(head);
  const hasMdHeadings = /(^|\n)#{1,6}\s+[^\n]+/m.test(t);
  const hasMdBold = /\*\*[^*\n][^*]*\*\*/.test(t);
  const hasHtmlBold = /<\s*strong\b/i.test(head);
  const hasMdListBold = /^\s*[\*\-]\s+\*\*/m.test(t);

  // 仍以 Markdown 标题为主：只要存在行首 # 且正文里还没有对应 HTML 标题，就转换
  if (hasMdHeadings && !hasHtmlHeadings) {
    return true;
  }

  // 列表项 * **Label:** 常见于模型混写
  if (hasMdListBold) {
    return true;
  }

  if (hasMdBold && !hasHtmlBold && !/<\s*p[\s>]/i.test(head)) {
    return true;
  }

  return false;
}

/**
 * 模型常输出「一段里既有 HTML 又有未转换的 Markdown 行」。marked 有时无法一次吃干净，这里做兜底：
 * - 行首 # / ## / ### 等 → h1–h4（h1 稍后统一改 h2）
 * - 行首 * **xx:** → <li><strong>…</strong>
 * - 连续 <li> 外包 <ul>
 */
export function repairRemainingMarkdownSyntax(html: string): string {
  if (!html?.trim()) return html;

  let s = html;
  if (!/(^|\n)#{1,6}\s/m.test(s) && !/^\s*[\*\-]\s+\*\*/m.test(s)) {
    return s;
  }

  s = s.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  s = s.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^#\s+(.+)$/gm, "<h2>$1</h2>");

  s = s.replace(/^\*\s+\*\*([^*]+)\*\*:\s*(.*)$/gm, "<li><strong>$1:</strong> $2</li>");
  s = s.replace(/^\-\s+\*\*([^*]+)\*\*:\s*(.*)$/gm, "<li><strong>$1:</strong> $2</li>");

  // 连续 <li>…</li> 合并为 <ul>（单条或多条）；避免包在已有 <ul> 里再套一层
  s = s.replace(
    /(?:^|(?<=\n))((?:<li>[\s\S]*?<\/li>)(?:\s*\n\s*<li>[\s\S]*?<\/li>)*)/g,
    (block) => {
      const inner = block.trim();
      if (!inner.startsWith("<li>") || inner.includes("<ul>")) return block;
      return `<ul>\n${inner}\n</ul>`;
    }
  );

  return s;
}

/**
 * 模型有时在文首输出多段纯文本（无 <p>），直到第一个 ## 或 HTML 块。浏览器会当成一整块文本显示。
 */
export function wrapLeadingBareTextIfNeeded(html: string): string {
  const t = html.trimStart();
  if (!t || t.startsWith("<") || /^#{1,6}\s/m.test(t)) return html;

  const re = /\n(?:(?:#{1,6})\s|<h[1-6]\b|<figure\b|<div\b|<table\b)/;
  const m = re.exec(t);
  if (!m || m.index === undefined || m.index <= 0) return html;

  const intro = t.slice(0, m.index).trim();
  if (!intro || intro.includes("<") || /^#{1,6}\s/m.test(intro)) return html;

  const rest = t.slice(m.index + 1);
  const paras = intro
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const wrapped = paras.map((p) => `<p>${p.replace(/\s+/g, " ")}</p>`).join("\n\n");
  return `${wrapped}\n\n${rest}`;
}

/** Convert Markdown fragment to HTML when detection says the model returned MD, not HTML. */
export function markdownToHtmlIfNeeded(fragment: string): string {
  let out = fragment;

  if (looksLikeMarkdownFragment(out)) {
    try {
      const html = marked.parse(out);
      if (typeof html === "string") {
        out = html.trim();
      }
    } catch {
      /* keep out */
    }
  }

  out = repairRemainingMarkdownSyntax(out);
  out = wrapLeadingBareTextIfNeeded(out);

  out = out
    .replace(/<h1([^>]*)>/gi, "<h2$1>")
    .replace(/<\/h1>/gi, "</h2>");

  return out;
}
