/**
 * Classifies long-tail keyword search intent for template and layout decisions.
 * Heuristic rules — no ML dependency.
 */

export type SearchIntent = "informational" | "transactional" | "evaluative";

export type LayoutPriority = "article-first" | "commerce-first" | "comparison-first";

const TRANSACTIONAL_TITLE_TYPES = new Set([
  "purchase",
  "commercial",
  "best",
  "top",
  "top-ranking",
  "most",
]);

const INFORMATIONAL_TITLE_TYPES = new Set([
  "informational",
  "how-to",
  "services-guides",
  "tech-insights",
  "recommendations",
]);

const EVALUATIVE_TITLE_TYPES = new Set(["comparison", "review", "expert"]);

const TRANSACTIONAL_RE =
  /\b(buy|buying|purchase|price|prices|cost|deal|deals|discount|where\s+to\s+buy|shop|order|cheap|affordable|sale)\b/i;

const INFORMATIONAL_RE =
  /\b(how\s+to|what\s+is|what\s+are|why\s|when\s|guide|guides|tutorial|explained|meaning|definition|tips|steps)\b/i;

const EVALUATIVE_RE =
  /\b(vs\.?|versus|compare|comparison|comparisons|review|reviews|ranking|ranked|top\s+\d|best\s+\d|which\s+is\s+better)\b/i;

export function classifySearchIntent(
  keyword: string,
  pageTitle: string,
  titleType?: string
): SearchIntent {
  const tt = (titleType || "").trim().toLowerCase();
  const text = `${keyword} ${pageTitle || ""}`.trim();

  if (tt && EVALUATIVE_TITLE_TYPES.has(tt)) return "evaluative";
  if (EVALUATIVE_RE.test(text)) return "evaluative";

  if (tt && TRANSACTIONAL_TITLE_TYPES.has(tt)) return "transactional";
  if (TRANSACTIONAL_RE.test(text)) return "transactional";

  if (tt && INFORMATIONAL_TITLE_TYPES.has(tt)) return "informational";
  if (INFORMATIONAL_RE.test(text)) return "informational";

  return "informational";
}

export function getLayoutPriority(intent: SearchIntent): LayoutPriority {
  switch (intent) {
    case "transactional":
      return "commerce-first";
    case "evaluative":
      return "comparison-first";
    default:
      return "article-first";
  }
}

export function shouldIncludeReferences(
  intent: SearchIntent,
  templateType?: string
): boolean {
  const tt = (templateType || "").trim();
  if (tt === "template-5" || tt === "template-6") return true;
  if (intent === "evaluative" && (tt === "template-4" || tt === "template-3")) return true;
  if (intent === "informational") return true;
  return false;
}

export function shouldRequireHowToSteps(
  intent: SearchIntent,
  titleType?: string
): boolean {
  const tt = (titleType || "").trim().toLowerCase();
  return (
    intent === "informational" &&
    (tt === "how-to" || tt === "services-guides" || /\bhow\s+to\b/i.test(tt))
  );
}
