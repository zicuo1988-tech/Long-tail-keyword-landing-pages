const form = document.querySelector("#generator-form");
const templateFileInput = document.querySelector("#templateFile");
const templateTextarea = document.querySelector("#templateContent");
const progressLog = document.querySelector("#progress-log");

if (!form || !templateFileInput || !templateTextarea || !progressLog) {
  throw new Error("初始化前端控件失败，请检查 HTML 结构。");
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
  submitButton?.setAttribute("disabled", "true");

  const formData = new FormData(form);
  const keyword = String(formData.get("keyword") ?? "").trim();
  const titleType = String(formData.get("titleType") ?? "").trim();
  const pageTitle = String(formData.get("pageTitle") ?? "").trim();
  const templateContent = templateTextarea.value.trim();
  const backendUrl = String(formData.get("backendUrl") ?? "").trim().replace(/\/$/, "");

  if (!keyword || !templateContent) {
    updateProgress("failed", "请填写关键词和模板内容");
    appendLog("请填写关键词和模板内容", "error");
    submitButton?.removeAttribute("disabled");
    return;
  }

  if (!titleType) {
    updateProgress("failed", "请选择标题类型");
    appendLog("请选择标题类型", "error");
    submitButton?.removeAttribute("disabled");
    return;
  }

  const templateType = String(formData.get("templateType") ?? "template-1").trim();
  
  const payload = {
    keyword,
    titleType,
    pageTitle,
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
    // 检查后端URL是否有效
    if (!backendUrl || !backendUrl.startsWith("http")) {
      throw new Error("请填写有效的后端 API 地址（例如：http://localhost:4000）");
    }

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
    submitButton?.removeAttribute("disabled");
  }
});

async function pollTaskStatus({ backendUrl, taskId, signal }) {
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
        appendLog(task.message ?? task.status);
        updateProgress(progressStage, message);
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
        return;
      }

      if (task.status === "failed") {
        updateProgress("failed", task.error || "任务失败");
        appendLog(task.error || "任务失败", "error");
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
