import { createClient, type SanityClient } from "@sanity/client";
import { normalizePublicSiteRoot } from "../utils/publicSiteUrl.js";

export interface SanityPublishInput {
  title: string;
  slug: string;
  /** Full document HTML (legacy); prefer bodyHtml when set */
  htmlContent?: string;
  bodyHtml?: string;
  excerpt?: string;
  canonicalPath?: string;
  ogImage?: string;
  /** JSON.stringify(string[]) of JSON-LD script bodies */
  jsonLd?: string;
  publishedAt?: string;
  modifiedAt?: string;
  primaryCategory?: string;
  keyword?: string;
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

export interface RelatedGuide {
  title: string;
  url: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  const url = (baseUrl || "").trim();
  if (!url) throw new Error("Sanity baseUrl is required");
  return normalizePublicSiteRoot(url);
}

export function createSanityWriteClient(input: {
  projectId: string;
  dataset: string;
  token: string;
  apiVersion?: string;
}): SanityClient {
  return createClient({
    projectId: input.projectId.trim(),
    dataset: input.dataset.trim(),
    token: input.token.trim(),
    apiVersion: input.apiVersion?.trim() || "2024-01-01",
    useCdn: false,
  });
}

/**
 * Fetch recently published guides in the same category (excluding current slug).
 */
export async function fetchRelatedGuidesFromSanity(
  client: SanityClient,
  options: {
    docType: string;
    currentSlug: string;
    primaryCategory?: string;
    limit?: number;
    baseUrl: string;
  }
): Promise<RelatedGuide[]> {
  const limit = options.limit ?? 5;
  const base = normalizeBaseUrl(options.baseUrl);
  const current = options.currentSlug.replace(/^\/+|\/+$/g, "");

  const categoryFilter = options.primaryCategory?.trim()
    ? `&& primaryCategory == $primaryCategory`
    : "";

  const query = `*[_type == $docType && slug.current != $currentSlug ${categoryFilter}] | order(publishedAt desc) [0...$limit]{
    title,
    "slug": slug.current
  }`;

  const params: Record<string, unknown> = {
    docType: options.docType,
    currentSlug: current,
    limit,
  };
  if (options.primaryCategory?.trim()) {
    params.primaryCategory = options.primaryCategory.trim();
  }

  try {
    const rows = await client.fetch<Array<{ title?: string; slug?: string }>>(query, params);
    return (rows || [])
      .filter((r) => r.slug && r.title)
      .map((r) => ({
        title: r.title!,
        url: `${base}/${r.slug!.replace(/^\/+|\/+$/g, "")}/`,
      }));
  } catch (err) {
    console.warn("[Sanity] fetchRelatedGuidesFromSanity failed:", err);
    return [];
  }
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

  const client = createSanityWriteClient({ projectId, dataset, token, apiVersion });

  const bodyHtml = (input.bodyHtml ?? input.htmlContent ?? "").trim();
  if (!bodyHtml) {
    throw new Error("Sanity publish requires bodyHtml or htmlContent");
  }

  const publishedAt = input.publishedAt || new Date().toISOString();
  const modifiedAt = input.modifiedAt || publishedAt;

  await client.createOrReplace({
    _id: documentId,
    _type: docType,
    title: input.title,
    slug: { current: cleanSlug },
    html: bodyHtml,
    bodyHtml,
    excerpt: input.excerpt || "",
    canonicalPath: input.canonicalPath || `/${cleanSlug}/`,
    ogImage: input.ogImage || "",
    jsonLd: input.jsonLd || "",
    publishedAt,
    modifiedAt,
    primaryCategory: input.primaryCategory || "",
    keyword: input.keyword || "",
    source: "ai-automation",
  });

  return {
    documentId,
    pageUrl: `${baseUrl}/${cleanSlug}/`,
  };
}
