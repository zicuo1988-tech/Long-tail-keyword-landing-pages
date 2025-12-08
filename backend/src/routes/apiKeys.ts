import { Router } from "express";
import { getApiKeyManager } from "../services/apiKeyManager.js";
import { getRateLimiter } from "../services/rateLimiter.js";
import { getRequestQueue } from "../services/requestQueue.js";

export const apiKeysRouter = Router();

/**
 * GET /api/api-keys/status
 * 获取所有 API Keys 的状态信息
 */
apiKeysRouter.get("/api-keys/status", (_req, res) => {
  try {
    const manager = getApiKeyManager();
    const statuses = manager.getKeyStatuses();
    const availableCount = manager.getAvailableKeyCount();
    const totalCount = manager.getAllKeys().length;
    const quotaLimitedCount = manager.getQuotaLimitedKeyCount();
    const failedCount = manager.getAllKeys().length - availableCount - quotaLimitedCount;

    res.json({
      success: true,
      summary: {
        total: totalCount,
        available: availableCount,
        quotaLimited: quotaLimitedCount,
        failed: failedCount,
      },
      keys: statuses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/api-keys/reset-quota
 * 清除所有配额限制标记（重置所有 Key 到可用状态）
 */
apiKeysRouter.post("/api-keys/reset-quota", (_req, res) => {
  try {
    const manager = getApiKeyManager();
    manager.clearAllQuotaLimits();
    manager.resetFailedKeys();
    
    res.json({
      success: true,
      message: "已清除所有配额限制和失败标记，所有 API Keys 已重置为可用状态",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/api-keys/reset-all
 * 重置所有状态（清除所有失败和配额限制记录）
 */
apiKeysRouter.post("/api/api-keys/reset-all", (_req, res) => {
  try {
    const manager = getApiKeyManager();
    manager.resetAllStates();
    
    res.json({
      success: true,
      message: "已重置所有 API Keys 状态",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/api-keys/rate-limit-stats
 * 获取频率限制统计信息
 */
apiKeysRouter.get("/api/api-keys/rate-limit-stats", (_req, res) => {
  try {
    const rateLimiter = getRateLimiter();
    const stats = rateLimiter.getAllStats();
    
    res.json({
      success: true,
      stats,
      config: {
        minRequestIntervalMs: 2000,
        maxRequestsPerMinute: 15,
        maxRequestsPerHour: 500,
        windowSizeMs: 60000,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/api-keys/reset-rate-limit
 * 重置频率限制记录
 */
apiKeysRouter.post("/api/api-keys/reset-rate-limit", (_req, res) => {
  try {
    const rateLimiter = getRateLimiter();
    rateLimiter.clearAll();
    
    res.json({
      success: true,
      message: "已清除所有频率限制记录",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/api-keys/queue-status
 * 获取请求队列状态
 */
apiKeysRouter.get("/api/api-keys/queue-status", (req, res) => {
  try {
    const requestQueue = getRequestQueue();
    const key = req.query.key as string | undefined;
    const statuses = requestQueue.getQueueStatus(key);
    const totalLength = requestQueue.getTotalQueueLength();
    
    res.json({
      success: true,
      totalQueueLength: totalLength,
      queues: statuses,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/api-keys/clear-queue
 * 清空请求队列
 */
apiKeysRouter.post("/api/api-keys/clear-queue", (req, res) => {
  try {
    const requestQueue = getRequestQueue();
    const key = req.body.key as string | undefined;
    
    let count: number;
    if (key) {
      count = requestQueue.clearQueue(key);
      res.json({
        success: true,
        message: `已清空 Key ${key.substring(0, 20)}... 的队列（${count} 个请求）`,
        clearedCount: count,
      });
    } else {
      count = requestQueue.clearAllQueues();
      res.json({
        success: true,
        message: `已清空所有队列（${count} 个请求）`,
        clearedCount: count,
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

