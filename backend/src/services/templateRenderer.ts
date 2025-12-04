import Handlebars from "handlebars";
import type { ProductSummary, FAQItem } from "../types.js";

Handlebars.registerHelper("safeHtml", (html: string) => new Handlebars.SafeString(html));
Handlebars.registerHelper("truncateText", (text: string | undefined, maxLength: number = 40) => {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.substring(0, maxLength).trim()}...`;
});
// Helper for JSON escaping in structured data
Handlebars.registerHelper("jsonEscape", (text: string | undefined) => {
  if (!text) return "";
  // Remove HTML tags and escape JSON special characters
  const plainText = text.replace(/<[^>]*>/g, "").trim();
  return JSON.stringify(plainText).slice(1, -1); // Remove surrounding quotes
});
// Helper to check if a string is not empty (handles both strings and Handlebars.SafeString)
Handlebars.registerHelper("isNotEmpty", (str: any) => {
  if (!str) return false;
  // Handle Handlebars.SafeString objects
  if (str && typeof str.toString === 'function') {
    const text = str.toString();
    return text && text.trim().length > 0;
  }
  // Handle regular strings
  if (typeof str === 'string') {
    return str.trim().length > 0;
  }
  return false;
});

export interface RenderTemplateInput {
  templateContent: string;
  pageTitle: string;
  pageDescription?: string; // 页面描述（用于模板2和模板3）
  metaDescription?: string; // SEO meta description
  metaKeywords?: string; // SEO meta keywords
  pageUrl?: string; // 页面URL（用于canonical和Open Graph）
  aiContent: string;
  extendedContent?: string; // 扩展内容（用于模板3的第二部分）
  products: ProductSummary[];
  productsRow2?: ProductSummary[]; // 第二排产品（可选）
  relatedProducts: ProductSummary[];
  faqItems: FAQItem[];
  faqCategoryLink?: string;
}

export function renderTemplate({
  templateContent,
  pageTitle,
  pageDescription,
  metaDescription,
  metaKeywords,
  pageUrl,
  aiContent,
  extendedContent,
  products,
  productsRow2,
  relatedProducts,
  faqItems,
  faqCategoryLink,
}: RenderTemplateInput) {
  const template = Handlebars.compile(templateContent);

  // 生成当前日期（ISO格式，用于结构化数据）
  const now = new Date();
  const datePublished = now.toISOString();
  const dateModified = now.toISOString();

  // 生成FAQ结构化数据JSON（安全转义）
  let faqStructuredData = "";
  if (faqItems && faqItems.length > 0) {
    try {
      const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faqItems.map(item => ({
          "@type": "Question",
          "name": item.question.replace(/<[^>]*>/g, "").trim(),
          "acceptedAnswer": {
            "@type": "Answer",
            "text": item.answer.replace(/<[^>]*>/g, "").trim()
          }
        }))
      };
      faqStructuredData = JSON.stringify(faqSchema, null, 2);
    } catch (error) {
      console.warn(`[TemplateRenderer] Failed to generate FAQ structured data:`, error);
    }
  }

  // 生成Article结构化数据JSON
  let articleStructuredData = "";
  try {
    const articleSchema = {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": pageTitle,
      "description": (metaDescription || pageDescription || "").replace(/<[^>]*>/g, "").trim(),
      "url": pageUrl || "",
      "author": {
        "@type": "Organization",
        "name": "VERTU"
      },
      "publisher": {
        "@type": "Organization",
        "name": "VERTU",
        "logo": {
          "@type": "ImageObject",
          "url": "https://vertu.com/wp-content/uploads/2024/10/vertu-logo.png"
        }
      },
      "datePublished": datePublished,
      "dateModified": dateModified,
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": pageUrl || ""
      }
    };
    articleStructuredData = JSON.stringify(articleSchema, null, 2);
  } catch (error) {
    console.warn(`[TemplateRenderer] Failed to generate Article structured data:`, error);
  }

  // 调试：检查描述是否正确传递
  if (pageDescription && pageDescription.trim().length > 0) {
    console.log(`[TemplateRenderer] ✅ Page description provided: ${pageDescription.length} characters`);
    console.log(`[TemplateRenderer] Description preview: ${pageDescription.substring(0, 100)}...`);
  } else {
    console.warn(`[TemplateRenderer] ⚠️ Page description is empty or undefined`);
  }

  // 调试：检查扩展内容是否正确传递
  if (extendedContent && extendedContent.trim().length > 0) {
    console.log(`[TemplateRenderer] ✅ Extended content provided: ${extendedContent.length} characters`);
    console.log(`[TemplateRenderer] Extended content preview: ${extendedContent.substring(0, 150)}...`);
  } else {
    console.warn(`[TemplateRenderer] ⚠️ Extended content is empty or undefined`);
  }

  const rendered = template({
    PAGE_TITLE: pageTitle,
    PAGE_DESCRIPTION: pageDescription || "", // 页面描述（用于模板2和模板3）
    META_DESCRIPTION: metaDescription || pageDescription || "", // SEO meta description
    META_KEYWORDS: metaKeywords || "", // SEO meta keywords
    PAGE_URL: pageUrl || "", // 页面URL（用于canonical和Open Graph）
    DATE_PUBLISHED: datePublished, // 发布日期（ISO格式）
    DATE_MODIFIED: dateModified, // 修改日期（ISO格式）
    ARTICLE_STRUCTURED_DATA: new Handlebars.SafeString(articleStructuredData), // Article结构化数据
    FAQ_STRUCTURED_DATA: new Handlebars.SafeString(faqStructuredData), // FAQ结构化数据
    AI_GENERATED_CONTENT: new Handlebars.SafeString(aiContent),
    AI_EXTENDED_CONTENT: (extendedContent && extendedContent.trim().length > 0) ? new Handlebars.SafeString(extendedContent) : "", // 扩展内容（用于模板3）
    products, // 第一排产品
    productsRow2: productsRow2 || [], // 第二排产品（如果未提供，使用空数组）
    relatedProducts, // 第三排产品
    faqItems,
    faqCategoryLink,
  });

  // 调试日志：检查渲染结果
  console.log(`[TemplateRenderer] 渲染完成:`);
  console.log(`  - 页面标题: ${pageTitle}`);
  console.log(`  - AI 内容长度: ${aiContent.length}`);
  console.log(`  - 产品数量: ${products.length}`);
  console.log(`  - 关联产品数量: ${relatedProducts.length}`);
  console.log(`  - FAQ 数量: ${faqItems.length}`);
  console.log(`  - 渲染后 HTML 长度: ${rendered.length}`);
  
  // 检查是否包含 Handlebars 占位符（说明渲染失败）
  const hasUnrenderedPlaceholders = rendered.includes('{{') || rendered.includes('{{{');
  if (hasUnrenderedPlaceholders) {
    console.warn(`[TemplateRenderer] ⚠️ 警告：渲染后的 HTML 仍包含 Handlebars 占位符！`);
    const placeholderMatches = rendered.match(/\{\{[^}]+\}\}/g);
    if (placeholderMatches) {
      console.warn(`[TemplateRenderer] 未渲染的占位符:`, placeholderMatches.slice(0, 5));
    }
  }
  
  // 检查是否包含实际数据
  if (products.length > 0) {
    const firstProductName = products[0].name || '';
    if (rendered.includes(firstProductName)) {
      console.log(`[TemplateRenderer] ✅ 产品数据已正确渲染到 HTML 中`);
    } else {
      console.warn(`[TemplateRenderer] ⚠️ 警告：产品数据可能未正确渲染（产品名称 "${firstProductName}" 未在 HTML 中找到）`);
    }
  }

  return rendered;
}
