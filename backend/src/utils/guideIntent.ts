/**
 * Shared rules: when a page should use long-form article limits and long HTML shells.
 * Keep in sync with product/content strategy (guide vs commercial landing).
 */
export function shouldTreatAsLongFormGuideArticle(
  templateType: string | undefined,
  keyword: string,
  pageTitle: string,
  titleType?: string
): boolean {
  const isBuiltInLongForm =
    templateType === "template-3" ||
    templateType === "template-4" ||
    templateType === "template-5" ||
    templateType === "template-6" ||
    templateType === "template-7";
  if (isBuiltInLongForm) return true;

  const isShortTemplate =
    templateType === "template-1" ||
    templateType === "template-2" ||
    templateType === undefined ||
    templateType === "";
  if (!isShortTemplate) return false;

  const guideTitleTypes = new Set([
    "informational",
    "review",
    "how-to",
    "recommendations",
    "comparison",
    "expert",
    "best",
    "top",
    "top-ranking",
    "most",
    "services-guides",
    "tech-insights",
  ]);
  if (titleType && guideTitleTypes.has(titleType)) return true;

  const text = `${keyword} ${pageTitle || ""}`.toLowerCase();
  return /\b(how\s+to|what\s+is|what\s+are|why\s|when\s|where\s|best\b|top\s+\d|vs\.?\b|versus\b|review|reviews|guides?\b|comparison|comparisons|price|prices|buy(ing)?|choose|choosing|worth\b|tips\b|ranking|recommended)\b/.test(
    text
  );
}
