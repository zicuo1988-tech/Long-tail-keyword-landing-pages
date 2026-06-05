import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "../../data");
const rewriteQueuePath = path.join(dataDir, "rewrite-queue.json");
const gscAlertsPath = path.join(dataDir, "gsc-alerts.json");
const gscMetricsPath = path.join(dataDir, "gsc-metrics-history.json");

export interface GscPageMetric {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  week: string;
}

export interface GscAlert {
  page: string;
  reason: string;
  ctrDropPct?: number;
  position?: number;
  detectedAt: string;
}

interface MetricsHistory {
  [page: string]: GscPageMetric[];
}

function readJson<T>(filePath: string, fallback: T): T {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Fetch Search Console page metrics via Google API.
 * Requires GSC_SERVICE_ACCOUNT_JSON (base64 or raw JSON) and GSC_SITE_URL.
 */
export async function fetchGscPageMetrics(options?: {
  startDate?: string;
  endDate?: string;
}): Promise<GscPageMetric[]> {
  const siteUrl = process.env.GSC_SITE_URL?.trim();
  const saJson = process.env.GSC_SERVICE_ACCOUNT_JSON?.trim();
  if (!siteUrl || !saJson) {
    console.warn("[GSC] GSC_SITE_URL or GSC_SERVICE_ACCOUNT_JSON not configured — skipping fetch");
    return [];
  }

  try {
    const { google } = await import("googleapis");
    const credentials = JSON.parse(
      saJson.startsWith("{") ? saJson : Buffer.from(saJson, "base64").toString("utf8")
    );
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
    });
    const searchconsole = google.searchconsole({ version: "v1", auth });
    const end = options?.endDate || new Date().toISOString().slice(0, 10);
    const start =
      options?.startDate ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const response = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions: ["page"],
        rowLimit: 250,
      },
    });

    const week = `${start}_${end}`;
    return (response.data.rows || []).map((row) => ({
      page: row.keys?.[0] || "",
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
      week,
    }));
  } catch (error) {
    console.warn("[GSC] API fetch failed:", error);
    return [];
  }
}

/** Detect CTR decay or ranking loss vs prior stored weeks. */
export function evaluateGscAlerts(
  current: GscPageMetric[],
  history: MetricsHistory
): GscAlert[] {
  const alerts: GscAlert[] = [];
  const now = new Date().toISOString();

  for (const row of current) {
    if (!row.page) continue;
    const prior = history[row.page] || [];
    if (prior.length < 2) continue;

    const baseline = prior.slice(-4);
    const avgCtr = baseline.reduce((s, m) => s + m.ctr, 0) / baseline.length;
    const avgPos = baseline.reduce((s, m) => s + m.position, 0) / baseline.length;

    if (avgCtr > 0 && row.ctr < avgCtr * 0.8) {
      alerts.push({
        page: row.page,
        reason: "ctr_drop",
        ctrDropPct: Math.round((1 - row.ctr / avgCtr) * 100),
        detectedAt: now,
      });
    }

    if (avgPos <= 10 && row.position > 10) {
      alerts.push({
        page: row.page,
        reason: "ranking_loss",
        position: row.position,
        detectedAt: now,
      });
    }
  }

  return alerts;
}

export async function runGscMonitor(): Promise<{
  metrics: number;
  alerts: number;
  rewriteQueue: number;
}> {
  const current = await fetchGscPageMetrics();
  const history = readJson<MetricsHistory>(gscMetricsPath, {});

  for (const row of current) {
    if (!row.page) continue;
    history[row.page] = [...(history[row.page] || []), row].slice(-12);
  }

  writeFileSync(gscMetricsPath, JSON.stringify(history, null, 2), "utf8");

  const alerts = evaluateGscAlerts(current, history);
  const existingAlerts = readJson<GscAlert[]>(gscAlertsPath, []);
  const mergedAlerts = [...alerts, ...existingAlerts].slice(0, 200);
  writeFileSync(gscAlertsPath, JSON.stringify(mergedAlerts, null, 2), "utf8");

  const rewriteQueue = readJson<unknown[]>(rewriteQueuePath, []);
  const rewritePages = new Set(
    rewriteQueue.map((r) => (r as { pageUrl?: string }).pageUrl).filter(Boolean)
  );

  for (const alert of alerts) {
    if (!rewritePages.has(alert.page)) {
      rewriteQueue.unshift({
        pageUrl: alert.page,
        keyword: "",
        reason: alert.reason,
        detectedAt: alert.detectedAt,
        source: "gsc-monitor",
      });
      rewritePages.add(alert.page);
    }
  }

  writeFileSync(rewriteQueuePath, JSON.stringify(rewriteQueue.slice(0, 500), null, 2), "utf8");

  return { metrics: current.length, alerts: alerts.length, rewriteQueue: rewriteQueue.length };
}
