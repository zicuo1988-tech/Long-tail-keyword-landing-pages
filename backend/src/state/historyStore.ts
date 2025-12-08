import type { TaskProgress } from "../types.js";
import { promises as fs } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// 获取当前文件的目录路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 历史记录文件路径
const HISTORY_FILE_PATH = join(__dirname, "../../data/history.json");
const MAX_HISTORY_RECORDS = 1000; // 最多保存1000条历史记录

// 内存缓存（提高读取性能）
let historyRecords: TaskProgress[] = [];
let isInitialized = false;

/**
 * 确保数据目录存在
 */
async function ensureDataDirectory(): Promise<void> {
  const dataDir = dirname(HISTORY_FILE_PATH);
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

/**
 * 从文件加载历史记录
 */
async function loadHistoryFromFile(): Promise<void> {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(HISTORY_FILE_PATH, "utf-8");
    historyRecords = JSON.parse(data);
    if (!Array.isArray(historyRecords)) {
      historyRecords = [];
    }
    console.log(`[HistoryStore] 已从文件加载 ${historyRecords.length} 条历史记录`);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      // 文件不存在，使用空数组
      historyRecords = [];
      console.log("[HistoryStore] 历史记录文件不存在，使用空记录");
    } else {
      console.error("[HistoryStore] 加载历史记录失败:", error);
      historyRecords = [];
    }
  }
}

/**
 * 保存历史记录到文件
 */
async function saveHistoryToFile(): Promise<void> {
  try {
    await ensureDataDirectory();
    await fs.writeFile(HISTORY_FILE_PATH, JSON.stringify(historyRecords, null, 2), "utf-8");
  } catch (error) {
    console.error("[HistoryStore] 保存历史记录到文件失败:", error);
    // 不抛出错误，避免影响主流程
  }
}

/**
 * 初始化历史记录存储（加载文件数据）
 */
export async function initializeHistoryStore(): Promise<void> {
  if (isInitialized) {
    return;
  }
  await loadHistoryFromFile();
  isInitialized = true;
}

/**
 * 保存历史记录（仅保存已完成的任务）
 */
export async function saveHistoryRecord(task: TaskProgress) {
  if (task.status === "completed" || task.status === "failed") {
    // 确保已初始化
    if (!isInitialized) {
      await initializeHistoryStore();
    }

    // 检查是否已存在（避免重复）
    const existingIndex = historyRecords.findIndex((r) => r.id === task.id);
    if (existingIndex !== -1) {
      // 更新现有记录
      historyRecords[existingIndex] = { ...task };
    } else {
      // 添加到数组开头（最新的在前面）
      historyRecords.unshift({ ...task });
    }

    // 如果超过最大数量，删除最旧的记录
    if (historyRecords.length > MAX_HISTORY_RECORDS) {
      historyRecords = historyRecords.slice(0, MAX_HISTORY_RECORDS);
    }

    // 异步保存到文件（不阻塞）
    saveHistoryToFile().catch((error) => {
      console.error("[HistoryStore] 异步保存历史记录失败:", error);
    });
  }
}

/**
 * 获取所有历史记录
 */
export async function getAllHistoryRecords(): Promise<TaskProgress[]> {
  if (!isInitialized) {
    await initializeHistoryStore();
  }
  return [...historyRecords];
}

/**
 * 获取最近N条历史记录
 */
export async function getRecentHistoryRecords(limit: number = 50): Promise<TaskProgress[]> {
  if (!isInitialized) {
    await initializeHistoryStore();
  }
  return historyRecords.slice(0, limit);
}

/**
 * 根据关键词搜索历史记录
 */
export async function searchHistoryRecords(keyword: string): Promise<TaskProgress[]> {
  if (!isInitialized) {
    await initializeHistoryStore();
  }
  const lowerKeyword = keyword.toLowerCase();
  return historyRecords.filter(record => 
    record.keyword?.toLowerCase().includes(lowerKeyword) ||
    record.pageTitle?.toLowerCase().includes(lowerKeyword)
  );
}

/**
 * 根据状态筛选历史记录
 */
export async function filterHistoryRecordsByStatus(status: "completed" | "failed"): Promise<TaskProgress[]> {
  if (!isInitialized) {
    await initializeHistoryStore();
  }
  return historyRecords.filter(record => record.status === status);
}

/**
 * 删除历史记录
 */
export async function deleteHistoryRecord(taskId: string): Promise<boolean> {
  if (!isInitialized) {
    await initializeHistoryStore();
  }
  const index = historyRecords.findIndex(record => record.id === taskId);
  if (index !== -1) {
    historyRecords.splice(index, 1);
    // 保存到文件
    await saveHistoryToFile();
    return true;
  }
  return false;
}

/**
 * 清空所有历史记录
 */
export async function clearAllHistoryRecords(): Promise<void> {
  if (!isInitialized) {
    await initializeHistoryStore();
  }
  historyRecords.length = 0;
  // 保存到文件
  await saveHistoryToFile();
}

