/**
 * API 请求频率限制器
 * 防止因请求频率过高导致配额限制
 */

interface KeyUsageRecord {
  lastRequestTime: number; // 最后一次请求的时间戳
  requestCount: number; // 当前时间窗口内的请求数
  windowStartTime: number; // 当前时间窗口的开始时间
}

class RateLimiter {
  private keyUsageMap = new Map<string, KeyUsageRecord>();
  
  // 配置参数（保守设置，避免触发配额限制）
  private readonly MIN_REQUEST_INTERVAL_MS = 3000; // 最小请求间隔：3秒（更保守）
  private readonly MAX_REQUESTS_PER_MINUTE = 10; // 每分钟最多10个请求（保守估计，避免配额限制）
  private readonly MAX_REQUESTS_PER_HOUR = 300; // 每小时最多300个请求（保守估计）
  private readonly WINDOW_SIZE_MS = 60000; // 时间窗口：60秒

  /**
   * 检查是否可以发送请求，如果可以，记录请求
   * @param key API Key
   * @returns 如果可以立即发送，返回 true；如果需要等待，返回 false 并返回需要等待的毫秒数
   */
  canMakeRequest(key: string): { allowed: boolean; waitMs?: number } {
    const now = Date.now();
    const record = this.keyUsageMap.get(key);

    if (!record) {
      // 第一次使用这个 Key，允许立即请求
      this.keyUsageMap.set(key, {
        lastRequestTime: now,
        requestCount: 1,
        windowStartTime: now,
      });
      return { allowed: true };
    }

    // 检查是否超过时间窗口，如果是，重置计数
    const timeSinceWindowStart = now - record.windowStartTime;
    if (timeSinceWindowStart >= this.WINDOW_SIZE_MS) {
      // 重置时间窗口
      record.windowStartTime = now;
      record.requestCount = 1;
      record.lastRequestTime = now;
      return { allowed: true };
    }

    // 检查最小请求间隔
    const timeSinceLastRequest = now - record.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      const waitMs = this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
      return { allowed: false, waitMs };
    }

    // 检查每分钟请求数限制
    if (record.requestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      // 需要等待到下一个时间窗口
      const waitMs = this.WINDOW_SIZE_MS - timeSinceWindowStart;
      return { allowed: false, waitMs };
    }

    // 允许请求，更新记录
    record.lastRequestTime = now;
    record.requestCount++;
    return { allowed: true };
  }

  /**
   * 记录请求完成（用于统计和监控）
   */
  recordRequest(key: string): void {
    const now = Date.now();
    const record = this.keyUsageMap.get(key);
    
    if (record) {
      record.lastRequestTime = now;
    }
  }

  /**
   * 获取 Key 的使用统计
   */
  getKeyStats(key: string): { requestCount: number; timeSinceLastRequest: number } | null {
    const record = this.keyUsageMap.get(key);
    if (!record) {
      return null;
    }

    const now = Date.now();
    const timeSinceWindowStart = now - record.windowStartTime;
    
    // 如果超过时间窗口，重置计数
    if (timeSinceWindowStart >= this.WINDOW_SIZE_MS) {
      return { requestCount: 0, timeSinceLastRequest: now - record.lastRequestTime };
    }

    return {
      requestCount: record.requestCount,
      timeSinceLastRequest: now - record.lastRequestTime,
    };
  }

  /**
   * 清除 Key 的使用记录（用于重置）
   */
  clearKey(key: string): void {
    this.keyUsageMap.delete(key);
  }

  /**
   * 清除所有记录
   */
  clearAll(): void {
    this.keyUsageMap.clear();
  }

  /**
   * 获取所有 Key 的统计信息
   */
  getAllStats(): Array<{ key: string; stats: { requestCount: number; timeSinceLastRequest: number } }> {
    const stats: Array<{ key: string; stats: { requestCount: number; timeSinceLastRequest: number } }> = [];
    
    for (const [key, record] of this.keyUsageMap.entries()) {
      const now = Date.now();
      const timeSinceWindowStart = now - record.windowStartTime;
      
      let requestCount = record.requestCount;
      if (timeSinceWindowStart >= this.WINDOW_SIZE_MS) {
        requestCount = 0;
      }

      stats.push({
        key: key.substring(0, 20) + "...",
        stats: {
          requestCount,
          timeSinceLastRequest: now - record.lastRequestTime,
        },
      });
    }
    
    return stats;
  }
}

// 全局频率限制器实例
let globalRateLimiter: RateLimiter | null = null;

/**
 * 获取全局频率限制器实例
 */
export function getRateLimiter(): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter();
  }
  return globalRateLimiter;
}

/**
 * 等待直到可以发送请求
 * @param key API Key
 * @param onWaitUpdate 等待状态更新回调
 */
export async function waitForRateLimit(
  key: string,
  onWaitUpdate?: (message: string) => void
): Promise<void> {
  const limiter = getRateLimiter();
  let checkCount = 0;
  const maxChecks = 100; // 最多检查100次（防止无限循环）

  while (checkCount < maxChecks) {
    const result = limiter.canMakeRequest(key);
    
    if (result.allowed) {
      // 可以立即发送请求
      return;
    }

    // 需要等待
    const waitMs = result.waitMs || 1000;
    const waitSeconds = Math.ceil(waitMs / 1000);
    
    if (onWaitUpdate) {
      onWaitUpdate(`请求频率限制：等待 ${waitSeconds} 秒后继续（防止配额限制）...`);
    }
    
    console.log(`[RateLimiter] ⏳ Key ${key.substring(0, 20)}... 需要等待 ${waitSeconds} 秒（防止配额限制）`);
    
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    checkCount++;
  }

  throw new Error("Rate limit check timeout");
}

