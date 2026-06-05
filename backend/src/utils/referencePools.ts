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

export interface GuideAuthorProfile {
  name: string;
  jobTitle: string;
  bio: string;
  slug: string;
  sameAs: string[];
  profilePath: string;
}

export const DEFAULT_GUIDE_AUTHOR: GuideAuthorProfile = {
  name: "James Whitfield",
  jobTitle: "Luxury Technology Editor",
  bio: "Covers premium mobile devices, wearables, and concierge-grade technology for VERTU luxury life guides.",
  slug: "james-whitfield",
  sameAs: ["https://www.linkedin.com/company/vertu"],
  profilePath: "/authors/james-whitfield/",
};

const GUIDE_AUTHOR_POOL: GuideAuthorProfile[] = [
  DEFAULT_GUIDE_AUTHOR,
  {
    name: "Elena Marchetti",
    jobTitle: "Senior Horology & Wearables Editor",
    bio: "Specialises in luxury smartwatches, materials science, and collector-grade timepieces for VERTU guides.",
    slug: "elena-marchetti",
    sameAs: ["https://www.linkedin.com/company/vertu"],
    profilePath: "/authors/elena-marchetti/",
  },
  {
    name: "David Okonkwo",
    jobTitle: "Mobile Technology Analyst",
    bio: "Reports on flagship smartphones, secure communications, and concierge-tier mobile experiences.",
    slug: "david-okonkwo",
    sameAs: ["https://www.linkedin.com/company/vertu"],
    profilePath: "/authors/david-okonkwo/",
  },
  {
    name: "Sophie Laurent",
    jobTitle: "Luxury Lifestyle Correspondent",
    bio: "Writes on premium audio, gifting, and lifestyle technology with an emphasis on British English editorial standards.",
    slug: "sophie-laurent",
    sameAs: ["https://www.linkedin.com/company/vertu"],
    profilePath: "/authors/sophie-laurent/",
  },
];

function hashKeyword(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function pickGuideAuthor(keyword: string): GuideAuthorProfile {
  return GUIDE_AUTHOR_POOL[hashKeyword(keyword) % GUIDE_AUTHOR_POOL.length];
}

export function resolveArticleAuthor(
  payload: {
    articleAuthorName?: string;
    articleAuthorJobTitle?: string;
    articleAuthorBio?: string;
  },
  keyword?: string
): GuideAuthorProfile {
  if (payload.articleAuthorName?.trim()) {
    const base = keyword ? pickGuideAuthor(keyword) : DEFAULT_GUIDE_AUTHOR;
    return {
      ...base,
      name: payload.articleAuthorName.trim(),
      jobTitle: payload.articleAuthorJobTitle?.trim() || base.jobTitle,
      bio: payload.articleAuthorBio?.trim() || base.bio,
    };
  }
  return keyword ? pickGuideAuthor(keyword) : DEFAULT_GUIDE_AUTHOR;
}
