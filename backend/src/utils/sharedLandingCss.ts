import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SHARED_LANDING_CSS_PLACEHOLDER = "<!-- SHARED_LANDING_CSS -->";

export function injectSharedLandingCss(templateContent: string): string {
  if (!templateContent.includes(SHARED_LANDING_CSS_PLACEHOLDER)) {
    return templateContent;
  }
  const cssPath = path.join(__dirname, "../../../frontend/shared/landing-base.css");
  if (!existsSync(cssPath)) {
    console.warn(`[sharedLandingCss] Missing ${cssPath}`);
    return templateContent.replace(SHARED_LANDING_CSS_PLACEHOLDER, "");
  }
  const css = readFileSync(cssPath, "utf8");
  return templateContent.replace(SHARED_LANDING_CSS_PLACEHOLDER, css);
}
