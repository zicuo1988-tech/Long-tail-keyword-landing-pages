import express from "express";
import { getTask } from "../state/taskStore.js";

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
