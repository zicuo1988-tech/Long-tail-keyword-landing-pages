import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GenerationRequestPayload } from "../types.js";
import { isCommercialTitleType, shouldTreatAsLongFormGuideArticle } from "./guideIntent.js";
import { detectPrimaryCategory, isComparisonIntent } from "./productCategory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_FILE_BY_TYPE: Record<string, string> = {
  "template-1": "default-template.html",
  "template-2": "template-2.html",
  "template-3": "template-3.html",
  "template-4": "template-4.html",
  "template-5": "template-5.html",
  "template-6": "template-6.html",
  "template-7": "template-7.html",
};

/** Long shells for guide-intent pages when the client sent a short template by mistake. */
const LONG_SHELL_ROTATION = ["template-5", "template-6", "template-7"] as const;

function repoFrontendDir(): string {
  return path.join(__dirname, "../../../frontend");
}

function hashKeyword(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function loadTemplateIntoPayload(
  payload: GenerationRequestPayload,
  pick: string,
  reason: string
): boolean {
  const fileName = TEMPLATE_FILE_BY_TYPE[pick];
  if (!fileName) return false;
  const fullPath = path.join(repoFrontendDir(), fileName);
  if (!existsSync(fullPath)) {
    console.warn(`[templatePolicy] ${reason} skipped: template file missing at ${fullPath}`);
    return false;
  }
  const from = payload.templateType || "template-1";
  payload.templateType = pick;
  payload.templateContent = readFileSync(fullPath, "utf8");
  console.log(`[templatePolicy] ${reason}: ${from} → ${pick} (keyword="${payload.keyword}")`);
  return true;
}

/** Prefer editorial shells for category-specific guides (content before or around products). */
function pickLongShellForCategory(keyword: string, pageTitle: string): string {
  const primary = detectPrimaryCategory(keyword, pageTitle);
  if (primary === "watch" || primary === "ring" || primary === "earbud") {
    return primary === "earbud" ? "template-7" : "template-6";
  }
  return LONG_SHELL_ROTATION[hashKeyword(keyword) % LONG_SHELL_ROTATION.length];
}

/**
 * Template-2 shows products above the article — high bounce when title/category mismatch.
 * For watch/ring/earbud intents, switch to template-7 (blog-first) or template-1 (content-first).
 */
export function applyCategoryAwareTemplateFix(
  payload: GenerationRequestPayload,
  finalPageTitle: string
): void {
  if (payload.respectTemplateChoice) return;
  if (isComparisonIntent(payload.keyword, finalPageTitle)) return;

  const tt = (payload.templateType || "template-1").trim();
  if (tt !== "template-2" && tt !== "template-3") return;

  const primary = detectPrimaryCategory(payload.keyword, finalPageTitle);
  if (primary !== "watch" && primary !== "ring" && primary !== "earbud") return;

  const pick = primary === "ring" || primary === "watch" ? "template-7" : "template-6";
  loadTemplateIntoPayload(
    payload,
    pick,
    `Category-aware fix (${primary}): avoid product-first short shell`
  );
}

/**
 * If the payload uses template-1/2 but the keyword/title/titleType imply a guide,
 * swap to a long-form shell (template 5/6/7) and reload template HTML from disk.
 */
export function applyGuideIntentLongShellIfNeeded(
  payload: GenerationRequestPayload,
  finalPageTitle: string
): void {
  if (payload.respectTemplateChoice) return;

  const tt = (payload.templateType || "template-1").trim();

  applyCategoryAwareTemplateFix(payload, finalPageTitle);
  if (payload.templateType !== tt && payload.templateType !== "template-1" && payload.templateType !== "template-2") {
    return;
  }

  if (tt !== "template-1" && tt !== "template-2") {
    return;
  }
  if (
    !shouldTreatAsLongFormGuideArticle(tt, payload.keyword, finalPageTitle, payload.titleType)
  ) {
    return;
  }

  const pick = pickLongShellForCategory(payload.keyword, finalPageTitle);
  loadTemplateIntoPayload(payload, pick, "Guide-intent upgrade");
}

/**
 * Commercial / purchase intent: prefer template-5 (Hero + Top Picks + comparison) for conversion.
 */
export function applyCommercialShellIfNeeded(
  payload: GenerationRequestPayload,
  finalPageTitle: string
): void {
  if (payload.respectTemplateChoice) return;
  if (!isCommercialTitleType(payload.titleType)) return;

  const tt = (payload.templateType || "template-1").trim();
  if (tt === "template-4" || tt === "template-5") return;

  loadTemplateIntoPayload(
    payload,
    "template-5",
    `Commercial titleType (${payload.titleType}): conversion shell`
  );
}
