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
  private modelUsageMap = new Map<string, KeyUsageRecord>(); // 按模型+Key组合记录使用情况
  
  // 配置参数（根据模型类型动态调整）
  // Flash模型通常有更高的配额，可以使用更宽松的限制
  // Pro模型配额较低，需要更严格的控制
  
  // Pro模型（高质量模型）的限流参数（更严格）
  private readonly PRO_MIN_REQUEST_INTERVAL_MS = 8000; // 最小请求间隔：8秒
  private readonly PRO_MAX_REQUESTS_PER_MINUTE = 3;    // 每分钟最多3个请求
  private readonly PRO_MAX_REQUESTS_PER_HOUR = 100;    // 每小时最多100个请求
  
  // Flash模型（快速模型）的限流参数（更宽松，配额更高）
  private readonly FLASH_MIN_REQUEST_INTERVAL_MS = 5000; // 最小请求间隔：5秒
  private readonly FLASH_MAX_REQUESTS_PER_MINUTE = 6;    // 每分钟最多6个请求
  private readonly FLASH_MAX_REQUESTS_PER_HOUR = 200;    // 每小时最多200个请求
  
  // 通用参数
  private readonly WINDOW_SIZE_MS = 60000; // 时间窗口：60秒
  private readonly HOUR_WINDOW_SIZE_MS = 3600000; // 小时时间窗口：3600秒
  
  /**
   * 根据模型类型获取限流参数
   */
  private getRateLimitParams(modelName?: string) {
    // 确保 modelName 是字符串类型才调用 includes
    const isFlashModel = (typeof modelName === "string" && modelName.includes("flash")) || false;
    return {
      minInterval: isFlashModel ? this.FLASH_MIN_REQUEST_INTERVAL_MS : this.PRO_MIN_REQUEST_INTERVAL_MS,
      maxPerMinute: isFlashModel ? this.FLASH_MAX_REQUESTS_PER_MINUTE : this.PRO_MAX_REQUESTS_PER_MINUTE,
      maxPerHour: isFlashModel ? this.FLASH_MAX_REQUESTS_PER_HOUR : this.PRO_MAX_REQUESTS_PER_HOUR,
    };
  }

  /**
   * 检查是否可以发送请求，如果可以，记录请求
   * @param key API Key
   * @param modelName 模型名称（可选，用于根据模型类型调整限流参数）
   * @returns 如果可以立即发送，返回 true；如果需要等待，返回 false 并返回需要等待的毫秒数
   */
  canMakeRequest(key: string, modelName?: string): { allowed: boolean; waitMs?: number; reason?: string } {
    const now = Date.now();
    
    // 使用模型+Key组合作为唯一标识（不同模型可能有不同的配额）
    const recordKey = modelName ? `${key}:${modelName}` : key;
    const record = this.modelUsageMap.get(recordKey) || this.keyUsageMap.get(key);
    
    // 获取该模型的限流参数
    const params = this.getRateLimitParams(modelName);

    if (!record) {
      // 第一次使用这个 Key+模型组合，允许立即请求
      const newRecord = {
        lastRequestTime: now,
        requestCount: 1,
        windowStartTime: now,
        hourlyRequestCount: 1,
        hourlyWindowStartTime: now,
      };
      if (modelName) {
        this.modelUsageMap.set(recordKey, newRecord);
      } else {
        this.keyUsageMap.set(key, newRecord);
      }
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
    if (record.hourlyRequestCount >= params.maxPerHour) {
      // 需要等待到下一个小时窗口
      const waitMs = this.HOUR_WINDOW_SIZE_MS - timeSinceHourlyWindowStart;
      const waitMinutes = Math.ceil(waitMs / 60000);
      return { 
        allowed: false, 
        waitMs,
        reason: `每小时请求数已达上限（${params.maxPerHour}），需等待 ${waitMinutes} 分钟`
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
    if (timeSinceLastRequest < params.minInterval) {
      const waitMs = params.minInterval - timeSinceLastRequest;
      return { 
        allowed: false, 
        waitMs,
        reason: `请求间隔不足（需等待 ${Math.ceil(waitMs / 1000)} 秒）`
      };
    }

    // 检查每分钟请求数限制
    if (record.requestCount >= params.maxPerMinute) {
      // 需要等待到下一个时间窗口
      const waitMs = this.WINDOW_SIZE_MS - timeSinceWindowStart;
      return { 
        allowed: false, 
        waitMs,
        reason: `每分钟请求数已达上限（${params.maxPerMinute}），需等待 ${Math.ceil(waitMs / 1000)} 秒`
      };
    }

    // 允许请求，更新记录
    record.lastRequestTime = now;
    record.requestCount++;
    record.hourlyRequestCount++;
    
    // 更新到对应的Map中
    if (modelName) {
      this.modelUsageMap.set(recordKey, record);
    } else {
      this.keyUsageMap.set(key, record);
    }
    
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

      // 使用默认的Pro模型参数计算使用率（保守估计）
      const maxPerHour = this.PRO_MAX_REQUESTS_PER_HOUR;
      const hourlyUsagePercent = (hourlyRequestCount / maxPerHour) * 100;

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
 * @param modelName 模型名称（可选，用于根据模型类型调整限流参数）
 * @param onWaitUpdate 等待状态更新回调
 * @param shouldAbort 可选的检查是否应该中止的回调（用于暂停功能）
 */
export async function waitForRateLimit(
  key: string,
  modelName?: string,
  onWaitUpdate?: (message: string) => void,
  shouldAbort?: () => boolean
): Promise<void> {
  const limiter = getRateLimiter();
  let checkCount = 0;
  const maxChecks = 100; // 最多检查100次（防止无限循环）

  while (checkCount < maxChecks) {
    // 检查是否应该中止（暂停）
    if (shouldAbort && shouldAbort()) {
      throw new Error("任务已暂停");
    }
    
    const result = limiter.canMakeRequest(key, modelName);
    
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
    
    // 分段等待，每500ms检查一次暂停状态
    const checkInterval = 500;
    let remainingMs = waitMs;
    while (remainingMs > 0) {
      if (shouldAbort && shouldAbort()) {
        throw new Error("任务已暂停");
      }
      const waitTime = Math.min(checkInterval, remainingMs);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      remainingMs -= waitTime;
    }
    
    checkCount++;
  }

  throw new Error("Rate limit check timeout");
}

