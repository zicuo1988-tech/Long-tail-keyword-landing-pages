import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const feedbackRouter = express.Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const feedbackPath = path.join(__dirname, "../../data/feedback.json");

interface FeedbackEntry {
  vote: "yes" | "no";
  pageSlug?: string;
  experimentVariant?: string;
  createdAt: string;
}

async function readFeedback(): Promise<FeedbackEntry[]> {
  try {
    const raw = await fs.readFile(feedbackPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

feedbackRouter.post("/feedback", async (req, res) => {
  try {
    const vote = req.body?.vote === "no" ? "no" : req.body?.vote === "yes" ? "yes" : null;
    if (!vote) {
      return res.status(400).json({ success: false, error: "vote must be yes or no" });
    }

    const entry: FeedbackEntry = {
      vote,
      pageSlug: typeof req.body?.pageSlug === "string" ? req.body.pageSlug : undefined,
      experimentVariant:
        typeof req.body?.experimentVariant === "string"
          ? req.body.experimentVariant
          : undefined,
      createdAt: new Date().toISOString(),
    };

    const rows = await readFeedback();
    rows.unshift(entry);
    await fs.mkdir(path.dirname(feedbackPath), { recursive: true });
    await fs.writeFile(feedbackPath, JSON.stringify(rows.slice(0, 5000), null, 2), "utf8");

    return res.json({ success: true });
  } catch (error) {
    console.error("[Feedback] save failed:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to save feedback",
    });
  }
});
