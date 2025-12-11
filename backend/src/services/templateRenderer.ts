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
// Helper to check if a tag is duplicate/redundant with "On Sale"
Handlebars.registerHelper("isDuplicateSaleTag", (tag: string | undefined, onSale: boolean | undefined) => {
  if (!tag || !onSale) return false;
  const tagLower = tag.toLowerCase().trim();
  // 检查 tag 是否与 "On Sale" 重复（不区分大小写）
  const saleKeywords = ["sale", "on sale", "onsale", "discount", "promotion", "promo", "special offer", "special price"];
  return saleKeywords.some(keyword => tagLower === keyword || tagLower.includes(keyword));
});
// Helper to get unique tags (filter out duplicates when onSale is true)
Handlebars.registerHelper("getUniqueTags", (tag: string | undefined, onSale: boolean | undefined) => {
  if (!tag) return [];
  const tagLower = tag.toLowerCase().trim();
  // 如果产品在售且 tag 与 sale 相关，返回空数组（避免重复）
  if (onSale) {
    const saleKeywords = ["sale", "on sale", "onsale", "discount", "promotion", "promo", "special offer", "special price"];
    if (saleKeywords.some(keyword => tagLower === keyword || tagLower.includes(keyword))) {
      return [];
    }
  }
  return [tag];
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

export interface ComparisonItem {
  name: string;
  feature: string;
  price: string;
  material?: string; // 材质
  keyFeature?: string; // 核心特色
  display?: string; // 显示屏
  battery?: string; // 电池
  conciergeService?: string; // Ruby Key管家服务（内部产品的核心优势）
  conciergeServiceLink?: string; // Ruby Key服务页面链接
  isExternal?: boolean; // 是否为外部产品
  externalUrl?: string; // 外部产品链接（如果有）
  productLink?: string; // 内部产品链接（如果有）
}

export interface InternalLink {
  title: string;
  url: string;
}

export interface ExternalLink {
  title: string;
  url: string;
  description?: string; // 可选：链接描述
}

export interface RenderTemplateInput {
  templateContent: string;
  pageTitle: string;
  pageDescription?: string; // 页面描述（用于模板2和模板3）
  metaDescription?: string; // SEO meta description
  metaKeywords?: string; // SEO meta keywords
  pageUrl?: string; // 页面URL（用于canonical和Open Graph）
  pageImage?: string; // 页面封面图URL（用于Open Graph和Twitter Card，仅模板4）
  aiContent: string;
  extendedContent?: string; // 扩展内容（用于模板3的第二部分）
  products: ProductSummary[];
  productsRow2?: ProductSummary[]; // 第二排产品（可选）
  relatedProducts: ProductSummary[];
  faqItems: FAQItem[];
  faqCategoryLink?: string;
  // 模板4新增字段
  topProducts?: ProductSummary[]; // Top Picks产品（前3个）
  comparisonItems?: ComparisonItem[]; // 对比表数据
  internalLinks?: InternalLink[]; // 内链数据
  externalLinks?: ExternalLink[]; // 外链数据
}

export function renderTemplate({
  templateContent,
  pageTitle,
  pageDescription,
  metaDescription,
  metaKeywords,
  pageUrl,
  pageImage,
  aiContent,
  extendedContent,
  products,
  productsRow2,
  relatedProducts,
  faqItems,
  faqCategoryLink,
  topProducts = [],
  comparisonItems = [],
  internalLinks = [],
  externalLinks = [],
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

  // 生成 ItemList 结构化数据（用于 Top Picks）
  let itemListStructuredData = "";
  if (topProducts && topProducts.length > 0) {
    try {
      const itemListSchema = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "Top Picks",
        "itemListElement": topProducts.map((product, index) => ({
          "@type": "ListItem",
          "position": index + 1,
          "item": {
            "@type": "Product",
            "name": product.name.replace(/<[^>]*>/g, "").trim(),
            "url": product.link || "",
            "image": product.imageUrl || "",
            "offers": product.price ? {
              "@type": "Offer",
              "price": product.price.replace(/[^0-9.]/g, ""),
              "priceCurrency": "USD"
            } : undefined
          }
        }))
      };
      itemListStructuredData = JSON.stringify(itemListSchema, null, 2);
    } catch (error) {
      console.warn(`[TemplateRenderer] Failed to generate ItemList structured data:`, error);
    }
  }

  // 生成 Product 结构化数据（用于对比表，SEO优化：包含丰富的产品属性）
  let productStructuredData = "";
  if (comparisonItems && comparisonItems.length > 0) {
    try {
      const productSchemas = comparisonItems.map(item => {
        const baseSchema: any = {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": item.name.replace(/<[^>]*>/g, "").trim(),
          "description": item.feature.replace(/<[^>]*>/g, "").trim(),
        };
        
        // 添加价格信息
        if (item.price && item.price !== "Price on request") {
          const priceMatch = item.price.match(/[\d,]+/);
          if (priceMatch) {
            baseSchema.offers = {
              "@type": "Offer",
              "price": priceMatch[0].replace(/,/g, ""),
              "priceCurrency": "USD",
              "availability": "https://schema.org/InStock"
            };
          }
        }
        
        // 添加额外属性（SEO优化：丰富的产品信息）
        if (item.material) {
          baseSchema.material = item.material;
        }
        if (item.keyFeature) {
          baseSchema.additionalProperty = baseSchema.additionalProperty || [];
          baseSchema.additionalProperty.push({
            "@type": "PropertyValue",
            "name": "Key Feature",
            "value": item.keyFeature
          });
        }
        if (item.display && item.display !== "N/A") {
          baseSchema.additionalProperty = baseSchema.additionalProperty || [];
          baseSchema.additionalProperty.push({
            "@type": "PropertyValue",
            "name": "Display",
            "value": item.display
          });
        }
        if (item.battery && item.battery !== "N/A") {
          baseSchema.additionalProperty = baseSchema.additionalProperty || [];
          baseSchema.additionalProperty.push({
            "@type": "PropertyValue",
            "name": "Battery/Power",
            "value": item.battery
          });
        }
        
        // 如果是外部产品，添加外部链接
        if (item.isExternal && item.externalUrl) {
          baseSchema.url = item.externalUrl;
        }
        
        return baseSchema;
      }).filter(schema => schema !== null);
      
      productStructuredData = JSON.stringify(productSchemas, null, 2);
    } catch (error) {
      console.warn(`[TemplateRenderer] Failed to generate Product structured data:`, error);
    }
  }

  const rendered = template({
    PAGE_TITLE: pageTitle,
    PAGE_DESCRIPTION: pageDescription || "", // 页面描述（用于模板2和模板3）
    META_DESCRIPTION: metaDescription || pageDescription || "", // SEO meta description
    META_KEYWORDS: metaKeywords || "", // SEO meta keywords
    PAGE_URL: pageUrl || "", // 页面URL（用于canonical和Open Graph）
    PAGE_IMAGE: pageImage || "", // 页面封面图URL（用于Open Graph和Twitter Card，仅模板4）
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
    // 模板4新增字段
    topProducts: topProducts || [], // Top Picks产品
    comparisonItems: comparisonItems || [], // 对比表数据
    internalLinks: internalLinks || [], // 内链数据
    externalLinks: externalLinks || [], // 外链数据
    ITEMLIST_STRUCTURED_DATA: itemListStructuredData ? new Handlebars.SafeString(itemListStructuredData) : "", // ItemList结构化数据
    PRODUCT_STRUCTURED_DATA: productStructuredData ? new Handlebars.SafeString(productStructuredData) : "", // Product结构化数据
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
