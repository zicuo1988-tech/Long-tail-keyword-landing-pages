import cors from "cors";
import express from "express";
import type { Application } from "express";
import { tasksRouter } from "./routes/tasks.js";
import { generationRouter } from "./routes/generation.js";
import { historyRouter } from "./routes/history.js";

export function createApp(): Application {
  const app = express();

  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const origins = allowedOrigins.length > 0 ? allowedOrigins : [];
  
  // 检查是否是本地/局域网请求（开发环境）
  function isLocalOrLANOrigin(origin: string): boolean {
    try {
      const url = new URL(origin);
      const hostname = url.hostname.toLowerCase();
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      
      // 允许 localhost 和 127.0.0.1
      if (hostname === "localhost" || hostname === "127.0.0.1") {
        return true;
      }
      
      // 允许前端开发服务器的端口（8080）
      if (port === "8080" || port === "3000" || port === "5173") {
        // 192.168.x.x
        if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
          return true;
        }
        // 10.x.x.x
        if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
          return true;
        }
        // 172.16.x.x - 172.31.x.x
        if (/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
          return true;
        }
      }
      
      return false;
    } catch {
      return false;
    }
  }
  
  app.use(
    cors({
      origin: (origin, callback) => {
        // 允许无 origin 的请求（如 Postman、curl）
        if (!origin) {
          callback(null, true);
          return;
        }
        
        // 如果配置了 "*"，允许所有来源
        if (origins.includes("*")) {
          callback(null, true);
          return;
        }
        
        // 检查是否在显式允许列表中
        if (origins.length > 0 && origins.includes(origin)) {
          callback(null, true);
          return;
        }
        
        // 开发环境：自动允许本地和局域网请求（前端开发服务器）
        if (isLocalOrLANOrigin(origin)) {
          console.log(`[CORS] Allowed local/LAN origin: ${origin}`);
          callback(null, true);
          return;
        }
        
        // 如果配置了允许列表但没有匹配，拒绝
        if (origins.length > 0) {
          console.warn(`[CORS] Blocked origin: ${origin}`);
          callback(new Error("Not allowed by CORS"));
          return;
        }
        
        // 如果没有配置允许列表，默认允许（开发环境）
        callback(null, true);
      },
      credentials: true,
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // 网络连接测试端点
  app.get("/api/network-test", async (_req, res) => {
    try {
      const { testGoogleAIConnection } = await import("./utils/networkTest.js");
      const result = await testGoogleAIConnection();
      res.json(result);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: `测试失败: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });

  app.use("/api", generationRouter);
  app.use("/api", tasksRouter);
  app.use("/api", historyRouter);

  app.use((err: unknown, _req, res, _next) => {
    console.error("[error]", err);
    res.status(500).json({ error: "Unexpected server error" });
  });

  return app;
}
