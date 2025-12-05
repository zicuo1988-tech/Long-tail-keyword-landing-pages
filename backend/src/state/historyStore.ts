import type { TaskProgress } from "../types.js";

// 历史记录存储（内存存储，重启后清空）
// 在生产环境中，可以考虑使用数据库或文件存储
const historyRecords: TaskProgress[] = [];
const MAX_HISTORY_RECORDS = 1000; // 最多保存1000条历史记录

/**
 * 保存历史记录（仅保存已完成的任务）
 */
export function saveHistoryRecord(task: TaskProgress) {
  if (task.status === "completed" || task.status === "failed") {
    // 添加到数组开头（最新的在前面）
    historyRecords.unshift({ ...task });
    
    // 如果超过最大数量，删除最旧的记录
    if (historyRecords.length > MAX_HISTORY_RECORDS) {
      historyRecords.pop();
    }
  }
}

/**
 * 获取所有历史记录
 */
export function getAllHistoryRecords(): TaskProgress[] {
  return [...historyRecords];
}

/**
 * 获取最近N条历史记录
 */
export function getRecentHistoryRecords(limit: number = 50): TaskProgress[] {
  return historyRecords.slice(0, limit);
}

/**
 * 根据关键词搜索历史记录
 */
export function searchHistoryRecords(keyword: string): TaskProgress[] {
  const lowerKeyword = keyword.toLowerCase();
  return historyRecords.filter(record => 
    record.keyword?.toLowerCase().includes(lowerKeyword) ||
    record.pageTitle?.toLowerCase().includes(lowerKeyword)
  );
}

/**
 * 根据状态筛选历史记录
 */
export function filterHistoryRecordsByStatus(status: "completed" | "failed"): TaskProgress[] {
  return historyRecords.filter(record => record.status === status);
}

/**
 * 删除历史记录
 */
export function deleteHistoryRecord(taskId: string): boolean {
  const index = historyRecords.findIndex(record => record.id === taskId);
  if (index !== -1) {
    historyRecords.splice(index, 1);
    return true;
  }
  return false;
}

/**
 * 清空所有历史记录
 */
export function clearAllHistoryRecords(): void {
  historyRecords.length = 0;
}

