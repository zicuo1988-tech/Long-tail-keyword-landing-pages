import type { MetadataRoute } from "next";

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://vertu.com").replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  const base = siteBaseUrl();
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${base}/sitemap.xml`,
  };
}
