const form = document.querySelector("#generator-form");
const templateFileInput = document.querySelector("#templateFile");
const templateTextarea = document.querySelector("#templateContent");
const progressLog = document.querySelector("#progress-log");
const backendUrlInput = document.querySelector("#backendUrl");

if (!form || !templateFileInput || !templateTextarea || !progressLog) {
  throw new Error("初始化前端控件失败，请检查 HTML 结构。");
}

// 自动检测并设置后端地址
function autoDetectBackendUrl() {
  if (!backendUrlInput) return;
  
  // 如果已经有值（用户手动设置），不覆盖
  if (backendUrlInput.value && backendUrlInput.value.trim() !== "") {
    return;
  }
  
  // 获取当前页面的主机名和端口
  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  
  // 如果是 localhost 或 127.0.0.1，使用 localhost:4000
  if (currentHost === "localhost" || currentHost === "127.0.0.1") {
    backendUrlInput.value = "http://localhost:4000";
    return;
  }
  
  // 如果是局域网IP，使用相同的IP但端口改为4000
  // 匹配 192.168.x.x, 10.x.x.x, 172.16-31.x.x
  const lanIPPattern = /^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2[0-9]|3[0-1])\.\d{1,3}\.\d{1,3})$/;
  if (lanIPPattern.test(currentHost)) {
    backendUrlInput.value = `http://${currentHost}:4000`;
    return;
  }
  
  // 默认使用 localhost:4000
  backendUrlInput.value = "http://localhost:4000";
}

// 页面加载时自动检测后端地址
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoDetectBackendUrl);
} else {
  autoDetectBackendUrl();
}

let pollingAbortController = null;

// 根据模板类型加载对应的模板
async function loadTemplate(templateType = "template-1") {
  try {
    const templateFile = templateType === "template-1" ? "default-template.html" : 
                         templateType === "template-2" ? "template-2.html" : 
                         "template-3.html";
    const response = await fetch(templateFile);
    if (response.ok) {
      const templateContent = await response.text();
      templateTextarea.value = templateContent;
      appendLog(`已自动加载${templateType === "template-1" ? "模板1" : templateType === "template-2" ? "模板2" : "模板3"}`);
    } else {
      console.warn(`无法加载${templateFile}，请手动上传模板文件`);
    }
  } catch (error) {
    console.warn(`加载模板失败:`, error);
    // 如果加载失败，不影响其他功能
  }
}

// 页面加载时自动加载默认模板
loadTemplate("template-1");

// 关键词池功能：显示/隐藏关键词池输入框
const useKeywordPoolCheckbox = document.querySelector("#useKeywordPool");
const keywordPoolRow = document.querySelector("#keywordPoolRow");
const keywordInput = document.querySelector("#keyword");

if (useKeywordPoolCheckbox && keywordPoolRow) {
  useKeywordPoolCheckbox.addEventListener("change", (e) => {
    if (e.target.checked) {
      keywordPoolRow.style.display = "block";
      if (keywordInput) {
        keywordInput.removeAttribute("required");
      }
    } else {
      keywordPoolRow.style.display = "none";
      if (keywordInput) {
        keywordInput.setAttribute("required", "required");
      }
    }
  });
}

// 模板卡片选择功能
function initTemplateCards() {
  const templateCards = document.querySelectorAll(".template-card");
  const templateTypeInput = document.querySelector("#templateType");

  // 初始化：选中第一个模板卡片
  if (templateCards.length > 0) {
    templateCards[0].classList.add("selected");
    const defaultTemplate = templateCards[0].getAttribute("data-template");
    if (templateTypeInput && defaultTemplate) {
      templateTypeInput.value = defaultTemplate;
    }
  }

  // 卡片点击选择
  templateCards.forEach((card) => {
    card.addEventListener("click", (e) => {
      // 如果点击的是Preview按钮，不触发选择
      if (e.target.closest(".preview-btn")) {
        return;
      }

      // 移除所有选中状态
      templateCards.forEach((c) => c.classList.remove("selected"));
      
      // 添加选中状态
      card.classList.add("selected");
      
      // 更新隐藏输入框的值
      const templateType = card.getAttribute("data-template");
      if (templateTypeInput) {
        templateTypeInput.value = templateType;
      }
      
      // 加载对应的模板
      loadTemplate(templateType);
    });
  });
}

// 初始化模板卡片选择功能
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTemplateCards);
} else {
  initTemplateCards();
}

// 预览弹窗功能
const previewModal = document.createElement("div");
previewModal.className = "preview-modal";
previewModal.innerHTML = `
  <div class="preview-modal-content">
    <button class="preview-modal-close" aria-label="关闭预览">×</button>
    <img src="" alt="模板预览" id="preview-image">
  </div>
`;
document.body.appendChild(previewModal);

const previewImage = document.getElementById("preview-image");
const previewCloseBtn = previewModal.querySelector(".preview-modal-close");

// 预览按钮点击事件
function initPreviewButtons() {
  document.querySelectorAll(".preview-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation(); // 阻止事件冒泡到卡片点击事件
      
      const previewUrl = btn.getAttribute("data-preview");
      if (previewUrl && previewImage) {
        // 添加加载状态
        previewImage.style.opacity = "0";
        previewImage.style.transition = "opacity 0.3s ease";
        previewImage.onload = () => {
          previewImage.style.opacity = "1";
        };
        previewImage.onerror = () => {
          previewImage.style.opacity = "1";
          console.error("预览图片加载失败:", previewUrl);
        };
        previewImage.src = previewUrl;
        previewModal.classList.add("active");
        document.body.style.overflow = "hidden"; // 防止背景滚动
      }
    });
  });
}

// 初始化模板选择器（包括预览按钮）
function initTemplateSelector() {
  // 初始化预览按钮
  initPreviewButtons();
}

// 页面加载完成后初始化
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTemplateSelector);
} else {
  initTemplateSelector();
}

// 关闭预览弹窗
function closePreviewModal() {
  previewModal.classList.remove("active");
  document.body.style.overflow = ""; // 恢复滚动
  if (previewImage) {
    previewImage.src = "";
  }
}

// 点击关闭按钮
if (previewCloseBtn) {
  previewCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closePreviewModal();
  });
}

// 点击背景关闭弹窗
previewModal.addEventListener("click", (e) => {
  if (e.target === previewModal) {
    closePreviewModal();
  }
});

// ESC键关闭弹窗
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && previewModal.classList.contains("active")) {
    closePreviewModal();
  }
});

// 进度条相关元素
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const progressStatus = document.getElementById("progress-status");

// 任务阶段定义
const TASK_STAGES = {
  "pending": { percent: 0, status: "等待开始..." },
  "submitted": { percent: 10, status: "任务已提交..." },
  "generating_title": { percent: 20, status: "正在生成标题..." },
  "generating_content": { percent: 40, status: "正在生成内容..." },
  "fetching_products": { percent: 60, status: "正在获取产品..." },
  "generating_html": { percent: 80, status: "正在生成HTML..." },
  "publishing": { percent: 90, status: "正在发布到WordPress..." },
  "completed": { percent: 100, status: "任务完成！" },
  "failed": { percent: 0, status: "任务失败" }
};

// 更新进度条
function updateProgress(stage, message = null) {
  const stageInfo = TASK_STAGES[stage] || TASK_STAGES["pending"];
  
  if (progressBar && progressText && progressStatus) {
    progressBar.style.width = `${stageInfo.percent}%`;
    progressText.textContent = `${stageInfo.percent}%`;
    
    // 更新状态文本
    if (message) {
      progressStatus.textContent = message;
    } else {
      progressStatus.textContent = stageInfo.status;
    }
    
    // 更新状态样式
    progressStatus.className = "progress-status";
    if (stage === "completed") {
      progressBar.classList.add("success");
      progressStatus.classList.add("success");
    } else if (stage === "failed") {
      progressBar.classList.add("error");
      progressStatus.classList.add("error");
    } else {
      progressBar.classList.remove("success", "error");
      progressStatus.classList.add("active");
    }
  }
}

// 重置进度条
function resetProgress() {
  updateProgress("pending");
  if (progressBar) {
    progressBar.classList.remove("success", "error");
  }
  if (progressStatus) {
    progressStatus.className = "progress-status";
  }
}

function appendLog(message, variant = "info", link) {
  const p = document.createElement("p");
  p.textContent = message;
  if (variant !== "info") {
    p.classList.add(variant);
  }
  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = " 打开页面";
    p.append(" ", anchor);
  }
  progressLog.appendChild(p);
  progressLog.scrollTop = progressLog.scrollHeight;
}

function clearLog() {
  progressLog.textContent = "";
  resetProgress();
}

templateFileInput.addEventListener("change", async () => {
  const file = templateFileInput.files?.[0];
  if (!file) return;
  try {
    const content = await file.text();
    templateTextarea.value = content;
    appendLog(`已载入模板文件：${file.name}`);
  } catch (error) {
    console.error(error);
    appendLog("读取模板文件失败", "error");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLog();

  if (pollingAbortController) {
    pollingAbortController.abort();
    pollingAbortController = null;
  }

  const submitButton = form.querySelector("button[type=submit]");
  if (submitButton) {
    submitButton.setAttribute("disabled", "true");
    submitButton.classList.add("loading");
  }

  const formData = new FormData(form);
  const useKeywordPool = formData.get("useKeywordPool") === "on";
  const keyword = String(formData.get("keyword") ?? "").trim();
  const keywordPool = String(formData.get("keywordPool") ?? "").trim();
  const templateContent = templateTextarea.value.trim();
  const backendUrl = String(formData.get("backendUrl") ?? "").trim().replace(/\/$/, "");

  // 检查后端URL是否有效
  if (!backendUrl || !backendUrl.startsWith("http")) {
    updateProgress("failed", "请填写有效的后端 API 地址");
    appendLog("请填写有效的后端 API 地址（例如：http://localhost:4000）", "error");
    if (submitButton) {
      submitButton.removeAttribute("disabled");
      submitButton.classList.remove("loading");
    }
    return;
  }

  if (!templateContent) {
    updateProgress("failed", "请填写模板内容");
    appendLog("请填写模板内容", "error");
    if (submitButton) {
      submitButton.removeAttribute("disabled");
      submitButton.classList.remove("loading");
    }
    return;
  }

  // 如果使用关键词池
  if (useKeywordPool) {
    if (!keywordPool) {
      updateProgress("failed", "请填写关键词池");
      appendLog("请填写关键词池（每行一个关键词）", "error");
      if (submitButton) {
        submitButton.removeAttribute("disabled");
        submitButton.classList.remove("loading");
      }
      return;
    }

    // 解析关键词池（每行一个）
    const keywords = keywordPool
      .split("\n")
      .map(k => k.trim())
      .filter(k => k.length > 0);

    if (keywords.length === 0) {
      updateProgress("failed", "关键词池为空");
      appendLog("关键词池为空，请至少输入一个关键词", "error");
      if (submitButton) {
        submitButton.removeAttribute("disabled");
        submitButton.classList.remove("loading");
      }
      return;
    }

    // 定义模板和标题类型循环数组
    const templateTypes = ["template-1", "template-2", "template-3"];
    const titleTypes = [
      "purchase", "informational", "review", "commercial", "how-to",
      "recommendations", "services-guides", "tech-insights", "comparison",
      "expert", "best", "top", "top-ranking", "most"
    ];

    appendLog(`开始批量生成，共 ${keywords.length} 个关键词`, "info");
    updateProgress("submitted", `批量生成中：0/${keywords.length}`);

    // 循环处理每个关键词
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < keywords.length; i++) {
      const currentKeyword = keywords[i];
      const templateIndex = i % templateTypes.length;
      const titleIndex = i % titleTypes.length;
      const currentTemplate = templateTypes[templateIndex];
      const currentTitleType = titleTypes[titleIndex];

      appendLog(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
      appendLog(`处理第 ${i + 1}/${keywords.length} 个关键词: "${currentKeyword}"`, "info");
      appendLog(`使用模板: ${currentTemplate === "template-1" ? "模板1" : currentTemplate === "template-2" ? "模板2" : "模板3"}`, "info");
      appendLog(`使用标题类型: ${currentTitleType}`, "info");

      // 加载对应的模板
      await loadTemplate(currentTemplate);
      const currentTemplateContent = templateTextarea.value.trim();

      const payload = {
        keyword: currentKeyword,
        titleType: currentTitleType,
        pageTitle: String(formData.get("pageTitle") ?? "").trim() || undefined,
        userPrompt: String(formData.get("userPrompt") ?? "").trim() || undefined,
        targetCategory: String(formData.get("targetCategory") ?? "").trim() || undefined,
        templateType: currentTemplate,
        templateContent: currentTemplateContent,
        useElementor: formData.get("useElementor") === "on",
        wordpress: {
          url: String(formData.get("wpUrl") ?? "").trim(),
          username: String(formData.get("wpUsername") ?? "").trim(),
          appPassword: String(formData.get("wpAppPassword") ?? "").trim(),
        },
      };

      try {
        updateProgress("submitted", `批量生成中：${i + 1}/${keywords.length} - 正在处理: ${currentKeyword}`);

        const response = await fetch(`${backendUrl}/api/generate-page`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          throw new Error(errorPayload.error || `后端返回错误：${response.status}`);
        }

        const json = await response.json();
        const taskId = json.taskId;
        appendLog(`任务提交成功，等待处理...`, "info");

        pollingAbortController = new AbortController();
        await pollTaskStatus({ 
          backendUrl, 
          taskId, 
          signal: pollingAbortController.signal,
          keywordIndex: i + 1,
          totalKeywords: keywords.length
        });

        successCount++;
        appendLog(`✅ 关键词 "${currentKeyword}" 处理完成`, "success");
      } catch (error) {
        failCount++;
        console.error(error);
        const errorMessage = error instanceof Error ? error.message : "请求失败";
        appendLog(`❌ 关键词 "${currentKeyword}" 处理失败: ${errorMessage}`, "error");
        
        // 继续处理下一个关键词，不中断整个流程
        continue;
      }
    }

    // 批量处理完成
    appendLog(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, "info");
    appendLog(`批量生成完成！`, "success");
    appendLog(`成功: ${successCount} 个，失败: ${failCount} 个，总计: ${keywords.length} 个`, 
      failCount > 0 ? "error" : "success");
    updateProgress(failCount > 0 ? "failed" : "completed", 
      `批量生成完成：成功 ${successCount}/${keywords.length}`);

    if (submitButton) {
      submitButton.removeAttribute("disabled");
      submitButton.classList.remove("loading");
    }
    return;
  }

  // 单个关键词处理（原有逻辑）
  if (!keyword) {
    updateProgress("failed", "请填写关键词");
    appendLog("请填写关键词", "error");
    if (submitButton) {
      submitButton.removeAttribute("disabled");
      submitButton.classList.remove("loading");
    }
    return;
  }

  const titleType = String(formData.get("titleType") ?? "").trim();
  if (!titleType) {
    updateProgress("failed", "请选择标题类型");
    appendLog("请选择标题类型", "error");
    if (submitButton) {
      submitButton.removeAttribute("disabled");
      submitButton.classList.remove("loading");
    }
    return;
  }

  const templateType = String(formData.get("templateType") ?? "template-1").trim();
  const pageTitle = String(formData.get("pageTitle") ?? "").trim();
  
  const payload = {
    keyword,
    titleType,
    pageTitle: pageTitle || undefined,
    userPrompt: String(formData.get("userPrompt") ?? "").trim() || undefined,
    targetCategory: String(formData.get("targetCategory") ?? "").trim() || undefined,
    templateType,
    templateContent,
    useElementor: formData.get("useElementor") === "on",
    wordpress: {
      url: String(formData.get("wpUrl") ?? "").trim(),
      username: String(formData.get("wpUsername") ?? "").trim(),
      appPassword: String(formData.get("wpAppPassword") ?? "").trim(),
    },
  };

  appendLog("正在创建任务...");

  try {
    const response = await fetch(`${backendUrl}/api/generate-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || `后端返回错误：${response.status}`);
    }

    const json = await response.json();
    const taskId = json.taskId;
    appendLog("任务提交成功，正在等待处理...");
    updateProgress("submitted", "任务已提交，等待处理...");

    pollingAbortController = new AbortController();
    await pollTaskStatus({ backendUrl, taskId, signal: pollingAbortController.signal });
  } catch (error) {
    console.error(error);
    let errorMessage = error instanceof Error ? error.message : "请求失败";
    
    // 更新进度条为错误状态
    updateProgress("failed", "任务失败");
    
    // 提供更友好的错误提示
    if (errorMessage.includes("Failed to fetch") || errorMessage.includes("NetworkError")) {
      appendLog(`无法连接到后端服务器（${backendUrl}）`, "error");
      appendLog("请确保：1. 后端服务器已启动（运行 npm run dev）", "error");
      appendLog("2. 后端地址正确（默认：http://localhost:4000）", "error");
      appendLog("3. 没有防火墙阻止连接", "error");
      appendLog("4. 如果使用局域网 IP，确保后端 CORS 配置允许", "error");
      return;
    }
    
    // CORS 错误提示
    if (errorMessage.includes("CORS") || errorMessage.includes("Not allowed")) {
      appendLog("CORS 跨域错误：后端拒绝了来自前端的请求", "error");
      appendLog("解决方案：后端已自动允许本地和局域网访问，请重启后端服务器", "error");
      return;
    }
    
    appendLog(errorMessage, "error");
  } finally {
    if (submitButton) {
      submitButton.removeAttribute("disabled");
      submitButton.classList.remove("loading");
    }
  }
});

async function pollTaskStatus({ backendUrl, taskId, signal, keywordIndex, totalKeywords }) {
  let lastStatus = null;

  while (!signal.aborted) {
    try {
      const response = await fetch(`${backendUrl}/api/tasks/${taskId}`, { signal });
      if (!response.ok) {
        throw new Error(`无法获取任务进度 (${response.status})`);
      }
      const task = await response.json();
      
      // 根据任务状态更新进度条
      const status = task.status || "pending";
      const message = task.message || null;
      
      // 根据消息内容推断更具体的阶段
      let progressStage = status;
      if (message) {
        if (message.includes("标题") || message.includes("title")) {
          progressStage = "generating_title";
        } else if (message.includes("内容") || message.includes("content") || message.includes("文章")) {
          progressStage = "generating_content";
        } else if (message.includes("产品") || message.includes("product")) {
          progressStage = "fetching_products";
        } else if (message.includes("HTML") || message.includes("模板")) {
          progressStage = "generating_html";
        } else if (message.includes("发布") || message.includes("publish") || message.includes("WordPress")) {
          progressStage = "publishing";
        }
      }
      
      if (task.status !== lastStatus) {
        let logMessage = task.message ?? task.status;
        if (keywordIndex && totalKeywords) {
          logMessage = `[${keywordIndex}/${totalKeywords}] ${logMessage}`;
        }
        appendLog(logMessage);
        updateProgress(progressStage, keywordIndex && totalKeywords 
          ? `批量生成中：${keywordIndex}/${totalKeywords} - ${message || task.status}`
          : message);
        lastStatus = task.status;
      }

      if (task.status === "completed") {
        updateProgress("completed", "页面已发布成功！");
        if (task.pageUrl) {
          appendLog("✅ 页面已发布成功!", "success");
          appendLog(`📄 页面 URL: ${task.pageUrl}`, "success", task.pageUrl);
          appendLog("💡 提示：点击上方链接验证页面是否已成功发布", "info");
        } else {
          appendLog("✅ 页面已发布成功!", "success");
          appendLog("⚠️ 注意：未获取到页面 URL，请在 WordPress 后台查看", "info");
        }
        // 任务完成后刷新历史记录
        setTimeout(() => {
          if (typeof loadHistory === "function") {
            loadHistory();
          }
        }, 1000);
        return;
      }

      if (task.status === "failed") {
        updateProgress("failed", task.error || "任务失败");
        appendLog(task.error || "任务失败", "error");
        // 任务失败后也刷新历史记录
        setTimeout(() => {
          if (typeof loadHistory === "function") {
            loadHistory();
          }
        }, 1000);
        return;
      }
    } catch (error) {
      if (signal.aborted) return;
      console.error(error);
      const errorMessage = error instanceof Error ? error.message : "轮询失败";
      
      // 更新进度条为错误状态
      updateProgress("failed", errorMessage);
      
      // 如果是 404 错误，提供更友好的提示
      if (errorMessage.includes("404")) {
        appendLog("任务不存在或已过期。如果任务失败，请重新提交。", "error");
      } else {
        appendLog(errorMessage, "error");
      }
      return;
    }

    try {
      await delay(2000, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      throw error;
    }
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ==================== 历史记录功能 ====================

// 历史记录相关元素
const historySection = document.querySelector("#history-section");
const historyList = document.querySelector("#history-list");
const refreshHistoryBtn = document.querySelector("#refresh-history-btn");
const clearHistoryBtn = document.querySelector("#clear-history-btn");
const historySearch = document.querySelector("#history-search");
const historyStatusFilter = document.querySelector("#history-status-filter");

// 加载历史记录
async function loadHistory() {
  if (!historyList) return;

  try {
    const backendUrl = backendUrlInput?.value?.trim().replace(/\/$/, "") || "http://localhost:4000";
    const search = historySearch?.value?.trim() || "";
    const status = historyStatusFilter?.value || "";

    let url = `${backendUrl}/api/history?`;
    if (search) url += `search=${encodeURIComponent(search)}&`;
    if (status) url += `status=${encodeURIComponent(status)}&`;
    url = url.replace(/[&?]$/, "");

    historyList.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">加载中...</p>';

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`获取历史记录失败: ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "获取历史记录失败");
    }

    const records = data.records || [];

    if (records.length === 0) {
      historyList.innerHTML = `
        <div class="history-empty">
          <div class="history-empty-icon">📭</div>
          <p>暂无历史记录</p>
          <small>生成页面后，记录会显示在这里</small>
        </div>
      `;
      return;
    }

    historyList.innerHTML = records.map(record => {
      const date = new Date(record.createdAt);
      const dateStr = date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const statusClass = record.status === "completed" ? "completed" : "failed";
      const statusText = record.status === "completed" ? "✅ 已完成" : "❌ 失败";

      return `
        <div class="history-item">
          <div class="history-item-header">
            <h3 class="history-item-title">${record.pageTitle || record.keyword || "未命名页面"}</h3>
            <span class="history-item-status ${statusClass}">${statusText}</span>
          </div>
          <div class="history-item-meta">
            <span class="history-item-meta-item">
              <strong>关键词:</strong> ${record.keyword || "N/A"}
            </span>
            <span class="history-item-meta-item">
              <strong>标题类型:</strong> ${record.titleType || "N/A"}
            </span>
            <span class="history-item-meta-item">
              <strong>模板:</strong> ${record.templateType === "template-1" ? "模板1" : record.templateType === "template-2" ? "模板2" : record.templateType === "template-3" ? "模板3" : "N/A"}
            </span>
            <span class="history-item-meta-item">
              <strong>生成时间:</strong> ${dateStr}
            </span>
          </div>
          ${record.pageUrl ? `
            <div style="margin-top: 0.5rem;">
              <a href="${record.pageUrl}" target="_blank" rel="noopener noreferrer" 
                 style="color: var(--primary-color); text-decoration: none; word-break: break-all;">
                🔗 ${record.pageUrl}
              </a>
            </div>
          ` : ""}
          ${record.error ? `
            <div style="margin-top: 0.5rem; padding: 0.5rem; background: rgba(239, 68, 68, 0.1); border-radius: 6px; color: var(--error-color); font-size: 0.9rem;">
              <strong>错误:</strong> ${record.error}
            </div>
          ` : ""}
          <div class="history-item-actions">
            ${record.pageUrl ? `
              <a href="${record.pageUrl}" target="_blank" rel="noopener noreferrer" class="secondary-btn">
                🔗 查看页面
              </a>
            ` : ""}
            <button type="button" class="secondary-btn" onclick="deleteHistoryRecord('${record.id}')" 
                    style="background: var(--error-color); color: white;">
              🗑️ 删除
            </button>
          </div>
        </div>
      `;
    }).join("");

  } catch (error) {
    console.error("加载历史记录失败:", error);
    historyList.innerHTML = `
      <div class="history-empty">
        <div class="history-empty-icon">⚠️</div>
        <p>加载历史记录失败</p>
        <small>${error instanceof Error ? error.message : "未知错误"}</small>
      </div>
    `;
  }
}

// 删除历史记录
async function deleteHistoryRecord(taskId) {
  if (!confirm("确定要删除这条历史记录吗？")) {
    return;
  }

  try {
    const backendUrl = backendUrlInput?.value?.trim().replace(/\/$/, "") || "http://localhost:4000";
    const response = await fetch(`${backendUrl}/api/history/${taskId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`删除失败: ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "删除失败");
    }

    // 重新加载历史记录
    await loadHistory();
  } catch (error) {
    console.error("删除历史记录失败:", error);
    alert(`删除失败: ${error instanceof Error ? error.message : "未知错误"}`);
  }
}

// 清空所有历史记录
async function clearAllHistory() {
  if (!confirm("确定要清空所有历史记录吗？此操作不可恢复！")) {
    return;
  }

  try {
    const backendUrl = backendUrlInput?.value?.trim().replace(/\/$/, "") || "http://localhost:4000";
    const response = await fetch(`${backendUrl}/api/history`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`清空失败: ${response.status}`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error(data.error || "清空失败");
    }

    // 重新加载历史记录
    await loadHistory();
  } catch (error) {
    console.error("清空历史记录失败:", error);
    alert(`清空失败: ${error instanceof Error ? error.message : "未知错误"}`);
  }
}

// 将函数暴露到全局作用域，以便在HTML中调用
window.deleteHistoryRecord = deleteHistoryRecord;

// 绑定事件
if (refreshHistoryBtn) {
  refreshHistoryBtn.addEventListener("click", loadHistory);
}

if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", clearAllHistory);
}

if (historySearch) {
  let searchTimeout;
  historySearch.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(loadHistory, 500); // 防抖，500ms后执行
  });
}

if (historyStatusFilter) {
  historyStatusFilter.addEventListener("change", loadHistory);
}

// 页面加载时自动加载历史记录
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(loadHistory, 500); // 延迟加载，确保后端URL已设置
  });
} else {
  setTimeout(loadHistory, 500);
}

// 注意：历史记录刷新已在 pollTaskStatus 函数内部的任务完成/失败时触发
