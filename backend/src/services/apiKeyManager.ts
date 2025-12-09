interface QuotaLimitInfo {
  timestamp: number; // 配额限制的时间戳
  date: string; // 配额限制的日期（YYYY-MM-DD格式）
  expiresAt: number; // 配额限制的过期时间戳（根据API返回的retryDelaySeconds计算）
}

class ApiKeyManager {
  private keys: string[] = [];
  private currentIndex = 0;
  private failedKeys = new Set<string>(); // 临时失败的 Key（可以重试）
  private permanentlyFailedKeys = new Set<string>(); // 永久失败的 Key（如泄露的 Key，不再使用）
  private quotaLimitedKeys = new Map<string, QuotaLimitInfo>(); // 记录配额限制的 Key 和时间
  private priorityKey: string | null = null; // 优先使用的 API Key

  constructor(keys: string[]) {
    // 验证并过滤 API Keys
    this.keys = keys
      .filter((key) => key?.trim())
      .map((key) => key.trim())
      .filter((key) => {
        // 验证 API Key 格式（Google API Key 通常以 AIza 开头，长度约 39 字符）
        if (!this.isValidApiKeyFormat(key)) {
          console.warn(`[ApiKeyManager] ⚠️  跳过无效的 API Key 格式: ${key.substring(0, 10)}...`);
          return false;
        }
        return true;
      });
    
    if (this.keys.length === 0) {
      throw new Error("At least one valid API key is required");
    }
    
    // 设置优先 Key（从环境变量读取，避免硬编码）
    const priorityKeyValue = process.env.GOOGLE_API_PRIORITY_KEY?.trim();
    if (priorityKeyValue && this.isValidApiKeyFormat(priorityKeyValue) && this.keys.includes(priorityKeyValue)) {
      this.priorityKey = priorityKeyValue;
      // 将优先 Key 移到数组开头
      const priorityIndex = this.keys.indexOf(priorityKeyValue);
      if (priorityIndex > 0) {
        this.keys.splice(priorityIndex, 1);
        this.keys.unshift(priorityKeyValue);
      }
      console.log(`[ApiKeyManager] ✅ 已设置优先 Key: ${this.maskApiKey(priorityKeyValue)}`);
    } else if (priorityKeyValue) {
      console.warn(`[ApiKeyManager] ⚠️  环境变量 GOOGLE_API_PRIORITY_KEY 指定的 Key 不在可用 Key 列表中`);
    }
  }

  /**
   * 验证 API Key 格式
   * Google API Key 通常以 AIza 开头，长度约 39 字符
   */
  private isValidApiKeyFormat(key: string): boolean {
    if (!key || key.length < 30 || key.length > 100) {
      return false;
    }
    // Google API Key 通常以 AIza 开头
    if (!key.startsWith("AIza")) {
      return false;
    }
    // 检查是否包含非法字符（只允许字母、数字、下划线、连字符）
    if (!/^[A-Za-z0-9_-]+$/.test(key)) {
      return false;
    }
    return true;
  }

  /**
   * 掩码 API Key（只显示前10个字符和后4个字符，中间用...代替）
   * 用于日志输出，防止泄露
   */
  maskApiKey(key: string): string {
    if (!key || key.length <= 14) {
      return "***";
    }
    return `${key.substring(0, 10)}...${key.substring(key.length - 4)}`;
  }

  /**
   * 检查配额限制是否已过期（根据API返回的retryDelaySeconds或默认的第二天）
   */
  isQuotaLimitExpired(key: string): boolean {
    const quotaInfo = this.quotaLimitedKeys.get(key);
    if (!quotaInfo) {
      return true; // 没有配额限制记录，视为可用
    }

    // 使用 expiresAt 时间戳来判断是否过期
    const now = Date.now();
    return now >= quotaInfo.expiresAt;
  }

  /**
   * 获取配额限制的剩余时间（秒）
   */
  getQuotaLimitRemainingSeconds(key: string): number {
    const quotaInfo = this.quotaLimitedKeys.get(key);
    if (!quotaInfo) {
      return 0;
    }

    const now = Date.now();
    const remaining = Math.max(0, quotaInfo.expiresAt - now);
    return Math.ceil(remaining / 1000); // 转换为秒
  }

  /**
   * 获取下一个可用的 API Key（轮换策略）
   * 自动跳过配额限制的 Key（直到第二天）
   */
  getNextKey(): string {
    if (this.keys.length === 0) {
      throw new Error("No API keys available");
    }

    // 清理过期的配额限制记录
    for (const [key, quotaInfo] of this.quotaLimitedKeys.entries()) {
      if (this.isQuotaLimitExpired(key)) {
        this.quotaLimitedKeys.delete(key);
        console.log(`[ApiKeyManager] 配额限制已过期，Key ${this.maskApiKey(key)} 可以重新使用`);
      }
    }

    // 如果所有 Key 都失败了或配额受限，检查是否可以重置
    const availableKeys = this.keys.filter(key => 
      !this.failedKeys.has(key) && 
      !this.permanentlyFailedKeys.has(key) && 
      this.isQuotaLimitExpired(key)
    );

      if (availableKeys.length === 0) {
      // 检查是否有配额限制的 Key
      const quotaLimitedCount = Array.from(this.quotaLimitedKeys.keys()).length;
      if (quotaLimitedCount > 0) {
        const firstQuotaKey = Array.from(this.quotaLimitedKeys.keys())[0];
        const remainingSeconds = this.getQuotaLimitRemainingSeconds(firstQuotaKey);
        const remainingMinutes = Math.ceil(remainingSeconds / 60);
        const remainingHours = Math.ceil(remainingSeconds / 3600);
        
        // 根据剩余时间判断是否跨天
        const quotaInfo = this.quotaLimitedKeys.get(firstQuotaKey);
        const expiresAtDate = quotaInfo ? new Date(quotaInfo.expiresAt) : null;
        const isTomorrow = expiresAtDate && expiresAtDate.getDate() !== new Date().getDate();
        const timeHint = isTomorrow ? "（明天）" : "";
        
        throw new Error(
          `所有 API Key 都遇到配额限制。最早可用的 Key 将在 ${remainingHours} 小时 ${remainingMinutes % 60} 分钟后${timeHint}恢复使用。`
        );
      }

      // 如果所有 Key 都失败了（非配额限制），重置失败记录
      console.warn("[ApiKeyManager] All keys failed, resetting failed keys set");
      this.failedKeys.clear();
    }

    // 优先使用优先 Key（如果可用）
    if (this.priorityKey && 
        !this.failedKeys.has(this.priorityKey) && 
        !this.permanentlyFailedKeys.has(this.priorityKey) && 
        this.isQuotaLimitExpired(this.priorityKey)) {
      console.log(`[ApiKeyManager] 🎯 使用优先 Key: ${this.maskApiKey(this.priorityKey)}`);
      return this.priorityKey;
    }

    // 如果优先 Key 不可用，记录原因
    if (this.priorityKey) {
      if (this.failedKeys.has(this.priorityKey)) {
        console.log(`[ApiKeyManager] ⚠️  优先 Key 已失败，使用其他 Key`);
      } else if (!this.isQuotaLimitExpired(this.priorityKey)) {
        const remainingSeconds = this.getQuotaLimitRemainingSeconds(this.priorityKey);
        const remainingHours = Math.ceil(remainingSeconds / 3600);
        console.log(`[ApiKeyManager] ⚠️  优先 Key 配额受限（剩余 ${remainingHours} 小时），使用其他 Key`);
      }
    }

    // 找到下一个未失败且未配额限制的 Key
    let attempts = 0;
    while (attempts < this.keys.length * 2) { // 增加尝试次数，因为可能跳过配额限制的 Key
      const key = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;

      // 跳过优先 Key（已经在上面检查过了）
      if (key === this.priorityKey) {
        attempts++;
        continue;
      }

      // 跳过永久失败的 Key
      if (this.permanentlyFailedKeys.has(key)) {
        attempts++;
        continue;
      }

      // 检查 Key 是否可用（未失败、未永久失败且配额限制已过期）
      if (!this.failedKeys.has(key) && 
          !this.permanentlyFailedKeys.has(key) && 
          this.isQuotaLimitExpired(key)) {
        return key;
      }

      // 如果 Key 配额受限，记录信息
      if (this.quotaLimitedKeys.has(key) && !this.isQuotaLimitExpired(key)) {
        const remainingSeconds = this.getQuotaLimitRemainingSeconds(key);
        const remainingHours = Math.ceil(remainingSeconds / 3600);
        console.log(`[ApiKeyManager] 跳过配额受限的 Key ${this.maskApiKey(key)} (剩余 ${remainingHours} 小时)`);
      }

      attempts++;
    }

    // 如果所有 Key 都不可用，返回第一个（已重置失败记录）
    return this.keys[0];
  }
  
  /**
   * 获取优先 Key（用于模型选择）
   */
  getPriorityKey(): string | null {
    return this.priorityKey;
  }
  
  /**
   * 检查指定的 Key 是否为优先 Key
   */
  isPriorityKey(key: string): boolean {
    return this.priorityKey === key;
  }

  /**
   * 标记某个 Key 为失败（临时失败，可以重试）
   */
  markAsFailed(key: string) {
    this.failedKeys.add(key);
    console.warn(`[ApiKeyManager] Marked key as failed (temporary): ${this.maskApiKey(key)}`);
  }

  /**
   * 标记某个 Key 为永久失败（如泄露的 Key，不再使用）
   */
  markAsPermanentlyFailed(key: string, reason: string = "永久失败") {
    this.permanentlyFailedKeys.add(key);
    // 同时从临时失败列表中移除（如果存在）
    this.failedKeys.delete(key);
    // 从配额限制列表中移除（如果存在）
    this.quotaLimitedKeys.delete(key);
    console.error(`[ApiKeyManager] ⛔ Key ${this.maskApiKey(key)} 已标记为永久失败: ${reason}`);
    console.error(`[ApiKeyManager] ⛔ 该 Key 将不再使用，请更换新的 API Key`);
  }

  /**
   * 检查 Key 是否永久失败
   */
  isPermanentlyFailed(key: string): boolean {
    return this.permanentlyFailedKeys.has(key);
  }

  /**
   * 标记某个 Key 为配额限制（429错误）
   * 根据API返回的retryDelaySeconds设置过期时间，如果没有提供则默认到第二天
   * 
   * @param key API Key
   * @param isConfirmedQuotaLimit 是否确认是配额限制
   * @param retryDelaySeconds API返回的重试延迟时间（秒），如果提供则使用此时间设置过期
   */
  markAsQuotaLimited(key: string, isConfirmedQuotaLimit: boolean = true, retryDelaySeconds?: number) {
    if (!isConfirmedQuotaLimit) {
      // 如果不是确认的配额限制，只标记为失败，不标记为配额限制
      this.markAsFailed(key);
      return;
    }

    const now = Date.now();
    const date = new Date(now);
    const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    
    // 计算过期时间：如果提供了retryDelaySeconds，则使用它；否则默认到第二天00:00:00
    let expiresAt: number;
    if (retryDelaySeconds && retryDelaySeconds > 0) {
      // 根据API返回的retryDelaySeconds设置过期时间
      expiresAt = now + (retryDelaySeconds * 1000);
      console.log(`[ApiKeyManager] 📌 根据API返回的retryDelay=${retryDelaySeconds}s，设置过期时间为 ${new Date(expiresAt).toLocaleString()}`);
    } else {
      // 默认策略：到第二天00:00:00
      const tomorrow = new Date(date);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      expiresAt = tomorrow.getTime();
      console.log(`[ApiKeyManager] 📌 未提供retryDelay，使用默认策略：到明天00:00:00`);
    }
    
    this.quotaLimitedKeys.set(key, {
      timestamp: now,
      date: dateString,
      expiresAt: expiresAt,
    });

    // 同时从失败列表中移除（配额限制不是永久失败）
    this.failedKeys.delete(key);

    const remainingMs = expiresAt - now;
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const remainingHours = Math.ceil(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.ceil((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    if (retryDelaySeconds && retryDelaySeconds > 0) {
      console.warn(`[ApiKeyManager] ⚠️  Key ${this.maskApiKey(key)} 遇到配额限制 (429)，根据API返回的retryDelay，将在 ${remainingHours} 小时 ${remainingMinutes} 分钟后（${new Date(expiresAt).toLocaleString()}）重新启用`);
    } else {
      console.warn(`[ApiKeyManager] ⚠️  Key ${this.maskApiKey(key)} 遇到配额限制 (429)，将在 ${remainingHours} 小时后（明天）重新启用`);
    }
  }

  /**
   * 清除某个 Key 的配额限制（手动重置）
   * 用于恢复被误判为配额限制的 Key
   */
  clearQuotaLimit(key: string) {
    if (this.quotaLimitedKeys.has(key)) {
      this.quotaLimitedKeys.delete(key);
      console.log(`[ApiKeyManager] ✅ 已清除 Key ${this.maskApiKey(key)} 的配额限制标记`);
    }
  }

  /**
   * 清除所有配额限制（手动重置）
   */
  clearAllQuotaLimits() {
    const count = this.quotaLimitedKeys.size;
    this.quotaLimitedKeys.clear();
    console.log(`[ApiKeyManager] ✅ 已清除所有配额限制标记（${count} 个 Key）`);
  }

  /**
   * 获取所有 Key 的状态信息（用于诊断）
   */
  getKeyStatuses(): Array<{ key: string; status: string; details?: string }> {
    const statuses: Array<{ key: string; status: string; details?: string }> = [];
    
    for (const key of this.keys) {
      const keyPreview = this.maskApiKey(key);
      let status = "可用";
      let details: string | undefined;
      
      if (this.permanentlyFailedKeys.has(key)) {
        status = "永久失败";
        details = "API Key 已泄露或永久失效，请更换新的 API Key";
      } else if (this.failedKeys.has(key)) {
        status = "失败";
        details = "临时失败，会重试";
      } else if (this.quotaLimitedKeys.has(key) && !this.isQuotaLimitExpired(key)) {
        status = "配额限制";
        const remainingSeconds = this.getQuotaLimitRemainingSeconds(key);
        const remainingHours = Math.ceil(remainingSeconds / 3600);
        const remainingMinutes = Math.ceil((remainingSeconds % 3600) / 60);
        
        // 根据过期时间判断是否跨天
        const quotaInfo = this.quotaLimitedKeys.get(key);
        const expiresAtDate = quotaInfo ? new Date(quotaInfo.expiresAt) : null;
        const isTomorrow = expiresAtDate && expiresAtDate.getDate() !== new Date().getDate();
        const timeHint = isTomorrow ? "（明天）" : "";
        const expiresAtStr = expiresAtDate ? expiresAtDate.toLocaleString() : "";
        
        details = `等待 ${remainingHours} 小时 ${remainingMinutes} 分钟后恢复${timeHint}${expiresAtStr ? ` (${expiresAtStr})` : ''}`;
      } else if (this.quotaLimitedKeys.has(key) && this.isQuotaLimitExpired(key)) {
        status = "可用（配额限制已过期）";
        details = "配额限制已过期，可以重新使用";
      } else {
        status = "可用";
      }
      
      statuses.push({ key: keyPreview, status, details });
    }
    
    return statuses;
  }

  /**
   * 重置失败记录（可选：定期重置）
   * 注意：不会重置永久失败的 Key
   */
  resetFailedKeys() {
    const count = this.failedKeys.size;
    this.failedKeys.clear();
    if (count > 0) {
      console.log(`[ApiKeyManager] ✅ 已清除 ${count} 个临时失败标记（永久失败的 Key 不会被清除）`);
    }
  }

  /**
   * 清除永久失败标记（手动操作，谨慎使用）
   */
  clearPermanentlyFailedKey(key: string) {
    if (this.permanentlyFailedKeys.has(key)) {
      this.permanentlyFailedKeys.delete(key);
      console.log(`[ApiKeyManager] ⚠️ 已清除 Key ${this.maskApiKey(key)} 的永久失败标记（请确保该 Key 已更换）`);
    }
  }

  /**
   * 获取当前可用的 Key 数量（排除失败、永久失败和配额限制的 Key）
   */
  getAvailableKeyCount(): number {
    return this.keys.filter(key => 
      !this.failedKeys.has(key) && 
      !this.permanentlyFailedKeys.has(key) && 
      this.isQuotaLimitExpired(key)
    ).length;
  }

  /**
   * 获取配额限制的 Key 数量
   */
  getQuotaLimitedKeyCount(): number {
    return Array.from(this.quotaLimitedKeys.keys()).filter(key => 
      !this.isQuotaLimitExpired(key)
    ).length;
  }

  /**
   * 获取所有 Key 列表（用于诊断）
   */
  getAllKeys(): string[] {
    return [...this.keys];
  }

  /**
   * 重置所有状态（清除所有失败和配额限制记录）
   * 用于恢复所有 Key 到可用状态
   */
  resetAllStates() {
    const failedCount = this.failedKeys.size;
    const quotaLimitedCount = this.quotaLimitedKeys.size;
    
    this.failedKeys.clear();
    this.quotaLimitedKeys.clear();
    
    console.log(`[ApiKeyManager] ✅ 已重置所有 Key 状态：清除 ${failedCount} 个失败标记，${quotaLimitedCount} 个配额限制标记`);
  }
}

let globalApiKeyManager: ApiKeyManager | null = null;

/**
 * 初始化全局 API Key 管理器
 */
export function initializeApiKeyManager(keys: string | string[]): void {
  const keyArray = Array.isArray(keys) ? keys : keys.split(",").map((k) => k.trim()).filter(Boolean);
  globalApiKeyManager = new ApiKeyManager(keyArray);
  console.log(`[ApiKeyManager] Initialized with ${keyArray.length} API key(s)`);
}

/**
 * 收集所有环境变量中的 API Keys
 */
function collectApiKeysFromEnv(): string[] {
  const keys: string[] = [];
  
  // 方式1: GOOGLE_API_KEYS (逗号分隔)
  const keysEnv = process.env.GOOGLE_API_KEYS;
  if (keysEnv) {
    const parsedKeys = keysEnv.split(",").map(k => k.trim()).filter(Boolean);
    keys.push(...parsedKeys);
  }
  
  // 方式2: GOOGLE_API_KEY (单个)
  const singleKey = process.env.GOOGLE_API_KEY;
  if (singleKey && singleKey.trim()) {
    keys.push(singleKey.trim());
  }
  
  // 方式3: GOOGLE_API_KEY_1, GOOGLE_API_KEY_2, ... (多个独立变量)
  let keyIndex = 1;
  while (true) {
    const keyVar = process.env[`GOOGLE_API_KEY_${keyIndex}`];
    if (!keyVar || !keyVar.trim()) {
      break;
    }
    keys.push(keyVar.trim());
    keyIndex++;
  }
  
  // 去重
  return Array.from(new Set(keys));
}

/**
 * 获取全局 API Key 管理器实例
 */
export function getApiKeyManager(): ApiKeyManager {
  if (!globalApiKeyManager) {
    const envKeys = collectApiKeysFromEnv();
    if (envKeys.length === 0) {
      throw new Error("API keys not initialized. Call initializeApiKeyManager() first or set GOOGLE_API_KEYS/GOOGLE_API_KEY/GOOGLE_API_KEY_N environment variables.");
    }
    initializeApiKeyManager(envKeys);
  }
  return globalApiKeyManager!;
}

/**
 * 使用 API Key 执行操作，支持自动故障转移和频率限制
 */
export async function withApiKey<T>(
  operation: (key: string) => Promise<T>,
  maxRetries = 5,
  onStatusUpdate?: (message: string) => void
): Promise<T> {
  const manager = getApiKeyManager();
  let lastError: Error | null = null;
  let currentKey: string | null = null;
  let keyRetryCount = 0;
  const maxKeyRetries = 3; // 每个 Key 最多重试 3 次

  // 导入频率限制器和请求队列（动态导入避免循环依赖）
  const { waitForRateLimit, getRateLimiter } = await import("./rateLimiter.js");
  const { executeWithQueue } = await import("./requestQueue.js");
  const rateLimiter = getRateLimiter();

  // 提取 Google 返回的 retryDelay（秒），优先使用官方字段，其次解析 retryInfo
  const getRetryDelaySeconds = (err: any): number => {
    if (typeof err?.retryDelaySeconds === "number") {
      return err.retryDelaySeconds;
    }
    const details = err?.errorDetails || err?.details || err?.error?.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        const delayStr = d?.retryInfo?.retryDelay || d?.retryDelay;
        if (typeof delayStr === "string" && delayStr.endsWith("s")) {
          const seconds = parseFloat(delayStr.replace("s", ""));
          if (!Number.isNaN(seconds) && seconds > 0) {
            return Math.ceil(seconds);
          }
        }
      }
    }
    return 0;
  };

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 如果是第一次尝试，或者需要切换 Key，获取新 Key
    if (currentKey === null || keyRetryCount >= maxKeyRetries) {
      currentKey = manager.getNextKey();
      keyRetryCount = 0;
    }

    try {
      // 在发送请求前，检查当前 Key 的配额使用率（预防配额限制）
      const keyStats = rateLimiter.getKeyStats(currentKey);
      if (keyStats) {
        // 如果每小时使用率超过 70%，增加额外延迟（提前预防）
        if (keyStats.hourlyUsagePercent > 70) {
          const extraDelay = Math.min(10000, (keyStats.hourlyUsagePercent - 70) * 200); // 最多额外延迟 10 秒
          if (onStatusUpdate) {
            onStatusUpdate(`⚠️ 配额使用率较高（${keyStats.hourlyUsagePercent.toFixed(1)}%），增加延迟 ${Math.ceil(extraDelay / 1000)} 秒以预防配额限制...`);
          }
          console.warn(`[ApiKeyManager] ⚠️  Key ${manager.maskApiKey(currentKey)} 配额使用率 ${keyStats.hourlyUsagePercent.toFixed(1)}%，增加延迟 ${Math.ceil(extraDelay / 1000)} 秒预防配额限制`);
          await new Promise((resolve) => setTimeout(resolve, extraDelay));
        }
        
        // 如果每小时使用率超过 85%，发出严重警告并自动切换到其他 Key（预防配额限制）
        if (keyStats.hourlyUsagePercent > 85) {
          console.warn(`[ApiKeyManager] ⚠️  Key ${manager.maskApiKey(currentKey)} 配额使用率已达 ${keyStats.hourlyUsagePercent.toFixed(1)}%，接近限制！`);
          if (onStatusUpdate) {
            onStatusUpdate(`⚠️ 配额使用率已达 ${keyStats.hourlyUsagePercent.toFixed(1)}%，接近限制，将切换到其他 Key 以预防配额限制...`);
          }
          // 如果有其他可用 Key，切换到下一个 Key
          const availableCount = manager.getAvailableKeyCount();
          if (availableCount > 1) {
            console.warn(`[ApiKeyManager] 🔄 预防性切换：Key ${manager.maskApiKey(currentKey)} 配额使用率过高，切换到其他 Key`);
            currentKey = null;
            keyRetryCount = 0;
            continue;
          }
        }
      }
      
      // 通过队列执行请求（确保按顺序处理，避免并发）
      const result = await executeWithQueue(
        currentKey,
        async (key: string) => {
          // 在发送请求前，检查频率限制并等待（如果需要）
          await waitForRateLimit(key, onStatusUpdate);
          
          // 执行操作
          const operationResult = await operation(key);
          
          // 记录请求完成
          rateLimiter.recordRequest(key);
          
          return operationResult;
        },
        0 // 默认优先级
      );
      
      // 成功时重置重试计数
      keyRetryCount = 0;
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否是 API Key 相关的错误
      const errorAny = error as any;
      const statusCode = errorAny.statusCode;
      
      const isApiKeyError =
        errorAny.isApiKeyError === true ||
        statusCode === 401 ||
        statusCode === 403 ||
        statusCode === 429;

      // 503 服务不可用，应该重试（可能是临时问题）
      const isRetryableError = statusCode === 503 || statusCode === 500 || statusCode === 502 || statusCode === 504;

      const errorMessage = lastError.message.toLowerCase();
      const isQuotaOrPermissionError =
        errorMessage.includes("api key") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("permission") ||
        errorMessage.includes("403") ||
        errorMessage.includes("401") ||
        errorMessage.includes("429");

      // 优先处理 403 错误：检查是否是 API Key 泄露
      if (statusCode === 403) {
        const errorMsgLower = lastError.message.toLowerCase();
        const isLeakedKey = 
          errorMsgLower.includes("leaked") ||
          errorMsgLower.includes("reported as leaked") ||
          errorMsgLower.includes("api key was reported");
        
        if (isLeakedKey && currentKey) {
          // API Key 泄露，标记为永久失败，不再使用
          manager.markAsPermanentlyFailed(currentKey, "API Key 已泄露，请更换新的 API Key");
          
          const availableCount = manager.getAvailableKeyCount();
          if (availableCount > 0) {
            // 如果有其他可用的 Key，立即切换到下一个 Key
            const switchMessage = `⚠️ API Key 已泄露 (403)，已标记为永久失败，切换到下一个 Key (${attempt + 1}/${maxRetries})...`;
            console.error(`[ApiKeyManager] ⛔ API Key leaked (403), marked as permanently failed, switching to next key (attempt ${attempt + 1}/${maxRetries})`);
            onStatusUpdate?.(switchMessage);
            currentKey = null;
            keyRetryCount = 0;
            if (attempt < maxRetries - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            continue;
          } else {
            // 如果所有 Key 都泄露或失败，抛出错误
            const errorMsg = `所有 API Key 都不可用。至少有一个 Key 已泄露，请更换新的 API Key。`;
            console.error(`[ApiKeyManager] ⛔ ${errorMsg}`);
            onStatusUpdate?.(errorMsg);
            throw new Error(errorMsg);
          }
        } else if (currentKey) {
          // 其他 403 错误（如权限问题），标记为临时失败
          manager.markAsFailed(currentKey);
          const switchMessage = `API Key 权限错误 (403)，正在切换到下一个 Key (${attempt + 1}/${maxRetries})...`;
          console.warn(`[ApiKeyManager] API key permission error (403), trying next key (attempt ${attempt + 1}/${maxRetries})`);
          onStatusUpdate?.(switchMessage);
          currentKey = null;
          keyRetryCount = 0;
          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          continue;
        }
      }

      // 处理 429 配额限制：标记为配额限制，根据API返回的retryDelaySeconds设置过期时间
      if (statusCode === 429) {
        // 提取API返回的retryDelay
        const retryDelaySeconds = getRetryDelaySeconds(errorAny);
        
        // 如果返回了 retryDelay，则按照服务端建议的等待时间暂停调用
        if (retryDelaySeconds > 0) {
          const waitMs = retryDelaySeconds * 1000;
          const msg = `API 返回 retryDelay=${retryDelaySeconds}s，暂停当前 Key 调用后再继续...`;
          console.warn(`[ApiKeyManager] 429 with retryDelay=${retryDelaySeconds}s, pausing before next attempt`);
          onStatusUpdate?.(msg);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        // 检查是否是真正的配额限制（而不是临时错误）
        // 真正的配额限制通常会有明确的错误消息
        const errorMsgLower = lastError.message.toLowerCase();
        const hasQuotaKeywords = 
          errorMsgLower.includes("quota") ||
          errorMsgLower.includes("rate limit") ||
          errorMsgLower.includes("too many requests") ||
          errorMsgLower.includes("resource exhausted");
        
        // 优化：区分短时间 retryDelay（临时限流）和长时间配额限制
        // 如果 retryDelay 小于 1 小时（3600秒），视为临时限流，等待后重试，不标记为配额限制
        // 如果 retryDelay 大于等于 1 小时，或明确提到配额，视为真正的配额限制
        const isShortTermRateLimit = retryDelaySeconds > 0 && retryDelaySeconds < 3600;
        const isConfirmedQuotaLimit = 
          hasQuotaKeywords ||
          (retryDelaySeconds > 0 && retryDelaySeconds >= 3600) ||
          (!retryDelaySeconds && hasQuotaKeywords);
        
        if (isShortTermRateLimit) {
          // 短时间限流（小于1小时），等待后重试，不标记为配额限制
          console.log(`[ApiKeyManager] 检测到短时间限流 (retryDelay=${retryDelaySeconds}s < 1小时)，等待后重试，不标记为配额限制`);
          // 不调用 markAsQuotaLimited，只等待后继续
          const availableCount = manager.getAvailableKeyCount();
          if (availableCount > 0) {
            // 如果有其他可用的 Key，切换到下一个 Key
            const switchMessage = `API 临时限流 (429, ${retryDelaySeconds}s)，切换到下一个 Key (${attempt + 1}/${maxRetries})...`;
            console.warn(`[ApiKeyManager] Short-term rate limit (429, ${retryDelaySeconds}s), switching to next key (attempt ${attempt + 1}/${maxRetries})`);
            onStatusUpdate?.(switchMessage);
            currentKey = null;
            keyRetryCount = 0;
            if (attempt < maxRetries - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            continue;
          } else {
            // 如果没有其他 Key，等待后重试当前 Key
            const waitMessage = `API 临时限流 (429)，等待 ${retryDelaySeconds} 秒后重试...`;
            console.warn(`[ApiKeyManager] Short-term rate limit (429), waiting ${retryDelaySeconds}s before retry`);
            onStatusUpdate?.(waitMessage);
            await new Promise((resolve) => setTimeout(resolve, retryDelaySeconds * 1000));
            keyRetryCount++;
            if (keyRetryCount < maxKeyRetries) {
              continue;
            } else if (currentKey) {
              // 重试次数用完，标记为临时失败
              manager.markAsFailed(currentKey);
              currentKey = null;
              keyRetryCount = 0;
              if (attempt < maxRetries - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              continue;
            }
          }
        } else if (currentKey) {
          // 真正的配额限制，标记为配额限制
          manager.markAsQuotaLimited(currentKey, isConfirmedQuotaLimit, retryDelaySeconds > 0 ? retryDelaySeconds : undefined);
          
          // 获取剩余可用 Key 数量
          const availableCount = manager.getAvailableKeyCount();
          
          // 显示诊断信息
          const keyStatuses = manager.getKeyStatuses();
          console.log(`[ApiKeyManager] 📊 API Key 状态诊断:`);
          keyStatuses.forEach((status, idx) => {
            console.log(`[ApiKeyManager]   Key ${idx + 1}: ${status.key} - ${status.status}${status.details ? ` (${status.details})` : ''}`);
          });
          console.log(`[ApiKeyManager]   可用 Key 数量: ${availableCount}/${manager['keys'].length}`);
          
          if (availableCount > 0) {
            // 如果有其他可用的 Key，立即切换到下一个 Key（不等待）
            const switchMessage = `API 配额限制 (429)，Key 已标记为配额限制（${isConfirmedQuotaLimit ? '明天恢复' : '临时失败'}），立即切换到下一个 Key (${attempt + 1}/${maxRetries})...`;
            console.warn(`[ApiKeyManager] Quota exceeded (429), marking key as ${isConfirmedQuotaLimit ? 'quota limited' : 'failed'}, switching to next key (attempt ${attempt + 1}/${maxRetries})`);
            onStatusUpdate?.(switchMessage);
            currentKey = null;
            keyRetryCount = 0;
            if (attempt < maxRetries - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500));
            }
            continue;
          } else {
            // 如果所有 Key 都配额受限，计算最早可用的时间
            // 使用类型断言访问私有属性
            const managerAny = manager as any;
            const quotaLimitedKeysMap = managerAny.quotaLimitedKeys as Map<string, QuotaLimitInfo>;
            const allKeys = managerAny.keys as string[];
            
            // 找到所有配额受限且未过期的 Key
            const quotaLimitedKeys = allKeys.filter(key => {
              const quotaInfo = quotaLimitedKeysMap.get(key);
              return quotaInfo && !manager.isQuotaLimitExpired(key);
            });
            
            if (quotaLimitedKeys.length > 0) {
              // 找到最早可用的 Key（剩余时间最短的）
              let earliestKey = quotaLimitedKeys[0];
              let minRemainingSeconds = manager.getQuotaLimitRemainingSeconds(earliestKey);
              
              for (const key of quotaLimitedKeys) {
                const remaining = manager.getQuotaLimitRemainingSeconds(key);
                if (remaining < minRemainingSeconds) {
                  minRemainingSeconds = remaining;
                  earliestKey = key;
                }
              }
              
              const remainingHours = Math.ceil(minRemainingSeconds / 3600);
              const remainingMinutes = Math.ceil((minRemainingSeconds % 3600) / 60);
              
              // 根据剩余时间判断是否跨天
              const managerAny2 = manager as any;
              const quotaInfo = managerAny2.quotaLimitedKeys.get(earliestKey);
              const expiresAtDate = quotaInfo ? new Date(quotaInfo.expiresAt) : null;
              const isTomorrow = expiresAtDate && expiresAtDate.getDate() !== new Date().getDate();
              const timeHint = isTomorrow ? "（明天）" : "";
              
              const errorMessage = `所有 API Key 都遇到配额限制。最早可用的 Key 将在 ${remainingHours} 小时 ${remainingMinutes} 分钟后${timeHint}恢复使用。`;
              console.error(`[ApiKeyManager] ${errorMessage}`);
              onStatusUpdate?.(errorMessage);
              
              // 抛出错误，让调用者知道需要等待
              throw new Error(errorMessage);
            } else if (currentKey) {
              // 如果没有配额限制记录，说明是其他问题，继续原有逻辑
              manager.markAsFailed(currentKey);
              const switchMessage = `当前 API Key 配额已用完 (429)，正在切换到下一个 Key (${attempt + 1}/${maxRetries})...`;
              console.warn(`[ApiKeyManager] API key quota exceeded (429), trying next key (attempt ${attempt + 1}/${maxRetries})`);
              onStatusUpdate?.(switchMessage);
              currentKey = null;
              keyRetryCount = 0;
              if (attempt < maxRetries - 1) {
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              continue;
            }
          }
        }
      }

      if ((isApiKeyError || isQuotaOrPermissionError) && currentKey) {
        manager.markAsFailed(currentKey);
        const switchMessage = `当前 API Key 不可用 (${statusCode})，正在切换到下一个 Key (${attempt + 1}/${maxRetries})...`;
        console.warn(`[ApiKeyManager] API key failed (${statusCode || "unknown"}), trying next key (attempt ${attempt + 1}/${maxRetries})`);
        onStatusUpdate?.(switchMessage);
        currentKey = null; // 下次循环会获取新 Key
        keyRetryCount = 0;
        // 切换 Key 时稍作延迟
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        continue;
      }

      // 如果是可重试的错误（503等），等待后重试（使用同一个 Key）
      if (isRetryableError && attempt < maxRetries - 1) {
        keyRetryCount++;
        const delayMs = Math.min(1000 * Math.pow(2, keyRetryCount - 1), 10000); // 指数退避，最多10秒
        const retryMessage = `Google AI API 服务暂时不可用 (${statusCode})，${Math.ceil(delayMs / 1000)}秒后自动重试 (${keyRetryCount}/${maxKeyRetries})...`;
        console.warn(`[ApiKeyManager] Retryable error (${statusCode}), retrying with same key after ${delayMs}ms (key retry ${keyRetryCount}/${maxKeyRetries}, total attempt ${attempt + 1}/${maxRetries})`);
        onStatusUpdate?.(retryMessage);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // 其他类型的错误直接抛出
      throw lastError;
    }
  }

  const finalError = lastError || new Error("All API keys failed after retries");
  if (currentKey) {
    (finalError as any).lastTriedKey = currentKey.substring(0, 20) + "...";
  }
  throw finalError;
}

