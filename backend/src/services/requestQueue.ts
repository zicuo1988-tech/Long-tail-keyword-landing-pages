/**
 * API 请求队列管理器
 * 使用队列方式处理请求，避免并发导致频率过高
 */

interface QueuedRequest<T> {
  id: string;
  key: string;
  operation: (key: string) => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  priority?: number; // 优先级（数字越大优先级越高，默认 0）
  timestamp: number; // 入队时间
}

class RequestQueue {
  private queues = new Map<string, QueuedRequest<any>[]>(); // 每个 Key 一个队列
  private processing = new Map<string, boolean>(); // 跟踪每个 Key 是否正在处理
  private readonly maxQueueSize = 100; // 每个 Key 的最大队列长度

  /**
   * 将请求加入队列
   */
  async enqueue<T>(
    key: string,
    operation: (key: string) => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // 检查队列是否已满
      const queue = this.queues.get(key) || [];
      if (queue.length >= this.maxQueueSize) {
        reject(new Error(`队列已满（${this.maxQueueSize}），请稍后重试`));
        return;
      }

      // 创建队列项
      const request: QueuedRequest<T> = {
        id: `${key}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        key,
        operation,
        resolve,
        reject,
        priority,
        timestamp: Date.now(),
      };

      // 加入队列（按优先级排序）
      queue.push(request);
      queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      this.queues.set(key, queue);

      // 尝试处理队列
      this.processQueue(key).catch((error) => {
        console.error(`[RequestQueue] 处理队列时出错 (${key.substring(0, 20)}...):`, error);
      });
    });
  }

  /**
   * 处理指定 Key 的队列
   */
  private async processQueue(key: string): Promise<void> {
    // 如果正在处理，跳过
    if (this.processing.get(key)) {
      return;
    }

    const queue = this.queues.get(key);
    if (!queue || queue.length === 0) {
      return;
    }

    // 标记为正在处理
    this.processing.set(key, true);

    try {
      // 处理队列中的所有请求（按顺序）
      while (queue.length > 0) {
        const request = queue.shift();
        if (!request) {
          break;
        }

        try {
          // 执行请求
          const result = await request.operation(request.key);
          request.resolve(result);
        } catch (error) {
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }

        // 请求之间添加延迟（避免频率过高）
        // 延迟时间由频率限制器控制，这里增加额外延迟 + 抖动以确保安全
        const baseDelayMs = 1000; // 基础 1 秒
        const jitterMs = 200 + Math.floor(Math.random() * 300); // 200-500ms 抖动
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs + jitterMs));
      }
    } finally {
      // 标记为处理完成
      this.processing.set(key, false);
      
      // 如果队列中还有请求，继续处理
      const remainingQueue = this.queues.get(key);
      if (remainingQueue && remainingQueue.length > 0) {
        // 延迟一下再处理下一个批次（避免阻塞）
        setTimeout(() => {
          this.processQueue(key).catch((error) => {
            console.error(`[RequestQueue] 继续处理队列时出错 (${key.substring(0, 20)}...):`, error);
          });
        }, 100);
      }
    }
  }

  /**
   * 获取队列状态
   */
  getQueueStatus(key?: string): {
    key: string;
    queueLength: number;
    isProcessing: boolean;
    oldestRequestAge: number;
  }[] {
    const statuses: {
      key: string;
      queueLength: number;
      isProcessing: boolean;
      oldestRequestAge: number;
    }[] = [];

    if (key) {
      const queue = this.queues.get(key) || [];
      const oldestRequest = queue[0];
      statuses.push({
        key: key.substring(0, 20) + "...",
        queueLength: queue.length,
        isProcessing: this.processing.get(key) || false,
        oldestRequestAge: oldestRequest
          ? Date.now() - oldestRequest.timestamp
          : 0,
      });
    } else {
      // 返回所有 Key 的状态
      for (const [k, queue] of this.queues.entries()) {
        const oldestRequest = queue[0];
        statuses.push({
          key: k.substring(0, 20) + "...",
          queueLength: queue.length,
          isProcessing: this.processing.get(k) || false,
          oldestRequestAge: oldestRequest
            ? Date.now() - oldestRequest.timestamp
            : 0,
        });
      }
    }

    return statuses;
  }

  /**
   * 清空指定 Key 的队列
   */
  clearQueue(key: string): number {
    const queue = this.queues.get(key);
    if (!queue) {
      return 0;
    }

    const count = queue.length;
    
    // 拒绝所有待处理的请求
    queue.forEach((request) => {
      request.reject(new Error("队列已清空"));
    });

    this.queues.delete(key);
    this.processing.set(key, false);

    return count;
  }

  /**
   * 清空所有队列
   */
  clearAllQueues(): number {
    let totalCount = 0;

    for (const [key, queue] of this.queues.entries()) {
      totalCount += queue.length;
      
      // 拒绝所有待处理的请求
      queue.forEach((request) => {
        request.reject(new Error("所有队列已清空"));
      });
    }

    this.queues.clear();
    this.processing.clear();

    return totalCount;
  }

  /**
   * 获取队列总长度
   */
  getTotalQueueLength(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }
}

// 全局请求队列实例
let globalRequestQueue: RequestQueue | null = null;

/**
 * 获取全局请求队列实例
 */
export function getRequestQueue(): RequestQueue {
  if (!globalRequestQueue) {
    globalRequestQueue = new RequestQueue();
  }
  return globalRequestQueue;
}

/**
 * 通过队列执行请求（确保按顺序处理）
 */
export async function executeWithQueue<T>(
  key: string,
  operation: (key: string) => Promise<T>,
  priority: number = 0
): Promise<T> {
  const queue = getRequestQueue();
  return queue.enqueue(key, operation, priority);
}

