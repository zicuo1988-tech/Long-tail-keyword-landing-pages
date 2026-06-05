import express from "express";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAllHistoryRecords } from "../state/historyStore.js";
import { evaluateKeywordGate } from "../utils/keywordIntentGate.js";

export const seoHealthRouter = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../data");

function readJsonArray(fileName: string): unknown[] {
  const full = path.join(dataDir, fileName);
  if (!existsSync(full)) return [];
  try {
    const parsed = JSON.parse(readFileSync(full, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

seoHealthRouter.get("/seo-health", async (_req, res) => {
  try {
    const history = await getAllHistoryRecords();
    const completed = history.filter((h) => h.status === "completed");

    const tierD = completed.filter((h) => {
      if (!h.keyword) return false;
      return evaluateKeywordGate(h.keyword, { titleType: h.titleType }).tier === "D";
    });

    const variantCounts = { A: 0, B: 0, unknown: 0 };
    for (const h of completed) {
      const v = (h.details as { experimentVariant?: string } | undefined)?.experimentVariant;
      if (v === "A") variantCounts.A += 1;
      else if (v === "B") variantCounts.B += 1;
      else variantCounts.unknown += 1;
    }

    const rewriteQueue = readJsonArray("rewrite-queue.json");
    const gscAlerts = readJsonArray("gsc-alerts.json");
    const feedback = readJsonArray("feedback.json");

    const helpfulYes = feedback.filter(
      (f) => (f as { vote?: string }).vote === "yes"
    ).length;
    const helpfulNo = feedback.filter(
      (f) => (f as { vote?: string }).vote === "no"
    ).length;

    return res.json({
      success: true,
      summary: {
        completedPages: completed.length,
        tierDPages: tierD.length,
        rewriteQueueSize: rewriteQueue.length,
        gscAlerts: gscAlerts.length,
        experimentVariants: variantCounts,
        helpfulVotes: { yes: helpfulYes, no: helpfulNo },
      },
      rewriteQueue: rewriteQueue.slice(0, 50),
      gscAlerts: gscAlerts.slice(0, 50),
      tierDSample: tierD.slice(0, 20).map((h) => ({
        keyword: h.keyword,
        pageUrl: h.pageUrl,
        templateType: h.templateType,
      })),
    });
  } catch (error) {
    console.error("[SEO Health] failed:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "SEO health check failed",
    });
  }
});
