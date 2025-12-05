import dotenv from "dotenv";
import os from "os";
import { createApp } from "./app.js";
import { initializeApiKeyManager } from "./services/apiKeyManager.js";

dotenv.config();

// 初始化 API Key 管理器
const apiKeys = process.env.GOOGLE_API_KEYS || process.env.GOOGLE_API_KEY;
if (apiKeys) {
  initializeApiKeyManager(apiKeys);
} else {
  console.warn("[server] Warning: No GOOGLE_API_KEYS or GOOGLE_API_KEY found in environment variables");
}

// 启动时进行网络诊断
async function performNetworkDiagnostics() {
  try {
    const { testGoogleAIConnection } = await import("./utils/networkTest.js");
    console.log("[server] 正在测试网络连接...");
    const result = await testGoogleAIConnection();
    
    if (result.success) {
      console.log(`[server] ✅ ${result.message}`);
    } else {
      console.warn(`[server] ⚠️  ${result.message}`);
      console.warn("[server] 提示：如果无法访问 Google AI API，请配置代理或使用 VPN");
      console.warn("[server] 详细说明请查看: backend/NETWORK_FIX.md");
    }
  } catch (error) {
    console.warn("[server] 网络诊断失败:", error);
  }
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0"; // 绑定到所有网络接口，允许局域网访问
const app = createApp();

app.listen(port, host, async () => {
  console.log(`[server] WordPress AI automation engine listening on ${host}:${port}`);
  console.log(`[server] Local: http://localhost:${port}`);
  console.log(`[server] Network: http://${getLocalIP()}:${port}`);
  // 异步执行网络诊断，不阻塞服务器启动
  void performNetworkDiagnostics();
});

// 获取本地IP地址
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  if (!interfaces) return "localhost";
  
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    
    for (const iface of ifaceList) {
      // 跳过内部（即127.0.0.1）和非IPv4地址
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}
