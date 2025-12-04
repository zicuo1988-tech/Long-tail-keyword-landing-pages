class ApiKeyManager {
  private keys: string[] = [];
  private currentIndex = 0;
  private failedKeys = new Set<string>();

  constructor(keys: string[]) {
    this.keys = keys.filter((key) => key?.trim()).map((key) => key.trim());
    if (this.keys.length === 0) {
      throw new Error("At least one API key is required");
    }
  }

  /**
   * 获取下一个可用的 API Key（轮换策略）
   */
  getNextKey(): string {
    if (this.keys.length === 0) {
      throw new Error("No API keys available");
    }

    // 如果所有 Key 都失败了，重置失败记录
    if (this.failedKeys.size >= this.keys.length) {
      console.warn("[ApiKeyManager] All keys failed, resetting failed keys set");
      this.failedKeys.clear();
    }

    // 找到下一个未失败的 Key
    let attempts = 0;
    while (attempts < this.keys.length) {
      const key = this.keys[this.currentIndex];
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;

      if (!this.failedKeys.has(key)) {
        return key;
      }

      attempts++;
    }

    // 如果所有 Key 都失败了，返回第一个（已重置失败记录）
    return this.keys[0];
  }

  /**
   * 标记某个 Key 为失败
   */
  markAsFailed(key: string) {
    this.failedKeys.add(key);
    console.warn(`[ApiKeyManager] Marked key as failed: ${key.substring(0, 20)}...`);
  }

  /**
   * 重置失败记录（可选：定期重置）
   */
  resetFailedKeys() {
    this.failedKeys.clear();
  }

  /**
   * 获取当前可用的 Key 数量
   */
  getAvailableKeyCount(): number {
    return this.keys.length - this.failedKeys.size;
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
 * 获取全局 API Key 管理器实例
 */
export function getApiKeyManager(): ApiKeyManager {
  if (!globalApiKeyManager) {
    const envKeys = process.env.GOOGLE_API_KEYS || process.env.GOOGLE_API_KEY;
    if (!envKeys) {
      throw new Error("API keys not initialized. Call initializeApiKeyManager() first or set GOOGLE_API_KEYS/GOOGLE_API_KEY environment variable.");
    }
    initializeApiKeyManager(envKeys);
  }
  return globalApiKeyManager!;
}

/**
 * 使用 API Key 执行操作，支持自动故障转移
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

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // 如果是第一次尝试，或者需要切换 Key，获取新 Key
    if (currentKey === null || keyRetryCount >= maxKeyRetries) {
      currentKey = manager.getNextKey();
      keyRetryCount = 0;
    }

    try {
      const result = await operation(currentKey);
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

      // 处理 429 配额限制：先尝试等待后重试，如果还是失败再切换 Key
      if (statusCode === 429 && (errorAny as any).retryDelaySeconds) {
        const retryDelaySeconds = (errorAny as any).retryDelaySeconds;
        const retryDelayMs = Math.min(retryDelaySeconds * 1000, 120000); // 最多等待 2 分钟
        
        if (keyRetryCount < maxKeyRetries && attempt < maxRetries - 1) {
          keyRetryCount++;
          const retryMessage = `API 配额限制 (429)，等待 ${retryDelaySeconds} 秒后重试 (${keyRetryCount}/${maxKeyRetries})...`;
          console.warn(`[ApiKeyManager] Quota exceeded (429), waiting ${retryDelaySeconds}s before retry (key retry ${keyRetryCount}/${maxKeyRetries}, total attempt ${attempt + 1}/${maxRetries})`);
          onStatusUpdate?.(retryMessage);
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        } else {
          // 重试次数用完，切换到下一个 Key
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

      if (isApiKeyError || isQuotaOrPermissionError) {
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

