import { notFound } from "next/navigation";
import { sanityReadClient } from "../../../lib/sanity.client";

/** 新发布的 Sanity 文档需即时可读，避免走纯静态缓存导致「假 404」 */
export const dynamic = "force-dynamic";

type Doc = {
  _id: string;
  title: string;
  html: string;
  excerpt?: string;
};

/**
 * URL: /luxury-life-guides/<keyword-slug>/
 * 与后端一致：Sanity 里 slug.current === "luxury-life-guides/<keyword-slug>"
 */
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
      excerpt
    }`,
    { fullSlug }
  );

  if (!doc) {
    notFound();
  }

  return (
    <main>
      {/* 完整 HTML 落地页：与模板生成的文档结构一致 */}
      <div dangerouslySetInnerHTML={{ __html: doc.html }} />
    </main>
  );
}
