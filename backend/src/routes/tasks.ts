import express from "express";
import { getTask, pauseTask, resumeTask } from "../state/taskStore.js";

export const tasksRouter = express.Router();

tasksRouter.get("/tasks/:taskId", (req, res) => {
  const task = getTask(req.params.taskId);
  if (!task) {
    return res.status(404).json({ 
      error: "Task not found",
      taskId: req.params.taskId,
      message: "任务不存在或已过期。任务在内存中存储，服务器重启后会丢失。"
    });
  }
  return res.json(task);
});

/**
 * POST /api/tasks/:taskId/pause
 * 暂停任务
 */
tasksRouter.post("/tasks/:taskId/pause", (req, res) => {
  try {
    const { taskId } = req.params;
    const success = pauseTask(taskId);
    
    if (success) {
      return res.json({
        success: true,
        message: "任务已暂停",
        task: getTask(taskId),
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "无法暂停任务。任务可能已完成、失败、已暂停或不存在。",
      });
    }
  } catch (error) {
    console.error("[Tasks] Error pausing task:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "暂停任务失败",
    });
  }
});

/**
 * POST /api/tasks/:taskId/resume
 * 恢复任务
 */
tasksRouter.post("/tasks/:taskId/resume", (req, res) => {
  try {
    const { taskId } = req.params;
    const success = resumeTask(taskId);
    
    if (success) {
      return res.json({
        success: true,
        message: "任务已恢复",
        task: getTask(taskId),
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "无法恢复任务。任务可能未暂停或不存在。",
      });
    }
  } catch (error) {
    console.error("[Tasks] Error resuming task:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "恢复任务失败",
    });
  }
});
