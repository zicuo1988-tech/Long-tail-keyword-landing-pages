/**
 * 当 AI 未插入配图但白名单 URL 可用时，在正文首个 H2 后注入一张 figure。
 */
export function injectArticleFiguresIfMissing(
  html: string,
  imageUrls: string[],
  captionHint = "Featured image"
): string {
  if (!html?.trim() || !imageUrls?.length) return html;
  if (/<figure\b|<img\b/i.test(html)) return html;

  const url = imageUrls[0].trim();
  if (!/^https?:\/\//i.test(url)) return html;

  const safeCaption = captionHint.replace(/[<>"']/g, "").trim().slice(0, 120) || "Featured image";
  const figure =
    `<figure class="ll-article-figure">` +
    `<img src="${url}" alt="${safeCaption}" loading="lazy" width="800" height="450">` +
    `<figcaption>${safeCaption}</figcaption></figure>`;

  const h2Match = html.match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i);
  if (h2Match && h2Match.index !== undefined) {
    const insertAt = h2Match.index + h2Match[0].length;
    return html.slice(0, insertAt) + figure + html.slice(insertAt);
  }

  const firstPMatch = html.match(/<\/p>/i);
  if (firstPMatch && firstPMatch.index !== undefined) {
    const insertAt = firstPMatch.index + firstPMatch[0].length;
    return html.slice(0, insertAt) + figure + html.slice(insertAt);
  }

  return figure + html;
}
