import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { GenerationRequestPayload } from "../types.js";
import { shouldTreatAsLongFormGuideArticle } from "./guideIntent.js";

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

/**
 * If the payload uses template-1/2 but the keyword/title/titleType imply a guide,
 * swap to a long-form shell (template 5/6/7) and reload template HTML from disk.
 */
export function applyGuideIntentLongShellIfNeeded(
  payload: GenerationRequestPayload,
  finalPageTitle: string
): void {
  const tt = (payload.templateType || "template-1").trim();
  if (tt !== "template-1" && tt !== "template-2") {
    return;
  }
  if (
    !shouldTreatAsLongFormGuideArticle(tt, payload.keyword, finalPageTitle, payload.titleType)
  ) {
    return;
  }

  const pick = LONG_SHELL_ROTATION[hashKeyword(payload.keyword) % LONG_SHELL_ROTATION.length];
  const fileName = TEMPLATE_FILE_BY_TYPE[pick];
  if (!fileName) return;

  const fullPath = path.join(repoFrontendDir(), fileName);
  if (!existsSync(fullPath)) {
    console.warn(
      `[templatePolicy] Guide-intent upgrade skipped: template file missing at ${fullPath}`
    );
    return;
  }

  payload.templateType = pick;
  payload.templateContent = readFileSync(fullPath, "utf8");
  console.log(
    `[templatePolicy] Upgraded shell from ${tt} to ${pick} for guide-intent keyword="${payload.keyword}"`
  );
}
