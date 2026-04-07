import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizePublicSiteRoot } from "../utils/publicSiteUrl.js";

export interface StaticPublishInput {
  slug: string;
  htmlContent: string;
  outputDir: string;
  baseUrl: string;
}

export interface StaticPublishResult {
  filePath: string;
  pageUrl: string;
}

function sanitizeSlug(slug: string): string {
  return (slug || "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\/{2,}/g, "/");
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = (baseUrl || "").trim();
  if (!url) {
    throw new Error("Static publish baseUrl is required");
  }
  return normalizePublicSiteRoot(url);
}

interface SitemapEntry {
  loc: string;
  lastmod: string;
}

const SITEMAP_ENTRIES_FILE = "sitemap-entries.json";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function normalizePageLoc(url: string): string {
  const t = (url || "").trim();
  if (!t) return "";
  return t.replace(/\/+$/, "") + "/";
}

/**
 * 在静态输出根目录维护 robots.txt、sitemap.xml（追加当前页 URL，去重）。
 * 部署时需将 outputDir 根目录对应到 STATIC_BASE_URL 所指站点路径。
 */
export async function updateStaticSiteSeoFiles(
  outputDir: string,
  baseUrl: string,
  pageUrl: string
): Promise<void> {
  const root = path.resolve((outputDir || "").trim());
  if (!root) return;

  const entriesPath = path.join(root, SITEMAP_ENTRIES_FILE);
  let entries: SitemapEntry[] = [];
  if (existsSync(entriesPath)) {
    try {
      const raw = await readFile(entriesPath, "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (e): e is SitemapEntry =>
            e && typeof (e as SitemapEntry).loc === "string" && typeof (e as SitemapEntry).lastmod === "string"
        );
      }
    } catch {
      entries = [];
    }
  }

  const loc = normalizePageLoc(pageUrl);
  const lastmod = new Date().toISOString().slice(0, 10);
  const existingIdx = entries.findIndex((e) => normalizePageLoc(e.loc) === loc);
  if (existingIdx >= 0) {
    entries[existingIdx].lastmod = lastmod;
  } else if (loc) {
    entries.push({ loc, lastmod });
  }

  await writeFile(entriesPath, JSON.stringify(entries, null, 2), "utf-8");

  const urlset = entries
    .map(
      (e) => `  <url>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join("\n");

  const sitemapBody = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlset}
</urlset>
`;
  await writeFile(path.join(root, "sitemap.xml"), sitemapBody, "utf-8");

  const siteRoot = normalizeBaseUrl(baseUrl).replace(/\/+$/, "");
  const sitemapPublicUrl = `${siteRoot}/sitemap.xml`;
  const robotsBody = `User-agent: *
Allow: /

Sitemap: ${sitemapPublicUrl}
`;
  await writeFile(path.join(root, "robots.txt"), robotsBody, "utf-8");
}

export async function publishStaticPage(input: StaticPublishInput): Promise<StaticPublishResult> {
  const outputDir = (input.outputDir || "").trim();
  if (!outputDir) {
    throw new Error("Static publish outputDir is required");
  }

  const slug = sanitizeSlug(input.slug);
  if (!slug) {
    throw new Error("Static publish slug is required");
  }

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const fullDir = path.join(outputDir, slug);
  const filePath = path.join(fullDir, "index.html");

  await mkdir(fullDir, { recursive: true });
  await writeFile(filePath, input.htmlContent, "utf-8");

  return {
    filePath,
    pageUrl: `${baseUrl}/${slug}/`,
  };
}
