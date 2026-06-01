/**
 * Extract body HTML and JSON-LD blocks from a full landing-page document
 * for Sanity / Next.js (body-only render, metadata at app layer).
 */
export interface ExtractedPublishHtml {
  bodyHtml: string;
  jsonLdScripts: string[];
}

const JSON_LD_SCRIPT_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function collectJsonLd(html: string): string[] {
  const scripts: string[] = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT_RE)) {
    const content = match[1]?.trim();
    if (content) scripts.push(content);
  }
  return scripts;
}

function stripJsonLd(html: string): string {
  return html.replace(JSON_LD_SCRIPT_RE, "");
}

/**
 * Split a rendered template document into publishable body HTML and JSON-LD payloads.
 */
export function extractPublishHtml(fullHtml: string): ExtractedPublishHtml {
  const trimmed = fullHtml.trim();
  const isFullDoc =
    trimmed.startsWith("<!DOCTYPE") || trimmed.toLowerCase().startsWith("<html");

  const jsonLdScripts = collectJsonLd(fullHtml);

  if (!isFullDoc) {
    return {
      bodyHtml: stripJsonLd(fullHtml).trim(),
      jsonLdScripts,
    };
  }

  const styleBlocks = fullHtml.match(/<style[^>]*>[\s\S]*?<\/style>/gi);
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let bodyContent = bodyMatch ? bodyMatch[1] : fullHtml;

  bodyContent = stripJsonLd(bodyContent).trim();

  const styles = styleBlocks?.map((s) => s.trim()).join("\n") ?? "";
  const bodyHtml = (styles ? `${styles}\n` : "") + bodyContent;

  return { bodyHtml, jsonLdScripts };
}

/** Merge multiple JSON-LD script contents into one array string for Sanity storage. */
export function serializeJsonLdScripts(scripts: string[]): string {
  if (scripts.length === 0) return "";
  return JSON.stringify(scripts);
}

export function parseJsonLdScripts(serialized: string | undefined | null): string[] {
  if (!serialized?.trim()) return [];
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
    }
  } catch {
    /* legacy: treat as single block */
  }
  return [serialized];
}

/** Path only, e.g. /luxury-life-guides/my-slug/ */
export function canonicalPathFromPageUrl(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
    return path;
  } catch {
    const p = pageUrl.replace(/^https?:\/\/[^/]+/i, "");
    return p.startsWith("/") ? (p.endsWith("/") ? p : `${p}/`) : `/${p}/`;
  }
}
