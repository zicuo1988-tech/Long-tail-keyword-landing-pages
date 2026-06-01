import type { MetadataRoute } from "next";
import { sanityReadClient } from "../lib/sanity.client";

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://vertu.com").replace(/\/+$/, "");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteBaseUrl();
  const rows = await sanityReadClient.fetch<
    Array<{ slug?: string; modifiedAt?: string; publishedAt?: string }>
  >(
    `*[_type == "luxuryLifeGuide" && defined(slug.current)]{
      "slug": slug.current,
      modifiedAt,
      publishedAt
    }`
  );

  const guideEntries: MetadataRoute.Sitemap = (rows || [])
    .filter((r) => r.slug)
    .map((r) => {
      const slug = r.slug!.replace(/^\/+|\/+$/g, "");
      const path = slug.startsWith("luxury-life-guides/")
        ? `/${slug}/`
        : `/luxury-life-guides/${slug.replace(/^luxury-life-guides\//, "")}/`;
      return {
        url: `${base}${path}`,
        lastModified: r.modifiedAt || r.publishedAt || new Date(),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      };
    });

  return [
    {
      url: `${base}/luxury-life-guides/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    ...guideEntries,
  ];
}
