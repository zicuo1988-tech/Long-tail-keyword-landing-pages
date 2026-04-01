import { createClient } from "@sanity/client";
import { normalizePublicSiteRoot } from "../utils/publicSiteUrl.js";

export interface SanityPublishInput {
  title: string;
  slug: string;
  htmlContent: string;
  excerpt?: string;
  projectId: string;
  dataset: string;
  token: string;
  apiVersion?: string;
  docType?: string;
  baseUrl: string;
}

export interface SanityPublishResult {
  documentId: string;
  pageUrl: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = (baseUrl || "").trim();
  if (!url) throw new Error("Sanity baseUrl is required");
  return normalizePublicSiteRoot(url);
}

export async function publishToSanity(input: SanityPublishInput): Promise<SanityPublishResult> {
  const projectId = input.projectId?.trim();
  const dataset = input.dataset?.trim();
  const token = input.token?.trim();
  if (!projectId || !dataset || !token) {
    throw new Error("Sanity projectId/dataset/token are required");
  }

  const apiVersion = input.apiVersion?.trim() || "2024-01-01";
  const docType = input.docType?.trim() || "luxuryLifeGuide";
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const cleanSlug = (input.slug || "").replace(/^\/+|\/+$/g, "");
  const documentId = `${docType}.${cleanSlug.replace(/\//g, "-")}`;

  const client = createClient({
    projectId,
    dataset,
    apiVersion,
    token,
    useCdn: false,
  });

  await client.createOrReplace({
    _id: documentId,
    _type: docType,
    title: input.title,
    slug: { current: cleanSlug },
    html: input.htmlContent,
    excerpt: input.excerpt || "",
    publishedAt: new Date().toISOString(),
    source: "ai-automation",
  });

  return {
    documentId,
    pageUrl: `${baseUrl}/${cleanSlug}/`,
  };
}
