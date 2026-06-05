/**
 * List Sanity guides not updated in 90+ days for content refresh queue.
 * Usage: npx tsx src/scripts/refreshStaleGuides.ts [--write-queue]
 */
import { writeFileSync, readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@sanity/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rewriteQueuePath = path.join(__dirname, "../../data/rewrite-queue.json");
const STALE_DAYS = 90;

async function main() {
  const projectId = process.env.SANITY_PROJECT_ID?.trim();
  const dataset = process.env.SANITY_DATASET?.trim();
  const token = process.env.SANITY_API_TOKEN?.trim();
  if (!projectId || !dataset || !token) {
    console.error("SANITY_PROJECT_ID, SANITY_DATASET, SANITY_API_TOKEN required");
    process.exit(1);
  }

  const client = createClient({
    projectId,
    dataset,
    token,
    apiVersion: process.env.SANITY_API_VERSION || "2024-01-01",
    useCdn: false,
  });

  const docs = await client.fetch<
    Array<{
      title?: string;
      slug?: string;
      modifiedAt?: string;
      keyword?: string;
    }>
  >(
    `*[_type == "luxuryLifeGuide" && defined(slug.current)]{
      title,
      "slug": slug.current,
      modifiedAt,
      keyword
    }`
  );

  const cutoff = Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000;
  const stale = (docs || []).filter((d) => {
    const t = Date.parse(d.modifiedAt || "");
    return Number.isNaN(t) || t < cutoff;
  });

  console.log(`Stale guides (>${STALE_DAYS}d): ${stale.length}`);
  stale.slice(0, 30).forEach((d) => {
    console.log(`  • ${d.slug} — ${d.title || ""}`);
  });

  if (process.argv.includes("--write-queue")) {
    let queue: unknown[] = [];
    if (existsSync(rewriteQueuePath)) {
      try {
        queue = JSON.parse(readFileSync(rewriteQueuePath, "utf8"));
        if (!Array.isArray(queue)) queue = [];
      } catch {
        queue = [];
      }
    }

    const existing = new Set(queue.map((q) => (q as { pageUrl?: string }).pageUrl));
    for (const d of stale) {
      const pageUrl = `/${(d.slug || "").replace(/^\/+|\/+$/g, "")}/`;
      if (existing.has(pageUrl)) continue;
      queue.unshift({
        pageUrl,
        keyword: d.keyword || "",
        reason: "stale_content",
        detectedAt: new Date().toISOString(),
        source: "refreshStaleGuides",
      });
    }

    writeFileSync(rewriteQueuePath, JSON.stringify(queue.slice(0, 500), null, 2), "utf8");
    console.log(`rewrite-queue.json updated (${queue.length} entries)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
