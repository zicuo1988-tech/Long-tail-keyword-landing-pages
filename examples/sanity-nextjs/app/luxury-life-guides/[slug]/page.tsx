import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { sanityReadClient } from "../../../lib/sanity.client";
import { parseJsonLdScripts } from "../../../lib/jsonLd";

export const revalidate = Number(process.env.NEXT_REVALIDATE_SECONDS || 3600);

export async function generateStaticParams() {
  const rows = await sanityReadClient.fetch<Array<{ slug?: string }>>(
    `*[_type == "luxuryLifeGuide" && defined(slug.current)]{ "slug": slug.current }`
  );
  return (rows || [])
    .filter((r) => r.slug)
    .map((r) => ({
      slug: r.slug!.replace(/^luxury-life-guides\//, ""),
    }));
}

type Doc = {
  _id: string;
  title: string;
  html?: string;
  bodyHtml?: string;
  excerpt?: string;
  canonicalPath?: string;
  ogImage?: string;
  jsonLd?: string;
  publishedAt?: string;
  modifiedAt?: string;
};

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://vertu.com").replace(/\/+$/, "");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const fullSlug = `luxury-life-guides/${slug}`;
  const doc = await sanityReadClient.fetch<{
    title: string;
    excerpt?: string;
    canonicalPath?: string;
    ogImage?: string;
    publishedAt?: string;
    modifiedAt?: string;
  } | null>(
    `*[_type == "luxuryLifeGuide" && slug.current == $fullSlug][0]{
      title,
      excerpt,
      canonicalPath,
      ogImage,
      publishedAt,
      modifiedAt
    }`,
    { fullSlug }
  );
  const base = siteBaseUrl();
  const path =
    doc?.canonicalPath?.trim() || `/luxury-life-guides/${slug}/`;
  const canonical = `${base}${path.startsWith("/") ? path : `/${path}`}`;

  if (!doc?.title) {
    return {
      title: "Luxury Life Guides | VERTU",
      alternates: { canonical },
    };
  }

  const description = doc.excerpt || undefined;
  const ogImage = doc.ogImage?.trim() || undefined;

  return {
    title: doc.title,
    description,
    alternates: { canonical },
    openGraph: {
      title: doc.title,
      description,
      url: canonical,
      type: "article",
      locale: "en_GB",
      siteName: "VERTU",
      publishedTime: doc.publishedAt,
      modifiedTime: doc.modifiedAt || doc.publishedAt,
      ...(ogImage ? { images: [{ url: ogImage, width: 1200, height: 630, alt: doc.title }] } : {}),
    },
    twitter: {
      card: ogImage ? "summary_large_image" : "summary",
      title: doc.title,
      description,
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

export default async function LuxuryLifeGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const fullSlug = `luxury-life-guides/${slug}`;

  const doc = await sanityReadClient.fetch<Doc | null>(
    `*[_type == "luxuryLifeGuide" && slug.current == $fullSlug][0]{
      _id,
      title,
      html,
      bodyHtml,
      excerpt,
      jsonLd,
      publishedAt,
      modifiedAt
    }`,
    { fullSlug }
  );

  if (!doc) {
    notFound();
  }

  const bodyHtml = (doc.bodyHtml || doc.html || "").trim();
  const jsonLdBlocks = parseJsonLdScripts(doc.jsonLd);

  return (
    <>
      {jsonLdBlocks.map((block, index) => (
        <script
          key={`jsonld-${index}`}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: block }}
        />
      ))}
      <div
        className="luxury-life-guide-body"
        dangerouslySetInnerHTML={{ __html: bodyHtml }}
      />
    </>
  );
}
