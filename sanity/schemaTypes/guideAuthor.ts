import { defineField, defineType } from "sanity";

export default defineType({
  name: "guideAuthor",
  title: "Guide Author",
  type: "document",
  fields: [
    defineField({
      name: "name",
      title: "Name",
      type: "string",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      options: { source: "name" },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "jobTitle",
      title: "Job title",
      type: "string",
    }),
    defineField({
      name: "bio",
      title: "Bio",
      type: "text",
      rows: 4,
    }),
    defineField({
      name: "image",
      title: "Portrait URL",
      type: "url",
    }),
    defineField({
      name: "sameAs",
      title: "Social / profile URLs",
      type: "array",
      of: [{ type: "url" }],
    }),
    defineField({
      name: "profilePath",
      title: "Profile path",
      type: "string",
      description: "e.g. /authors/james-whitfield/",
    }),
  ],
  preview: {
    select: { title: "name", subtitle: "jobTitle" },
  },
});
