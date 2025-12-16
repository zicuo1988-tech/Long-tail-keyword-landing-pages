import express from "express";
import { createTask, setTaskCompleted, setTaskError, updateTaskStatus, isTaskPaused, waitForTaskResume } from "../state/taskStore.js";
import type { GenerationRequestPayload, ProductSummary } from "../types.js";
import { extractMentionedProductsFromContent } from "../services/googleAi.js";
import { searchProductsByName } from "../services/wordpress.js";
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
import { fetchRelatedProducts, publishPage, searchProductsByName } from "../services/wordpress.js";
import { renderTemplate } from "../services/templateRenderer.js";
import { createSlug } from "../utils/slug.js";

/**
 * 优先推荐最新款产品（Agent Q, Quantum Flip, Metavertu Max等）
 * 将最新款产品排在前面，提高推荐优先级
 */
function prioritizeLatestProducts(products: ProductSummary[]): ProductSummary[] {
  if (!products || products.length === 0) return products;
  
  // 定义最新款产品优先级（数字越小优先级越高）
  const latestProductPriority: Record<string, number> = {
    "agent q": 1,
    "quantum flip": 2,
    "quantum": 2,
    "metavertu max": 3,
    "metamax": 3,
    "metavertu 1 curve": 4,
    "metavertu curve": 4,
    "metavertu": 5,
    "ivertu": 6,
    "signature s+": 7,
    "signature s": 8,
    "signature v": 9,
    "grand watch": 10,
    "metawatch": 11,
    "meta ring": 12,
    "ai diamond ring": 13,
    "ows earbuds": 14,
    "phantom earbuds": 15,
  };
  
  // 为每个产品计算优先级
  const productsWithPriority = products.map(product => {
    const nameLower = product.name.toLowerCase();
    let priority = 999; // 默认优先级（最低）
    
    // 检查产品名称是否匹配最新款产品
    for (const [productKey, productPriority] of Object.entries(latestProductPriority)) {
      if (nameLower.includes(productKey)) {
        priority = productPriority;
        break; // 找到匹配就停止
      }
    }
    
    return { product, priority };
  });
  
  // 按优先级排序（优先级数字越小越靠前）
  productsWithPriority.sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    // 如果优先级相同，保持原有顺序
    return 0;
  });
  
  // 提取排序后的产品
  const sortedProducts = productsWithPriority.map(item => item.product);
  
  // 记录排序结果（用于调试）
  if (sortedProducts.length > 0) {
    const topProducts = sortedProducts.slice(0, 5).map(p => p.name).join(", ");
    console.log(`[Product Priority] 产品已按最新款优先级排序，前5个: ${topProducts}`);
  }
  
  return sortedProducts;
}

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
    // 保存任务的关键信息到任务对象中（用于历史记录）
    updateTaskStatus(taskId, "queued", "任务已创建", {
      keyword: payload.keyword,
      pageTitle: payload.pageTitle,
      titleType: payload.titleType,
      templateType: payload.templateType,
    });

    // 如果请求中提供了 API Key，优先使用；否则使用环境变量中的 Key 池
    const apiKey = payload.googleApiKey || undefined;
    const siteBaseUrl = normalizeSiteUrl(payload.wordpress.url);

    // 如果页面标题为空，根据长尾词和选择的标题类型自动生成标题
    let finalPageTitle = payload.pageTitle?.trim() || "";
    if (!finalPageTitle) {
      // 在生成标题之前检查暂停状态
      await waitForTaskResume(taskId);
      if (isTaskPaused(taskId)) {
        return; // 任务已暂停，退出
      }
      
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
            // 在状态更新时检查暂停状态（不抛出错误，让后续检查处理）
            if (!isTaskPaused(taskId)) {
              updateTaskStatus(taskId, "generating_title", message);
            }
          },
          shouldAbort: () => isTaskPaused(taskId), // 传递暂停检查回调
        });
        
        // 生成标题后立即检查暂停状态
        if (isTaskPaused(taskId)) {
          return; // 任务已暂停，丢弃结果并退出
        }
        
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

    // 检查是否暂停
    await waitForTaskResume(taskId);
    if (isTaskPaused(taskId)) {
      return; // 任务已暂停，退出
    }
    
    updateTaskStatus(taskId, "generating_content", payload.userPrompt ? "正在根据您的提示词生成 AI 内容和 FAQ..." : "正在生成 AI 内容和 FAQ...");
    
    // 在生成内容之前再次检查暂停状态
    if (isTaskPaused(taskId)) {
      return; // 任务已暂停，退出
    }
    
    const generatedContent = await generateHtmlContent({
      apiKey, // 如果为 undefined，将使用 API Key 管理器
      keyword: payload.keyword,
      pageTitle: finalPageTitle,
      titleType: payload.titleType, // 传递标题类型，用于调整内容风格和FAQ重点
      templateType: payload.templateType || "template-1", // 传递模板类型，template-3无字数限制
      userPrompt: payload.userPrompt, // 传递用户提示词，AI将按照此提示词生成内容
      onStatusUpdate: (message) => {
        // 在状态更新时检查暂停状态（不抛出错误，让后续检查处理）
        if (!isTaskPaused(taskId)) {
          // 更新任务状态，但不改变状态类型
          updateTaskStatus(taskId, "generating_content", message);
        }
      },
      shouldAbort: () => isTaskPaused(taskId), // 传递暂停检查回调
    });

    // 生成内容后立即检查暂停状态
    if (isTaskPaused(taskId)) {
      return; // 任务已暂停，丢弃结果并退出
    }
    
    // 在获取产品之前检查暂停状态
    if (isTaskPaused(taskId)) {
      return; // 任务已暂停，退出
    }
    
    updateTaskStatus(taskId, "fetching_products", payload.targetCategory ? `正在搜索分类 "${payload.targetCategory}" 下的产品...` : "正在搜索相关产品...");
    let products: ProductSummary[] = [];
    let relatedProducts: ProductSummary[] = [];
    try {
      const productResult = await fetchRelatedProducts(payload.wordpress, payload.keyword, payload.targetCategory);
      
      // 获取产品后立即检查暂停状态
      if (isTaskPaused(taskId)) {
        return; // 任务已暂停，退出
      }
      products = attachCategoryLinks(attachLearnMoreLinks(productResult.products), siteBaseUrl);
      relatedProducts = attachCategoryLinks(attachLearnMoreLinks(productResult.relatedProducts), siteBaseUrl);
      
      // SEO优化：根据关键词和标题过滤相关产品
      const keywordLower = payload.keyword.toLowerCase();
      const pageTitleLower = (payload.pageTitle || "").toLowerCase();
      const combinedText = `${keywordLower} ${pageTitleLower}`;
      
      // 检测性别和目标受众
      const isMenTarget = combinedText.includes("丈夫") || combinedText.includes("husband") || 
                          combinedText.includes("men") || combinedText.includes("men's") ||
                          combinedText.includes("male") || combinedText.includes("gift for him") ||
                          combinedText.includes("for him") || combinedText.includes("his");
      const isWomenTarget = combinedText.includes("妻子") || combinedText.includes("wife") ||
                            combinedText.includes("women") || combinedText.includes("women's") ||
                            combinedText.includes("ladies") || combinedText.includes("lady") ||
                            combinedText.includes("female") || combinedText.includes("gift for her") ||
                            combinedText.includes("for her") || combinedText.includes("her");
      
      // 检测产品类型
      const isPhoneKeyword = keywordLower.includes("phone") || keywordLower.includes("smartphone") || 
                            keywordLower.includes("mobile") || keywordLower.includes("cell") ||
                            pageTitleLower.includes("phone") || pageTitleLower.includes("smartphone") ||
                            pageTitleLower.includes("mobile") || pageTitleLower.includes("cell");
      const isWatchKeyword = keywordLower.includes("watch") || keywordLower.includes("timepiece") ||
                            pageTitleLower.includes("watch") || pageTitleLower.includes("timepiece");
      const isRingKeyword = keywordLower.includes("ring") || keywordLower.includes("jewellery") ||
                           keywordLower.includes("jewelry") || pageTitleLower.includes("ring") ||
                           pageTitleLower.includes("jewellery") || pageTitleLower.includes("jewelry");
      const isEarbudKeyword = keywordLower.includes("earbud") || keywordLower.includes("earphone") ||
                              keywordLower.includes("audio") || keywordLower.includes("headphone") ||
                              pageTitleLower.includes("earbud") || pageTitleLower.includes("earphone");
      
      // 过滤相关产品的函数
      const filterProductsByRelevance = (productList: ProductSummary[]): ProductSummary[] => {
        return productList.filter(product => {
          const productName = product.name.toLowerCase();
          const productCategory = (product.category || "").toLowerCase();
          
          // 性别过滤
          if (isMenTarget && !isWomenTarget) {
            if (productName.includes("women") || productName.includes("women's") ||
                productName.includes("ladies") || productName.includes("lady") ||
                productName.includes("female") || productCategory.includes("women") ||
                productCategory.includes("ladies")) {
              return false;
            }
          }
          if (isWomenTarget && !isMenTarget) {
            if (productName.includes("men") || productName.includes("men's") ||
                productName.includes("male") || productCategory.includes("men") ||
                productCategory.includes("male")) {
              return false;
            }
          }
          
          // 产品类型过滤
          if (isPhoneKeyword) {
            return productName.includes("phone") || productName.includes("smartphone") ||
                   productName.includes("mobile") || productName.includes("agent") ||
                   productName.includes("quantum") || productName.includes("metavertu") ||
                   productName.includes("ivertu") || productName.includes("signature") ||
                   productCategory.includes("phone");
          } else if (isWatchKeyword) {
            return productName.includes("watch") || productName.includes("timepiece") ||
                   productName.includes("grand") || productName.includes("meta") ||
                   productCategory.includes("watch");
          } else if (isRingKeyword) {
            return productName.includes("ring") || productName.includes("jewellery") ||
                   productName.includes("jewelry") || productName.includes("diamond") ||
                   productName.includes("aura") || productCategory.includes("ring");
          } else if (isEarbudKeyword) {
            return productName.includes("earbud") || productName.includes("earphone") ||
                   productName.includes("audio") || productName.includes("headphone") ||
                   productName.includes("ows") || productCategory.includes("earbud");
          }
          
          return true; // 如果没有明确的产品类型要求，保留所有产品
        });
      };
      
      // 应用过滤
      products = filterProductsByRelevance(products);
      relatedProducts = filterProductsByRelevance(relatedProducts);
      
      // 优化：优先推荐最新款产品（Agent Q, Quantum Flip, Metavertu Max等）
      products = prioritizeLatestProducts(products);
      relatedProducts = prioritizeLatestProducts(relatedProducts);
      
      console.log(`[task ${taskId}] SEO产品过滤结果:`);
      console.log(`  - 关键词: ${payload.keyword}`);
      console.log(`  - 页面标题: ${payload.pageTitle || "未指定"}`);
      if (isMenTarget) console.log(`  - 目标受众: 男性/丈夫`);
      if (isWomenTarget) console.log(`  - 目标受众: 女性/妻子`);
      if (isPhoneKeyword) console.log(`  - 产品类型: 手机`);
      if (isWatchKeyword) console.log(`  - 产品类型: 手表`);
      if (isRingKeyword) console.log(`  - 产品类型: 戒指`);
      if (isEarbudKeyword) console.log(`  - 产品类型: 耳机`);
      console.log(`  - 过滤后主产品数: ${products.length}`);
      console.log(`  - 过滤后相关产品数: ${relatedProducts.length}`);
      
      // 针对奢华产品系列，补充 bespoke 分类的产品
      // keywordLower 已在上面声明（第288行），直接使用
      const isLuxuryKeyword = keywordLower.includes("luxury") || keywordLower.includes("premium") ||
                              keywordLower.includes("bespoke") || keywordLower.includes("exclusive") ||
                              keywordLower.includes("handcrafted") || keywordLower.includes("artisan");
      
      if (isLuxuryKeyword || products.length < 3) {
        // 在补充产品之前检查暂停状态
        if (isTaskPaused(taskId)) {
          return; // 任务已暂停，退出
        }
        
        try {
          updateTaskStatus(taskId, "fetching_products", "检测到奢华关键词，补充 bespoke 分类产品...");
          const bespokeResult = await fetchRelatedProducts(payload.wordpress, payload.keyword, "bespoke");
          
          // 补充产品后立即检查暂停状态
          if (isTaskPaused(taskId)) {
            return; // 任务已暂停，退出
          }
          
          const bespokeProducts = attachCategoryLinks(attachLearnMoreLinks(bespokeResult.products), siteBaseUrl);
          const prioritizedBespoke = prioritizeLatestProducts(bespokeProducts);
          
          // 合并 bespoke 产品，避免重复，优先显示最新款
          const existingIds = new Set(products.map(p => p.id));
          const newBespokeProducts = prioritizedBespoke.filter(p => !existingIds.has(p.id));
          
          if (newBespokeProducts.length > 0) {
            // 将 bespoke 产品插入到前面（优先显示）
            products = [...newBespokeProducts.slice(0, 3), ...products];
            updateTaskStatus(taskId, "fetching_products", `已补充 ${newBespokeProducts.length} 个 bespoke 产品`);
            console.log(`[task ${taskId}] ✅ 已补充 bespoke 产品: ${newBespokeProducts.map(p => p.name).join(", ")}`);
          }
        } catch (e) {
          console.warn(`[task ${taskId}] 补充 bespoke 产品失败:`, e);
        }
      }
      
      if (products.length === 0) {
        updateTaskStatus(taskId, "fetching_products", "未找到相关产品，继续发布页面...");
      } else {
        updateTaskStatus(taskId, "fetching_products", `找到 ${products.length} 个相关产品（已优化排序）`);
      }

      // 如果内容/关键词涉及手机但列表里没手机类目，补充拉取手机产品，避免页面突兀
      // 注意：keywordLower 已在上面声明，这里直接使用
      const contentSuggestsPhone =
        /phone|mobile|smartphone|fold|flip|hinge|camera\s+phone|best phone/i.test(payload.keyword) ||
        generatedContent.articleContent.toLowerCase().includes("phone");
      const hasPhoneProduct = products.some(
        (p) =>
          (p.category?.toLowerCase().includes("phone") || p.name.toLowerCase().includes("phone")) ||
          (p.categorySlug?.includes("phone") ?? false)
      );
      if (contentSuggestsPhone && !hasPhoneProduct) {
        // 在补充手机产品之前检查暂停状态
        if (isTaskPaused(taskId)) {
          return; // 任务已暂停，退出
        }
        
        try {
          updateTaskStatus(taskId, "fetching_products", "未找到手机产品，尝试补充手机类目...");
          const phoneResult = await fetchRelatedProducts(payload.wordpress, payload.keyword, "phones");
          
          // 补充手机产品后立即检查暂停状态
          if (isTaskPaused(taskId)) {
            return; // 任务已暂停，退出
          }
          
          const phoneProducts = attachCategoryLinks(attachLearnMoreLinks(phoneResult.products), siteBaseUrl);
          // 只取前4个作为补充，避免过多，并应用优先级排序
          const prioritizedPhoneProducts = prioritizeLatestProducts(phoneProducts);
          products = [...prioritizedPhoneProducts.slice(0, 4), ...products];
          updateTaskStatus(taskId, "fetching_products", `已补充 ${phoneProducts.length} 个手机产品（已优化排序）`);
        } catch (e) {
          console.warn("[task %s] 补充手机类目失败: %s", taskId, e);
        }
      }
    } catch (error) {
      // 如果获取产品失败（如 WooCommerce 未安装），记录警告但继续执行
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[task ${taskId}] 获取产品失败，继续执行:`, errorMsg);
      updateTaskStatus(taskId, "fetching_products", "获取产品失败，继续发布页面（不包含产品列表）...");
      products = [];
      relatedProducts = [];
    }

    // SEO优化：确保内容中提到的产品也出现在产品列表中，且与关键词相关
    try {
      // 从生成的内容中提取提到的产品
      const allContent = `${generatedContent.articleContent} ${generatedContent.extendedContent || ""} ${generatedContent.faqItems.map(f => `${f.question} ${f.answer}`).join(" ")}`;
      const mentionedProducts = extractMentionedProductsFromContent(allContent);
      
      if (mentionedProducts.length > 0) {
        console.log(`[task ${taskId}] 内容中提到的产品: ${mentionedProducts.join(", ")}`);
        
        // SEO过滤：只搜索与关键词相关的产品
        // 注意：这里的变量名与上面的不同，因为它们在独立的 try 块内
        const keywordLowerForFilter = payload.keyword.toLowerCase();
        const pageTitleLower = (payload.pageTitle || "").toLowerCase();
        const combinedText = `${keywordLowerForFilter} ${pageTitleLower}`;
        
        // 检测产品类型和性别
        const isPhoneKeywordForFilter = combinedText.includes("phone") || combinedText.includes("smartphone") || combinedText.includes("mobile");
        const isWatchKeywordForFilter = combinedText.includes("watch") || combinedText.includes("timepiece");
        const isRingKeywordForFilter = combinedText.includes("ring") || combinedText.includes("jewellery") || combinedText.includes("jewelry");
        const isEarbudKeywordForFilter = combinedText.includes("earbud") || combinedText.includes("earphone") || combinedText.includes("audio");
        const isMenTarget = combinedText.includes("丈夫") || combinedText.includes("husband") || combinedText.includes("men") || combinedText.includes("men's");
        const isWomenTarget = combinedText.includes("妻子") || combinedText.includes("wife") || combinedText.includes("women") || combinedText.includes("women's");
        
        // 过滤：只保留与关键词相关的产品
        const relevantMentionedProducts = mentionedProducts.filter(productName => {
          const nameLower = productName.toLowerCase();
          
          // 性别过滤
          if (isMenTarget && !isWomenTarget) {
            if (nameLower.includes("women") || nameLower.includes("women's") || nameLower.includes("ladies") || nameLower.includes("lady")) {
              return false;
            }
          }
          if (isWomenTarget && !isMenTarget) {
            if (nameLower.includes("men") || nameLower.includes("men's") || nameLower.includes("male")) {
              return false;
            }
          }
          
          // 产品类型过滤
          if (isPhoneKeywordForFilter) {
            return nameLower.includes("phone") || nameLower.includes("agent") || nameLower.includes("quantum") || 
                   nameLower.includes("metavertu") || nameLower.includes("ivertu") || nameLower.includes("signature");
          } else if (isWatchKeywordForFilter) {
            return nameLower.includes("watch") || nameLower.includes("timepiece") || nameLower.includes("grand");
          } else if (isRingKeywordForFilter) {
            return nameLower.includes("ring") || nameLower.includes("jewellery") || nameLower.includes("jewelry") || nameLower.includes("diamond");
          } else if (isEarbudKeywordForFilter) {
            return nameLower.includes("earbud") || nameLower.includes("earphone") || nameLower.includes("audio") || nameLower.includes("ows");
          }
          
          // 如果没有明确的产品类型要求，检查是否包含关键词
          if (keywordLowerForFilter && nameLower.includes(keywordLowerForFilter)) {
            return true;
          }
          
          // 默认保留（如果没有明确的过滤条件）
          return true;
        });
        
        console.log(`[task ${taskId}] SEO过滤后的相关产品: ${relevantMentionedProducts.join(", ")}`);
        
        // 检查这些产品是否已经在产品列表中
        const existingProductNames = new Set(
          [...products, ...relatedProducts].map(p => p.name.toLowerCase())
        );
        
        const missingProducts = relevantMentionedProducts.filter(
          productName => !existingProductNames.has(productName.toLowerCase())
        );
        
        if (missingProducts.length > 0) {
          // 在搜索产品之前检查暂停状态
          if (isTaskPaused(taskId)) {
            return; // 任务已暂停，退出
          }
          
          console.log(`[task ${taskId}] 内容中提到的产品但不在产品列表中，正在搜索: ${missingProducts.join(", ")}`);
          updateTaskStatus(taskId, "fetching_products", `正在搜索内容中提到的产品: ${missingProducts.join(", ")}...`);
          
          // 从 WordPress 中搜索这些产品
          const foundProducts = await searchProductsByName(payload.wordpress, missingProducts);
          
          // 搜索产品后立即检查暂停状态
          if (isTaskPaused(taskId)) {
            return; // 任务已暂停，退出
          }
          
          if (foundProducts.length > 0) {
            // 将找到的产品添加到产品列表的开头（优先显示）
            const processedFoundProducts = attachCategoryLinks(
              attachLearnMoreLinks(foundProducts),
              siteBaseUrl
            );
            
            // 去重：移除已存在的产品（按ID）
            const existingProductIds = new Set([...products, ...relatedProducts].map(p => p.id));
            const newProducts = processedFoundProducts.filter(p => !existingProductIds.has(p.id));
            
            // 将内容中提到的产品添加到列表开头，优先显示
            products = [...newProducts, ...products];
            
            console.log(`[task ${taskId}] ✅ 已将内容中提到的 ${newProducts.length} 个产品添加到产品列表: ${newProducts.map(p => p.name).join(", ")}`);
            updateTaskStatus(taskId, "fetching_products", `找到 ${products.length} 个相关产品（包含内容中提到的产品）`);
          } else {
            console.log(`[task ${taskId}] ⚠️ 未在 WordPress 中找到内容中提到的产品: ${missingProducts.join(", ")}`);
          }
        } else {
          console.log(`[task ${taskId}] ✅ 内容中提到的产品已全部在产品列表中`);
        }
      }
    } catch (error) {
      // 如果提取或搜索产品失败，记录警告但继续执行
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[task ${taskId}] 提取或搜索内容中提到的产品失败，继续执行:`, errorMsg);
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

    // 将产品数组分组，每组4个，确保不重复，优先显示与关键词相关的产品
    function getUniqueProductGroups(allProducts: ProductSummary[], numGroups: number, productsPerGroup: number = 4, keyword: string = "", pageTitle: string = ""): ProductSummary[][] {
      if (allProducts.length === 0) return [];
      
      // SEO优化：根据关键词相关性对产品进行排序
      const keywordLower = keyword.toLowerCase();
      const pageTitleLower = (pageTitle || "").toLowerCase();
      const combinedText = `${keywordLower} ${pageTitleLower}`;
      
      // 计算产品相关性得分
      const scoredProducts = allProducts.map(product => {
        let score = 0;
        const productName = product.name.toLowerCase();
        const productCategory = (product.category || "").toLowerCase();
        
        // 产品名称包含关键词
        if (keywordLower && productName.includes(keywordLower)) {
          score += 10;
        }
        
        // 产品分类包含关键词
        if (keywordLower && productCategory.includes(keywordLower)) {
          score += 5;
        }
        
        // 标题中明确提到的产品类型匹配
        if (combinedText.includes("phone") || combinedText.includes("smartphone")) {
          if (productName.includes("phone") || productName.includes("agent") || productName.includes("quantum") || productName.includes("metavertu")) {
            score += 8;
          }
        }
        if (combinedText.includes("watch") || combinedText.includes("timepiece")) {
          if (productName.includes("watch")) {
            score += 8;
          }
        }
        if (combinedText.includes("ring")) {
          if (productName.includes("ring")) {
            score += 8;
          }
        }
        if (combinedText.includes("earbud") || combinedText.includes("earphone")) {
          if (productName.includes("earbud") || productName.includes("earphone")) {
            score += 8;
          }
        }
        
        return { product, score };
      });
      
      // 按相关性得分排序（得分高的在前）
      scoredProducts.sort((a, b) => b.score - a.score);
      
      // 提取排序后的产品列表
      const sortedProducts = scoredProducts.map(item => item.product);
      
      const groups: ProductSummary[][] = [];
      const usedProductIds = new Set<number>();
      
      for (let groupIndex = 0; groupIndex < numGroups; groupIndex++) {
        const group: ProductSummary[] = [];
        let attempts = 0;
        const maxAttempts = sortedProducts.length * 2; // 防止无限循环
        
        while (group.length < productsPerGroup && attempts < maxAttempts) {
          for (const product of sortedProducts) {
            if (group.length >= productsPerGroup) break;
            
            // 如果产品未被使用，添加到当前组
            if (!usedProductIds.has(product.id)) {
              group.push(product);
              usedProductIds.add(product.id);
            }
          }
          
          // 如果当前组还没满，但所有产品都已使用，则允许重复使用（但优先使用未使用的）
          if (group.length < productsPerGroup) {
            for (const product of sortedProducts) {
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

    // 为三个产品区域准备不同的产品列表（每排4个，不重复，优先显示与关键词相关的产品）
    const allProducts = [...products, ...relatedProducts];
    const productGroups = getUniqueProductGroups(allProducts, 3, 4, payload.keyword, payload.pageTitle || "");
    
    // 第一排产品（product-section）
    let productsRow1 = productGroups[0] || [];
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

    // 为模板4和模板5生成封面图URL（基于页面标题生成）
    let pageImageUrl = "";
    if (payload.templateType === "template-4" || payload.templateType === "template-5") {
      // 生成封面图URL，格式：https://vertu-website-oss.vertu.com/2025/12/screencapture-vertu-luxury-life-guides-{slug}-scaled.jpg
      const currentDate = new Date();
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, "0");
      // 使用baseSlug生成图片文件名（保持连字符格式）
      const imageSlug = baseSlug;
      pageImageUrl = `https://vertu-website-oss.vertu.com/${year}/${month}/screencapture-vertu-luxury-life-guides-${imageSlug}-scaled.jpg`;
      console.log(`[task ${taskId}] ✅ ${payload.templateType === "template-4" ? "模板4" : "模板5"}封面图URL已生成: ${pageImageUrl}`);
    }

    // 为模板4和模板5准备特殊数据
    const isTemplate4 = payload.templateType === "template-4";
    const isTemplate5 = payload.templateType === "template-5";
    let topProducts: ProductSummary[] = [];
    let comparisonItems: Array<{ 
      name: string; 
      feature: string; 
      price: string; 
      material?: string; 
      keyFeature?: string; 
      display?: string; 
      battery?: string; 
      conciergeService?: string; 
      conciergeServiceLink?: string; 
      isExternal?: boolean; 
      externalUrl?: string; 
      productLink?: string; 
    }> = [];
    let internalLinks: Array<{ title: string; url: string }> = [];
    let externalLinks: Array<{ title: string; url: string; description?: string }> = [];

    if (isTemplate4 || isTemplate5) {
      // 提前声明 keywordLower，避免在后续代码中使用时出现初始化错误
      const keywordLower = payload.keyword.toLowerCase();
      const pageTitleLower = (payload.pageTitle || "").toLowerCase();
      const combinedText = `${keywordLower} ${pageTitleLower}`;
      
      // 检测性别关键词
      const isMenTarget = combinedText.includes("丈夫") || combinedText.includes("husband") || 
                          combinedText.includes("men") || combinedText.includes("men's") ||
                          combinedText.includes("male") || combinedText.includes("gift for him") ||
                          combinedText.includes("for him") || combinedText.includes("his");
      const isWomenTarget = combinedText.includes("妻子") || combinedText.includes("wife") ||
                            combinedText.includes("women") || combinedText.includes("women's") ||
                            combinedText.includes("ladies") || combinedText.includes("lady") ||
                            combinedText.includes("female") || combinedText.includes("gift for her") ||
                            combinedText.includes("for her") || combinedText.includes("her");
      
      // 检测产品类型关键词（同时检查关键词和标题）
      const isPhoneKeyword = keywordLower.includes("phone") || keywordLower.includes("smartphone") || 
                            keywordLower.includes("mobile") || keywordLower.includes("cell") ||
                            pageTitleLower.includes("phone") || pageTitleLower.includes("smartphone") ||
                            pageTitleLower.includes("mobile") || pageTitleLower.includes("cell");
      const isWatchKeyword = keywordLower.includes("watch") || keywordLower.includes("timepiece") ||
                            pageTitleLower.includes("watch") || pageTitleLower.includes("timepiece");
      const isRingKeyword = keywordLower.includes("ring") || keywordLower.includes("jewellery") ||
                           keywordLower.includes("jewelry") || pageTitleLower.includes("ring") ||
                           pageTitleLower.includes("jewellery") || pageTitleLower.includes("jewelry");
      const isEarbudKeyword = keywordLower.includes("earbud") || keywordLower.includes("earphone") ||
                              keywordLower.includes("audio") || keywordLower.includes("headphone") ||
                              pageTitleLower.includes("earbud") || pageTitleLower.includes("earphone");
      
      // 产品相关性过滤函数：确保产品与关键词相关
      const filterRelevantProducts = (products: ProductSummary[]): ProductSummary[] => {
        const relevantKeywords: string[] = [];
        
        // 根据关键词类型确定相关产品关键词（优先匹配明确的产品类型）
        if (isPhoneKeyword) {
          // 明确提到手机：只推荐手机产品
          relevantKeywords.push("phone", "smartphone", "mobile", "cell", "agent", "quantum", "metavertu", "ivertu", "signature");
        } else if (isWatchKeyword) {
          relevantKeywords.push("watch", "timepiece", "grand", "meta");
        } else if (isRingKeyword) {
          relevantKeywords.push("ring", "jewellery", "jewelry", "meta ring", "aura", "diamond");
        } else if (isEarbudKeyword) {
          relevantKeywords.push("earbud", "earphone", "audio", "headphone", "ows");
        } else if (keywordLower.includes("security") || keywordLower.includes("secure") || keywordLower.includes("privacy")) {
          // 安全相关关键词：优先手机产品
          relevantKeywords.push("phone", "smartphone", "mobile", "agent", "quantum", "metavertu", "ivertu");
        } else {
          // 默认：包含所有产品类型关键词
          relevantKeywords.push("phone", "watch", "ring", "earbud", "agent", "quantum", "metavertu", "ivertu");
        }
        
        return products.filter(product => {
          const productName = product.name.toLowerCase();
          const productCategory = (product.category || "").toLowerCase();
          
          // 性别过滤：如果明确针对男性，过滤掉女士产品
          if (isMenTarget && !isWomenTarget) {
            // 过滤掉明确标注为女士的产品
            if (productName.includes("women") || productName.includes("women's") ||
                productName.includes("ladies") || productName.includes("lady") ||
                productName.includes("female") || productCategory.includes("women") ||
                productCategory.includes("ladies")) {
              return false;
            }
          }
          
          // 性别过滤：如果明确针对女性，过滤掉男士产品
          if (isWomenTarget && !isMenTarget) {
            // 过滤掉明确标注为男士的产品
            if (productName.includes("men") || productName.includes("men's") ||
                productName.includes("male") || productCategory.includes("men") ||
                productCategory.includes("male")) {
              return false;
            }
          }
          
          // 检查产品名称或分类是否包含相关关键词
          return relevantKeywords.some(keyword => 
            productName.includes(keyword.toLowerCase()) || 
            productCategory.includes(keyword.toLowerCase())
          );
        });
      };
      
      // 过滤第一排产品，确保与关键词相关
      const relevantProductsRow1 = filterRelevantProducts(productsRow1);
      console.log(`[task ${taskId}] 产品相关性过滤:`);
      console.log(`  - 关键词: ${payload.keyword}`);
      console.log(`  - 页面标题: ${payload.pageTitle || "未指定"}`);
      if (isMenTarget) {
        console.log(`  - 目标受众: 男性/丈夫 (已过滤女士产品)`);
      } else if (isWomenTarget) {
        console.log(`  - 目标受众: 女性/妻子 (已过滤男士产品)`);
      }
      if (isPhoneKeyword) {
        console.log(`  - 产品类型: 手机 (优先推荐手机产品)`);
      } else if (isWatchKeyword) {
        console.log(`  - 产品类型: 手表`);
      } else if (isRingKeyword) {
        console.log(`  - 产品类型: 戒指`);
      } else if (isEarbudKeyword) {
        console.log(`  - 产品类型: 耳机`);
      }
      console.log(`  - 第一排原始产品数: ${productsRow1.length}`);
      console.log(`  - 过滤后相关产品数: ${relevantProductsRow1.length}`);
      if (productsRow1.length > relevantProductsRow1.length) {
        const filteredOut = productsRow1.filter(p => !relevantProductsRow1.includes(p));
        console.log(`  - 已过滤掉不相关产品: ${filteredOut.map(p => p.name).join(", ")}`);
      }
      
      // 如果过滤后产品不足，尝试从其他排补充
      let allRelevantProducts = [...relevantProductsRow1];
      if (allRelevantProducts.length < 3) {
        const relevantProductsRow2 = filterRelevantProducts(productsRow2);
        const relevantProductsRow3 = filterRelevantProducts(productsRow3);
        allRelevantProducts = [...allRelevantProducts, ...relevantProductsRow2, ...relevantProductsRow3];
        // 去重（按ID）
        const uniqueProducts = Array.from(new Map(allRelevantProducts.map(p => [p.id, p])).values());
        allRelevantProducts = uniqueProducts;
        console.log(`  - 从其他排补充后相关产品总数: ${allRelevantProducts.length}`);
      }
      
      // 如果仍然没有相关产品，使用原始产品（避免空列表）
      if (allRelevantProducts.length === 0) {
        console.warn(`[task ${taskId}] ⚠️ 警告：未找到与关键词 "${payload.keyword}" 相关的产品，使用原始产品列表`);
        allRelevantProducts = productsRow1.slice(0, 3);
      }
      
      // Top Picks: 取相关产品的前3个
      topProducts = allRelevantProducts.slice(0, 3);
      console.log(`  - Top Picks产品: ${topProducts.map(p => p.name).join(", ")}`);
      
      // 对比表: 从前3个相关产品中提取对比信息（智能化、多元化，根据关键词动态调整对比维度）
      const productsForComparison = allRelevantProducts.slice(0, 3);
      
      // 根据关键词确定对比重点（智能化对比维度选择）
      const isSecurityKeyword = keywordLower.includes("security") || keywordLower.includes("secure") || keywordLower.includes("privacy") || keywordLower.includes("protection");
      const isPerformanceKeyword = keywordLower.includes("performance") || keywordLower.includes("speed") || keywordLower.includes("power") || keywordLower.includes("fast");
      const isDesignKeyword = keywordLower.includes("design") || keywordLower.includes("luxury") || keywordLower.includes("premium") || keywordLower.includes("craftsmanship");
      const isCameraKeyword = keywordLower.includes("camera") || keywordLower.includes("photo") || keywordLower.includes("photography");
      const isBatteryKeyword = keywordLower.includes("battery") || keywordLower.includes("charging") || keywordLower.includes("power");
      
      comparisonItems = productsForComparison.map(product => {
        const productName = product.name.replace(/<[^>]*>/g, "").trim();
        // 获取产品链接（优先使用 learnMoreLink，否则使用 link）
        const productLink = product.learnMoreLink || product.link || "";
        
        // 根据产品名称提取关键信息（使用知识库中的详细规格）
        let material = "Premium Materials";
        let keyFeature = "Luxury Craftsmanship";
        let display = "Premium Display";
        let battery = "Long Battery Life";
        let conciergeService = "Ruby Key: 24/7 Concierge Service"; // 硬性要求：所有内部产品必须包含Ruby Key
        
        // 根据产品类型设置具体信息（基于知识库数据）
        const nameLower = productName.toLowerCase();
        if (nameLower.includes("agent q")) {
          material = "Swiss Hinge, Gold-Plated Internals, Ceramic Pillow";
          if (isSecurityKeyword) {
            keyFeature = "Five-Layer Data Sovereignty, Triple-System Architecture, 10TB Distributed Vault";
          } else if (isPerformanceKeyword) {
            keyFeature = "Snapdragon 8 Elite Supreme (3nm), 16GB RAM, AI Agent System (200+ Agents)";
          } else {
            keyFeature = "AI Agent System (200+ Agents), AIGS, Ruby Talk";
          }
          display = "6.82\" FHD+ AMOLED, 120Hz";
          battery = "5,565 mAh, 65W Fast Charging";
          conciergeService = "Ruby Key: 24/7 Concierge + AIGS Proactive Intelligence";
        } else if (nameLower.includes("quantum") || nameLower.includes("flip")) {
          material = "Aerospace Titanium Alloy (HV900 Hardness)";
          if (isSecurityKeyword) {
            keyFeature = "Quantum Security (BB84 Protocol), Three-Finger Biometric, Triple Isolated Systems";
          } else if (isPerformanceKeyword) {
            keyFeature = "Snapdragon 8 Elite Supreme 3nm, 16GB RAM, 1TB Storage, 3D Liquid Cooling";
          } else if (isCameraKeyword) {
            keyFeature = "50MP Rear OIS, 64MP Telephoto, 32MP Front, 4K 60fps Video";
          } else {
            keyFeature = "Quantum Security, AI Ecosystem (400+ Agents), 76-Language Translation";
          }
          display = "6.9\" FHD+ OLED Foldable, 3\" Cover Display, 120Hz";
          battery = "4,300 mAh, 65W Flash Charging (70% in 20 min)";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("metavertu max") || nameLower.includes("metamax")) {
          material = "Aerospace 316L Stainless Steel, Ceramic Frame, Sapphire Lens";
          if (isSecurityKeyword) {
            keyFeature = "Triple-System Architecture, Dedicated Security Chip, One-Key Destruction";
          } else if (isPerformanceKeyword) {
            keyFeature = "Snapdragon 8 Gen 2, 12GB RAM, 512GB + 10TB Distributed Vault";
          } else {
            keyFeature = "Web3 Dual-AI Brain, Triple-System Architecture, Blockchain Security";
          }
          display = "6.78\" 1.5K OLED, 120Hz";
          battery = "5,100 mAh, 55W Charging, 10TB Distributed Storage";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("metavertu") && (nameLower.includes("curve") || nameLower.includes("1"))) {
          material = "Premium Materials, Luxury Craftsmanship";
          keyFeature = "Advanced Features, Premium Build";
          display = "Premium Display";
          battery = "Long Battery Life";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("watch") || nameLower.includes("grand")) {
          material = "Swiss Craftsmanship, Premium Materials";
          keyFeature = "Luxury Timepiece, Swiss Movement";
          display = "Premium Watch Face, Swiss Precision";
          battery = "Swiss Movement, Mechanical/Automatic";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("ring") || nameLower.includes("meta ring") || nameLower.includes("aura ring")) {
          material = "Premium Materials, Smart Technology";
          keyFeature = "Smart Technology, AI-Powered";
          display = "N/A";
          battery = "Long-lasting Battery";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("ai diamond ring") || nameLower.includes("smartring")) {
          material = "Diamond, Premium Materials";
          keyFeature = "AI-Powered, Smart Technology";
          display = "N/A";
          battery = "Long-lasting";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("earbud") || nameLower.includes("audio") || nameLower.includes("ows")) {
          material = "Premium Build, High-Quality Materials";
          keyFeature = "High-Fidelity Audio, Premium Sound";
          display = "N/A";
          battery = "Extended Playback, Long Battery Life";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("ivertu") || nameLower.includes("calfskin")) {
          // iVERTU 系列产品
          material = "Calfskin Leather, Premium Materials";
          keyFeature = "5G Connectivity, Luxury Design";
          display = "Premium Display";
          battery = "Long Battery Life, Fast Charging";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else if (nameLower.includes("signature")) {
          material = "Premium Materials, Luxury Craftsmanship";
          keyFeature = "Signature Series, Premium Features";
          display = "Premium Display";
          battery = "Long Battery Life";
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        } else {
          // 默认产品
          conciergeService = "Ruby Key: 24/7 Concierge Service";
        }
        
        return {
          name: productName,
          feature: product.category || "Premium Device",
          price: product.price || "Price on request",
          material: material,
          keyFeature: keyFeature,
          display: display,
          battery: battery,
          conciergeService: conciergeService, // 硬性要求：Ruby Key管家服务
          conciergeServiceLink: `${siteBaseUrl}/ruby-key/`, // Ruby Key服务页面链接
          isExternal: false,
          productLink: productLink
        };
      });
      
      // 添加1-3个外部类似产品对比（根据关键词类型，智能化调整对比维度）
      const externalComparisons: Array<{ name: string; feature: string; price: string; material?: string; keyFeature?: string; display?: string; battery?: string; conciergeService?: string; isExternal?: boolean; externalUrl?: string }> = [];
      
      if (keywordLower.includes("watch") || keywordLower.includes("timepiece")) {
        // 手表类：添加其他品牌手表对比（多样化选择）
        const watchOptions = [
          {
            name: "Rolex Submariner",
            feature: "Luxury Swiss Watch",
            price: "$8,000 - $15,000",
            material: "904L Steel, Ceramic",
            keyFeature: "Dive Watch Heritage",
            display: "Mechanical Movement",
            battery: "Automatic Movement",
            externalUrl: "https://www.rolex.com/"
          },
          {
            name: "Omega Speedmaster",
            feature: "Swiss Luxury Watch",
            price: "$5,000 - $8,000",
            material: "Stainless Steel",
            keyFeature: "Moonwatch Legacy",
            display: "Mechanical Chronograph",
            battery: "Manual/Auto Movement",
            externalUrl: "https://www.omegawatches.com/"
          },
          {
            name: "Patek Philippe Nautilus",
            feature: "Luxury Swiss Watch",
            price: "$30,000 - $100,000+",
            material: "Stainless Steel, Gold",
            keyFeature: "Iconic Design, Swiss Craftsmanship",
            display: "Mechanical Movement",
            battery: "Automatic Movement",
            externalUrl: "https://www.patek.com/"
          },
          {
            name: "Audemars Piguet Royal Oak",
            feature: "Luxury Swiss Watch",
            price: "$20,000 - $50,000+",
            material: "Stainless Steel, Gold",
            keyFeature: "Iconic Octagonal Design",
            display: "Mechanical Movement",
            battery: "Automatic Movement",
            externalUrl: "https://www.audemarspiguet.com/"
          },
          {
            name: "Cartier Santos",
            feature: "Luxury French Watch",
            price: "$6,000 - $15,000",
            material: "Stainless Steel, Gold",
            keyFeature: "Aviation Heritage, Iconic Design",
            display: "Mechanical Movement",
            battery: "Automatic Movement",
            externalUrl: "https://www.cartier.com/"
          }
        ];
        
        // 随机选择2-3个产品
        const shuffledWatches = watchOptions.sort(() => Math.random() - 0.5);
        const numWatches = Math.min(3, Math.max(2, Math.floor(Math.random() * 2) + 2));
        
        for (let i = 0; i < numWatches; i++) {
          externalComparisons.push({
            ...shuffledWatches[i],
            conciergeService: "N/A",
            isExternal: true
          });
        }
      } else if (keywordLower.includes("phone") || keywordLower.includes("smartphone") || keywordLower.includes("mobile")) {
        // 手机类：根据关键词类型调整对比维度，提供更多样化的产品选择
        // 定义所有可用的外部产品选项（多样化产品池）
        const allPhoneOptions = [
          {
            name: "iPhone 17 Pro Max",
            feature: "Flagship Smartphone",
            price: "$1,199 - $1,599",
            material: "Titanium Frame",
            keyFeature: "A19 Pro Chip, iOS 19, Apple Intelligence",
            display: "6.9\" Super Retina XDR",
            battery: "4,900 mAh",
            externalUrl: "https://www.apple.com/iphone/"
          },
          {
            name: "Samsung Galaxy S25 Ultra",
            feature: "Premium Android Phone",
            price: "$1,299 - $1,499",
            material: "Titanium Frame",
            keyFeature: "S Pen, Galaxy AI, Snapdragon 8 Gen 4",
            display: "6.9\" Dynamic AMOLED 2X",
            battery: "5,000 mAh",
            externalUrl: "https://www.samsung.com/"
          },
          {
            name: "Google Pixel 10 Pro",
            feature: "AI-Powered Smartphone",
            price: "$999 - $1,299",
            material: "Aluminum Frame",
            keyFeature: "Google Tensor G5, Gemini AI, Best-in-Class Camera",
            display: "6.8\" LTPO OLED",
            battery: "5,050 mAh",
            externalUrl: "https://store.google.com/product/pixel_10_pro"
          },
          {
            name: "OnePlus 13",
            feature: "Performance Flagship",
            price: "$899 - $1,199",
            material: "Aluminum Frame",
            keyFeature: "Snapdragon 8 Gen 4, 16GB RAM, OxygenOS",
            display: "6.8\" LTPO AMOLED, 120Hz",
            battery: "5,500 mAh, 100W Fast Charging",
            externalUrl: "https://www.oneplus.com/"
          },
          {
            name: "Xiaomi 15 Ultra",
            feature: "Premium Android Phone",
            price: "$899 - $1,199",
            material: "Ceramic Back, Titanium Frame",
            keyFeature: "Snapdragon 8 Gen 4, Leica Camera System",
            display: "6.73\" LTPO AMOLED, 120Hz",
            battery: "5,300 mAh, 120W Fast Charging",
            externalUrl: "https://www.mi.com/"
          },
          {
            name: "Sony Xperia 1 VI",
            feature: "Professional Camera Phone",
            price: "$1,199 - $1,399",
            material: "Gorilla Glass Victus 2",
            keyFeature: "Zeiss Optics, 4K 120fps Video, Pro Camera",
            display: "6.5\" 4K OLED, 120Hz",
            battery: "5,000 mAh",
            externalUrl: "https://www.sony.com/electronics/smartphones"
          },
          {
            name: "Nothing Phone (3)",
            feature: "Unique Design Phone",
            price: "$599 - $799",
            material: "Transparent Back, Aluminum Frame",
            keyFeature: "Glyph Interface, Snapdragon 8s Gen 3",
            display: "6.7\" LTPO OLED, 120Hz",
            battery: "4,700 mAh, 45W Fast Charging",
            externalUrl: "https://nothing.tech/"
          },
          {
            name: "Motorola Edge 50 Ultra",
            feature: "Premium Android Phone",
            price: "$799 - $999",
            material: "Vegan Leather, Aluminum Frame",
            keyFeature: "Snapdragon 8s Gen 3, 125W TurboPower",
            display: "6.7\" pOLED, 144Hz",
            battery: "4,500 mAh, 125W Fast Charging",
            externalUrl: "https://www.motorola.com/"
          }
        ];
        
        // 根据关键词类型筛选和调整产品特性
        let selectedPhones = [...allPhoneOptions];
        
        if (isSecurityKeyword) {
          // 安全相关：调整keyFeature突出安全特性
          selectedPhones = selectedPhones.map(phone => ({
            ...phone,
            keyFeature: phone.name.includes("iPhone") ? "Face ID, Secure Enclave, iOS 19 Security" :
                       phone.name.includes("Samsung") ? "Knox Security 3.0, S Pen, AI Security" :
                       phone.name.includes("Google") ? "Titan M2 Security Chip, Android 16" :
                       phone.name.includes("OnePlus") ? "OxygenOS Security, Snapdragon Secure" :
                       phone.keyFeature
          }));
        } else if (isPerformanceKeyword) {
          // 性能相关：调整keyFeature突出性能特性
          selectedPhones = selectedPhones.map(phone => ({
            ...phone,
            keyFeature: phone.name.includes("iPhone") ? "A19 Pro Chip, 8GB RAM, ProRes Video" :
                       phone.name.includes("Samsung") ? "Snapdragon 8 Gen 4, 16GB RAM, S Pen" :
                       phone.name.includes("OnePlus") ? "Snapdragon 8 Gen 4, 16GB RAM, OxygenOS" :
                       phone.keyFeature
          }));
        } else if (isCameraKeyword) {
          // 相机相关：优先选择相机突出的产品
          selectedPhones = selectedPhones.sort((a, b) => {
            const cameraPriority = ["Sony", "Google", "Xiaomi", "Samsung", "iPhone"];
            const aPriority = cameraPriority.findIndex(brand => a.name.includes(brand));
            const bPriority = cameraPriority.findIndex(brand => b.name.includes(brand));
            return (aPriority === -1 ? 999 : aPriority) - (bPriority === -1 ? 999 : bPriority);
          });
        }
        
        // 随机选择1-3个产品（确保多样性）
        const shuffled = selectedPhones.sort(() => Math.random() - 0.5);
        const numExternal = Math.min(3, Math.max(1, Math.floor(Math.random() * 3) + 1));
        
        for (let i = 0; i < numExternal; i++) {
          externalComparisons.push({
            ...shuffled[i],
            conciergeService: "N/A",
            isExternal: true
          });
        }
      } else if (keywordLower.includes("ring") || keywordLower.includes("jewellery") || keywordLower.includes("jewelry")) {
        // 戒指类：添加其他品牌智能戒指对比（多样化选择）
        const ringOptions = [
          {
            name: "Oura Ring Gen 3",
            feature: "Health Tracking Ring",
            price: "$299 - $549",
            material: "Titanium",
            keyFeature: "Health Monitoring, Sleep Tracking",
            display: "N/A",
            battery: "7 Days",
            externalUrl: "https://ouraring.com/"
          },
          {
            name: "Ultrahuman Ring Air",
            feature: "Fitness Tracking Ring",
            price: "$349",
            material: "Titanium",
            keyFeature: "Metabolic Health, Sleep Analysis",
            display: "N/A",
            battery: "6 Days",
            externalUrl: "https://ultrahuman.com/"
          },
          {
            name: "Circular Ring",
            feature: "Smart Health Ring",
            price: "$279 - $349",
            material: "Titanium",
            keyFeature: "Activity Tracking, Sleep Monitoring",
            display: "N/A",
            battery: "4-5 Days",
            externalUrl: "https://circular.xyz/"
          }
        ];
        
        // 随机选择1-2个产品
        const shuffledRings = ringOptions.sort(() => Math.random() - 0.5);
        const numRings = Math.min(2, Math.max(1, Math.floor(Math.random() * 2) + 1));
        
        for (let i = 0; i < numRings; i++) {
          externalComparisons.push({
            ...shuffledRings[i],
            conciergeService: "N/A",
            isExternal: true
          });
        }
      } else if (keywordLower.includes("earbud") || keywordLower.includes("earphone") || keywordLower.includes("audio")) {
        // 音频类：添加其他品牌耳机对比（多样化选择）
        const earbudOptions = [
          {
            name: "AirPods Pro 2",
            feature: "Premium Earbuds",
            price: "$249",
            material: "Plastic, Metal",
            keyFeature: "Active Noise Cancellation, Spatial Audio",
            display: "N/A",
            battery: "6 Hours + Case",
            externalUrl: "https://www.apple.com/airpods/"
          },
          {
            name: "Sony WF-1000XM5",
            feature: "Premium Noise Cancelling",
            price: "$299",
            material: "Plastic, Metal",
            keyFeature: "Industry-Leading ANC, Hi-Res Audio",
            display: "N/A",
            battery: "8 Hours + Case",
            externalUrl: "https://www.sony.com/"
          },
          {
            name: "Bose QuietComfort Ultra",
            feature: "Premium Noise Cancelling",
            price: "$299",
            material: "Plastic, Metal",
            keyFeature: "CustomTune Technology, Immersive Audio",
            display: "N/A",
            battery: "6 Hours + Case",
            externalUrl: "https://www.bose.com/"
          },
          {
            name: "Sennheiser Momentum True Wireless 4",
            feature: "High-Fidelity Earbuds",
            price: "$299",
            material: "Plastic, Metal",
            keyFeature: "7mm Dynamic Drivers, Adaptive ANC",
            display: "N/A",
            battery: "7 Hours + Case",
            externalUrl: "https://www.sennheiser.com/"
          },
          {
            name: "Samsung Galaxy Buds3 Pro",
            feature: "Premium Android Earbuds",
            price: "$249",
            material: "Plastic, Metal",
            keyFeature: "Galaxy AI, 360 Audio, ANC",
            display: "N/A",
            battery: "8 Hours + Case",
            externalUrl: "https://www.samsung.com/"
          }
        ];
        
        // 随机选择2-3个产品
        const shuffledEarbuds = earbudOptions.sort(() => Math.random() - 0.5);
        const numEarbuds = Math.min(3, Math.max(2, Math.floor(Math.random() * 2) + 2));
        
        for (let i = 0; i < numEarbuds; i++) {
          externalComparisons.push({
            ...shuffledEarbuds[i],
            conciergeService: "N/A",
            isExternal: true
          });
        }
      }
      
      // 合并内部和外部对比（最多3个外部产品）
      comparisonItems = [...comparisonItems, ...externalComparisons.slice(0, 3)];

      // 内链: 只使用真实存在的链接（产品分类、官方页面、产品详情页等）
      // keywordLower, isPhoneKeyword, isWatchKeyword, isRingKeyword, isEarbudKeyword 已在上面声明（第777-802行），这里直接使用
      
      // SEO优化：基于产品分类生成内链（优先显示与关键词相关的分类）
      const categoryLinks: Array<{ title: string; url: string }> = [];
      const uniqueCategories = new Set<string>();
      
      // 优先收集与关键词相关的分类链接
      const relevantCategoryLinks: Array<{ title: string; url: string }> = [];
      const otherCategoryLinks: Array<{ title: string; url: string }> = [];
      
      // 从所有产品中收集分类（只使用真实的产品分类链接）
      [...productsRow1, ...productsRow2, ...productsRow3].forEach(product => {
        if (product.categoryLink && product.categoryLink.startsWith("http") && !uniqueCategories.has(product.categoryLink)) {
          uniqueCategories.add(product.categoryLink);
          const categoryName = product.category || "Products";
          const categoryLower = categoryName.toLowerCase();
          const categoryLinkLower = product.categoryLink.toLowerCase();
          
          const linkItem = {
            title: `Shop ${categoryName}`,
            url: product.categoryLink
          };
          
          // 检查分类是否与关键词相关
          let isRelevant = false;
          if (isPhoneKeyword && (categoryLower.includes("phone") || categoryLinkLower.includes("phone"))) {
            isRelevant = true;
          } else if (isWatchKeyword && (categoryLower.includes("watch") || categoryLinkLower.includes("watch"))) {
            isRelevant = true;
          } else if (isRingKeyword && (categoryLower.includes("ring") || categoryLower.includes("jewellery") || categoryLinkLower.includes("ring"))) {
            isRelevant = true;
          } else if (isEarbudKeyword && (categoryLower.includes("earbud") || categoryLower.includes("earphone") || categoryLower.includes("audio") || categoryLinkLower.includes("earbud"))) {
            isRelevant = true;
          } else if (keywordLower && (categoryLower.includes(keywordLower) || categoryLinkLower.includes(keywordLower))) {
            isRelevant = true;
          }
          
          if (isRelevant) {
            relevantCategoryLinks.push(linkItem);
          } else {
            otherCategoryLinks.push(linkItem);
          }
        }
      });
      
      // 优先添加相关分类链接，然后添加其他分类链接（最多2个）
      categoryLinks.push(...relevantCategoryLinks.slice(0, 2));
      if (categoryLinks.length < 2) {
        categoryLinks.push(...otherCategoryLinks.slice(0, 2 - categoryLinks.length));
      }
      
      // 使用真实存在的官方页面链接（不生成假设的页面）
      const officialLinks: Array<{ title: string; url: string }> = [];
      
      // 根据关键词类型添加相关的真实官方页面
      if (keywordLower.includes("watch") || keywordLower.includes("timepiece")) {
        officialLinks.push(
          { title: "VERTU Grand Watch Collection", url: `${siteBaseUrl}/product-category/watches/` },
          { title: "VERTU Grand Watch", url: `${siteBaseUrl}/grandwatch/` }
        );
      } else if (keywordLower.includes("phone") || keywordLower.includes("smartphone") || keywordLower.includes("mobile")) {
        officialLinks.push(
          { title: "VERTU Phone Collection", url: `${siteBaseUrl}/product-category/phones/` },
          { title: "VERTU Agent Q", url: `${siteBaseUrl}/agent-q/` },
          { title: "VERTU Quantum Flip", url: `${siteBaseUrl}/quantum/` }
        );
      } else if (keywordLower.includes("ring") || keywordLower.includes("jewellery") || keywordLower.includes("jewelry")) {
        officialLinks.push(
          { title: "VERTU Smart Ring Collection", url: `${siteBaseUrl}/product-category/rings/` },
          { title: "VERTU Meta Ring", url: `${siteBaseUrl}/aura-ring/` },
          { title: "VERTU AI Diamond Ring", url: `${siteBaseUrl}/smartring/` }
        );
      } else if (keywordLower.includes("earbud") || keywordLower.includes("earphone") || keywordLower.includes("audio")) {
        officialLinks.push(
          { title: "VERTU Audio Collection", url: `${siteBaseUrl}/product-category/accessories/` },
          { title: "VERTU OWS Earbuds", url: `${siteBaseUrl}/ows-earbuds/` }
        );
      }
      
      // 添加通用的真实官方页面
      officialLinks.push(
        { title: "VERTU Official Store", url: `${siteBaseUrl}/shop/` },
        { title: "VERTU Concierge Service", url: `${siteBaseUrl}/ruby-key/` }
      );
      
      // 如果有FAQ分类链接，也添加
      if (faqCategoryLink) {
        officialLinks.push({
          title: "Related FAQs",
          url: faqCategoryLink
        });
      }
      
      // 从产品中提取真实的产品详情页链接（learnMoreLink）
      const productDetailLinks: Array<{ title: string; url: string }> = [];
      const uniqueProductLinks = new Set<string>();
      
      [...productsRow1, ...productsRow2, ...productsRow3].forEach(product => {
        if (product.learnMoreLink && product.learnMoreLink.startsWith("http") && !uniqueProductLinks.has(product.learnMoreLink)) {
          uniqueProductLinks.add(product.learnMoreLink);
          const productName = product.name.replace(/<[^>]*>/g, "").trim();
          productDetailLinks.push({
            title: `Learn More About ${productName}`,
            url: product.learnMoreLink
          });
        }
      });
      
      // 合并内链（优先显示分类链接，然后是官方页面，最后是产品详情页，最多5个）
      internalLinks = [
        ...categoryLinks.slice(0, 2), 
        ...officialLinks.slice(0, 2),
        ...productDetailLinks.slice(0, 1)
      ].slice(0, 5);

      // 外链: 指向第三方权威网站（SEO最佳实践：外链应该指向其他权威网站，而不是自己的网站）
      // 注意：这些是真实存在的第三方权威网站链接，用于SEO和内容可信度
      const externalLinksList: Array<{ title: string; url: string; description?: string }> = [];
      
      // 根据关键词类型添加相关的第三方权威网站外链
      if (keywordLower.includes("watch") || keywordLower.includes("timepiece")) {
        // 手表相关的第三方权威资源（多样化选择池）
        const watchExternalLinksPool = [
          { 
            title: "Luxury Watch Guide - Forbes", 
            url: "https://www.forbes.com/sites/forbes-personal-shopper/2024/01/15/best-luxury-watches/",
            description: "Expert insights on luxury timepieces from Forbes"
          },
          { 
            title: "Watch Reviews - Hodinkee", 
            url: "https://www.hodinkee.com/",
            description: "Authoritative watch reviews and industry news"
          },
          { 
            title: "Luxury Timepieces - Robb Report", 
            url: "https://robbreport.com/tag/watches/",
            description: "Luxury watch coverage from Robb Report"
          },
          { 
            title: "Watch Guide - WatchTime", 
            url: "https://www.watchtime.com/",
            description: "Comprehensive watch reviews and industry insights"
          },
          { 
            title: "Luxury Watches - GQ", 
            url: "https://www.gq.com/tag/watches",
            description: "Luxury watch trends and expert reviews"
          },
          { 
            title: "Timepiece Reviews - Revolution", 
            url: "https://revolutionwatch.com/",
            description: "Expert watch reviews and horology insights"
          },
          { 
            title: "Watch Guide - A Blog to Watch", 
            url: "https://www.ablogtowatch.com/",
            description: "Independent watch reviews and industry news"
          }
        ];
        
        // 随机选择3-4个链接
        const shuffledWatchLinks = watchExternalLinksPool.sort(() => Math.random() - 0.5);
        const numWatchLinks = Math.min(4, Math.max(3, Math.floor(Math.random() * 2) + 3));
        externalLinksList.push(...shuffledWatchLinks.slice(0, numWatchLinks));
      } else if (keywordLower.includes("phone") || keywordLower.includes("smartphone") || keywordLower.includes("mobile")) {
        // 手机相关的第三方权威资源（多样化选择池）
        const phoneExternalLinksPool = [
          { 
            title: "Smartphone Reviews - TechCrunch", 
            url: "https://techcrunch.com/tag/smartphones/",
            description: "Latest smartphone technology news and reviews"
          },
          { 
            title: "Mobile Device Guide - CNET", 
            url: "https://www.cnet.com/tech/mobile/",
            description: "Comprehensive mobile device reviews and comparisons"
          },
          { 
            title: "Luxury Tech - The Verge", 
            url: "https://www.theverge.com/",
            description: "Technology news and reviews from The Verge"
          },
          { 
            title: "Phone Reviews - TechRadar", 
            url: "https://www.techradar.com/news/phone-and-communications",
            description: "Expert smartphone reviews and buying guides"
          },
          { 
            title: "Mobile Reviews - Wired", 
            url: "https://www.wired.com/tag/mobile/",
            description: "In-depth mobile technology analysis and reviews"
          },
          { 
            title: "Smartphone Guide - GSM Arena", 
            url: "https://www.gsmarena.com/",
            description: "Comprehensive smartphone specifications and reviews"
          },
          { 
            title: "Android Authority", 
            url: "https://www.androidauthority.com/",
            description: "Android news, reviews, and expert analysis"
          },
          { 
            title: "Phone Reviews - Tom's Guide", 
            url: "https://www.tomsguide.com/phones",
            description: "Expert phone reviews and buying advice"
          },
          { 
            title: "Mobile Tech - Digital Trends", 
            url: "https://www.digitaltrends.com/mobile/",
            description: "Latest mobile technology trends and reviews"
          },
          { 
            title: "Phone Reviews - Pocket-lint", 
            url: "https://www.pocket-lint.com/phones/",
            description: "Smartphone reviews and technology insights"
          }
        ];
        
        // 随机选择3-4个链接（确保多样性）
        const shuffledLinks = phoneExternalLinksPool.sort(() => Math.random() - 0.5);
        const numLinks = Math.min(4, Math.max(3, Math.floor(Math.random() * 2) + 3));
        externalLinksList.push(...shuffledLinks.slice(0, numLinks));
      } else if (keywordLower.includes("ring") || keywordLower.includes("jewellery") || keywordLower.includes("jewelry")) {
        // 珠宝/戒指相关的第三方权威资源
        const ringExternalLinksPool = [
          { 
            title: "Jewelry Guide - Vogue", 
            url: "https://www.vogue.com/tag/jewelry",
            description: "Luxury jewelry trends and guides from Vogue"
          },
          { 
            title: "Fine Jewelry - Harper's Bazaar", 
            url: "https://www.harpersbazaar.com/fashion/jewelry/",
            description: "Expert jewelry coverage from Harper's Bazaar"
          },
          { 
            title: "Smart Jewelry - Wired", 
            url: "https://www.wired.com/tag/wearables/",
            description: "Technology insights on smart jewelry and wearables"
          },
          { 
            title: "Jewelry Trends - Elle", 
            url: "https://www.elle.com/jewelry/",
            description: "Latest jewelry trends and style guides"
          },
          { 
            title: "Luxury Jewelry - Town & Country", 
            url: "https://www.townandcountrymag.com/style/jewelry",
            description: "Luxury jewelry coverage and expert insights"
          },
          { 
            title: "Wearable Tech - TechCrunch", 
            url: "https://techcrunch.com/tag/wearables/",
            description: "Smart jewelry and wearable technology news"
          }
        ];
        
        // 随机选择3-4个链接
        const shuffledRingLinks = ringExternalLinksPool.sort(() => Math.random() - 0.5);
        const numRingLinks = Math.min(4, Math.max(3, Math.floor(Math.random() * 2) + 3));
        externalLinksList.push(...shuffledRingLinks.slice(0, numRingLinks));
      } else if (keywordLower.includes("earbud") || keywordLower.includes("earphone") || keywordLower.includes("audio")) {
        // 音频设备相关的第三方权威资源（多样化选择池）
        const audioExternalLinksPool = [
          { 
            title: "Audio Reviews - What Hi-Fi?", 
            url: "https://www.whathifi.com/",
            description: "Expert audio equipment reviews and buying guides"
          },
          { 
            title: "Headphone Guide - SoundGuys", 
            url: "https://www.soundguys.com/",
            description: "In-depth audio product reviews and comparisons"
          },
          { 
            title: "Premium Audio - TechRadar", 
            url: "https://www.techradar.com/audio",
            description: "Latest audio technology news and reviews"
          },
          { 
            title: "Audio Reviews - CNET", 
            url: "https://www.cnet.com/audio/",
            description: "Comprehensive audio product reviews and comparisons"
          },
          { 
            title: "Headphone Reviews - Wired", 
            url: "https://www.wired.com/tag/headphones/",
            description: "Expert headphone reviews and buying advice"
          },
          { 
            title: "Audio Tech - The Verge", 
            url: "https://www.theverge.com/audio",
            description: "Latest audio technology news and reviews"
          },
          { 
            title: "Headphone Guide - Rtings", 
            url: "https://www.rtings.com/headphones",
            description: "Detailed headphone measurements and reviews"
          }
        ];
        
        // 随机选择3-4个链接
        const shuffledAudioLinks = audioExternalLinksPool.sort(() => Math.random() - 0.5);
        const numAudioLinks = Math.min(4, Math.max(3, Math.floor(Math.random() * 2) + 3));
        externalLinksList.push(...shuffledAudioLinks.slice(0, numAudioLinks));
      } else {
        // 通用关键词：使用通用的第三方权威资源
        externalLinksList.push(
          { 
            title: "Luxury Lifestyle - Forbes", 
            url: "https://www.forbes.com/lifestyle/",
            description: "Luxury lifestyle insights and expert opinions"
          },
          { 
            title: "Tech Reviews - The Verge", 
            url: "https://www.theverge.com/reviews",
            description: "Comprehensive technology reviews and analysis"
          },
          { 
            title: "Luxury Goods - Robb Report", 
            url: "https://robbreport.com/",
            description: "Authoritative coverage of luxury products and services"
          }
        );
      }
      
      // 限制外链数量（最多4个），确保质量
      externalLinks = externalLinksList.slice(0, 4);
      
      console.log(`[task ${taskId}] 模板4数据准备完成:`);
      console.log(`  - Top Picks数量: ${topProducts.length}`);
      console.log(`  - 对比表项目数: ${comparisonItems.length}`);
      console.log(`  - 内链数量: ${internalLinks.length}`);
      console.log(`  - 外链数量: ${externalLinks.length}`);
      
      // 验证对比表中的Ruby Key链接
      const internalComparisonItems = comparisonItems.filter(item => !item.isExternal);
      if (internalComparisonItems.length > 0) {
        console.log(`[task ${taskId}] ✅ 对比表内部产品Ruby Key链接检查:`);
        internalComparisonItems.forEach((item, index) => {
          const hasLink = !!item.conciergeServiceLink;
          const linkUrl = item.conciergeServiceLink || "未设置";
          console.log(`  - 产品 ${index + 1} (${item.name}): Ruby Key链接 = ${linkUrl} ${hasLink ? "✅" : "❌"}`);
        });
      }
      
      // 优化：确保Top Picks中的产品不会在第一排产品中重复显示
      const topProductIds = new Set(topProducts.map(p => p.id));
      const filteredProductsRow1 = productsRow1.filter(p => !topProductIds.has(p.id));
      
      // 如果过滤后第一排产品不足，从其他排补充（但排除Top Picks中的产品）
      let finalProductsRow1 = filteredProductsRow1;
      if (finalProductsRow1.length < 4) {
        const allAvailableProducts = [
          ...filteredProductsRow1,
          ...productsRow2.filter(p => !topProductIds.has(p.id)),
          ...productsRow3.filter(p => !topProductIds.has(p.id))
        ];
        // 去重
        const uniqueAvailable = Array.from(new Map(allAvailableProducts.map(p => [p.id, p])).values());
        finalProductsRow1 = uniqueAvailable.slice(0, 4);
        console.log(`[task ${taskId}] ✅ 第一排产品已优化：排除Top Picks中的 ${topProducts.length} 个产品，避免重复显示`);
        console.log(`  - 优化后第一排产品: ${finalProductsRow1.map(p => p.name).join(", ")}`);
      } else {
        console.log(`[task ${taskId}] ✅ 第一排产品已优化：已排除Top Picks中的产品，避免重复`);
      }
      
      // 更新productsRow1为优化后的列表（避免重复）
      productsRow1 = finalProductsRow1;
    }

    const finalHtml = renderTemplate({
      templateContent: payload.templateContent,
      pageTitle: finalPageTitle,
      pageDescription: generatedContent.pageDescription, // 页面描述（用于模板2和模板3）
      metaDescription: generatedContent.metaDescription, // SEO meta description
      metaKeywords: generatedContent.metaKeywords, // SEO meta keywords
      pageUrl: expectedPageUrl, // 页面URL（用于canonical和Open Graph）
      pageImage: pageImageUrl, // 页面封面图URL（用于Open Graph和Twitter Card，仅模板4）
      aiContent: generatedContent.articleContent,
      extendedContent: generatedContent.extendedContent, // 扩展内容（用于模板3/4/5的第二部分）
      products: productsRow1, // 第一排产品（已优化，排除Top Picks中的产品，避免重复）
      productsRow2: productsRow2, // 第二排产品（最多4个）
      relatedProducts: productsRow3, // 第三排产品（最多4个）
      faqItems: generatedContent.faqItems,
      faqCategoryLink,
      // 模板4新增字段
      topProducts,
      comparisonItems,
      internalLinks,
      externalLinks,
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

    // 检查是否暂停
    await waitForTaskResume(taskId);
    if (isTaskPaused(taskId)) {
      return; // 任务已暂停，退出
    }
    
    // 在发布页面之前再次检查暂停状态
    if (isTaskPaused(taskId)) {
      return; // 任务已暂停，退出
    }
    
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

    // 发布页面后立即检查暂停状态
    if (isTaskPaused(taskId)) {
      return; // 任务已暂停，退出
    }

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
