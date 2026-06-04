/**
 * Audit history.json for low-fit keywords, alignment retries, and rewrite candidates.
 * Usage: npx tsx src/scripts/auditHistoryPages.ts [--rewrite-queue]
 */
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateKeywordGate } from "../utils/keywordIntentGate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const historyPath = path.join(__dirname, "../../data/history.json");

interface HistoryEntry {
  id?: string;
  status?: string;
  keyword?: string;
  titleType?: string;
  templateType?: string;
  pageUrl?: string;
  alignmentAttempts?: number;
  alignmentReasons?: string[];
  finalAlignmentMismatch?: boolean;
  details?: {
    alignmentAttempts?: number;
    alignmentReasons?: string[];
    finalAlignmentMismatch?: boolean;
  };
}

function main() {
  const writeQueue = process.argv.includes("--rewrite-queue");
  const raw = readFileSync(historyPath, "utf8");
  const entries: HistoryEntry[] = JSON.parse(raw);

  const tierD: HistoryEntry[] = [];
  const alignmentIssues: HistoryEntry[] = [];
  const completed: HistoryEntry[] = [];

  for (const e of entries) {
    if (e.status !== "completed" || !e.keyword) continue;
    completed.push(e);
    const gate = evaluateKeywordGate(e.keyword, { titleType: e.titleType });
    if (gate.tier === "D") tierD.push(e);
    const attempts = e.alignmentAttempts ?? e.details?.alignmentAttempts ?? 1;
    const mismatch = e.finalAlignmentMismatch ?? e.details?.finalAlignmentMismatch;
    const reasons = e.alignmentReasons ?? e.details?.alignmentReasons ?? [];
    if (attempts > 1 || mismatch || reasons.length > 0) {
      alignmentIssues.push(e);
    }
  }

  console.log("=== Luxury Life Guides — History Audit ===\n");
  console.log(`Completed pages: ${completed.length}`);
  console.log(`Tier D (low brand fit): ${tierD.length}`);
  console.log(`Alignment retries / mismatch: ${alignmentIssues.length}\n`);

  if (tierD.length > 0) {
    console.log("--- Tier D keywords (rewrite or noindex candidates) ---");
    tierD.slice(0, 20).forEach((e) => {
      console.log(`  • ${e.keyword} → ${e.pageUrl || "no url"}`);
    });
    if (tierD.length > 20) console.log(`  … and ${tierD.length - 20} more`);
    console.log("");
  }

  if (alignmentIssues.length > 0) {
    console.log("--- Alignment issues (priority rewrite) ---");
    alignmentIssues.slice(0, 15).forEach((e) => {
      const reasons = e.alignmentReasons ?? e.details?.alignmentReasons ?? [];
      console.log(
        `  • ${e.keyword} (attempts=${e.alignmentAttempts ?? 1}) ${reasons.slice(0, 2).join("; ") || ""}`
      );
    });
    console.log("");
  }

  console.log("--- GA4 follow-up ---");
  console.log("Segment by templateType × titleType in GA4; flag URLs with scroll_depth@25 < 40%.");
  console.log("See docs/ga4-cwv-playbook.md for exploration steps.\n");

  if (writeQueue) {
    const queue = [
      ...tierD.map((e) => ({ ...e, queueReason: "tier_d" })),
      ...alignmentIssues
        .filter((e) => !tierD.includes(e))
        .map((e) => ({ ...e, queueReason: "alignment" })),
    ];
    const outPath = path.join(__dirname, "../../data/rewrite-queue.json");
    writeFileSync(outPath, JSON.stringify(queue, null, 2), "utf8");
    console.log(`Wrote ${queue.length} entries to ${outPath}`);
  }
}

main();
