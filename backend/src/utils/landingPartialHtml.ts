export interface LinkItem {
  title: string;
  url: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildAuthorBylineHtml(
  name: string,
  job?: string,
  bio?: string
): string {
  const n = name?.trim();
  if (!n) return "";
  const jobPart = job?.trim()
    ? `<span class="ll-author-byline-meta"> · ${escapeHtml(job.trim())}</span>`
    : "";
  const bioPart = bio?.trim()
    ? `<p class="ll-author-bio">${escapeHtml(bio.trim())}</p>`
    : "";
  return `<aside class="ll-author-byline" aria-label="Article author"><p><strong>By</strong> ${escapeHtml(n)}${jobPart}</p>${bioPart}</aside>`;
}

export function buildRelatedGuidesHtml(
  guides: LinkItem[],
  options?: { compact?: boolean; title?: string }
): string {
  if (!guides?.length) return "";
  const limit = options?.compact ? 3 : 8;
  const title = options?.title || "Related Guides";
  const items = guides.slice(0, limit);
  const lis = items
    .map(
      (g) =>
        `<li class="ll-link-item"><a href="${escapeHtml(g.url)}">${escapeHtml(g.title)}</a></li>`
    )
    .join("");
  return `<div class="links-section ll-related-guides"><h2 class="links-title">${escapeHtml(title)}</h2><ul class="links-list">${lis}</ul></div>`;
}

export function buildInternalLinksHtml(links: LinkItem[]): string {
  if (!links?.length) return "";
  const lis = links
    .slice(0, 8)
    .map(
      (l) =>
        `<li class="ll-link-item"><a href="${escapeHtml(l.url)}">${escapeHtml(l.title)}</a></li>`
    )
    .join("");
  return `<div class="links-section ll-internal-links"><h2 class="links-title">Explore VERTU</h2><ul class="links-list">${lis}</ul></div>`;
}

/** Server-side TOC — avoids client CLS from late DOM injection. */
export function injectServerSideToc(articleHtml: string): string {
  if (!articleHtml?.trim() || articleHtml.includes("ll-on-this-page")) return articleHtml;
  const h2Regex = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  const headings: { id: string; text: string }[] = [];
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = h2Regex.exec(articleHtml)) !== null) {
    i += 1;
    const id = `ll-sec-${i}`;
    const text = match[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
    headings.push({ id, text });
  }
  if (headings.length < 2) return articleHtml;

  let idx = 0;
  const withIds = articleHtml.replace(/<h2\b([^>]*)>/gi, (full, attrs) => {
    idx += 1;
    if (/id\s*=/.test(attrs)) return full;
    return `<h2 id="ll-sec-${idx}"${attrs}>`;
  });

  const tocItems = headings
    .map(
      (h) =>
        `<li><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`
    )
    .join("");
  const toc = `<nav class="ll-on-this-page" aria-label="On this page"><p class="ll-toc-title">On this page</p><ol class="ll-toc-list">${tocItems}</ol></nav>`;

  return toc + withIds;
}

export function extractHowToStepsFromHtml(html: string): Array<{ name: string; text: string }> {
  const steps: Array<{ name: string; text: string }> = [];
  const sections = html.split(/<h2\b[^>]*>/i).slice(1);
  for (const sec of sections) {
    const nameMatch = sec.match(/^[^>]*>([\s\S]*?)<\/h2>/i);
    const name = nameMatch?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "";
    const olMatch = sec.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i);
    if (!name || !olMatch) continue;
    const items = [...olMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    items.forEach((m, idx) => {
      const text = m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      if (text) steps.push({ name: `${name} — Step ${idx + 1}`, text });
    });
  }
  return steps.slice(0, 12);
}

export function buildHowToSchemaJson(
  pageTitle: string,
  pageUrl: string,
  steps: Array<{ name: string; text: string }>
): string {
  if (steps.length < 2) return "";
  try {
    return JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: pageTitle.replace(/<[^>]*>/g, "").trim(),
        url: pageUrl,
        step: steps.map((s, i) => ({
          "@type": "HowToStep",
          position: i + 1,
          name: s.name,
          text: s.text,
        })),
      },
      null,
      2
    );
  } catch {
    return "";
  }
}
