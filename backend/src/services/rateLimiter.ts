/**
 * API 请求频率限制器
 * 防止因请求频率过高导致配额限制
 */

interface KeyUsageRecord {
  lastRequestTime: number; // 最后一次请求的时间戳
  requestCount: number; // 当前时间窗口内的请求数
  windowStartTime: number; // 当前时间窗口的开始时间
  hourlyRequestCount: number; // 当前小时内的请求数
  hourlyWindowStartTime: number; // 当前小时窗口的开始时间
}

class RateLimiter {
  private keyUsageMap = new Map<string, KeyUsageRecord>();
  
  // 配置参数（非常保守的设置，避免触发配额限制）
  private readonly MIN_REQUEST_INTERVAL_MS = 5000; // 最小请求间隔：5秒（更保守，避免配额限制）
  private readonly MAX_REQUESTS_PER_MINUTE = 6; // 每分钟最多6个请求（非常保守，避免配额限制）
  private readonly MAX_REQUESTS_PER_HOUR = 200; // 每小时最多200个请求（非常保守，避免配额限制）
  private readonly WINDOW_SIZE_MS = 60000; // 时间窗口：60秒
  private readonly HOUR_WINDOW_SIZE_MS = 3600000; // 小时时间窗口：3600秒

  /**
   * 检查是否可以发送请求，如果可以，记录请求
   * @param key API Key
   * @returns 如果可以立即发送，返回 true；如果需要等待，返回 false 并返回需要等待的毫秒数
   */
  canMakeRequest(key: string): { allowed: boolean; waitMs?: number; reason?: string } {
    const now = Date.now();
    const record = this.keyUsageMap.get(key);

    if (!record) {
      // 第一次使用这个 Key，允许立即请求
      this.keyUsageMap.set(key, {
        lastRequestTime: now,
        requestCount: 1,
        windowStartTime: now,
        hourlyRequestCount: 1,
        hourlyWindowStartTime: now,
      });
      return { allowed: true };
    }

    // 检查是否超过小时时间窗口，如果是，重置小时计数
    const timeSinceHourlyWindowStart = now - record.hourlyWindowStartTime;
    if (timeSinceHourlyWindowStart >= this.HOUR_WINDOW_SIZE_MS) {
      // 重置小时时间窗口
      record.hourlyWindowStartTime = now;
      record.hourlyRequestCount = 0;
    }

    // 检查每小时请求数限制（优先检查，更严格）
    if (record.hourlyRequestCount >= this.MAX_REQUESTS_PER_HOUR) {
      // 需要等待到下一个小时窗口
      const waitMs = this.HOUR_WINDOW_SIZE_MS - timeSinceHourlyWindowStart;
      const waitMinutes = Math.ceil(waitMs / 60000);
      return { 
        allowed: false, 
        waitMs,
        reason: `每小时请求数已达上限（${this.MAX_REQUESTS_PER_HOUR}），需等待 ${waitMinutes} 分钟`
      };
    }

    // 检查是否超过分钟时间窗口，如果是，重置分钟计数
    const timeSinceWindowStart = now - record.windowStartTime;
    if (timeSinceWindowStart >= this.WINDOW_SIZE_MS) {
      // 重置分钟时间窗口
      record.windowStartTime = now;
      record.requestCount = 0;
    }

    // 检查最小请求间隔（最优先检查）
    const timeSinceLastRequest = now - record.lastRequestTime;
    if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL_MS) {
      const waitMs = this.MIN_REQUEST_INTERVAL_MS - timeSinceLastRequest;
      return { 
        allowed: false, 
        waitMs,
        reason: `请求间隔不足（需等待 ${Math.ceil(waitMs / 1000)} 秒）`
      };
    }

    // 检查每分钟请求数限制
    if (record.requestCount >= this.MAX_REQUESTS_PER_MINUTE) {
      // 需要等待到下一个时间窗口
      const waitMs = this.WINDOW_SIZE_MS - timeSinceWindowStart;
      return { 
        allowed: false, 
        waitMs,
        reason: `每分钟请求数已达上限（${this.MAX_REQUESTS_PER_MINUTE}），需等待 ${Math.ceil(waitMs / 1000)} 秒`
      };
    }

    // 允许请求，更新记录
    record.lastRequestTime = now;
    record.requestCount++;
    record.hourlyRequestCount++;
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
      // 注意：requestCount 和 hourlyRequestCount 已在 canMakeRequest 中更新
    }
  }

  /**
   * 获取 Key 的使用统计
   */
  getKeyStats(key: string): { 
    requestCount: number; 
    hourlyRequestCount: number;
    timeSinceLastRequest: number;
    hourlyUsagePercent: number;
  } | null {
    const record = this.keyUsageMap.get(key);
    if (!record) {
      return null;
    }

    const now = Date.now();
    const timeSinceWindowStart = now - record.windowStartTime;
    const timeSinceHourlyWindowStart = now - record.hourlyWindowStartTime;
    
    let requestCount = record.requestCount;
    let hourlyRequestCount = record.hourlyRequestCount;
    
    // 如果超过时间窗口，重置计数
    if (timeSinceWindowStart >= this.WINDOW_SIZE_MS) {
      requestCount = 0;
    }
    
    if (timeSinceHourlyWindowStart >= this.HOUR_WINDOW_SIZE_MS) {
      hourlyRequestCount = 0;
    }

    const hourlyUsagePercent = (hourlyRequestCount / this.MAX_REQUESTS_PER_HOUR) * 100;

    return {
      requestCount,
      hourlyRequestCount,
      timeSinceLastRequest: now - record.lastRequestTime,
      hourlyUsagePercent: Math.round(hourlyUsagePercent * 100) / 100,
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
  getAllStats(): Array<{ 
    key: string; 
    stats: { 
      requestCount: number; 
      hourlyRequestCount: number;
      timeSinceLastRequest: number;
      hourlyUsagePercent: number;
    } 
  }> {
    const stats: Array<{ 
      key: string; 
      stats: { 
        requestCount: number; 
        hourlyRequestCount: number;
        timeSinceLastRequest: number;
        hourlyUsagePercent: number;
      } 
    }> = [];
    
    for (const [key, record] of this.keyUsageMap.entries()) {
      const now = Date.now();
      const timeSinceWindowStart = now - record.windowStartTime;
      const timeSinceHourlyWindowStart = now - record.hourlyWindowStartTime;
      
      let requestCount = record.requestCount;
      let hourlyRequestCount = record.hourlyRequestCount;
      
      if (timeSinceWindowStart >= this.WINDOW_SIZE_MS) {
        requestCount = 0;
      }
      
      if (timeSinceHourlyWindowStart >= this.HOUR_WINDOW_SIZE_MS) {
        hourlyRequestCount = 0;
      }

      const hourlyUsagePercent = (hourlyRequestCount / this.MAX_REQUESTS_PER_HOUR) * 100;

      stats.push({
        key: key.substring(0, 20) + "...",
        stats: {
          requestCount,
          hourlyRequestCount,
          timeSinceLastRequest: now - record.lastRequestTime,
          hourlyUsagePercent: Math.round(hourlyUsagePercent * 100) / 100,
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
    const reason = result.reason || "请求频率限制";
    
    if (onWaitUpdate) {
      onWaitUpdate(`${reason}，等待 ${waitSeconds} 秒后继续（防止配额限制）...`);
    }
    
    console.log(`[RateLimiter] ⏳ Key ${key.substring(0, 20)}... ${reason}，需要等待 ${waitSeconds} 秒（防止配额限制）`);
    
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    checkCount++;
  }

  throw new Error("Rate limit check timeout");
}

