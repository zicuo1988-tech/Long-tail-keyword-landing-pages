# WordPress AI 内容自动化引擎

一个强大的全栈自动化系统，使用 Google AI (Gemini) 生成 SEO 优化的内容，并自动发布到 WordPress。该引擎简化了长尾关键词落地页的创建流程，集成了 AI 生成内容、产品集成和无缝的 WordPress 发布功能。

## 🎯 项目概述

本项目是一个端到端的内容自动化解决方案，专为创建高质量、SEO 优化的落地页而设计。它结合了 Google Gemini AI 的内容生成能力和 WordPress REST API 集成，实现无缝发布。系统智能匹配 WooCommerce 产品，基于全面的知识库生成结构化内容，并发布格式完整、包含适当 SEO 元数据的页面。

## ✨ 核心功能

### 🤖 AI 驱动的内容生成

- **Google Gemini 集成**：使用 Google Gemini 2.5 Pro 进行高质量内容生成
- **SEO 优化**：内容针对搜索引擎优化，具有适当的关键词密度和结构
- **知识库合规**：严格遵循产品知识库，确保内容准确性
- **英式英语**：所有生成的内容均为英式英语，不包含中文字符
- **多种标题类型**：支持 14+ 种标题类型，包括：
  - 购买交易类型 (Purchase)
  - 信息类型 (Informational)
  - 评论类型 (Review)
  - 商业类型 (Commercial)
  - 操作指南 (How to)
  - 推荐类型 (Recommendations)
  - 服务指南 (Services Guides)
  - 科技洞察 (Tech Insights)
  - 对比类型 (Comparison)
  - 专家类型 (Expert)
  - 最佳类型 (Best)
  - 顶级类型 (Top)
  - 最多类型 (Most)
  - 排名类型 (Top Ranking)

### 📝 内容结构

- **结构化格式**：强制执行特定的内容结构（H1、介绍、H2 标题、编号列表、结论）
- **一屏优化**：简洁、可读的内容，适合一屏显示（模板 1 和 2）
- **问题式标题**：SEO 友好的标题，直接回答用户查询
- **动态长度**：根据所选模板调整内容长度（模板 3 无字数限制）
- **用户提示词**：支持用户提供内容提示词和想法，AI 将按照用户意图生成内容
- **类型感知内容**：内容和 FAQ 会根据选择的标题类型进行调整，确保内容风格一致

### 🛍️ 产品集成

- **WooCommerce 集成**：自动从 WooCommerce REST API 获取产品
- **智能产品匹配**：基于关键词的智能产品搜索，支持相关性评分
- **多产品关键词支持**：当关键词包含多个产品时（如 "smart ring vs smart watch"），系统会识别并显示所有相关产品
- **产品过滤**：
  - 过滤不需要的分类（Uncategorised、Payment Link、Ironflip、Aster P、Vertu Classics）
  - 针对 "Phones" 父分类，只允许特定子分类（Agent Q、Quantum Flip、Meta Max、Meta Curve、iVertu、Signature S+、Signature、Signature S）
  - 过滤缺货产品，只显示有库存的产品
  - 支持用户指定产品分类，页面只显示该分类下的产品（支持模糊匹配）
- **随机化显示**：每行显示 4 个不重复的产品，每次生成都是随机的
- **价格格式化**：处理价格范围、促销价格和划线原价
- **产品标签**：条件显示 "On Sale" 标签和产品标签（仅在产品有对应标签时显示）

### 🎨 模板系统

- **三个内置模板**：
  - **模板 1（默认）**：标题 + 内容 + 产品（一屏内容）
  - **模板 2**：标题 + 描述 + 第一排产品 + 内容 + 第二排产品 + FAQ + 相关产品（一屏内容）
  - **模板 3**：标题 + 描述 + 第一排产品 + 内容 + 第二排产品 + FAQ + 相关产品 + 扩展内容（无字数限制）
- **卡片式选择**：可视化模板选择器，带有预览图片
- **预览功能**：全屏预览模板设计，点击 "Preview" 按钮查看完整预览
- **自定义模板**：支持自定义 HTML 模板，使用 Handlebars 语法
- **响应式设计**：完全响应式模板，针对桌面、笔记本电脑、平板电脑和移动设备优化

### 📊 用户体验

- **可视化进度条**：实时进度跟踪，显示百分比和状态更新
- **任务状态轮询**：异步任务处理，带状态更新
- **错误处理**：全面的错误处理，提供用户友好的错误消息
- **模板预览**：选择前全屏预览模板设计
- **自动后端检测**：前端自动检测后端 URL（支持 localhost、127.0.0.1 和本地 IP）
- **网络访问支持**：后端绑定到 0.0.0.0，支持局域网访问
- **加载状态**：提交按钮显示加载状态和进度提示

### 🔐 WordPress 集成

- **REST API 支持**：完整的 WordPress REST API 集成
- **Elementor 支持**：可选的 Elementor HTML 小部件发布
- **自定义 URL 前缀**：新页面自动添加 `/luxury-life-guides/` URL 前缀
- **SEO 元数据**：自动生成元描述、关键词、Open Graph 和结构化数据
- **自定义字段**：将 URL 前缀和其他元数据存储为自定义字段
- **URL 重写**：通过 WordPress 插件实现自定义 URL 结构，不影响现有页面

### 🔄 批量生成功能

- **关键词池**：支持提供多个长尾关键词，系统会依次处理
- **模板循环**：自动循环使用三个模板（模板 1、模板 2、模板 3）
- **标题类型循环**：自动循环使用所有标题类型
- **批量进度显示**：显示批量任务进度（如 `[1/5] 生成标题中...`）
- **批量结果汇总**：显示成功和失败的生成数量

### 📜 历史记录功能

- **生成历史查看**：查看所有生成任务的历史记录
- **搜索功能**：支持按关键词搜索历史记录
- **状态过滤**：按状态（成功、失败、进行中）过滤历史记录
- **记录详情**：显示关键词、页面标题、标题类型、模板类型、页面 URL、生成时间等
- **记录管理**：支持删除单个记录或清空所有记录
- **自动保存**：任务完成或失败时自动保存到历史记录

## 🏗️ 系统架构

### 后端（Node.js + TypeScript）

- **Express 服务器**：支持 CORS 的 RESTful API 服务器
- **Google AI 服务**：与 Google Generative AI SDK 集成
- **WordPress 服务**：WordPress/WooCommerce REST API 客户端
- **模板渲染器**：基于 Handlebars 的模板渲染引擎
- **任务管理**：异步任务处理，带状态跟踪
- **API 密钥管理**：API 密钥轮换，带重试逻辑和错误处理
- **历史记录存储**：内存存储生成历史记录（最多 1000 条）

### 前端（Vanilla JavaScript）

- **现代 UI**：简洁、响应式界面，采用卡片式设计
- **模板选择器**：可视化模板选择，带预览功能
- **进度跟踪**：实时进度条和详细日志
- **表单验证**：客户端验证，带错误消息
- **任务轮询**：自动状态轮询，支持中止
- **历史记录界面**：历史记录查看、搜索、过滤和管理界面

## 📦 项目结构

```
├── backend/
│   ├── src/
│   │   ├── services/
│   │   │   ├── googleAi.ts          # Google AI 内容生成
│   │   │   ├── wordpress.ts         # WordPress API 集成
│   │   │   ├── templateRenderer.ts  # Handlebars 模板渲染
│   │   │   └── apiKeyManager.ts     # API 密钥轮换和管理
│   │   ├── routes/
│   │   │   ├── generation.ts        # 页面生成端点
│   │   │   ├── tasks.ts             # 任务状态端点
│   │   │   └── history.ts           # 历史记录端点
│   │   ├── state/
│   │   │   ├── taskStore.ts         # 任务状态管理
│   │   │   └── historyStore.ts     # 历史记录存储
│   │   ├── knowledgeBase.ts         # 产品知识库
│   │   ├── types.ts                 # TypeScript 类型定义
│   │   └── app.ts                   # Express 应用配置
│   ├── server.ts                    # 服务器入口
│   └── package.json
├── frontend/
│   ├── index.html                   # 主应用界面
│   ├── main.js                     # 前端逻辑
│   ├── styles.css                  # 应用样式
│   ├── assets/
│   │   ├── logo.svg                # 项目 Logo
│   │   └── logo-icon.svg           # 网站图标
│   ├── default-template.html       # 模板 1
│   ├── template-2.html             # 模板 2
│   └── template-3.html             # 模板 3
├── wordpress-url-rewrite.php       # WordPress URL 重写插件
└── package.json                     # 根 package.json
```

## 🚀 快速开始

### 前置要求

- Node.js 18+ 和 npm
- 启用 REST API 的 WordPress 网站
- WooCommerce 插件（用于产品集成）
- Google AI Studio API 密钥（一个或多个）

### 安装步骤

1. **克隆仓库**
   ```bash
   git clone <repository-url>
   cd 长尾词落地页
   ```

2. **安装依赖**
   ```bash
   npm run install:all
   ```

3. **配置后端环境**
   ```bash
   cd backend
   # 创建 .env 文件，配置 Google AI API 密钥
   # 参考 backend/.env.example
   ```
   
   `.env` 文件示例：
   ```env
   GOOGLE_AI_API_KEYS=key1,key2,key3
   DEFAULT_MODEL=gemini-2.5-pro
   HTTP_PROXY=http://proxy.example.com:8080
   HTTPS_PROXY=http://proxy.example.com:8080
   NO_PROXY=localhost,127.0.0.1
   WORDPRESS_PROXY=https://proxy-vertu.vertu.com
   ```

4. **启动开发服务器**
   ```bash
   # 从根目录运行
   npm run dev
   ```
   这将启动：
   - 后端服务器：`http://localhost:4000`（也支持局域网访问）
   - 前端服务器：`http://localhost:8080`

### WordPress 设置

1. **安装 URL 重写插件**
   - 将 `wordpress-url-rewrite.php` 文件上传到 WordPress 的 `wp-content/plugins/` 目录
   - 在 WordPress 后台激活插件
   - 插件会自动处理 `/luxury-life-guides/` URL 前缀

2. **确保 REST API 已启用**
   - WordPress 4.7+ 默认启用 REST API
   - 访问 `https://your-site.com/wp-json/` 验证是否可用

3. **创建应用密码**
   - 进入 WordPress 后台：用户 → 个人资料
   - 滚动到 "应用密码" 部分
   - 创建新的应用密码（名称：如 "AI Content Engine"）
   - 保存生成的密码（格式：`xxxx xxxx xxxx xxxx xxxx xxxx`）

4. **配置 WooCommerce REST API**（可选，用于产品集成）
   - 进入 WooCommerce → 设置 → 高级 → REST API
   - 创建新的 API 密钥
   - 保存 Consumer Key 和 Consumer Secret

## 📖 使用指南

### 基本使用流程

1. **打开前端界面**：访问 `http://localhost:8080`
2. **配置后端 URL**：默认自动检测，也可手动设置（支持局域网 IP）
3. **输入 WordPress 凭据**：
   - 网站 URL（如：`https://vertu.com`）
   - 用户名（默认：`zicuo`）
   - 应用密码（默认已预填）
4. **选择模板**：从三个模板中选择一个，可点击 "Preview" 预览
5. **选择标题类型**：从 14+ 种标题类型中选择（影响内容和 FAQ 风格）
6. **输入长尾关键词**：输入要生成页面的关键词
7. **可选设置**：
   - **页面标题**：可选，如果为空则自动生成
   - **内容提示词**：可选，提供内容生成的方向和想法
   - **产品分类**：可选，指定要显示的产品分类（支持模糊匹配）
8. **提交任务**：点击 "生成并发布" 开始生成过程
9. **监控进度**：查看进度条和日志获取实时更新
10. **访问发布页面**：任务完成后，点击成功消息中的链接访问发布的页面

### 批量生成流程

1. **启用关键词池**：勾选 "使用关键词池（批量生成）"
2. **输入多个关键词**：在文本框中输入多个关键词，每行一个
3. **提交批量任务**：系统会自动：
   - 依次处理每个关键词
   - 循环使用三个模板
   - 循环使用所有标题类型
   - 显示批量进度（如 `[1/5] 生成标题中...`）
4. **查看结果**：任务完成后显示成功和失败的生成数量

### 查看历史记录

1. **打开历史记录**：滚动到页面底部的 "生成历史记录" 部分
2. **搜索记录**：在搜索框中输入关键词搜索
3. **过滤记录**：使用状态下拉菜单过滤（全部、成功、失败、进行中）
4. **刷新记录**：点击 "刷新" 按钮更新历史记录
5. **清空记录**：点击 "清空" 按钮删除所有历史记录
6. **查看详情**：点击记录查看详细信息
7. **访问页面**：点击 "查看页面" 链接访问生成的页面

## 🎨 模板系统

### 模板变量

模板使用 Handlebars 语法，支持以下变量：

- `{{PAGE_TITLE}}` - 页面标题
- `{{PAGE_DESCRIPTION}}` - 页面描述（模板 2 和 3）
- `{{{AI_GENERATED_CONTENT}}}` - 主要 AI 生成内容
- `{{{AI_EXTENDED_CONTENT}}}` - 扩展内容（仅模板 3）
- `{{#each products}}` - 产品循环（第一排产品）
- `{{#each productsRow2}}` - 第二排产品循环（模板 2 和 3）
- `{{#each relatedProducts}}` - 相关产品循环（"You may also like"）
- `{{#each faqItems}}` - FAQ 项目循环
- SEO 元标签和结构化数据

### 自定义模板

您可以上传自定义 HTML 模板，遵循 Handlebars 语法。系统会自动使用生成的内容和产品渲染您的模板。

### 模板特点

- **模板 1**：简洁的一屏内容，适合快速阅读
- **模板 2**：内容穿插在产品之间，提供更好的用户体验
- **模板 3**：无字数限制，适合深度内容，包含扩展内容部分

## 🔧 配置说明

### 环境变量（后端）

```env
# Google AI API 密钥（多个密钥用逗号分隔）
GOOGLE_AI_API_KEYS=key1,key2,key3

# 默认模型
DEFAULT_MODEL=gemini-2.5-pro

# 代理配置（可选）
HTTP_PROXY=http://proxy.example.com:8080
HTTPS_PROXY=http://proxy.example.com:8080
NO_PROXY=localhost,127.0.0.1
WORDPRESS_PROXY=https://proxy-vertu.vertu.com

# WooCommerce API（可选）
WOOCOMMERCE_CONSUMER_KEY=ck_xxxxx
WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxx
```

### API 密钥管理

系统支持多个 API 密钥，带自动轮换功能：
- 遇到速率限制（429）错误时自动轮换密钥
- 指数退避重试逻辑
- 自动回退到下一个密钥
- 详细的错误日志和诊断信息

### 产品搜索配置

系统支持多种产品搜索策略：
- **关键词匹配**：基于关键词搜索产品
- **分类匹配**：基于产品分类搜索
- **多产品关键词**：识别并匹配多个产品关键词
- **用户指定分类**：优先搜索用户指定的分类
- **模糊匹配**：支持产品名称和分类的模糊匹配

## 📊 任务状态流程

1. **待处理** (0%) - 初始状态
2. **已提交** (10%) - 任务提交成功
3. **生成标题中** (20%) - AI 正在生成页面标题
4. **生成内容中** (40%) - AI 正在生成文章内容
5. **获取产品中** (60%) - 从 WooCommerce 检索产品
6. **生成 HTML 中** (80%) - 渲染模板和内容
7. **发布中** (90%) - 发布到 WordPress
8. **已完成** (100%) - 任务成功完成

## 🛡️ 错误处理

系统包含全面的错误处理：

- **网络错误**：清晰的错误消息和故障排除步骤
- **API 错误**：详细的错误消息和重试逻辑
- **WordPress 错误**：针对认证和发布问题的特定错误消息
- **验证错误**：客户端和服务器端验证
- **产品搜索错误**：优雅降级，即使产品搜索失败也能继续生成页面

## 🔒 安全特性

- **API 密钥轮换**：多个 API 密钥，带自动轮换
- **WordPress 认证**：应用密码认证
- **输入验证**：全面的输入清理和验证
- **CORS 保护**：可配置的 CORS 设置
- **错误清理**：敏感信息不会在错误中暴露

## 📈 SEO 特性

- **元标签**：自动生成元描述和关键词
- **结构化数据**：Article 和 FAQPage 的 JSON-LD
- **Open Graph**：社交媒体分享标签
- **规范 URL**：正确的规范 URL 生成
- **H1/H2 结构**：SEO 友好的标题层次结构
- **关键词优化**：适当的关键词密度和位置
- **HTML lang 属性**：设置为 `en-GB`（英式英语）
- **Robots 标签**：可配置的 robots 元标签

## 🌐 浏览器支持

- Chrome/Edge（最新版本）
- Firefox（最新版本）
- Safari（最新版本）
- 移动浏览器（iOS Safari、Chrome Mobile）

## 📝 技术栈

- **后端**：Node.js, TypeScript, Express
- **AI 服务**：Google Generative AI SDK (Gemini 2.5 Pro)
- **WordPress 集成**：WordPress REST API, WooCommerce REST API
- **模板引擎**：Handlebars
- **前端**：Vanilla JavaScript, HTML5, CSS3
- **构建工具**：npm scripts

## 🤝 贡献指南

欢迎贡献！如果您想为项目做出贡献，请：

1. Fork 仓库
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 📧 支持

如有问题或疑问，请参考项目文档或在仓库中创建 Issue。

---

**构建工具**：Node.js, TypeScript, Express, Google Generative AI, WordPress REST API, Handlebars, Vanilla JavaScript

**版本**：1.0.0

**最后更新**：2025年1月
