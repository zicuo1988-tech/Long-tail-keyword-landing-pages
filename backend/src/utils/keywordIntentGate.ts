/**
 * Keyword intent gate: scores brand/category relevance and assigns tiers.
 * Tier D keywords are blocked in batch mode unless forceGenerate is set.
 */

export type KeywordTier = "A" | "B" | "C" | "D";

export interface KeywordGateResult {
  tier: KeywordTier;
  score: number;
  allowed: boolean;
  reasons: string[];
  /** When tier is C, prefer long-form editorial shell (template-5/6). */
  forceLongShell: boolean;
  /** Brand + clear intent: relax batch blocking, shell forcing, and category template locks. */
  brandStrong: boolean;
}

/** Exported for frontend batch logic (keep regex in sync with BRAND_TERMS). */
export const BRAND_STRONG_PATTERN =
  /\b(vertu|agent\s*q|quantum\s*flip|metavertu|meta\s*max|meta\s*curve|ivertu|signature|ironflip|grand\s*watch|meta\s*ring|ai\s*diamond\s*ring|ows\s*earbud|ruby\s*key|ruby\s*talk|concierge)\b/i;

export function isBrandStrongKeyword(keyword: string, pageTitle?: string): boolean {
  const text = `${keyword} ${pageTitle || ""}`.trim();
  if (!BRAND_STRONG_PATTERN.test(text)) return false;
  return (
    LUXURY_MODIFIERS.test(text) ||
    GUIDE_INTENT.test(text) ||
    COMMERCIAL_INTENT.test(text) ||
    CATEGORY_TERMS.test(text)
  );
}

const BRAND_TERMS = BRAND_STRONG_PATTERN;

const LUXURY_MODIFIERS =
  /\b(luxury|luxurious|premium|ultra[\s-]?premium|high[\s-]?end|bespoke|artisan|hand[\s-]?crafted|exclusive|flagship|collectible|concierge)\b/i;

const GUIDE_INTENT =
  /\b(how\s+to|what\s+is|what\s+are|why\s|when\s|where\s|best\b|top\s+\d|vs\.?\b|versus\b|review|reviews|guides?\b|comparison|comparisons|choose|choosing|worth\b|tips\b|ranking|recommended|buying\s+guide)\b/i;

const COMMERCIAL_INTENT = /\b(buy|purchase|shop|price|prices|official\s+store|where\s+to\s+buy|deal|sale)\b/i;

/** Generic accessory / repair / commodity terms — poor fit for VERTU luxury grids. */
const TIER_D_PATTERNS: RegExp[] = [
  /\b(charging\s+cable|charger|usb\s+c|power\s+adapter|wall\s+charger|wireless\s+charger)\b/i,
  /\b(screen\s+protector|tempered\s+glass|phone\s+case|phone\s+cover|silicone\s+case)\b/i,
  /\b(screen\s+repair|battery\s+replacement|fix\s+my\s+phone|repair\s+shop|cracked\s+screen)\b/i,
  /\b(cheapest|budget|affordable|under\s+\$?\d+|free\s+phone|refurbished\s+budget)\b/i,
  /\b(download\s+apk|mod\s+apk|crack|unlock\s+tool|root\s+guide|jailbreak)\b/i,
  /\b(sim\s+card\s+adapter|memory\s+card|sd\s+card|otg\s+cable)\b/i,
];

const CATEGORY_TERMS =
  /\b(phone|phones|smartphone|smartphones|mobile|watch|watches|timepiece|ring|rings|earbud|earbuds|earphone|jewellery|jewelry|flip\s+phone|foldable)\b/i;

function hashKeyword(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function evaluateKeywordGate(
  keyword: string,
  options?: { pageTitle?: string; titleType?: string; forceGenerate?: boolean }
): KeywordGateResult {
  const text = `${keyword} ${options?.pageTitle || ""}`.trim().toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (BRAND_TERMS.test(text)) {
    score += 40;
    reasons.push("brand or product name present");
  }
  if (LUXURY_MODIFIERS.test(text)) {
    score += 25;
    reasons.push("luxury/premium modifier");
  }
  if (GUIDE_INTENT.test(text) || COMMERCIAL_INTENT.test(text)) {
    score += 15;
    reasons.push("clear search intent");
  }
  if (CATEGORY_TERMS.test(text)) {
    score += 10;
    reasons.push("VERTU-relevant category");
  }

  const hasBrand = BRAND_TERMS.test(text);

  for (const pat of TIER_D_PATTERNS) {
    if (pat.test(text)) {
      // Brand-qualified queries (e.g. VERTU + accessory) stay publishable — softer penalty
      score -= hasBrand ? 15 : 50;
      reasons.push(`low-fit pattern: ${pat.source.slice(0, 40)}`);
      break;
    }
  }

  // Generic android/ios without luxury — weak unless brand or category education intent
  if (
    /\b(android|iphone|samsung|xiaomi|pixel)\b/i.test(text) &&
    !LUXURY_MODIFIERS.test(text) &&
    !hasBrand
  ) {
    score -= 20;
    reasons.push("generic platform term without luxury context");
  }

  let tier: KeywordTier;
  if (score >= 50) tier = "A";
  else if (score >= 30) tier = "B";
  else if (score >= 10) tier = "C";
  else tier = "D";

  const brandStrong = isBrandStrongKeyword(keyword, options?.pageTitle);

  // Brand-strong: always at least Tier B, often Tier A
  if (brandStrong) {
    if (tier === "D" || tier === "C") tier = "B";
    if (score >= 45 || (COMMERCIAL_INTENT.test(text) && hasBrand)) tier = "A";
    reasons.push("brand-strong keyword: relaxed gate");
  } else if (hasBrand && tier === "D") {
    tier = "B";
    reasons.push("brand present: floor Tier B");
  }

  const forceGenerate = options?.forceGenerate === true;
  const allowed = tier !== "D" || forceGenerate || brandStrong;
  // Do not force long shell for brand-strong — allow template rotation / conversion shells
  const forceLongShell =
    !brandStrong && (tier === "C" || (tier === "B" && GUIDE_INTENT.test(text)));

  if (tier === "D" && !forceGenerate && !brandStrong) {
    reasons.push("Tier D: blocked in batch unless forceGenerate");
  }

  return { tier, score, allowed, reasons, forceLongShell, brandStrong };
}

/** Stable pick for keyword-aware reference URLs (generation.ts). */
export function pickFromPool<T>(pool: T[], seed: string, count: number): T[] {
  if (pool.length === 0 || count <= 0) return [];
  const start = hashKeyword(seed) % pool.length;
  const out: T[] = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    out.push(pool[(start + i) % pool.length]);
  }
  return out;
}
