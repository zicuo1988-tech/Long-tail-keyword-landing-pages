import dotenv from "dotenv";
import os from "os";
import { createApp } from "./app.js";
import { initializeApiKeyManager } from "./services/apiKeyManager.js";
import { initializeHistoryStore } from "./state/historyStore.js";

dotenv.config();

// 初始化 API Key 管理器
// 支持多种格式：
// 1. GOOGLE_API_KEYS=key1,key2,key3 (逗号分隔)
// 2. GOOGLE_API_KEY=key1 (单个key)
// 3. GOOGLE_API_KEY_1, GOOGLE_API_KEY_2, ... GOOGLE_API_KEY_N (多个独立变量)
function collectApiKeys(): string[] {
  const keys: string[] = [];
  
  // 方式1: GOOGLE_API_KEYS (逗号分隔)
  const keysEnv = process.env.GOOGLE_API_KEYS;
  if (keysEnv) {
    const parsedKeys = keysEnv.split(",").map(k => k.trim()).filter(Boolean);
    keys.push(...parsedKeys);
    console.log(`[server] 从 GOOGLE_API_KEYS 读取 ${parsedKeys.length} 个 API Keys`);
  }
  
  // 方式2: GOOGLE_API_KEY (单个)
  const singleKey = process.env.GOOGLE_API_KEY;
  if (singleKey && singleKey.trim()) {
    keys.push(singleKey.trim());
    console.log(`[server] 从 GOOGLE_API_KEY 读取 1 个 API Key`);
  }
  
  // 方式3: GOOGLE_API_KEY_1, GOOGLE_API_KEY_2, ... (多个独立变量)
  let keyIndex = 1;
  while (true) {
    const keyVar = process.env[`GOOGLE_API_KEY_${keyIndex}`];
    if (!keyVar || !keyVar.trim()) {
      break;
    }
    keys.push(keyVar.trim());
    keyIndex++;
  }
  if (keyIndex > 1) {
    console.log(`[server] 从 GOOGLE_API_KEY_1 到 GOOGLE_API_KEY_${keyIndex - 1} 读取 ${keyIndex - 1} 个 API Keys`);
  }
  
  // 去重
  const uniqueKeys = Array.from(new Set(keys));
  if (uniqueKeys.length !== keys.length) {
    console.log(`[server] 检测到重复的 API Keys，已去重：${keys.length} -> ${uniqueKeys.length}`);
  }
  
  return uniqueKeys;
}

const apiKeys = collectApiKeys();
if (apiKeys.length > 0) {
  initializeApiKeyManager(apiKeys);
  console.log(`[server] ✅ 总共初始化 ${apiKeys.length} 个 API Keys`);
} else {
  console.warn("[server] ⚠️  Warning: No API keys found in environment variables");
  console.warn("[server] 支持的格式：");
  console.warn("[server]   - GOOGLE_API_KEYS=key1,key2,key3");
  console.warn("[server]   - GOOGLE_API_KEY=key1");
  console.warn("[server]   - GOOGLE_API_KEY_1=key1, GOOGLE_API_KEY_2=key2, ...");
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
  
  // 初始化历史记录存储（从文件加载）
  try {
    await initializeHistoryStore();
    console.log("[server] ✅ 历史记录存储已初始化");
  } catch (error) {
    console.warn("[server] ⚠️  历史记录存储初始化失败:", error);
  }
  
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
