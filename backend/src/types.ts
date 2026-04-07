export type TaskStatus =
  | "queued"
  | "generating_title"
  | "generating_content"
  | "fetching_products"
  | "rendering_template"
  | "publishing"
  | "paused"
  | "completed"
  | "failed";

export interface GenerationRequestPayload {
  keyword: string;
  productSource?: "wordpress" | "shopify"; // 产品数据源；未指定时若具备完整 Shopify 凭据则走 Shopify，否则 WooCommerce
  publishTarget?: "wordpress" | "static" | "sanity"; // 发布目标
  titleType?: string; // 标题类型：purchase, informational, review, commercial, how-to, recommendations, services-guides, tech-insights, comparison, expert, best, top, most
  pageTitle?: string; // 可选：如果为空，将根据长尾词和选择的标题类型自动生成标题
  userPrompt?: string; // 可选：用户提供的内容提示词和想法，AI将按照此提示词生成内容
  targetCategory?: string; // 可选：用户指定的产品分类，页面将只显示该分类下的产品
  templateType?: string; // 模板类型：template-1, template-2, template-3
  templateContent: string;
  googleApiKey?: string;
  useElementor?: boolean; // 是否使用 Elementor 保存页面
  wordpress?: {
    url: string;
    username: string;
    appPassword: string;
    // WooCommerce 认证（可选）
    consumerKey?: string;
    consumerSecret?: string;
  };
  shopify?: {
    storeUrl: string; // 例如 https://your-store.myshopify.com（Admin API）
    accessToken: string; // Admin API Access Token
    /** 前台产品链接使用的域名，如 https://vertu.com；不填则与 storeUrl 一致 */
    publicStoreUrl?: string;
  };
  staticPublish?: {
    outputDir?: string; // 静态文件落盘目录
    baseUrl?: string; // 对外访问基地址，例如 https://vertu.com/luxury-life-guides
  };
  sanity?: {
    projectId?: string;
    dataset?: string;
    apiVersion?: string; // 默认 2024-01-01
    token?: string;
    docType?: string; // 默认 luxuryLifeGuide
    baseUrl?: string; // 前台页面基地址，例如 https://vertu.com/luxury-life-guides
  };
}

export interface ProductSummary {
  id: number;
  name: string;
  link: string;
  imageUrl?: string;
  category?: string;
  categorySlug?: string;
  categoryLink?: string;
  price?: string;
  originalPrice?: string;
  onSale?: boolean;
  learnMoreLink?: string;
  tag?: string;
  isPriceRange?: boolean;
}

export interface ProductFetchResult {
  products: ProductSummary[];
  relatedProducts: ProductSummary[];
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface TaskProgress {
  id: string;
  status: TaskStatus;
  message: string;
  details?: Record<string, unknown>;
  pageUrl?: string;
  createdAt: number;
  updatedAt: number;
  error?: string;
  // 历史记录相关字段
  keyword?: string;
  pageTitle?: string;
  titleType?: string;
  templateType?: string;
}
