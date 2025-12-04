import { randomUUID } from "crypto";
import type { TaskProgress, TaskStatus } from "../types.js";

const tasks = new Map<string, TaskProgress>();

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

export function updateTaskStatus(id: string, status: TaskStatus, message: string, extras?: Partial<Omit<TaskProgress, "id" | "status" | "message" | "createdAt" | "updatedAt">>) {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task ${id} not found`);
  }

  Object.assign(task, extras);

  task.status = status;
  task.message = message;
  task.updatedAt = Date.now();
  tasks.set(id, task);
}

export function setTaskError(id: string, error: string) {
  updateTaskStatus(id, "failed", error, { error });
}

export function setTaskCompleted(id: string, message: string, pageUrl?: string) {
  updateTaskStatus(id, "completed", message, { pageUrl });
}

export function getTask(id: string): TaskProgress | undefined {
  return tasks.get(id);
}
