import { mkdir, writeFile } from "node:fs/promises";
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
