import type { PrimaryProductCategory } from "../utils/productCategory.js";

export type InformationGainType = "expert-insight" | "case-study" | "data-comparison";

export interface InformationGainSnippet {
  type: InformationGainType;
  title: string;
  body: string;
}

function hashKeyword(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const PHONE_SNIPPETS: InformationGainSnippet[] = [
  {
    type: "expert-insight",
    title: "Editor's perspective",
    body:
      "Luxury handset buyers rarely optimise for raw benchmark scores alone. Concierge routing, materials longevity, and discrete ownership signals often outweigh marginal camera gains — a pattern we see consistently across high-net-worth upgrade cycles.",
  },
  {
    type: "case-study",
    title: "Real-world scenario",
    body:
      "A private-banking client replaced a flagship mass-market phone with a hand-finished device primarily for boardroom discretion and 24/7 lifestyle support. After six months, utilisation shifted toward secure comms and travel logistics rather than social apps.",
  },
  {
    type: "data-comparison",
    title: "At a glance",
    body:
      "Premium devices in this category typically pair exotic materials (ceramic, sapphire, leather) with dedicated support channels — whereas mainstream flagships prioritise annual spec bumps and ecosystem lock-in.",
  },
];

const WATCH_SNIPPETS: InformationGainSnippet[] = [
  {
    type: "expert-insight",
    title: "Horology note",
    body:
      "Collectors evaluating smart-luxury hybrids should weigh service network depth and case finishing as heavily as sensor suites — resale narratives for artisan brands differ materially from consumer electronics depreciation curves.",
  },
  {
    type: "case-study",
    title: "Wear pattern",
    body:
      "An executive traveller used a sapphire-crystal smartwatch chiefly for timezone management and wellness alerts during multi-leg itineraries, citing glare resistance and formal-dress compatibility as decisive factors over step-count gamification.",
  },
  {
    type: "data-comparison",
    title: "Spec lens",
    body:
      "High-end wearables in this segment often trade battery marathon scores for thinner profiles and formal aesthetics — opposite to fitness-first models optimising GPS runtime and ruggedisation.",
  },
];

const RING_SNIPPETS: InformationGainSnippet[] = [
  {
    type: "expert-insight",
    title: "Wearable analyst view",
    body:
      "Smart rings succeed when sizing accuracy and sleep-stage consistency beat feature checklists. Luxury-positioned rings add design permanence — buyers expect the piece to remain socially acceptable beyond a single product cycle.",
  },
  {
    type: "case-study",
    title: "Daily use",
    body:
      "A user migrating from a wrist wearable to a ring cited fewer meeting interruptions and improved sleep comfort, accepting narrower display-less interaction in exchange for always-on biometrics.",
  },
  {
    type: "data-comparison",
    title: "Category contrast",
    body:
      "Rings compress sensors into a smaller thermal envelope than watches, which can affect workout HR accuracy but improves 24/7 wear compliance — a trade-off luxury buyers should understand upfront.",
  },
];

const EARBUD_SNIPPETS: InformationGainSnippet[] = [
  {
    type: "expert-insight",
    title: "Acoustic editor view",
    body:
      "Premium IEM and luxury earbud buyers frequently prioritise timbral balance and call clarity in variable environments over maximum bass emphasis — tuning philosophy matters as much as driver size on paper.",
  },
  {
    type: "case-study",
    title: "Listening context",
    body:
      "A frequent flyer standardised on one high-end earbud set for cabin noise, concierge calls, and hotel gym sessions, reducing carry weight versus over-ear alternatives without sacrificing isolation.",
  },
  {
    type: "data-comparison",
    title: "Feature frame",
    body:
      "Luxury audio products may offer fewer codec badges than mainstream flagships but invest in chassis materials, fit stability, and long-term driver consistency — differences rarely visible in spec sheets alone.",
  },
];

const GENERAL_SNIPPETS: InformationGainSnippet[] = [
  {
    type: "expert-insight",
    title: "VERTU editorial",
    body:
      "Across luxury technology categories, ownership value often compounds through service access and craftsmanship rather than annual specification increments — a useful lens when comparing seemingly similar price tiers.",
  },
  {
    type: "case-study",
    title: "Buyer journey",
    body:
      "High-intent researchers typically narrow options after clarifying primary use (travel, gifting, status signalling, productivity) — not after reading generic feature lists duplicated across review aggregators.",
  },
  {
    type: "data-comparison",
    title: "Decision shortcut",
    body:
      "Mass-market and luxury-tier products may share chipset generations yet diverge on assembly, support SLAs, and materials sourcing — compare those dimensions before normalising on price per gigabyte alone.",
  },
];

function poolForCategory(category: string): InformationGainSnippet[] {
  switch (category) {
    case "phone":
      return [...PHONE_SNIPPETS, ...GENERAL_SNIPPETS];
    case "watch":
      return [...WATCH_SNIPPETS, ...GENERAL_SNIPPETS];
    case "ring":
      return [...RING_SNIPPETS, ...GENERAL_SNIPPETS];
    case "earbud":
      return [...EARBUD_SNIPPETS, ...GENERAL_SNIPPETS];
    default:
      return GENERAL_SNIPPETS;
  }
}

/** Pick one information-gain snippet per page for uniqueness. */
export function pickInformationGainSnippet(
  keyword: string,
  primaryCategory: PrimaryProductCategory | string
): InformationGainSnippet {
  const pool = poolForCategory(primaryCategory);
  return pool[hashKeyword(keyword) % pool.length];
}
