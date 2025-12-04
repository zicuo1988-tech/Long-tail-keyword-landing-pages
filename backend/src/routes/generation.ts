import express from "express";
import { createTask, setTaskCompleted, setTaskError, updateTaskStatus } from "../state/taskStore.js";
import type { GenerationRequestPayload, ProductSummary } from "../types.js";
const LEARN_MORE_MAP: Record<string, string> = {
  "quantum flip": "https://vertu.com/quantum/",
  "metavertu 1 curve": "https://vertu.com/metavertu-curve/",
  "metavertu max": "https://vertu.com/metamax/",
  "grand watch": "https://vertu.com/grandwatch/",
  "meta ring": "https://vertu.com/aura-ring/",
  "signature s": "https://vertu.com/signature-s/",
  ironflip: "https://vertu.com/page-ironflip/",
  "ows earbuds": "https://vertu.com/ows-earbuds/",
  "ai diamond ring": "https://vertu.com/smartring/",
  "agent q": "https://vertu.com/agent-q/",
};

function attachLearnMoreLinks(items: ProductSummary[]): ProductSummary[] {
  return items.map((item) => {
    const nameLower = item.name?.toLowerCase() ?? "";
    const matchedKey = Object.keys(LEARN_MORE_MAP).find((key) => nameLower.includes(key));
    if (matchedKey) {
      return {
        ...item,
        learnMoreLink: LEARN_MORE_MAP[matchedKey],
      };
    }
    return item;
  });
}

function normalizeSiteUrl(url?: string): string {
  if (!url) return "";
  let normalized = url.trim();
  if (!normalized) return "";
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  return normalized.replace(/\/+$/, "");
}

function attachCategoryLinks(items: ProductSummary[], siteUrl: string): ProductSummary[] {
  if (!siteUrl) return items;
  const base = siteUrl.replace(/\/+$/, "");
  return items.map((item) => {
    if (item.categoryLink && item.categoryLink.startsWith("http")) {
      return item;
    }
    if (item.categorySlug) {
      const slug = item.categorySlug.replace(/^\/+|\/+$/g, "");
      return {
        ...item,
        categoryLink: `${base}/product-category/${slug}/`,
      };
    }
    return item;
  });
}
import { generateHtmlContent, generatePageTitle } from "../services/googleAi.js";
import { fetchRelatedProducts, publishPage } from "../services/wordpress.js";
import { renderTemplate } from "../services/templateRenderer.js";
import { createSlug } from "../utils/slug.js";

export const generationRouter = express.Router();

generationRouter.post("/generate-page", (req, res) => {
  const payload = req.body as GenerationRequestPayload;

  if (!payload?.keyword?.trim()) {
    return res.status(400).json({ error: "Keyword is required" });
  }
  if (!payload?.templateContent?.trim()) {
    return res.status(400).json({ error: "Template content is required" });
  }
  if (!payload?.wordpress) {
    return res.status(400).json({ error: "WordPress credentials are required" });
  }

  const task = createTask("Task queued");
  console.log('generate-page-------');

  void processTask(task.id, payload);

  return res.status(202).json({
    taskId: task.id,
    status: task.status,
    message: task.message,
  });
});

async function processTask(taskId: string, payload: GenerationRequestPayload) {
  try {
    // 如果请求中提供了 API Key，优先使用；否则使用环境变量中的 Key 池
    const apiKey = payload.googleApiKey || undefined;
    const siteBaseUrl = normalizeSiteUrl(payload.wordpress.url);

    // 如果页面标题为空，根据长尾词和选择的标题类型自动生成标题
    let finalPageTitle = payload.pageTitle?.trim() || "";
    if (!finalPageTitle) {
      const titleTypeName = payload.titleType 
        ? `标题类型: ${payload.titleType}`
        : "随机标题类型";
      updateTaskStatus(taskId, "generating_title", `正在根据长尾词和${titleTypeName}生成页面标题...`);
      try {
        finalPageTitle = await generatePageTitle({
          apiKey,
          keyword: payload.keyword,
          titleType: payload.titleType,
          onStatusUpdate: (message) => {
            updateTaskStatus(taskId, "generating_title", message);
          },
        });
        updateTaskStatus(taskId, "generating_title", `已生成标题: ${finalPageTitle}`);
        console.log(`[task ${taskId}] Generated page title: ${finalPageTitle}`);
      } catch (error) {
        console.error(`[task ${taskId}] Failed to generate title, using fallback:`, error);
        // 如果生成失败，使用对应类型的备用标题
        const getFallbackByType = (keyword: string, type?: string): string => {
          const typeFallbacks: Record<string, string[]> = {
            "purchase": [`Buy ${keyword} - Best Deals & Reviews`, `Purchase ${keyword} - Where to Buy`],
            "informational": [`Complete Guide to ${keyword}`, `Everything About ${keyword}`],
            "review": [`Best ${keyword} - Top Rated & Reviews`, `${keyword} Review: Top Rated`],
            "commercial": [`Best Deals on ${keyword}`, `Discounts for ${keyword}`],
            "how-to": [`How to Choose the Best ${keyword}`, `How to Find ${keyword}`],
            "recommendations": [`Top-rated ${keyword}: Expert Recommendations`, `Recommended ${keyword}`],
            "services-guides": [`${keyword} Usage Guide`, `${keyword} User Guide`],
            "tech-insights": [`${keyword} Comparison: Tech Insights`, `${keyword} Tech Comparison`],
            "comparison": [`${keyword} Comparison`, `Best ${keyword} Comparison`],
            "expert": [`${keyword} - Expert Buying Guide`, `Expert Guide to ${keyword}`],
            "best": [`Best ${keyword}: Quality Guide`, `Best ${keyword} - Top Rated`],
            "top": [`Top ${keyword}: Premium Choices`, `Top Rated ${keyword}`],
            "top-ranking": [`Top 10 ${keyword}: Complete Ranking`, `Top 5 ${keyword}: Best Rankings`],
            "most": [`Most Popular ${keyword}`, `Most Recommended ${keyword}`],
          };
          const fallbacks = typeFallbacks[type || ""] || [`${keyword} - Expert Buying Guide`];
          return fallbacks[Math.floor(Math.random() * fallbacks.length)];
        };
        finalPageTitle = getFallbackByType(payload.keyword, payload.titleType);
        updateTaskStatus(taskId, "generating_title", `使用备用标题（类型: ${payload.titleType || '默认'}）: ${finalPageTitle}`);
      }
    }

    updateTaskStatus(taskId, "generating_content", "正在生成 AI 内容和 FAQ...");
    const generatedContent = await generateHtmlContent({
      apiKey, // 如果为 undefined，将使用 API Key 管理器
      keyword: payload.keyword,
      pageTitle: finalPageTitle,
      titleType: payload.titleType, // 传递标题类型，用于调整内容风格和FAQ重点
      templateType: payload.templateType || "template-1", // 传递模板类型，template-3无字数限制
      onStatusUpdate: (message) => {
        // 更新任务状态，但不改变状态类型
        updateTaskStatus(taskId, "generating_content", message);
      },
    });

    updateTaskStatus(taskId, "fetching_products", "正在搜索相关产品...");
    let products: ProductSummary[] = [];
    let relatedProducts: ProductSummary[] = [];
    try {
      const productResult = await fetchRelatedProducts(payload.wordpress, payload.keyword);
      products = attachCategoryLinks(attachLearnMoreLinks(productResult.products), siteBaseUrl);
      relatedProducts = attachCategoryLinks(attachLearnMoreLinks(productResult.relatedProducts), siteBaseUrl);
      if (products.length === 0) {
        updateTaskStatus(taskId, "fetching_products", "未找到相关产品，继续发布页面...");
      } else {
        updateTaskStatus(taskId, "fetching_products", `找到 ${products.length} 个相关产品`);
      }
    } catch (error) {
      // 如果获取产品失败（如 WooCommerce 未安装），记录警告但继续执行
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[task ${taskId}] 获取产品失败，继续执行:`, errorMsg);
      updateTaskStatus(taskId, "fetching_products", "获取产品失败，继续发布页面（不包含产品列表）...");
      products = [];
      relatedProducts = [];
    }

    // 随机打乱产品数组，确保每次生成都是随机的
    function shuffleArray<T>(array: T[]): T[] {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

    // 将产品数组分组，每组4个，确保不重复
    function getUniqueProductGroups(allProducts: ProductSummary[], numGroups: number, productsPerGroup: number = 4): ProductSummary[][] {
      if (allProducts.length === 0) return [];
      
      // 随机打乱所有产品
      const shuffled = shuffleArray(allProducts);
      
      const groups: ProductSummary[][] = [];
      const usedProductIds = new Set<number>();
      
      for (let groupIndex = 0; groupIndex < numGroups; groupIndex++) {
        const group: ProductSummary[] = [];
        let attempts = 0;
        const maxAttempts = shuffled.length * 2; // 防止无限循环
        
        while (group.length < productsPerGroup && attempts < maxAttempts) {
          for (const product of shuffled) {
            if (group.length >= productsPerGroup) break;
            
            // 如果产品未被使用，添加到当前组
            if (!usedProductIds.has(product.id)) {
              group.push(product);
              usedProductIds.add(product.id);
            }
          }
          
          // 如果当前组还没满，但所有产品都已使用，则重新打乱并允许重复使用
          if (group.length < productsPerGroup) {
            // 允许重复使用产品（但优先使用未使用的）
            for (const product of shuffleArray(allProducts)) {
              if (group.length >= productsPerGroup) break;
              if (!group.some(p => p.id === product.id)) {
                group.push(product);
              }
            }
          }
          
          attempts++;
        }
        
        groups.push(group);
      }
      
      return groups;
    }

    // 为三个产品区域准备不同的产品列表（每排4个，不重复）
    const allProducts = [...products, ...relatedProducts];
    const productGroups = getUniqueProductGroups(allProducts, 3, 4);
    
    // 第一排产品（product-section）
    const productsRow1 = productGroups[0] || [];
    // 第二排产品（product-section2，第一个）
    const productsRow2 = productGroups[1] || [];
    // 第三排产品（product-section2，relatedProducts）
    const productsRow3 = productGroups[2] || [];
    
    const faqCategoryLink =
      productsRow1.find((p) => p.categoryLink)?.categoryLink ||
      productsRow2.find((p) => p.categoryLink)?.categoryLink ||
      productsRow3.find((p) => p.categoryLink)?.categoryLink ||
      products.find((p) => p.categoryLink)?.categoryLink ||
      relatedProducts.find((p) => p.categoryLink)?.categoryLink ||
      undefined;

    console.log(`[task ${taskId}] 产品分组完成:`);
    console.log(`  - 第一排产品数量: ${productsRow1.length}`);
    console.log(`  - 第二排产品数量: ${productsRow2.length}`);
    console.log(`  - 第三排产品数量: ${productsRow3.length}`);

    updateTaskStatus(taskId, "rendering_template", "正在渲染 HTML 模板...");
    
    // 检查模板内容
    console.log(`[task ${taskId}] 模板内容检查:`);
    console.log(`  - 模板长度: ${payload.templateContent.length}`);
    console.log(`  - 包含 PAGE_TITLE: ${payload.templateContent.includes('{{PAGE_TITLE}}')}`);
    console.log(`  - 包含 AI_GENERATED_CONTENT: ${payload.templateContent.includes('{{{AI_GENERATED_CONTENT}}}') || payload.templateContent.includes('{{AI_GENERATED_CONTENT}}')}`);
    console.log(`  - 包含 products 循环: ${payload.templateContent.includes('{{#each products}}')}`);
    console.log(`  - 包含 relatedProducts 循环: ${payload.templateContent.includes('{{#each relatedProducts}}')}`);
    console.log(`  - 包含 faqItems 循环: ${payload.templateContent.includes('{{#each faqItems}}')}`);
    
    // 检查数据
    console.log(`[task ${taskId}] 数据检查:`);
    console.log(`  - 页面标题: ${finalPageTitle}`);
    console.log(`  - AI 内容长度: ${generatedContent.articleContent.length}`);
    console.log(`  - 第一排产品数量: ${productsRow1.length}`);
    console.log(`  - 第二排产品数量: ${productsRow2.length}`);
    console.log(`  - 第三排产品数量: ${productsRow3.length}`);
    console.log(`  - FAQ 数量: ${generatedContent.faqItems.length}`);
    
    // 构建预期的页面URL（用于SEO meta标签）
    const baseSlug = createSlug(finalPageTitle) || createSlug(payload.keyword) || `page-${Date.now()}`;
    const expectedPageUrl = `${siteBaseUrl}/luxury-life-guides/${baseSlug}/`;

    const finalHtml = renderTemplate({
      templateContent: payload.templateContent,
      pageTitle: finalPageTitle,
      pageDescription: generatedContent.pageDescription, // 页面描述（用于模板2和模板3）
      metaDescription: generatedContent.metaDescription, // SEO meta description
      metaKeywords: generatedContent.metaKeywords, // SEO meta keywords
      pageUrl: expectedPageUrl, // 页面URL（用于canonical和Open Graph）
      aiContent: generatedContent.articleContent,
      extendedContent: generatedContent.extendedContent, // 扩展内容（用于模板3的第二部分）
      products: productsRow1, // 第一排产品（最多4个）
      productsRow2: productsRow2, // 第二排产品（最多4个）
      relatedProducts: productsRow3, // 第三排产品（最多4个）
      faqItems: generatedContent.faqItems,
      faqCategoryLink,
    });

    // 调试：检查渲染后的 HTML 内容
    console.log(`[task ${taskId}] 渲染后的 HTML 预览（前 500 字符）:`);
    console.log(finalHtml.substring(0, 500));
    console.log(`[task ${taskId}] 渲染后的 HTML 是否包含产品数据:`);
    if (products.length > 0) {
      const firstProductName = products[0].name || '';
      console.log(`  - 产品名称 "${firstProductName}" 在 HTML 中: ${finalHtml.includes(firstProductName)}`);
    }
    console.log(`  - 是否包含 "{{" 占位符: ${finalHtml.includes('{{')}`);
    console.log(`  - 是否包含 AI 内容: ${finalHtml.includes(generatedContent.articleContent.substring(0, 50))}`);

    updateTaskStatus(taskId, "publishing", "正在发布 WordPress 页面...");
    // 在slug前面添加 /luxury-life-guides/ 目录前缀
    const slug = `luxury-life-guides/${baseSlug}`;
    const page = await publishPage({
      credentials: payload.wordpress,
      title: finalPageTitle,
      slug,
      htmlContent: finalHtml,
      useElementor: payload.useElementor ?? true,
    });

    // 获取页面 URL
    const pageUrl = page?.link ?? page?.guid?.rendered ?? page?.guid?.raw;
    const baseUrl = payload.wordpress.url.endsWith("/") 
      ? payload.wordpress.url.slice(0, -1) 
      : payload.wordpress.url;
    
    // 获取页面的实际slug（WordPress返回的slug不包含前缀）
    const pageSlug = page?.slug || baseSlug;
    
    // 构建正确的URL（包含 /luxury-life-guides/ 前缀）
    const expectedUrl = `${baseUrl}/luxury-life-guides/${pageSlug}/`;
    
    if (!pageUrl) {
      // 如果 API 没有返回 URL，使用构建的 URL
      console.warn(`[task ${taskId}] WordPress API 未返回页面 URL，使用构建的 URL: ${expectedUrl}`);
      setTaskCompleted(taskId, `发布成功！页面 ID: ${page?.id || '未知'}`, expectedUrl);
    } else {
      // 检查返回的URL是否包含 /luxury-life-guides/ 前缀
      // 如果WordPress的permalink过滤器已生效，URL会包含前缀
      // 如果未生效（PHP代码未添加或重写规则未刷新），使用构建的URL
      let finalUrl = pageUrl;
      
      if (!pageUrl.includes("/luxury-life-guides/")) {
        // WordPress返回的URL不包含前缀，使用我们构建的URL
        console.warn(`[task ${taskId}] WordPress返回的URL不包含 /luxury-life-guides/ 前缀`);
        console.warn(`[task ${taskId}] 原始URL: ${pageUrl}`);
        console.warn(`[task ${taskId}] 使用构建的URL: ${expectedUrl}`);
        console.warn(`[task ${taskId}] 提示：请确保已将 wordpress-url-rewrite.php 代码添加到主题的 functions.php 并刷新了重写规则`);
        finalUrl = expectedUrl;
      } else {
        console.log(`[task ${taskId}] WordPress返回的URL已包含前缀: ${pageUrl}`);
      }
      
      console.log(`[task ${taskId}] 页面发布成功: ${finalUrl}`);
      setTaskCompleted(taskId, `发布成功！页面 ID: ${page?.id || '未知'}`, finalUrl);
    }
  } catch (error) {
    console.error(`[task ${taskId}]`, error);
    const message = error instanceof Error ? error.message : "生成流程失败";
    setTaskError(taskId, message);
  }
}
