/**
 * 当 AI 未插入配图但白名单 URL 可用时，在正文 H2 后注入 figure（可多张、不同 URL）。
 */
export function injectArticleFiguresIfMissing(
  html: string,
  imageUrls: string[],
  captionHint = "Featured image",
  maxFigures = 3
): string {
  if (!html?.trim() || !imageUrls?.length) return html;

  const urls = [...new Set(imageUrls.map((u) => u?.trim()).filter((u) => u && /^https?:\/\//i.test(u)))];
  if (!urls.length) return html;

  const existingImgCount = (html.match(/<img\b/gi) || []).length;
  if (existingImgCount >= maxFigures) return html;

  const safeCaption = captionHint.replace(/[<>"']/g, "").trim().slice(0, 120) || "Featured image";

  const buildFigure = (url: string, caption: string) =>
    `<figure class="ll-article-figure">` +
    `<img src="${url}" alt="${caption}" loading="lazy" width="800" height="450">` +
    `<figcaption>${caption}</figcaption></figure>`;

  const h2Regex = /<h2\b[^>]*>[\s\S]*?<\/h2>/gi;
  const h2Matches: { index: number; length: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = h2Regex.exec(html)) !== null) {
    if (m.index !== undefined) {
      h2Matches.push({ index: m.index, length: m[0].length });
    }
  }

  const figuresToInsert = Math.min(maxFigures - existingImgCount, urls.length);
  if (figuresToInsert <= 0) return html;

  if (h2Matches.length > 0) {
    const step = Math.max(1, Math.floor(h2Matches.length / figuresToInsert));
    const insertions: { at: number; figure: string }[] = [];
    for (let i = 0; i < figuresToInsert; i++) {
      const h2Idx = Math.min(i * step, h2Matches.length - 1);
      const pos = h2Matches[h2Idx];
      const url = urls[i % urls.length];
      insertions.push({
        at: pos.index + pos.length,
        figure: buildFigure(url, safeCaption),
      });
    }
    insertions.sort((a, b) => b.at - a.at);
    let out = html;
    for (const ins of insertions) {
      out = out.slice(0, ins.at) + ins.figure + out.slice(ins.at);
    }
    return out;
  }

  if (existingImgCount > 0) return html;

  const url = urls[0];
  const figure = buildFigure(url, safeCaption);
  const firstPMatch = html.match(/<\/p>/i);
  if (firstPMatch && firstPMatch.index !== undefined) {
    const insertAt = firstPMatch.index + firstPMatch[0].length;
    return html.slice(0, insertAt) + figure + html.slice(insertAt);
  }

  return figure + html;
}
