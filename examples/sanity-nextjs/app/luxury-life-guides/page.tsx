import type { Metadata } from "next";
import Link from "next/link";
import { sanityReadClient } from "../../lib/sanity.client";

export const dynamic = "force-dynamic";

type GuideRow = {
  title: string;
  slug: string;
  excerpt?: string;
  publishedAt?: string;
};

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://vertu.com").replace(/\/+$/, "");
}

export async function generateMetadata(): Promise<Metadata> {
  const base = siteBaseUrl();
  const canonical = `${base}/luxury-life-guides/`;
  return {
    title: "Luxury Life Guides | VERTU",
    description:
      "Expert guides on luxury phones, watches, rings, and audio from VERTU — buying advice, comparisons, and technology insights.",
    alternates: { canonical },
    openGraph: {
      title: "Luxury Life Guides | VERTU",
      url: canonical,
      type: "website",
      locale: "en_GB",
      siteName: "VERTU",
    },
    robots: { index: true, follow: true },
  };
}

export default async function LuxuryLifeGuidesHubPage() {
  const base = siteBaseUrl();
  const guides = await sanityReadClient.fetch<GuideRow[]>(
    `*[_type == "luxuryLifeGuide" && defined(slug.current)] | order(publishedAt desc) {
      title,
      "slug": slug.current,
      excerpt,
      publishedAt
    }`
  );

  const itemList = (guides || []).map((g, i) => {
    const slug = g.slug.replace(/^\/+|\/+$/g, "");
    const path = slug.startsWith("luxury-life-guides/")
      ? `/${slug}/`
      : `/luxury-life-guides/${slug.replace(/^luxury-life-guides\//, "")}/`;
    return {
      "@type": "ListItem",
      position: i + 1,
      name: g.title,
      url: `${base}${path}`,
    };
  });

  const hubJsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: "Luxury Life Guides",
        url: `${base}/luxury-life-guides/`,
        description:
          "VERTU luxury life guides — phones, watches, rings, and premium audio.",
        inLanguage: "en-GB",
      },
      {
        "@type": "ItemList",
        itemListElement: itemList,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
          {
            "@type": "ListItem",
            position: 2,
            name: "Luxury Life Guides",
            item: `${base}/luxury-life-guides/`,
          },
        ],
      },
    ],
  };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(hubJsonLd) }}
      />
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>Luxury Life Guides</h1>
      <p style={{ color: "#555", marginBottom: 32, lineHeight: 1.6 }}>
        Curated VERTU guides for luxury technology — from buying advice to in-depth
        comparisons.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(guides || []).map((g) => {
          const slug = g.slug.replace(/^\/+|\/+$/g, "");
          const segment = slug.replace(/^luxury-life-guides\//, "");
          const href = `/luxury-life-guides/${segment}/`;
          return (
            <li
              key={g.slug}
              style={{
                borderBottom: "1px solid #eee",
                padding: "20px 0",
              }}
            >
              <Link href={href} style={{ fontSize: "1.125rem", fontWeight: 600 }}>
                {g.title}
              </Link>
              {g.excerpt ? (
                <p style={{ margin: "8px 0 0", color: "#666", fontSize: 15 }}>
                  {g.excerpt}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
