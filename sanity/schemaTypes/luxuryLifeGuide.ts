import { defineField, defineType } from "sanity";

/** Slug stored as one string, e.g. luxury-life-guides/best-luxury-phone-guide-2026 (matches generator + Next route). */
const SLUG_PREFIX = "luxury-life-guides/";

/**
 * 与 backend/src/services/sanityPublisher.ts 写入字段对齐：
 * title, slug.current, html, excerpt, publishedAt, source
 *
 * Studio 注册：import luxuryLifeGuide from "./schemaTypes/luxuryLifeGuide";
 * schemaTypes: [luxuryLifeGuide, ...]
 */
export default defineType({
  name: "luxuryLifeGuide",
  title: "Luxury Life Guide (HTML)",
  type: "document",
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      description: `Must be "${SLUG_PREFIX}<article-slug>" so GROQ and the Next.js route stay aligned.`,
      options: {
        source: "title",
        slugify: (input: string) =>
          `${SLUG_PREFIX}${input
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "-")
            .replace(/[^a-z0-9-]/g, "")}`,
      },
      validation: (Rule) =>
        Rule.required().custom((value: { current?: string } | undefined) => {
          const current = value?.current;
          if (!current) return "Slug is required";
          if (!current.startsWith(SLUG_PREFIX)) {
            return `Slug must start with "${SLUG_PREFIX}"`;
          }
          const rest = current.slice(SLUG_PREFIX.length);
          if (!rest || rest.includes("/")) {
            return "Use a single segment after the prefix, e.g. best-luxury-phone-guide-2026";
          }
          return true;
        }),
    }),
    defineField({
      name: "html",
      title: "HTML",
      type: "text",
      description: "Full HTML fragment from the generator (may include <style> etc.).",
      rows: 20,
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "excerpt",
      title: "Excerpt",
      type: "text",
      rows: 4,
    }),
    defineField({
      name: "publishedAt",
      title: "Published at",
      type: "datetime",
    }),
    defineField({
      name: "source",
      title: "Source",
      type: "string",
      description: "Provenance from the generator (e.g. pipeline id or upstream URL).",
    }),
  ],
  preview: {
    select: {
      title: "title",
      slugCurrent: "slug.current",
    },
    prepare({ title, slugCurrent }: { title?: string; slugCurrent?: string }) {
      return { title, subtitle: slugCurrent };
    },
  },
});
