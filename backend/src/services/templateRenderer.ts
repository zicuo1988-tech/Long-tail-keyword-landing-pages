import Handlebars from "handlebars";
import type { ProductSummary, FAQItem } from "../types.js";
import { rewriteVertuOssContentToShopifyCdn } from "../config/shopifyCdn.js";

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
// Helper to limit array length
Handlebars.registerHelper("limit", (array: any[] | undefined, limit: number) => {
  if (!array || !Array.isArray(array)) return [];
  return array.slice(0, limit);
});
// Helper for template-7: add two numbers (e.g. {{add @index 1}} for 1-based index)
Handlebars.registerHelper("add", (a: number, b: number) => (Number(a) || 0) + (Number(b) || 0));

/**
 * 智能判断链接的 rel 属性
 * 根据链接类型决定是否加 nofollow
 * 
 * @param linkType - 链接类型：'authoritative' | 'competitor' | 'commercial' | 'affiliate' | 'ugc' | undefined
 * @returns 返回应该使用的 rel 属性值
 */
Handlebars.registerHelper("getRelAttribute", (linkType?: string) => {
  // 默认：权威来源和竞品对比不加 nofollow
  if (!linkType || linkType === 'authoritative' || linkType === 'competitor') {
    return 'noopener'; // 只加 noopener，不加 nofollow
  }
  
  // 商业合作：加 sponsored
  if (linkType === 'commercial') {
    return 'noopener sponsored';
  }
  
  // 联盟链接：加 nofollow
  if (linkType === 'affiliate') {
    return 'noopener nofollow';
  }
  
  // 用户生成内容：加 ugc nofollow
  if (linkType === 'ugc') {
    return 'noopener ugc nofollow';
  }
  
  // 默认：只加 noopener（保守策略，不加 nofollow）
  return 'noopener';
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
  linkType?: 'authoritative' | 'competitor' | 'commercial' | 'affiliate' | 'ugc'; // 链接类型，用于智能判断是否加 nofollow
}

// 模板6新增：参考文献接口
export interface Reference {
  author?: string; // 作者
  year?: string; // 年份
  title?: string; // 标题
  publication?: string; // 出版物/期刊
  url?: string; // 链接
  doi?: string; // DOI
  linkType?: 'authoritative' | 'competitor' | 'commercial' | 'affiliate' | 'ugc'; // 链接类型，用于智能判断是否加 nofollow
}

// 模板6新增：外部权威资源接口
export interface ExternalResource {
  title: string; // 资源标题
  url: string; // 资源链接
  linkType?: 'authoritative' | 'competitor' | 'commercial' | 'affiliate' | 'ugc'; // 链接类型，用于智能判断是否加 nofollow
  description?: string; // 资源描述
  type?: string; // 资源类型（如：Academic Paper, Industry Report, News Article等）
  source?: string; // 来源（如：Nature, Forbes, IEEE等）
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
  // 模板6新增字段
  references?: Reference[]; // 参考文献列表
  externalResources?: ExternalResource[]; // 外部权威资源列表
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
  references = [],
  externalResources = [],
}: RenderTemplateInput) {
  const template = Handlebars.compile(templateContent);

  const aiContentResolved = rewriteVertuOssContentToShopifyCdn(aiContent);
  const extendedContentResolved = extendedContent
    ? rewriteVertuOssContentToShopifyCdn(extendedContent)
    : extendedContent;
  const pageImageResolved = pageImage ? rewriteVertuOssContentToShopifyCdn(pageImage) : pageImage;

  // 生成当前日期（ISO格式，用于结构化数据）
  const now = new Date();
  const datePublished = now.toISOString();
  const dateModified = now.toISOString();

  /** FAQ 并入主 @graph，不再单独输出第二段 script，避免重复 @context */
  let faqStructuredData = "";

  const pageTitlePlain = pageTitle.replace(/<[^>]*>/g, "").trim();

  const VERTU_LOGO_URL = "https://vertu.com/wp-content/uploads/2024/10/vertu-logo.png";

  /** 与 canonical URL 对齐的 BreadcrumbList（利于富结果与站点层级） */
  function buildBreadcrumbListSchema(url: string, titlePlain: string): Record<string, unknown> | null {
    try {
      const u = new URL(url);
      const origin = `${u.protocol}//${u.host}`;
      const segments = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
      if (segments.length === 0) return null;
      const itemListElement: Array<{
        "@type": "ListItem";
        position: number;
        name: string;
        item: string;
      }> = [];
      let pos = 1;
      let acc = "";
      itemListElement.push({
        "@type": "ListItem",
        position: pos++,
        name: "Home",
        item: `${origin}/`,
      });
      for (let i = 0; i < segments.length; i++) {
        acc += `/${segments[i]}`;
        const isLast = i === segments.length - 1;
        let name: string;
        if (segments[i] === "luxury-life-guides") {
          name = "Luxury Life Guides";
        } else if (isLast) {
          name = titlePlain.slice(0, 110) || segments[i].replace(/-/g, " ");
        } else {
          name = segments[i]
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        }
        itemListElement.push({
          "@type": "ListItem",
          position: pos++,
          name,
          item: `${origin}${acc}/`,
        });
      }
      return {
        "@type": "BreadcrumbList",
        itemListElement,
      };
    } catch {
      return null;
    }
  }

  // Article + Organization + WebSite + BreadcrumbList + FAQPage（单 @graph）
  let articleStructuredData = "";
  try {
    const pu = pageUrl?.trim() ?? "";
    let orgId: string | undefined;
    const graph: unknown[] = [];

    if (pu) {
      try {
        const origin = new URL(pu).origin;
        orgId = `${origin}/#organization`;
        graph.push({
          "@type": "Organization",
          "@id": orgId,
          name: "VERTU",
          url: `${origin}/`,
          logo: {
            "@type": "ImageObject",
            url: VERTU_LOGO_URL,
          },
        });
        graph.push({
          "@type": "WebSite",
          "@id": `${origin}/#website`,
          url: `${origin}/`,
          name: "VERTU",
          publisher: { "@id": orgId },
          inLanguage: "en-GB",
        });
      } catch {
        orgId = undefined;
      }
    }

    const articleNode: Record<string, unknown> = {
      "@type": "Article",
      headline: pageTitlePlain,
      description: (metaDescription || pageDescription || "").replace(/<[^>]*>/g, "").trim(),
      url: pageUrl || "",
      inLanguage: "en-GB",
      datePublished: datePublished,
      dateModified: dateModified,
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": pageUrl || "",
      },
    };
    if (orgId) {
      articleNode.author = { "@id": orgId };
      articleNode.publisher = { "@id": orgId };
    } else {
      articleNode.author = { "@type": "Organization", name: "VERTU" };
      articleNode.publisher = {
        "@type": "Organization",
        name: "VERTU",
        logo: {
          "@type": "ImageObject",
          url: VERTU_LOGO_URL,
        },
      };
    }
    const img = pageImageResolved?.trim() || pageImage?.trim();
    if (img) {
      articleNode.image = img;
    }
    graph.push(articleNode);

    if (pu) {
      const crumbs = buildBreadcrumbListSchema(pu, pageTitlePlain);
      if (crumbs) graph.push(crumbs);
    }

    if (faqItems?.length) {
      const mainEntity = faqItems
        .map((item) => {
          const name = item.question.replace(/<[^>]*>/g, "").trim();
          const text = item.answer.replace(/<[^>]*>/g, "").trim();
          if (!name || !text) return null;
          return {
            "@type": "Question",
            name,
            acceptedAnswer: {
              "@type": "Answer",
              text,
            },
          };
        })
        .filter(Boolean) as Array<Record<string, unknown>>;
      if (mainEntity.length > 0) {
        graph.push({
          "@type": "FAQPage",
          mainEntity,
        });
      }
    }

    articleStructuredData = JSON.stringify(
      {
        "@context": "https://schema.org",
        "@graph": graph,
      },
      null,
      2
    );
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

  // 生成 Citations 结构化数据（模板6：参考文献）
  let citationsStructuredData = "";
  if (references && references.length > 0) {
    try {
      const citationsSchema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": pageTitle,
        "citation": references.map(ref => {
          const citation: any = {
            "@type": "CreativeWork"
          };
          if (ref.title) citation.name = ref.title;
          if (ref.author) citation.author = { "@type": "Person", "name": ref.author };
          if (ref.year) citation.datePublished = ref.year;
          if (ref.publication) citation.publisher = { "@type": "Organization", "name": ref.publication };
          if (ref.url) citation.url = ref.url;
          if (ref.doi) citation.identifier = `https://doi.org/${ref.doi}`;
          return citation;
        })
      };
      citationsStructuredData = JSON.stringify(citationsSchema, null, 2);
    } catch (error) {
      console.warn(`[TemplateRenderer] Failed to generate Citations structured data:`, error);
    }
  }

  const rendered = template({
    PAGE_TITLE: pageTitle,
    PAGE_DESCRIPTION: pageDescription || "", // 页面描述（用于模板2和模板3）
    META_DESCRIPTION: metaDescription || pageDescription || "", // SEO meta description
    META_KEYWORDS: metaKeywords || "", // SEO meta keywords
    PAGE_URL: pageUrl || "", // 页面URL（用于canonical和Open Graph）
    PAGE_IMAGE: pageImageResolved || "", // 页面封面图URL（用于Open Graph和Twitter Card，仅模板4）
    DATE_PUBLISHED: datePublished, // 发布日期（ISO格式）
    CURRENT_DATE: new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }), // 当前日期（用于模板6底部显示）
    DATE_MODIFIED: dateModified, // 修改日期（ISO格式）
    ARTICLE_STRUCTURED_DATA: new Handlebars.SafeString(articleStructuredData), // Article结构化数据
    FAQ_STRUCTURED_DATA: new Handlebars.SafeString(faqStructuredData), // FAQ结构化数据
    AI_GENERATED_CONTENT: new Handlebars.SafeString(aiContentResolved),
    AI_EXTENDED_CONTENT: (extendedContentResolved && extendedContentResolved.trim().length > 0) ? new Handlebars.SafeString(extendedContentResolved) : "", // 扩展内容（用于模板3）
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
    // 模板6新增字段
    references: references || [], // 参考文献列表
    externalResources: externalResources || [], // 外部权威资源列表
    CITATIONS_STRUCTURED_DATA: citationsStructuredData ? new Handlebars.SafeString(citationsStructuredData) : "", // Citations结构化数据
  });

  // 调试日志：检查渲染结果
  console.log(`[TemplateRenderer] 渲染完成:`);
  console.log(`  - 页面标题: ${pageTitle}`);
  console.log(`  - AI 内容长度: ${aiContentResolved.length}`);
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
