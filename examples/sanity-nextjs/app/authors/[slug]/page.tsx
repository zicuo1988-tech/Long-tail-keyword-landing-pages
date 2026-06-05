import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIDE_AUTHORS } from "../../../lib/guideAuthors";
import { sanityReadClient } from "../../../lib/sanity.client";

export const revalidate = Number(process.env.NEXT_REVALIDATE_SECONDS || 3600);

function siteBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://vertu.com").replace(/\/+$/, "");
}

export async function generateStaticParams() {
  return GUIDE_AUTHORS.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const author = GUIDE_AUTHORS.find((a) => a.slug === slug);
  if (!author) return { title: "Author | VERTU" };
  return {
    title: `${author.name} | VERTU Luxury Life Guides`,
    description: author.bio,
    alternates: { canonical: `${siteBaseUrl()}${author.profilePath}` },
  };
}

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const author = GUIDE_AUTHORS.find((a) => a.slug === slug);
  if (!author) notFound();

  const guides = await sanityReadClient.fetch<
    Array<{ title: string; slug: string; excerpt?: string }>
  >(
    `*[_type == "luxuryLifeGuide" && authorSlug == $slug] | order(publishedAt desc)[0...20]{
      title,
      "slug": slug.current,
      excerpt
    }`,
    { slug }
  );

  const base = siteBaseUrl();
  const profileUrl = `${base}${author.profilePath}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        url: profileUrl,
        name: author.name,
        inLanguage: "en-GB",
        mainEntity: { "@id": `${profileUrl}#person` },
      },
      {
        "@type": "Person",
        "@id": `${profileUrl}#person`,
        name: author.name,
        jobTitle: author.jobTitle,
        description: author.bio,
        url: profileUrl,
        sameAs: author.sameAs,
      },
    ],
  };

  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "48px 24px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>{author.name}</h1>
      <p style={{ color: "#666", marginBottom: 8 }}>{author.jobTitle}</p>
      <p style={{ lineHeight: 1.7, marginBottom: 32 }}>{author.bio}</p>

      <h2 style={{ fontSize: "1.25rem", marginBottom: 16 }}>Guides by {author.name}</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(guides || []).map((g) => {
          const segment = g.slug.replace(/^luxury-life-guides\//, "");
          return (
            <li key={g.slug} style={{ borderBottom: "1px solid #eee", padding: "14px 0" }}>
              <Link href={`/luxury-life-guides/${segment}/`} style={{ fontWeight: 600 }}>
                {g.title}
              </Link>
              {g.excerpt ? (
                <p style={{ margin: "6px 0 0", color: "#666", fontSize: 14 }}>{g.excerpt}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {(!guides || guides.length === 0) && (
        <p style={{ color: "#888" }}>No published guides linked to this author yet.</p>
      )}
    </main>
  );
}
