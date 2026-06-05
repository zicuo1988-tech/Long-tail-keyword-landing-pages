export interface GuideAuthor {
  name: string;
  jobTitle: string;
  bio: string;
  slug: string;
  sameAs: string[];
  profilePath: string;
}

/** Keep in sync with backend/src/utils/referencePools.ts GUIDE_AUTHOR_POOL */
export const GUIDE_AUTHORS: GuideAuthor[] = [
  {
    name: "James Whitfield",
    jobTitle: "Luxury Technology Editor",
    bio: "Covers premium mobile devices, wearables, and concierge-grade technology for VERTU luxury life guides.",
    slug: "james-whitfield",
    sameAs: ["https://www.linkedin.com/company/vertu"],
    profilePath: "/authors/james-whitfield/",
  },
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
