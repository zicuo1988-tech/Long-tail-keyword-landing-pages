import { randomUUID } from "crypto";
import type { TaskProgress, TaskStatus } from "../types.js";
import { saveHistoryRecord } from "./historyStore.js";

const tasks = new Map<string, TaskProgress>();
const pausedTasks = new Set<string>(); // 暂停的任务ID集合

export function createTask(initialMessage: string): TaskProgress {
  const id = randomUUID();
  const now = Date.now();
  const task: TaskProgress = {
    id,
    status: "queued",
    message: initialMessage,
    createdAt: now,
    updatedAt: now,
  };
  tasks.set(id, task);
  return task;
}

/**
 * 暂停任务
 */
export function pauseTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task) {
    return false;
  }
  
  // 只有进行中的任务才能暂停
  if (task.status === "completed" || task.status === "failed" || task.status === "paused") {
    return false;
  }
  
  pausedTasks.add(id);
  updateTaskStatus(id, "paused", "任务已暂停", {});
  return true;
}

/**
 * 恢复任务
 */
export function resumeTask(id: string): boolean {
  const task = tasks.get(id);
  if (!task) {
    return false;
  }
  
  // 只有暂停的任务才能恢复
  if (task.status !== "paused") {
    return false;
  }
  
  pausedTasks.delete(id);
  // 恢复到之前的状态（如果可能）或设置为 queued
  const previousStatus = (task.details as any)?.previousStatus || task.status || "queued";
  
  // 如果 previousStatus 是 paused，使用 queued
  const resumeStatus = previousStatus === "paused" ? "queued" : previousStatus;
  
  updateTaskStatus(id, resumeStatus as TaskStatus, "任务已恢复，继续处理...", {});
  return true;
}

/**
 * 检查任务是否已暂停
 */
export function isTaskPaused(id: string): boolean {
  return pausedTasks.has(id);
}

/**
 * 等待任务恢复（如果任务已暂停）
 */
export async function waitForTaskResume(id: string, checkInterval: number = 1000): Promise<void> {
  while (isTaskPaused(id)) {
    await new Promise((resolve) => setTimeout(resolve, checkInterval));
  }
}

export function updateTaskStatus(id: string, status: TaskStatus, message: string, extras?: Partial<Omit<TaskProgress, "id" | "status" | "message" | "createdAt" | "updatedAt">>) {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task ${id} not found`);
  }

  // 如果状态不是 paused，保存当前状态作为 previousStatus（用于恢复）
  if (status !== "paused" && task.status !== "paused") {
    if (!task.details) {
      task.details = {};
    }
    (task.details as any).previousStatus = task.status;
  }

  Object.assign(task, extras);

  task.status = status;
  task.message = message;
  task.updatedAt = Date.now();
  tasks.set(id, task);
}

export function setTaskError(id: string, error: string) {
  const task = tasks.get(id);
  if (task) {
    updateTaskStatus(id, "failed", error, { error });
    // 保存到历史记录（异步，不阻塞）
    saveHistoryRecord(task).catch((err) => {
      console.error("[TaskStore] 保存历史记录失败:", err);
    });
  }
}

export function setTaskCompleted(id: string, message: string, pageUrl?: string) {
  const task = tasks.get(id);
  if (task) {
    updateTaskStatus(id, "completed", message, { pageUrl });
    // 保存到历史记录（异步，不阻塞）
    saveHistoryRecord(task).catch((err) => {
      console.error("[TaskStore] 保存历史记录失败:", err);
    });
  }
}

export function getTask(id: string): TaskProgress | undefined {
  return tasks.get(id);
}
