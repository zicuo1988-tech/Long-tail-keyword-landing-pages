import slugify from "slugify";

export function createSlug(input: string): string {
  return slugify(input, {
    lower: true,
    strict: true,
    locale: "en",
  });
}
