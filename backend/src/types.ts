export type TaskStatus =
  | "queued"
  | "generating_title"
  | "generating_content"
  | "fetching_products"
  | "rendering_template"
  | "publishing"
  | "completed"
  | "failed";

export interface GenerationRequestPayload {
  keyword: string;
  titleType?: string; // 标题类型：purchase, informational, review, commercial, how-to, recommendations, services-guides, tech-insights, comparison, expert, best, top, most
  pageTitle?: string; // 可选：如果为空，将根据长尾词和选择的标题类型自动生成标题
  userPrompt?: string; // 可选：用户提供的内容提示词和想法，AI将按照此提示词生成内容
  targetCategory?: string; // 可选：用户指定的产品分类，页面将只显示该分类下的产品
  templateType?: string; // 模板类型：template-1, template-2, template-3
  templateContent: string;
  googleApiKey?: string;
  useElementor?: boolean; // 是否使用 Elementor 保存页面
  wordpress: {
    url: string;
    username: string;
    appPassword: string;
    // WooCommerce 认证（可选）
    consumerKey?: string;
    consumerSecret?: string;
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
}
