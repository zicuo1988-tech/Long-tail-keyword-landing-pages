import express from "express";
import {
  getAllHistoryRecords,
  getRecentHistoryRecords,
  searchHistoryRecords,
  filterHistoryRecordsByStatus,
  deleteHistoryRecord,
  clearAllHistoryRecords,
} from "../state/historyStore.js";

export const historyRouter = express.Router();

// 获取所有历史记录
historyRouter.get("/history", (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const status = req.query.status as "completed" | "failed" | undefined;
    const search = req.query.search as string | undefined;

    let records = getAllHistoryRecords();

    // 按状态筛选
    if (status) {
      records = filterHistoryRecordsByStatus(status);
    }

    // 搜索
    if (search && search.trim()) {
      records = searchHistoryRecords(search.trim());
    }

    // 限制数量
    if (limit && limit > 0) {
      records = records.slice(0, limit);
    }

    return res.json({
      success: true,
      count: records.length,
      records,
    });
  } catch (error) {
    console.error("[History] Error fetching history:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "获取历史记录失败",
    });
  }
});

// 获取最近的历史记录
historyRouter.get("/history/recent", (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const records = getRecentHistoryRecords(limit);
    return res.json({
      success: true,
      count: records.length,
      records,
    });
  } catch (error) {
    console.error("[History] Error fetching recent history:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "获取最近历史记录失败",
    });
  }
});

// 删除单条历史记录
historyRouter.delete("/history/:taskId", (req, res) => {
  try {
    const { taskId } = req.params;
    const deleted = deleteHistoryRecord(taskId);
    if (deleted) {
      return res.json({
        success: true,
        message: "历史记录已删除",
      });
    } else {
      return res.status(404).json({
        success: false,
        error: "历史记录不存在",
      });
    }
  } catch (error) {
    console.error("[History] Error deleting history:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "删除历史记录失败",
    });
  }
});

// 清空所有历史记录
historyRouter.delete("/history", (req, res) => {
  try {
    clearAllHistoryRecords();
    return res.json({
      success: true,
      message: "所有历史记录已清空",
    });
  } catch (error) {
    console.error("[History] Error clearing history:", error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "清空历史记录失败",
    });
  }
});

