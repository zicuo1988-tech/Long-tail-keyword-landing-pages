import type { FAQItem } from "../types.js";
import { extractMentionedProductsFromContent } from "../services/googleAi.js";
import {
  checkArticleTopicMismatch,
  isFlipFormFactorProductName,
  isFlipPhoneIntent,
  isSpecificProductCategory,
  productMatchesPrimaryCategory,
  type PrimaryProductCategory,
} from "./productCategory.js";

export const MAX_ALIGNMENT_ATTEMPTS = 3;

export interface ContentAlignmentInput {
  articleContent: string;
  extendedContent?: string;
  faqItems?: FAQItem[];
  keyword: string;
  pageTitle: string;
  availableProductNames: string[];
  primaryCategory: PrimaryProductCategory;
  topicContentMismatch?: boolean;
}

export interface ContentAlignmentResult {
  needsRetry: boolean;
  reasons: string[];
}

function stripHtml(text: string): string {
  return (text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeName(name: string): string {
  return stripHtml(name).toLowerCase();
}

function isProductOnAvailableList(mentioned: string, availableProductNames: string[]): boolean {
  const m = normalizeName(mentioned);
  if (!m) return true;
  return availableProductNames.some((a) => {
    const n = normalizeName(a);
    return n === m || n.includes(m) || m.includes(n);
  });
}

function inferCategoryFromProductName(name: string): PrimaryProductCategory | null {
  const stub = { id: 0, name: stripHtml(name), link: "" };
  if (isFlipFormFactorProductName(name)) return "phone";
  const order: PrimaryProductCategory[] = ["watch", "ring", "earbud", "phone"];
  for (const cat of order) {
    if (productMatchesPrimaryCategory(stub, cat)) return cat;
  }
  return null;
}

/** Products mentioned in copy but not on the page product whitelist. */
export function findOffListProductMentions(
  content: string,
  availableProductNames: string[]
): string[] {
  if (!content?.trim()) return [];
  const mentioned = extractMentionedProductsFromContent(content);
  if (availableProductNames.length === 0) {
    return mentioned;
  }
  return mentioned.filter((p) => !isProductOnAvailableList(p, availableProductNames));
}

function findCrossCategoryMentions(
  content: string,
  primaryCategory: PrimaryProductCategory
): string[] {
  if (!isSpecificProductCategory(primaryCategory) || !content?.trim()) return [];
  const mentioned = extractMentionedProductsFromContent(content);
  return mentioned.filter((name) => {
    const cat = inferCategoryFromProductName(name);
    return cat !== null && cat !== primaryCategory;
  });
}

function buildFullText(input: ContentAlignmentInput): string {
  const faqText = (input.faqItems || [])
    .map((f) => `${f.question} ${f.answer}`)
    .join(" ");
  return `${input.articleContent || ""} ${input.extendedContent || ""} ${faqText}`;
}

export function evaluateContentAlignment(input: ContentAlignmentInput): ContentAlignmentResult {
  const reasons: string[] = [];
  const fullText = buildFullText(input);

  const topicCheck = checkArticleTopicMismatch(fullText, input.keyword, input.pageTitle);
  if (topicCheck.mismatch) {
    const expected =
      topicCheck.source === "title" ? topicCheck.titleCategories : topicCheck.keywordCategories;
    reasons.push(
      `topic mismatch (${topicCheck.source}): expected ${expected.join("/")}, content has ${topicCheck.contentCategories.join("/")}`
    );
  }

  if (input.topicContentMismatch) {
    reasons.push("AI flagged topicContentMismatch during generation");
  }

  if (isFlipPhoneIntent(input.keyword, input.pageTitle)) {
    const cross = findCrossCategoryMentions(fullText, "phone").filter(
      (n) => !isFlipFormFactorProductName(n)
    );
    if (cross.length > 0) {
      reasons.push(`flip intent but content emphasises bar phones: ${cross.slice(0, 3).join(", ")}`);
    }
  } else if (isSpecificProductCategory(input.primaryCategory)) {
    const cross = findCrossCategoryMentions(fullText, input.primaryCategory);
    if (cross.length > 0) {
      reasons.push(
        `cross-category products for ${input.primaryCategory}: ${cross.slice(0, 4).join(", ")}`
      );
    }
  }

  if (input.availableProductNames.length > 0) {
    const offList = findOffListProductMentions(fullText, input.availableProductNames);
    if (offList.length > 0) {
      reasons.push(`products mentioned but not on page list: ${offList.slice(0, 4).join(", ")}`);
    }
  } else if (isSpecificProductCategory(input.primaryCategory)) {
    const mentioned = extractMentionedProductsFromContent(fullText);
    const specificSkus = mentioned.filter((n) => inferCategoryFromProductName(n) !== null);
    if (specificSkus.length > 0) {
      reasons.push(
        `no catalog products on page but content names SKUs: ${specificSkus.slice(0, 4).join(", ")}`
      );
    }
  }

  return { needsRetry: reasons.length > 0, reasons };
}

export function mergeUserPrompt(userPrompt: string | undefined, retryHint: string | undefined): string | undefined {
  const base = userPrompt?.trim() || "";
  const hint = retryHint?.trim() || "";
  if (!base && !hint) return undefined;
  if (!hint) return base;
  if (!base) return hint;
  return `${base}\n\n---\nALIGNMENT CORRECTION (mandatory):\n${hint}`;
}

export function buildAlignmentRetryPrompt(
  reasons: string[],
  availableProductNames: string[],
  primaryCategory: PrimaryProductCategory,
  keyword: string,
  pageTitle = ""
): string {
  const productLine =
    availableProductNames.length > 0
      ? `ONLY discuss these VERTU products: ${availableProductNames.join(", ")}.`
      : `Write a category-level guide for "${keyword}" without inventing specific SKU names or specs not on the official page.`;

  const categoryRule = isFlipPhoneIntent(keyword, pageTitle)
    ? "Focus ONLY on foldable handsets (Quantum Flip, Ironflip). Do NOT promote bar phones (Agent Q, Signature, Metavertu bar models) as the main recommendation."
    : isSpecificProductCategory(primaryCategory)
      ? `Primary category is ${primaryCategory}. Do NOT write as if the page is about a different product category.`
      : "Stay aligned with the keyword and page title product scope.";

  return [
    "Previous draft failed alignment checks. Regenerate from scratch.",
    `Issues: ${reasons.join("; ")}`,
    categoryRule,
    productLine,
    "Use British English. Product facts from the filtered knowledge base only.",
  ].join(" ");
}

export function buildEmptyCatalogContentHint(
  primaryCategory: PrimaryProductCategory,
  keyword: string
): string {
  if (!isSpecificProductCategory(primaryCategory)) return "";
  return (
    `[System] No products are currently on this page for "${keyword}". ` +
    `Write a ${primaryCategory}-category guide without naming specific VERTU SKUs unless they appear in the knowledge base as generic examples.`
  );
}
