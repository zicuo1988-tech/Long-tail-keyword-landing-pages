import type { Reference } from "../services/templateRenderer.js";
import { pickFromPool } from "./keywordIntentGate.js";

type RefPoolItem = Omit<Reference, "linkType"> & { linkType?: Reference["linkType"] };

const PHONE_REFERENCES: RefPoolItem[] = [
  {
    author: "NIST Cybersecurity Framework",
    year: "2024",
    title: "Mobile Device Security Guidelines",
    publication: "National Institute of Standards and Technology",
    url: "https://www.nist.gov/cyberframework",
    linkType: "authoritative",
  },
  {
    author: "MIT Technology Review",
    year: "2024",
    title: "The Future of Smartphone Technology",
    publication: "MIT Technology Review",
    url: "https://www.technologyreview.com/tag/smartphones/",
    linkType: "authoritative",
  },
  {
    author: "IEEE Communications Society",
    year: "2023",
    title: "Mobile Security and Privacy Research",
    publication: "IEEE Communications Magazine",
    url: "https://www.comsoc.org/publications/magazines",
    linkType: "authoritative",
  },
  {
    author: "GSMA Intelligence",
    year: "2024",
    title: "Global Mobile Economy Outlook",
    publication: "GSMA",
    url: "https://www.gsma.com/mobileeconomy/",
    linkType: "authoritative",
  },
];

const WATCH_REFERENCES: RefPoolItem[] = [
  {
    author: "Forbes Contributors",
    year: "2024",
    title: "Luxury Watch Market Analysis and Trends",
    publication: "Forbes",
    url: "https://www.forbes.com/sites/forbes-personal-shopper/2024/01/15/best-luxury-watches/",
    linkType: "authoritative",
  },
  {
    author: "Hodinkee Editorial Team",
    year: "2024",
    title: "Comprehensive Guide to Luxury Timepieces",
    publication: "Hodinkee",
    url: "https://www.hodinkee.com/",
    linkType: "authoritative",
  },
  {
    author: "McKinsey & Company",
    year: "2024",
    title: "Luxury Watch Industry Report",
    publication: "McKinsey Global Institute",
    url: "https://www.mckinsey.com/industries/retail/our-insights/the-state-of-fashion-2024",
    linkType: "authoritative",
  },
  {
    author: "Revolution Watch",
    year: "2024",
    title: "Horology and Craftsmanship Insights",
    publication: "Revolution",
    url: "https://revolutionwatch.com/",
    linkType: "authoritative",
  },
];

const RING_REFERENCES: RefPoolItem[] = [
  {
    author: "Wearable Technology Research",
    year: "2024",
    title: "Smart Ring Technology and Luxury Wearables",
    publication: "Wearable Technology Review",
    url: "https://www.wareable.com/smart-rings",
    linkType: "authoritative",
  },
  {
    author: "TechCrunch Editorial",
    year: "2024",
    title: "The Evolution of Smart Ring Devices",
    publication: "TechCrunch",
    url: "https://techcrunch.com/tag/wearables/",
    linkType: "authoritative",
  },
  {
    author: "The Verge",
    year: "2024",
    title: "Wearable Health Tracking Overview",
    publication: "The Verge",
    url: "https://www.theverge.com/wearables",
    linkType: "authoritative",
  },
];

const EARBUD_REFERENCES: RefPoolItem[] = [
  {
    author: "CNET Reviews",
    year: "2024",
    title: "Premium Audio Technology Analysis",
    publication: "CNET",
    url: "https://www.cnet.com/audio/",
    linkType: "authoritative",
  },
  {
    author: "The Verge",
    year: "2024",
    title: "High-End Earbuds and Audio Quality",
    publication: "The Verge",
    url: "https://www.theverge.com/headphones",
    linkType: "authoritative",
  },
  {
    author: "What Hi-Fi?",
    year: "2024",
    title: "Luxury Personal Audio Buying Guide",
    publication: "What Hi-Fi?",
    url: "https://www.whathifi.com/best-buys/headphones",
    linkType: "authoritative",
  },
];

const GENERAL_REFERENCES: RefPoolItem[] = [
  {
    author: "Robb Report",
    year: "2024",
    title: "Luxury Lifestyle Technology Trends",
    publication: "Robb Report",
    url: "https://robbreport.com/tag/technology/",
    linkType: "authoritative",
  },
  {
    author: "Financial Times",
    year: "2024",
    title: "Premium Consumer Electronics Market",
    publication: "Financial Times",
    url: "https://www.ft.com/technology",
    linkType: "authoritative",
  },
];

export function buildKeywordAwareReferences(
  keyword: string,
  primaryCategory: string,
  titleType?: string
): Reference[] {
  const seed = `${keyword}|${primaryCategory}|${titleType || ""}`;
  let pool: RefPoolItem[] = GENERAL_REFERENCES;
  if (primaryCategory === "phone") pool = [...PHONE_REFERENCES, ...GENERAL_REFERENCES];
  else if (primaryCategory === "watch") pool = [...WATCH_REFERENCES, ...GENERAL_REFERENCES];
  else if (primaryCategory === "ring") pool = [...RING_REFERENCES, ...GENERAL_REFERENCES];
  else if (primaryCategory === "earbud") pool = [...EARBUD_REFERENCES, ...GENERAL_REFERENCES];

  const count = titleType === "how-to" || titleType === "expert" ? 4 : 3;
  return pickFromPool(pool, seed, count).map((r) => ({
    ...r,
    year: r.year || String(new Date().getFullYear() - 1),
  }));
}

export const DEFAULT_GUIDE_AUTHOR = {
  name: "James Whitfield",
  jobTitle: "Luxury Technology Editor",
  bio: "Covers premium mobile devices, wearables, and concierge-grade technology for VERTU luxury life guides.",
};

export function resolveArticleAuthor(payload: {
  articleAuthorName?: string;
  articleAuthorJobTitle?: string;
  articleAuthorBio?: string;
}): { name: string; jobTitle: string; bio: string } {
  return {
    name: payload.articleAuthorName?.trim() || DEFAULT_GUIDE_AUTHOR.name,
    jobTitle: payload.articleAuthorJobTitle?.trim() || DEFAULT_GUIDE_AUTHOR.jobTitle,
    bio: payload.articleAuthorBio?.trim() || DEFAULT_GUIDE_AUTHOR.bio,
  };
}
