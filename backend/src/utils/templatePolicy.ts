import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GenerationRequestPayload } from "../types.js";
import { isCommercialTitleType, shouldTreatAsLongFormGuideArticle } from "./guideIntent.js";
import { isBrandStrongKeyword } from "./keywordIntentGate.js";
import { detectPrimaryCategory, isComparisonIntent } from "./productCategory.js";
import {
  classifySearchIntent,
  getLayoutPriority,
  type LayoutPriority,
  type SearchIntent,
} from "./searchIntentClassifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_FILE_BY_TYPE: Record<string, string> = {
  "template-1": "default-template.html",
  "template-2": "template-2.html",
  "template-3": "template-3.html",
  "template-4": "template-4.html",
  "template-5": "template-5.html",
  "template-6": "template-6.html",
};

/** Template 7 temporarily disabled — requests map here. */
export const TEMPLATE_7_FALLBACK = "template-6";

const DISABLED_TEMPLATE_TYPES = new Set(["template-7"]);

/** Long shells for guide-intent pages when the client sent a short template by mistake. */
const LONG_SHELL_ROTATION = ["template-5", "template-6"] as const;

/** Map deprecated template ids to supported shells (reloads HTML from disk). */
export function migrateDisabledTemplate(
  payload: GenerationRequestPayload,
  logPrefix = ""
): boolean {
  const tt = (payload.templateType || "").trim();
  if (!DISABLED_TEMPLATE_TYPES.has(tt)) return false;
  const prefix = logPrefix ? `${logPrefix} ` : "";
  console.log(`${prefix}template-7 已停用，自动改用 ${TEMPLATE_7_FALLBACK}`);
  return loadTemplateIntoPayload(
    payload,
    TEMPLATE_7_FALLBACK,
    "Template-7 disabled (fallback to template-6)"
  );
}

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
    return "template-6";
  }
  return LONG_SHELL_ROTATION[hashKeyword(keyword) % LONG_SHELL_ROTATION.length];
}

/**
 * Template-2 shows products above the article — high bounce when title/category mismatch.
 * For watch/ring/earbud intents, switch to template-6 (long-form) instead of product-first short shells.
 */
export function applyCategoryAwareTemplateFix(
  payload: GenerationRequestPayload,
  finalPageTitle: string
): void {
  if (payload.respectTemplateChoice) return;
  if (isBrandStrongKeyword(payload.keyword, finalPageTitle)) return;
  if (isComparisonIntent(payload.keyword, finalPageTitle)) return;

  const tt = (payload.templateType || "template-1").trim();
  if (tt !== "template-2" && tt !== "template-3") return;

  const primary = detectPrimaryCategory(payload.keyword, finalPageTitle);
  if (primary !== "watch" && primary !== "ring" && primary !== "earbud") return;

  const pick = "template-6";
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
  if (isBrandStrongKeyword(payload.keyword, finalPageTitle)) return;

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

/**
 * Intent-driven template and layout selection.
 * Runs before guide-intent and commercial shell upgrades when respectTemplateChoice is false.
 */
export function applyIntentDrivenLayout(
  payload: GenerationRequestPayload,
  finalPageTitle: string
): { intent: SearchIntent; layoutPriority: LayoutPriority } {
  const intent = classifySearchIntent(
    payload.keyword,
    finalPageTitle,
    payload.titleType
  );
  const layoutPriority = getLayoutPriority(intent);

  payload.searchIntent = intent;
  payload.layoutPriority = layoutPriority;

  if (payload.respectTemplateChoice || isBrandStrongKeyword(payload.keyword, finalPageTitle)) {
    return { intent, layoutPriority };
  }

  const tt = (payload.templateType || "template-1").trim();

  switch (intent) {
    case "informational":
      if (tt === "template-1" || tt === "template-2") {
        loadTemplateIntoPayload(payload, "template-6", "Intent-driven (informational)");
      }
      break;
    case "transactional":
      if (tt !== "template-4" && tt !== "template-5") {
        loadTemplateIntoPayload(
          payload,
          hashKeyword(payload.keyword) % 2 === 0 ? "template-5" : "template-4",
          "Intent-driven (transactional)"
        );
      }
      break;
    case "evaluative":
      if (tt === "template-1" || tt === "template-2" || tt === "template-3") {
        loadTemplateIntoPayload(
          payload,
          "template-5",
          "Intent-driven (evaluative)"
        );
      }
      break;
  }

  return { intent, layoutPriority };
}

/**
 * A/B: variant A = template-6 (text-heavy).
 * Only overrides shell for single-page auto-pick flows — never when respectTemplateChoice is set (batch rotation / manual pick).
 */
export function applyExperimentVariantShell(payload: GenerationRequestPayload): void {
  if (payload.respectTemplateChoice) return;
  if (payload.experimentVariant !== "A") return;
  const tt = (payload.templateType || "").trim();
  if (tt === "template-6") return;
  loadTemplateIntoPayload(payload, "template-6", "A/B variant A (text-heavy shell)");
}
