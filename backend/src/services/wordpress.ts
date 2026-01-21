import axios from "axios";
import type { ProductFetchResult, ProductSummary } from "../types.js";

const STOP_WORDS = new Set([
  "best",
  "buy",
  "deal",
  "price",
  "phones",
  "phone",
  "mobile",
  "smartphone",
  "review",
  "reviews",
  "with",
  "from",
  "near",
  "cheap",
  "luxury",
  "store",
  "android",
  "brand",
]);

const PRODUCT_KEYWORD_HINTS = [
  {
    keywords: ["flip", "fold", "foldable", "folding", "hinge", "clamshell", "dual screen"],
    productNames: ["Quantum Flip"], // 优先推荐 Quantum Flip（翻盖手机）
  },
  {
    keywords: ["keyboard", "keypad", "physical keyboard", "qwerty"],
    productNames: ["Signature S", "Signature S+", "Signature V", "Signature Cobra"], // 实体键盘手机
  },
  {
    keywords: ["web3", "crypto", "blockchain", "metaverse", "wallet", "defi"],
    productNames: ["Metavertu Max", "Metavertu", "Metavertu 2"],
  },
  {
    keywords: ["signature", "bar phone", "classic", "artisan", "bespoke"],
    productNames: ["Signature S", "Signature S+", "Signature V", "Signature Cobra"],
  },
  {
    keywords: ["ring", "jewellery", "jewelry", "wearable", "diamond"],
    productNames: ["Meta Ring", "AI Diamond Ring", "AI Meta Ring"],
  },
  {
    keywords: ["watch", "horology", "timepiece", "chronograph"],
    productNames: ["Grand Watch", "Metawatch"],
  },
  {
    keywords: ["earbud", "earbuds", "earphone", "earphones", "audio"],
    productNames: ["Phantom Earbuds", "OWS Earbuds"],
  },
  {
    keywords: ["laptop", "notebook", "computer", "pc", "laptop computer", "portable computer", "ultrabook", "macbook", "laptops", "notebooks"],
    productNames: [], // 笔记本电脑产品将从WordPress产品库中动态搜索
  },
];

const MAX_KEYWORD_VARIANTS = 10;

const KNOWN_PRODUCT_NAMES = [
  "Agent Q",
  "Quantum Flip",
  "Metavertu Max",
  "Metavertu Curve",
  "Metavertu 1 Curve",
  "Metavertu",
  "Metavertu 2",
  "iVERTU",
  "Signature S",
  "Signature S+",
  "Signature V",
  "Signature Cobra",
  "Meta Ring",
  "AI Diamond Ring",
  "AI Meta Ring",
  "Grand Watch",
  "Metawatch",
  "Phantom Earbuds",
  "OWS Earbuds",
  "Ironflip",
  "Quantum",
  "Metavertu Pro",
];

const PRODUCT_NAME_ALIASES: Record<string, string[]> = {
  "Metavertu Max": ["metavertu 2 max", "metavertu 2 pro", "metavertu max phone"],
  "Quantum Flip": ["vertu flip", "quantum folding phone"],
  "Agent Q": ["vertu agent q"],
  "Meta Ring": ["vertu meta ring"],
  "AI Diamond Ring": ["diamond smart ring", "vertu diamond ring"],
  "AI Meta Ring": ["meta ai ring"],
  "Grand Watch": ["vertu grand watch"],
  "Metawatch": ["meta watch"],
  "Phantom Earbuds": ["phantom buds", "vertu phantom earbuds"],
  "OWS Earbuds": ["ows buds", "ows earphone"],
  "Ironflip": ["vertu ironflip", "iron flip"],
};

// 产品分类别名映射（用于优化分类搜索）
const CATEGORY_ALIASES: Record<string, string[]> = {
  "grand watch": ["watch", "watches", "grand-watch", "grandwatch", "timepiece"],
  "meta ring": ["ring", "rings", "meta-ring", "metaring", "smart ring", "smart-ring"],
  "agent q": ["agent-q", "agentq", "phone", "phones", "smartphone"],
  "quantum flip": ["quantum-flip", "quantumflip", "flip", "phone", "phones"],
  "metavertu": ["metavertu-max", "metavertu max", "phone", "phones"],
  "earbud": ["earbuds", "earphone", "earphones", "audio", "ows"],
};

const PRODUCT_NAME_ENTRIES = KNOWN_PRODUCT_NAMES.flatMap((name) => {
  const aliases = PRODUCT_NAME_ALIASES[name] || [];
  return [name, ...aliases].map((label) => ({
    canonical: name,
    normalized: normalizePhrase(label),
  }));
});

export interface WordpressCredentials {
  url: string;
  username: string;
  appPassword: string;
  // WooCommerce 认证（可选）
  consumerKey?: string;
  consumerSecret?: string;
}

function createClient({ url, username, appPassword }: WordpressCredentials) {
  if (!url) {
    throw new Error("WordPress URL is required");
  }
  if (!username || !appPassword) {
    throw new Error("WordPress credentials are required");
  }

  // 确保 URL 是完整的，包含协议
  let baseURL = url.trim();
  
  // 如果没有协议，默认使用 https
  if (!baseURL.startsWith("http://") && !baseURL.startsWith("https://")) {
    baseURL = `https://${baseURL}`;
  }
  
  // 移除末尾的斜杠，避免双斜杠问题
  baseURL = baseURL.replace(/\/+$/, "");

  // 检查 WordPress 代理配置
  // 支持三种情况：
  // 1. NO_PROXY - 禁用代理（直接访问）
  // 2. WORDPRESS_PROXY - 为 WordPress 配置专门的代理
  // 3. 默认使用 HTTP_PROXY/HTTPS_PROXY
  const noProxy = process.env.NO_PROXY || "";
  const wordpressProxy = process.env.WORDPRESS_PROXY || "";
  let proxyConfig: any = undefined; // undefined = 使用环境变量中的代理
  
  try {
    const urlObj = new URL(baseURL);
    const hostname = urlObj.hostname;
    
    // 情况1: 检查 NO_PROXY 配置（禁用代理）
    if (noProxy) {
      const noProxyList = noProxy.split(",").map(d => d.trim());
      const shouldDisableProxy = noProxyList.some(domain => {
        return domain === "*" || hostname.includes(domain) || hostname === domain;
      });
      if (shouldDisableProxy) {
        proxyConfig = false; // 禁用代理
        console.log(`[WordPress] 禁用代理（NO_PROXY 匹配）: ${hostname}`);
      }
    }
    
    // 情况2: 如果配置了 WORDPRESS_PROXY，使用专门的代理
    if (proxyConfig === undefined && wordpressProxy) {
      try {
        const proxyUrl = new URL(wordpressProxy);
        proxyConfig = {
          protocol: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
        };
        console.log(`[WordPress] 使用专门的代理: ${wordpressProxy}`);
      } catch (e) {
        console.warn(`[WordPress] WORDPRESS_PROXY 配置无效: ${wordpressProxy}`);
      }
    }
    
    console.log(`[WordPress] URL: ${baseURL}, NO_PROXY: ${noProxy || "未配置"}, WORDPRESS_PROXY: ${wordpressProxy || "未配置"}, proxyConfig: ${proxyConfig === false ? "禁用" : proxyConfig ? "自定义" : "使用环境变量"}`);
  } catch (e) {
    // URL 解析失败，使用默认行为
    console.warn(`[WordPress] URL 解析失败: ${baseURL}`);
  }

  // 记录配置信息（不记录完整密码）
  const maskedPassword = appPassword.length > 8 
    ? `${appPassword.substring(0, 4)}...${appPassword.substring(appPassword.length - 4)}`
    : "***";
  console.log(`[WordPress] 创建客户端: URL=${baseURL}/wp-json/wp/v2, 用户名=${username}, 密码=${maskedPassword}`);

  const client = axios.create({
    baseURL: `${baseURL}/wp-json/wp/v2`,
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${appPassword}`).toString("base64")}`,
    },
    // 代理配置：
    // false = 禁用代理
    // 对象 = 使用指定的代理配置
    // undefined = 使用环境变量中的代理（HTTP_PROXY/HTTPS_PROXY）
    proxy: proxyConfig,
    // 确保正确处理 HTTPS
    httpsAgent: undefined, // 使用默认的 HTTPS agent
  });

  return client;
}

/**
 * 根据产品名称列表搜索产品（用于确保内容中提到的产品出现在产品列表中）
 * @param credentials WordPress 凭证
 * @param productNames 产品名称列表
 * @returns 找到的产品列表
 */
export async function searchProductsByName(
  credentials: WordpressCredentials,
  productNames: string[]
): Promise<ProductSummary[]> {
  if (!productNames || productNames.length === 0) {
    return [];
  }

  // 准备基础 URL 和代理配置
  let baseURL = credentials.url.trim();
  if (!baseURL.startsWith("http://") && !baseURL.startsWith("https://")) {
    baseURL = `https://${baseURL}`;
  }
  baseURL = baseURL.replace(/\/+$/, "");

  const noProxy = process.env.NO_PROXY || "";
  const wordpressProxy = process.env.WORDPRESS_PROXY || "";
  let proxyConfig: any = undefined;

  try {
    const urlObj = new URL(baseURL);
    const hostname = urlObj.hostname;

    if (noProxy) {
      const noProxyList = noProxy.split(",").map(d => d.trim());
      const shouldDisableProxy = noProxyList.some(domain => {
        return domain === "*" || hostname.includes(domain) || hostname === domain;
      });
      if (shouldDisableProxy) {
        proxyConfig = false;
      }
    }

    if (proxyConfig === undefined && wordpressProxy) {
      try {
        const proxyUrl = new URL(wordpressProxy);
        proxyConfig = {
          protocol: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
        };
      } catch (e) {
        console.warn(`[WordPress] WORDPRESS_PROXY 配置无效: ${wordpressProxy}`);
      }
    }
  } catch (e) {
    console.warn(`[WordPress] URL 解析失败: ${baseURL}`);
  }

  const foundProducts: ProductSummary[] = [];
  const foundProductIds = new Set<number>();

  // 尝试使用 WooCommerce API
  if (credentials.consumerKey && credentials.consumerSecret) {
    try {
      const client = axios.create({
        baseURL: `${baseURL}/wp-json/wc/v3`,
        auth: {
          username: credentials.consumerKey,
          password: credentials.consumerSecret,
        },
        proxy: proxyConfig,
        timeout: 30000,
      });

      // 为每个产品名称搜索
      for (const productName of productNames) {
        try {
          const response = await client.get("/products", {
              params: {
                search: productName,
                per_page: 10,
                status: "publish", // 只要求已发布
              },
          });

          if (response.data && Array.isArray(response.data)) {
            const filtered = filterRawProductsByTargetNames(response.data, [productName]);
            for (const product of parseProductsData(filtered, "WooCommerce")) {
              if (!foundProductIds.has(product.id)) {
                foundProducts.push(product);
                foundProductIds.add(product.id);
              }
            }
          }
        } catch (error: any) {
          console.warn(`[WordPress] 搜索产品 "${productName}" 失败:`, error.response?.status || error.message);
        }
      }
    } catch (error: any) {
      console.warn(`[WordPress] WooCommerce API 搜索失败:`, error.response?.status || error.message);
    }
  }

  // 如果 WooCommerce 搜索失败，尝试使用 WordPress 标准 API
  if (foundProducts.length === 0) {
    try {
      const client = axios.create({
        baseURL: `${baseURL}/wp-json/wp/v2`,
        auth: {
          username: credentials.username,
          password: credentials.appPassword,
        },
        proxy: proxyConfig,
        timeout: 30000,
      });

      for (const productName of productNames) {
        try {
          const response = await client.get("/products", {
            params: {
              search: productName,
              per_page: 10,
              _embed: true,
              status: "publish", // 只要求已发布
            },
          });

          if (response.data && Array.isArray(response.data)) {
            const filtered = filterRawProductsByTargetNames(response.data, [productName]);
            for (const product of parseProductsData(filtered, "WordPress Standard")) {
              if (!foundProductIds.has(product.id)) {
                foundProducts.push(product);
                foundProductIds.add(product.id);
              }
            }
          }
        } catch (error: any) {
          console.warn(`[WordPress] 搜索产品 "${productName}" 失败:`, error.response?.status || error.message);
        }
      }
    } catch (error: any) {
      console.warn(`[WordPress] WordPress Standard API 搜索失败:`, error.response?.status || error.message);
    }
  }

  if (foundProducts.length > 0) {
    console.log(`[WordPress] ✅ 根据内容中提到的产品名称，找到 ${foundProducts.length} 个产品: ${foundProducts.map(p => p.name).join(", ")}`);
  }

  return foundProducts;
}

export async function fetchRelatedProducts(
  credentials: WordpressCredentials,
  keyword: string,
  targetCategory?: string
): Promise<ProductFetchResult> {
  // WooCommerce 使用自己的 REST API 命名空间和认证方式
  // 支持两种认证方式：
  // 1. Consumer Key/Secret（WooCommerce 推荐）
  // 2. WordPress 应用密码（备用）
  
  // 准备基础 URL 和代理配置
  let baseURL = credentials.url.trim();
  if (!baseURL.startsWith("http://") && !baseURL.startsWith("https://")) {
    baseURL = `https://${baseURL}`;
  }
  baseURL = baseURL.replace(/\/+$/, "");
  
  const noProxy = process.env.NO_PROXY || "";
  const wordpressProxy = process.env.WORDPRESS_PROXY || "";
  let proxyConfig: any = undefined;
  
  try {
    const urlObj = new URL(baseURL);
    const hostname = urlObj.hostname;
    
    if (noProxy) {
      const noProxyList = noProxy.split(",").map(d => d.trim());
      const shouldDisableProxy = noProxyList.some(domain => {
        return domain === "*" || hostname.includes(domain) || hostname === domain;
      });
      if (shouldDisableProxy) {
        proxyConfig = false;
      }
    }
    
    if (proxyConfig === undefined && wordpressProxy) {
      try {
        const proxyUrl = new URL(wordpressProxy);
        proxyConfig = {
          protocol: proxyUrl.protocol.replace(":", ""),
          host: proxyUrl.hostname,
          port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
        };
      } catch (e) {
        console.warn(`[WordPress] WORDPRESS_PROXY 配置无效: ${wordpressProxy}`);
      }
    }
  } catch (e) {
    console.warn(`[WordPress] URL 解析失败: ${baseURL}`);
  }

  // 如果用户指定了目标分类，优先使用分类搜索
  if (targetCategory && targetCategory.trim()) {
    console.log(`[WordPress] 用户指定了目标分类: "${targetCategory.trim()}"，优先使用分类搜索`);
    
    // 尝试多个端点和认证方式
    const endpoints = [
      { path: "/wp-json/wc/v3/products", name: "WooCommerce v3" },
      { path: "/wp-json/wc/v2/products", name: "WooCommerce v2" },
    ];
    
    const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY || (credentials as any).consumerKey;
    const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET || (credentials as any).consumerSecret;
    
    // 准备代理配置
    const noProxy = process.env.NO_PROXY || "";
    const wordpressProxy = process.env.WORDPRESS_PROXY || "";
    let proxyConfig: any = undefined;
    
    try {
      const urlObj = new URL(baseURL);
      const hostname = urlObj.hostname;
      
      if (noProxy) {
        const noProxyList = noProxy.split(",").map(d => d.trim());
        const shouldDisableProxy = noProxyList.some(domain => {
          return domain === "*" || hostname.includes(domain) || hostname === domain;
        });
        if (shouldDisableProxy) {
          proxyConfig = false;
        }
      }
      
      if (proxyConfig === undefined && wordpressProxy) {
        try {
          const proxyUrl = new URL(wordpressProxy);
          proxyConfig = {
            protocol: proxyUrl.protocol.replace(":", ""),
            host: proxyUrl.hostname,
            port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
          };
        } catch (e) {
          console.warn(`[WordPress] WORDPRESS_PROXY 配置无效: ${wordpressProxy}`);
        }
      }
    } catch (e) {
      console.warn(`[WordPress] URL 解析失败: ${baseURL}`);
    }
    
    // 尝试通过分类搜索产品
    for (const endpoint of endpoints) {
      try {
        const endpointBase = endpoint.path.replace("/products", "");
        let client: ReturnType<typeof axios.create>;
        
        if (consumerKey && consumerSecret) {
          client = axios.create({
            baseURL: `${baseURL}${endpointBase}`,
            auth: {
              username: consumerKey,
              password: consumerSecret,
            },
            proxy: proxyConfig,
            httpsAgent: undefined,
          });
        } else {
          client = axios.create({
            baseURL: `${baseURL}${endpointBase}`,
            headers: {
              Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.appPassword}`).toString("base64")}`,
            },
            proxy: proxyConfig,
            httpsAgent: undefined,
          });
        }
        
        // 支持多个分类（逗号分隔）
        const targetCategories = targetCategory.trim().split(',').map(c => c.trim()).filter(c => c.length > 0);
        console.log(`[WordPress] 📋 解析目标分类: ${targetCategories.length} 个分类 - [${targetCategories.join(", ")}]`);
        
        // 收集所有匹配的分类
        const matchedCategories = new Map<number, { id: number; name: string; slug: string }>();
        
        // 标准化分类名称和slug进行匹配
        const normalizeCategory = (str: string) => str.replace(/[\s_-]+/g, "-").toLowerCase().trim();
        
        // 对每个目标分类进行搜索
        for (const targetCat of targetCategories) {
          console.log(`[WordPress] 🔍 搜索分类: "${targetCat}"`);
          
          // 获取分类的所有可能别名
          const targetCatLower = targetCat.toLowerCase();
          const searchVariants = [targetCat];
          
          // 添加别名
          for (const [key, aliases] of Object.entries(CATEGORY_ALIASES)) {
            if (targetCatLower.includes(key) || key.includes(targetCatLower)) {
              searchVariants.push(...aliases);
            }
          }
          
          // 去重
          const uniqueSearchVariants = [...new Set(searchVariants)];
          console.log(`[WordPress]   搜索变体: [${uniqueSearchVariants.join(", ")}]`);
          
          // 对每个搜索变体进行API调用
          for (const searchTerm of uniqueSearchVariants) {
          try {
            const categoryResp = await client.get("/products/categories", {
              params: {
                  search: searchTerm,
                  per_page: 30, // 增加搜索数量以支持模糊匹配
                hide_empty: true,
              },
            });
            
            let categories: Array<{ id: number; name: string; slug: string }> = Array.isArray(categoryResp.data)
              ? categoryResp.data
              : [];
            
              console.log(`[WordPress]   搜索词 "${searchTerm}" 返回 ${categories.length} 个分类`);
              
            const targetCategoryNormalized = normalizeCategory(targetCat);
              const searchTermNormalized = normalizeCategory(searchTerm);
            
            // 模糊匹配分类（包含匹配，不区分大小写）
            categories.forEach((category) => {
              const categoryName = normalizeCategory(category.name || "");
              const categorySlug = normalizeCategory(category.slug || "");
              
              // 检查分类名称或slug是否包含目标关键词（模糊匹配）
                const nameMatches = categoryName.includes(targetCategoryNormalized) || 
                                   targetCategoryNormalized.includes(categoryName) ||
                                   categoryName.includes(searchTermNormalized) || 
                                   searchTermNormalized.includes(categoryName);
                
                const slugMatches = categorySlug.includes(targetCategoryNormalized) || 
                                   targetCategoryNormalized.includes(categorySlug) ||
                                   categorySlug.includes(searchTermNormalized) || 
                                   searchTermNormalized.includes(categorySlug);
              
              // 也支持精确匹配
                const exactMatch = categoryName === targetCategoryNormalized || 
                                  categorySlug === targetCategoryNormalized ||
                                  categoryName === searchTermNormalized || 
                                  categorySlug === searchTermNormalized;
              
              if (exactMatch || nameMatches || slugMatches) {
                // 使用Map避免重复
                if (!matchedCategories.has(category.id)) {
                  matchedCategories.set(category.id, category);
                    console.log(`[WordPress]   ✅ 匹配到分类: "${category.name}" (slug: "${category.slug}") - 原始输入: "${targetCat}", 搜索词: "${searchTerm}"`);
                }
              }
            });
          } catch (error: any) {
              console.warn(`[WordPress]   ⚠️ 搜索分类 "${searchTerm}" 失败:`, error.response?.status || error.message);
            continue;
            }
          }
        }
        
        const categories = Array.from(matchedCategories.values());
        
        if (categories.length > 0) {
          console.log(`[WordPress] ✅ 找到 ${categories.length} 个匹配的分类: [${categories.map(c => `"${c.name}"(${c.slug})`).join(", ")}]`);
          
          // 获取这些分类下的所有产品
          const uniqueProducts = new Map<number, any>();
          
          for (const category of categories) {
            try {
              console.log(`[WordPress] 🛍️  正在获取分类 "${category.name}" (ID: ${category.id}) 下的产品...`);
              const productsResp = await client.get("/products", {
                params: {
                  category: category.id,
                  per_page: 50,
                  status: "publish", // 只要求已发布
                },
              });
              
              const list: any[] = Array.isArray(productsResp.data) ? productsResp.data : [];
              const newProducts: string[] = [];
              list.forEach((product) => {
                if (!uniqueProducts.has(product.id)) {
                  uniqueProducts.set(product.id, product);
                  newProducts.push(product.name || `Product ${product.id}`);
                }
              });
              console.log(`[WordPress]   ✅ 从分类 "${category.name}" 获取 ${list.length} 个产品 (新增 ${newProducts.length} 个)`);
              if (newProducts.length > 0 && newProducts.length <= 10) {
                console.log(`[WordPress]      产品列表: [${newProducts.join(", ")}]`);
              }
            } catch (error: any) {
              console.warn(
                `[WordPress]   ❌ 分类 "${category.name}" (${category.slug}) 拉取产品失败:`,
                error.response?.status || error.message
              );
              continue;
            }
          }
          
          if (uniqueProducts.size > 0) {
            const collectedProducts = Array.from(uniqueProducts.values());
            console.log(`[WordPress] 📦 总共收集到 ${collectedProducts.length} 个唯一产品（已去重）`);
            const products = parseProductsData(collectedProducts, endpoint.name);
            
            // 获取相关产品（upsells）
            const relatedProducts = await fetchWooCommerceRelatedProducts(
              client,
              collectedProducts,
              endpoint.name,
              products
            );
            
            console.log(`[WordPress] ✅ 成功！通过指定分类获取 ${products.length} 个产品，${relatedProducts.length} 个相关产品`);
            console.log(`[WordPress] 📋 最终产品列表: [${products.slice(0, 10).map(p => p.name).join(", ")}${products.length > 10 ? ', ...' : ''}]`);
            return { products, relatedProducts };
          } else {
            console.warn(`[WordPress] ⚠️ 匹配的分类下没有产品，将使用默认搜索策略`);
          }
        } else {
          console.warn(`[WordPress] ⚠️ 未找到匹配的分类: "${targetCategory.trim()}"，将使用默认搜索策略`);
          console.warn(`[WordPress] 💡 提示：请确认 WooCommerce 中存在这些分类，或者尝试使用分类的准确名称/slug`);
        }
      } catch (error: any) {
        console.warn(`[WordPress] 通过分类搜索失败:`, error.response?.status || error.message);
        // 继续使用默认搜索策略
      }
    }
  }

  const targetProductNames = extractTargetProductNames(keyword);
  if (targetProductNames.length) {
    console.log(
      `[WordPress] 检测到关键词包含具体产品：${targetProductNames.join(", ")}`
    );
  }

  const keywordVariants = buildKeywordVariants(keyword, targetProductNames);
  console.log(`[WordPress] 产品检索关键词序列: ${keywordVariants.join(", ")}`);

  // 尝试多个端点和认证方式
  const endpoints = [
    { path: "/wp-json/wc/v3/products", name: "WooCommerce v3" },
    { path: "/wp-json/wc/v2/products", name: "WooCommerce v2" },
    { path: "/wp-json/wp/v2/products", name: "WordPress Standard" },
  ];
  const wooEndpoints = endpoints.filter((endpoint) => endpoint.name.startsWith("WooCommerce"));

  // 检查是否有 Consumer Key/Secret（从环境变量或凭据中）
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY || (credentials as any).consumerKey;
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET || (credentials as any).consumerSecret;

  let lastError: any = null;

  // 如果有 Consumer Key/Secret，优先使用
  if (consumerKey && consumerSecret) {
    console.log(`[WordPress] 使用 WooCommerce Consumer Key/Secret 认证`);
    
    for (const endpoint of wooEndpoints) {
      try {
        console.log(`[WordPress] 尝试端点: ${endpoint.name} (${endpoint.path})`);
        
        const endpointBase = endpoint.path.replace("/products", "");
        const wcClient = axios.create({
          baseURL: `${baseURL}${endpointBase}`,
          auth: {
            username: consumerKey,
            password: consumerSecret,
          },
          proxy: proxyConfig,
          httpsAgent: undefined,
        });

        const result = await fetchWooCommerceProducts(
          wcClient,
          keywordVariants,
          endpoint.name,
          targetProductNames
        );
        if (result) {
          return result;
        }
      } catch (error: any) {
        console.warn(`[WordPress] ${endpoint.name} 失败:`, error.response?.status || error.message);
        lastError = error;
        continue; // 尝试下一个端点
      }
    }
  }

  // 如果没有 Consumer Key/Secret 或都失败了，尝试使用 WordPress 应用密码
  console.log(`[WordPress] 尝试使用 WordPress 应用密码认证`);
  
  for (const endpoint of endpoints) {
    try {
      console.log(`[WordPress] 尝试端点: ${endpoint.name} (${endpoint.path})`);
      
      const endpointBase = endpoint.path.replace("/products", "");
      const client = axios.create({
        baseURL: `${baseURL}${endpointBase}`,
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.appPassword}`).toString("base64")}`,
        },
        proxy: proxyConfig,
        httpsAgent: undefined,
      });

      if (endpoint.name.startsWith("WooCommerce")) {
        const wooResult = await fetchWooCommerceProducts(
          client,
          keywordVariants,
          endpoint.name,
          targetProductNames
        );
        if (wooResult) {
          return wooResult;
        }
        continue;
      }

      const wpResult = await fetchWordpressStandardProducts(
        client,
        keywordVariants,
        endpoint.name,
        targetProductNames
      );
      if (wpResult) {
        return wpResult;
      }
    } catch (error: any) {
      console.warn(`[WordPress] ${endpoint.name} 失败:`, error.response?.status || error.message);
      lastError = error;
      continue; // 尝试下一个端点
    }
  }

  // 所有端点都失败了
  console.warn(`[WordPress] 所有端点都失败，返回空数组`);
  
  // 如果是 404 错误，返回空数组而不是抛出错误
  if (lastError?.response?.status === 404) {
    const errorData = lastError.response?.data || {};
    const errorCode = errorData.code || "";
    const errorMsg = errorData.message || "";
    
    if (errorCode === "rest_no_route" || errorMsg.includes("No route was found")) {
      console.warn(`[WordPress] 产品端点不存在，继续执行（返回空数组）`);
      return { products: [], relatedProducts: [] };
    }
  }
  
  throw lastError || new Error("无法获取产品：所有端点都失败");
}

// 解析产品数据的辅助函数
function parseProductsData(productsData: any[], apiType: string): ProductSummary[] {
  // 需要排除的分类（统一列表）
  const normalizeCategory = (str: string) => {
    if (!str) return "";
    return str.replace(/[\s_-]+/g, "-").toLowerCase().trim();
  };
  
  const excludedCategoryPatterns = [
    "uncategorized",
    "uncategorised",
    "payment-link",
    "payment link",
    "ironflip",
    "iron-flip",
    "aster-p",
    "aster p",
    "vertu-classics",
    "vertu classics",
  ];
  
  // Phones 分类下允许的子分类（白名单）
  // 注意：对于泛词搜索（如"phones"），应该显示所有手机产品，所以白名单应该包含所有 VERTU 手机系列
  const allowedPhonesSubcategories = [
    "agent q",
    "agent-q",
    "quantum flip",
    "quantum-flip",
    "metavertu",
    "meta-vertu",
    "metavertu max",
    "metavertu-max",
    "metavertu 2",
    "metavertu-2",
    "metavertu pro",
    "metavertu-pro",
    "meta max",
    "meta-max",
    "metavertu curve",
    "metavertu-curve",
    "metavertu 1 curve",
    "metavertu-1-curve",
    "meta curve",
    "meta-curve",
    "ivertu",
    "i-vertu",
    "signature s+",
    "signature-s+",
    "signature s",
    "signature-s",
    "signature v",
    "signature-v",
    "signature cobra",
    "signature-cobra",
    "signature",
  ];
  
  // 检查产品是否缺货
  const isProductOutOfStock = (product: any): boolean => {
    // WooCommerce API 格式
    if (product.stock_status !== undefined) {
      // stock_status: "instock" 或 "outofstock"
      if (product.stock_status === "outofstock") {
        return true; // 缺货
      }
      if (product.stock_status === "instock") {
        return false; // 有货
      }
    }
    
    // 检查 in_stock 字段（boolean）
    if (product.in_stock !== undefined) {
      if (product.in_stock === false) {
        return true; // 缺货
      }
    }
    
    // 检查 manage_stock 和 stock_quantity
    if (product.manage_stock === true) {
      const stockQuantity = product.stock_quantity;
      if (stockQuantity !== undefined && stockQuantity !== null) {
        if (stockQuantity <= 0) {
          return true; // 库存数量为0或负数，缺货
        }
      }
    }
    
    // 如果所有库存相关字段都不存在，默认认为有货（向后兼容）
    return false;
  };
  
  // 检查产品是否属于排除的分类
  const isProductExcluded = (product: any): boolean => {
    let categories: Array<{ name?: string; slug?: string; parent?: number }> = [];
    
    // WooCommerce API格式
    if (product.categories && Array.isArray(product.categories)) {
      categories = product.categories;
    }
    // WordPress标准API格式（从_embedded中提取）
    else if (product._embedded && product._embedded["wp:term"]) {
      const terms = product._embedded["wp:term"];
      if (Array.isArray(terms) && terms.length > 0) {
        // wp:term可能是一个二维数组，需要扁平化
        categories = Array.isArray(terms[0]) ? terms.flat() : terms;
      }
    }
    
    if (categories.length === 0) {
      return false;
    }
    
    // 检查产品是否属于 Phones 分类或其子分类
    let belongsToPhones = false;
    let hasAllowedPhonesSubcategory = false;
    let hasOtherPhonesSubcategory = false;
    
    for (const cat of categories) {
      const categoryName = normalizeCategory(cat.name || "");
      const categorySlug = normalizeCategory(cat.slug || "");
      
      // 检查是否是 Phones 分类本身
      if (categoryName === "phones" || categorySlug === "phones") {
        belongsToPhones = true;
        continue;
      }
      
      // 检查是否是 Phones 的允许子分类
      const isAllowedSubcategory = allowedPhonesSubcategories.some((allowed) => {
        const normalizedAllowed = normalizeCategory(allowed);
        return categoryName === normalizedAllowed || categorySlug === normalizedAllowed;
      });
      
      if (isAllowedSubcategory) {
        hasAllowedPhonesSubcategory = true;
      } else {
        // 检查是否可能是 Phones 的其他子分类（通过检查 parent 字段或分类名称模式）
        // 如果分类有 parent 字段，说明它是某个分类的子分类
        // 这里我们假设如果分类名称不在允许列表中，且产品也属于 Phones，则可能是 Phones 的其他子分类
        if (cat.parent !== undefined && cat.parent !== 0) {
          // 有父分类，可能是 Phones 的子分类
          hasOtherPhonesSubcategory = true;
        }
      }
    }
    
    // 如果产品属于 Phones 分类
    if (belongsToPhones) {
      // 如果有允许的子分类，允许显示
      if (hasAllowedPhonesSubcategory) {
        return false; // 允许显示
      }
      
      // 如果直接属于 Phones（没有子分类），允许显示
      if (!hasAllowedPhonesSubcategory && !hasOtherPhonesSubcategory) {
        return false; // 允许显示（直接属于 Phones）
      }
      
      // 如果属于 Phones 的其他子分类（不在允许列表中），过滤掉
      if (hasOtherPhonesSubcategory && !hasAllowedPhonesSubcategory) {
        const productName = product.name || product.title?.rendered || product.slug || "Unknown";
        const categoryNames = categories.map(c => `${c.name || c.slug}${c.parent ? `(parent: ${c.parent})` : ''}`).join(", ");
        console.log(`[WordPress] ⚠️ 产品 "${productName}" 属于 Phones 但不属于允许的子分类。分类: ${categoryNames}`);
        return true; // 过滤掉
      }
    }
    
    // 如果产品不属于 Phones，但属于允许的子分类（可能通过其他方式关联），也允许显示
    if (!belongsToPhones && hasAllowedPhonesSubcategory) {
      return false; // 允许显示
    }
    
    // 检查产品的所有分类（排除分类检查）
    for (const cat of categories) {
      const categoryName = normalizeCategory(cat.name || "");
      const categorySlug = normalizeCategory(cat.slug || "");
      
      const isExcluded = excludedCategoryPatterns.some((excluded) => {
        const normalizedExcluded = normalizeCategory(excluded);
        return categoryName === normalizedExcluded || categorySlug === normalizedExcluded;
      });
      
      if (isExcluded) {
        const productName = product.name || product.title?.rendered || product.slug || "Unknown";
        console.log(`[WordPress] ⚠️ 产品 "${productName}" 属于排除分类: "${cat.name || cat.slug}" (slug: "${cat.slug || cat.name}")`);
        return true;
      }
    }
    
    return false;
  };
  
  return productsData
    .filter((product) => {
      // 先过滤掉缺货的产品
      // 不过滤缺货产品 - 只要已发布就显示
      // if (isProductOutOfStock(product)) {
      //   const productName = product.name || product.title?.rendered || product.slug || "Unknown";
      //   console.log(`[WordPress] ⚠️ 过滤缺货产品: ${productName}`);
      //   return false;
      // }
      // 只过滤掉属于排除分类的产品
      return !isProductExcluded(product);
    })
    .map((product) => {
    if (apiType.includes("WooCommerce")) {
      const imageUrl = product.images?.[0]?.src;
      const category = product.categories?.[0]?.name;
      const categorySlug = product.categories?.[0]?.slug;
      const categoryLink = product.categories?.[0]?.permalink;
      const { price, originalPrice, onSale, isPriceRange } = buildPriceFields(product);
      const tag = product.tags?.[0]?.name;

      return {
        id: product.id,
        name: product.name,
        link: product.permalink || product.link,
        imageUrl,
        category,
        categorySlug,
        categoryLink,
        price,
        originalPrice,
        onSale,
        tag,
        isPriceRange,
      } satisfies ProductSummary;
    } else {
      const embedded = product._embedded ?? {};
      const media: any[] = embedded["wp:featuredmedia"] ?? [];
      const categories: any[] = embedded["wp:term"]?.flat() ?? [];

      const imageUrl = media[0]?.source_url;
      const category = categories[0]?.name;
      const categorySlug = categories[0]?.slug;
      const categoryLink = categories[0]?.link;

      return {
        id: product.id,
        name: product.title?.rendered ?? product.slug,
        link: product.link,
        imageUrl,
        category,
        categorySlug,
        categoryLink,
      } satisfies ProductSummary;
    }
  })
    .filter((product) => {
      const categoryLower = product.category?.toLowerCase().trim() || "";
      const categorySlugLower = product.categorySlug?.toLowerCase().trim() || "";
      
      // 需要排除的分类（不区分大小写）
      // 注意：slug通常使用连字符，名称可能使用空格
      const excludedCategoryPatterns = [
        "uncategorized",
        "uncategorised",
        "payment-link",
        "payment link",
        "ironflip",
        "iron-flip",
        "aster-p",
        "aster p",
        "vertu-classics",
        "vertu classics",
      ];
      
      // 标准化分类名称和slug以便比较（将空格、连字符、下划线都标准化为连字符）
      const normalizeCategory = (str: string) => {
        if (!str) return "";
        return str.replace(/[\s_-]+/g, "-").toLowerCase().trim();
      };
      
      const normalizedCategory = normalizeCategory(categoryLower);
      const normalizedSlug = normalizeCategory(categorySlugLower);
      
      // 检查分类名称和 slug 是否在排除列表中（支持多种格式：空格、连字符、下划线）
      const isExcluded = excludedCategoryPatterns.some((excluded) => {
        const normalizedExcluded = normalizeCategory(excluded);
        // 精确匹配标准化后的值
        const matches = (
          normalizedCategory === normalizedExcluded ||
          normalizedSlug === normalizedExcluded
        );
        
        // 如果匹配，记录详细信息用于调试
        if (matches) {
          console.log(`[WordPress] 🔍 匹配到排除分类: "${excluded}"`);
          console.log(`[WordPress]   产品分类名称: "${product.category}" (标准化: "${normalizedCategory}")`);
          console.log(`[WordPress]   产品分类slug: "${product.categorySlug}" (标准化: "${normalizedSlug}")`);
        }
        
        return matches;
      });
      
      // 只返回有效的分类且不在排除列表中的产品
      if (!categoryLower) {
        console.log(`[WordPress] 过滤产品（无分类）: ${product.name}`);
        return false; // 没有分类的产品也过滤掉
      }
      
      if (isExcluded) {
        console.log(`[WordPress] ⚠️ 过滤产品: ${product.name}`);
        console.log(`[WordPress]   原因: 分类 "${product.category}" (slug: "${product.categorySlug}") 在排除列表中`);
        console.log(`[WordPress]   标准化后: category="${normalizedCategory}", slug="${normalizedSlug}"`);
        return false;
      }
      
      return true;
    });
}

function sanitizePrice(value?: string): string | undefined {
  if (!value) return undefined;
  const stripped = stripHtml(value).trim();
  return stripped || undefined;
}

function buildPriceFields(product: any): {
  price?: string;
  originalPrice?: string;
  onSale: boolean;
  isPriceRange: boolean;
} {
  const priceHtml: string = product.price_html || "";
  const tokens = extractPriceTokens(priceHtml);
  const hasSale = Boolean(product.on_sale) || /<del/i.test(priceHtml);
  const isRange = isPriceRange(priceHtml);

  let price: string | undefined;
  let originalPrice: string | undefined;

  if (hasSale && tokens.length >= 2) {
    originalPrice = tokens[0];
    price = tokens[tokens.length - 1];
  } else if (tokens.length >= 1) {
    price = tokens[tokens.length - 1];
  } else if (product.price_html) {
    price = sanitizePrice(product.price_html);
  } else if (product.price) {
    price = formatNumericPrice(product.price);
  }

  if (!originalPrice && hasSale) {
    if (tokens.length >= 2) {
      originalPrice = tokens[0];
    } else if (product.regular_price) {
      originalPrice = formatNumericPrice(product.regular_price, price);
    }
  }

  const normalizedCurrent = normalizePriceForComparison(price);
  const normalizedOriginal = normalizePriceForComparison(originalPrice);
  const onSale =
    Boolean(hasSale) &&
    normalizedCurrent !== undefined &&
    normalizedOriginal !== undefined &&
    normalizedCurrent < normalizedOriginal;

  if (!onSale) {
    originalPrice = undefined;
  }

  return { price, originalPrice, onSale, isPriceRange: isRange };
}

function extractPriceTokens(priceHtml?: string): string[] {
  if (!priceHtml) return [];
  const matches: string[] = [];
  const regex = /<bdi>(.*?)<\/bdi>/gi;
  let match;
  while ((match = regex.exec(priceHtml)) !== null) {
    const value = stripHtml(match[1] || "")
      .replace(/\s+/g, " ")
      .trim();
    if (value) {
      matches.push(value);
    }
  }
  if (!matches.length) {
    const sanitized = stripHtml(priceHtml);
    if (sanitized) {
      sanitized
        .split(/–|&ndash;| to /i)
        .map((token) => token.trim())
        .filter(Boolean)
        .forEach((token) => matches.push(token));
    }
  }
  return matches;
}

function isPriceRange(priceHtml?: string): boolean {
  if (!priceHtml) return false;
  return /&ndash;|–| to /i.test(priceHtml);
}

function normalizePriceForComparison(value?: string): number | undefined {
  if (!value) return undefined;
  const numeric = parseFloat(value.replace(/[^\d.]/g, ""));
  return isFinite(numeric) ? numeric : undefined;
}

function formatNumericPrice(value?: string, template?: string): string | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (!isFinite(numeric)) {
    return value;
  }

  const prefix = extractCurrencyPrefix(template) || "US$";
  const formattedNumber = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numeric);

  return `${prefix}${formattedNumber}`;
}

function extractCurrencyPrefix(sample?: string): string | undefined {
  if (!sample) return undefined;
  const match = sample.match(/^[^\d]+/);
  return match ? match[0].trim() : undefined;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

async function fetchWooCommerceProducts(
  client: ReturnType<typeof axios.create>,
  keywordVariants: string[],
  apiName: string,
  targetProductNames: string[] = []
): Promise<ProductFetchResult | null> {
  for (const term of keywordVariants) {
    const fromCategory = await fetchWooCommerceProductsByCategory(
      client,
      term,
      apiName,
      targetProductNames
    );
    if (fromCategory && fromCategory.products.length > 0) {
      return fromCategory;
    }
  }

  for (const term of keywordVariants) {
    const fromSearch = await fetchWooCommerceProductsBySearch(
      client,
      term,
      apiName,
      targetProductNames
    );
    if (fromSearch && fromSearch.products.length > 0) {
      return fromSearch;
    }
  }

  console.log(`[WordPress] 未通过关键词命中产品，尝试 ${apiName} 默认产品 fallback`);
  return fetchWooCommerceFallbackProducts(client, apiName, targetProductNames);
}

async function fetchWooCommerceProductsBySearch(
  client: ReturnType<typeof axios.create>,
  searchTerm: string,
  apiName: string,
  targetProductNames: string[] = []
): Promise<ProductFetchResult | null> {
  const trimmedTerm = searchTerm.trim();
  if (!trimmedTerm) {
    return null;
  }

  // 优化：对于通用类别关键词（如"phone"、"mobile phone"、"luxury watch"、"smart ring"），大幅增加搜索数量以获取所有相关产品
  // 完整泛词识别：支持所有常见的手机、手表、戒指、耳机泛词和组合
  // 完整的手机泛词模式 - 包含所有可能的长尾词组合
  // 基础词 + 所有形容词组合（luxury, premium, flagship, business, designer, expensive 等）
  const phonePattern = /\b(phone|phones|smartphone|smartphones|mobile|mobiles|cellphone|cellphones|handset|handsets|mobile\s+phone|mobile\s+phones|smart\s+phone|smart\s+phones|cell\s+phone|cell\s+phones|luxury\s+phone|luxury\s+phones|luxury\s+mobile|luxury\s+smartphone|premium\s+phone|premium\s+phones|premium\s+mobile|premium\s+smartphone|high-?end\s+phone|high-?end\s+phones|high-?end\s+mobile|flagship\s+phone|flagship\s+phones|business\s+phone|business\s+phones|feature\s+phone|feature\s+phones|android\s+phone|android\s+phones|5G\s+phone|5G\s+phones|expensive\s+phone|expensive\s+phones|designer\s+phone|designer\s+phones|exclusive\s+phone|exclusive\s+phones|boutique\s+phone|boutique\s+phones|VERTU\s+phone|VERTU\s+phones|VERTU\s+mobile|VERTU\s+smartphone|secure\s+phone|secure\s+phones|privacy\s+phone|privacy\s+phones|encrypted\s+phone|encrypted\s+phones|crypto\s+phone|crypto\s+phones|Web3\s+phone|Web3\s+phones|AI\s+phone|AI\s+phones|concierge\s+phone|titanium\s+phone|ceramic\s+phone|leather\s+phone|gold\s+phone|diamond\s+phone|sapphire\s+phone|executive\s+phone|executive\s+phones|VIP\s+phone|VIP\s+phones|collector\s+phone)\b/i;
  const watchPattern = /\b(watch|watches|timepiece|timepieces|wristwatch|wristwatches|smartwatch|smartwatches|smart\s+watch|smart\s+watches|luxury\s+watch|premium\s+watch)\b/i;
  const ringPattern = /\b(ring|rings|smart\s+ring|smart\s+rings|wearable\s+ring|luxury\s+ring|premium\s+ring|diamond\s+ring|gold\s+ring|jewellery|jewelry)\b/i;
  const earbudPattern = /\b(earbud|earbuds|earphone|earphones|headphone|headphones|wireless\s+earbud|bluetooth\s+earbud)\b/i;
  const specificModelPattern = /(flip|fold|foldable|folding|keyboard|keypad|signature|agent|quantum|metavertu|grand\s+watch|metawatch|meta\s+ring)/i;
  
  const isGenericCategoryKeyword = (phonePattern.test(trimmedTerm) || watchPattern.test(trimmedTerm) || ringPattern.test(trimmedTerm) || earbudPattern.test(trimmedTerm)) &&
                                   !specificModelPattern.test(trimmedTerm);
  // 泛词使用 100 个产品搜索，确保获取所有相关产品
  const perPage = isGenericCategoryKeyword ? 100 : (targetProductNames.length > 1 ? 20 : 10);

  console.log(`[WordPress] 搜索关键词"${trimmedTerm}"${isGenericCategoryKeyword ? '（泛词）' : ''}，per_page=${perPage}`);

  // 只要求产品已发布，不限制库存状态
  const searchParams: any = {
    search: trimmedTerm,
    per_page: perPage,
    status: "publish", // 只要求已发布
  };
  
  console.log(`[WordPress] 搜索关键词"${trimmedTerm}"（${isGenericCategoryKeyword ? '泛词' : '普通'}），per_page=${perPage}，仅已发布产品`);
  
  const response = await client.get("/products", {
    params: searchParams,
  });

  // 对于手机泛词，额外搜索核心产品名称以确保这些产品一定被获取
  let allProducts = response.data && Array.isArray(response.data) ? [...response.data] : [];
  
  if (isGenericCategoryKeyword && phonePattern.test(trimmedTerm)) {
    console.log(`[WordPress] 🔍 检测到手机泛词，额外搜索核心产品以确保覆盖...`);
    
    // 核心手机产品列表
    const corePhoneProducts = ['Agent Q', 'Quantum Flip', 'Signature', 'Metavertu Max', 'Metavertu'];
    
    for (const productName of corePhoneProducts) {
      try {
        const coreResponse = await client.get("/products", {
          params: {
            search: productName,
            per_page: 10,
            status: "publish",
          },
        });
        
        if (coreResponse.data && Array.isArray(coreResponse.data) && coreResponse.data.length > 0) {
          console.log(`[WordPress] ✅ 找到核心产品 "${productName}": ${coreResponse.data.length} 个`);
          // 合并产品，避免重复
          const existingIds = new Set(allProducts.map((p: any) => p.id));
          coreResponse.data.forEach((p: any) => {
            if (!existingIds.has(p.id)) {
              allProducts.push(p);
              existingIds.add(p.id);
            }
          });
        }
      } catch (error) {
        console.log(`[WordPress] ⚠️ 搜索核心产品 "${productName}" 失败，继续...`);
      }
    }
    
    console.log(`[WordPress] 合并核心产品后，总计 ${allProducts.length} 个产品`);
  }
  
  if (allProducts.length > 0) {
    console.log(`[WordPress] ✅ 成功使用 ${apiName} （search=${trimmedTerm}）获取 ${allProducts.length} 个原始产品`);
    
    // 详细列出所有获取到的产品名称和状态
    console.log(`[WordPress] ========== 原始产品列表 ==========`);
    allProducts.slice(0, 30).forEach((p: any, idx: number) => {
      const name = p.name || p.title?.rendered || 'Unknown';
      const status = p.status || 'N/A';
      const stockStatus = p.stock_status || 'N/A';
      const categories = p.categories?.map((c: any) => c.name).join(', ') || 'No category';
      console.log(`[WordPress]   ${idx + 1}. ${name}`);
      console.log(`[WordPress]      状态: ${status}, 库存: ${stockStatus}`);
      console.log(`[WordPress]      分类: ${categories}`);
    });
    if (allProducts.length > 30) {
      console.log(`[WordPress]   ... 还有 ${allProducts.length - 30} 个产品`);
    }
    console.log(`[WordPress] ========================================`);
    
    // 更新 response.data 为合并后的产品列表
    response.data = allProducts;
    
    // 重要：如果是通用类别关键词，应该返回所有相关类别的产品，不做严格过滤
    // 这样可以确保 phone 关键词能返回所有手机产品，而不仅仅是知识库中定义的几个
    console.log(`[WordPress] 准备过滤产品，是否泛词: ${isGenericCategoryKeyword}, 目标产品: ${targetProductNames.join(", ")}`);
    
    let filteredRaw: any[];
    if (isGenericCategoryKeyword) {
      // 对于通用类别关键词，使用宽松过滤：过滤掉明显不相关的产品
      filteredRaw = filterRawProductsByTargetNames(response.data, targetProductNames, trimmedTerm);
      console.log(`[WordPress] 通用类别关键词"${trimmedTerm}"，过滤后 ${filteredRaw.length} 个产品（宽松过滤）`);
    } else {
      filteredRaw = filterRawProductsByTargetNames(response.data, targetProductNames, trimmedTerm);
      console.log(`[WordPress] 普通关键词"${trimmedTerm}"，过滤后 ${filteredRaw.length} 个产品`);
    }
    
    // 如果有目标产品名称但未找到匹配的产品，记录警告但不立即返回 null
    // 因为可能通过其他搜索方式找到产品
    if (targetProductNames.length && filteredRaw.length === 0 && !isGenericCategoryKeyword) {
      console.warn(`[WordPress] ${apiName} （search=${trimmedTerm}）未找到指定产品: ${targetProductNames.join(", ")}`);
      // 不返回 null，继续尝试其他搜索方式
      return null;
    }
    
    if (targetProductNames.length > 1 && !isGenericCategoryKeyword) {
      console.log(`[WordPress] 多产品关键词匹配: 找到 ${filteredRaw.length} 个产品（目标产品: ${targetProductNames.join(", ")})`);
    }
    
    const products = parseProductsData(filteredRaw, apiName);
    const relatedProducts = await fetchWooCommerceRelatedProducts(
      client,
      filteredRaw,
      apiName,
      products
    );
    return { products, relatedProducts };
  }

  return null;
}

async function fetchWooCommerceProductsByCategory(
  client: ReturnType<typeof axios.create>,
  searchTerm: string,
  apiName: string,
  targetProductNames: string[] = []
): Promise<ProductFetchResult | null> {
  const trimmedKeyword = searchTerm.trim();
  if (!trimmedKeyword) {
    return null;
  }

  try {
    const categoryResp = await client.get("/products/categories", {
      params: {
        search: trimmedKeyword,
        per_page: 5,
        hide_empty: true,
      },
    });

    let categories: Array<{ id: number; name: string; slug: string }> = Array.isArray(categoryResp.data)
      ? categoryResp.data
      : [];

    // 过滤掉需要排除的分类
    const normalizeCategory = (str: string) => str.replace(/[\s_-]+/g, "-").toLowerCase().trim();
    const excludedCategories = [
      "uncategorized",
      "uncategorised",
      "payment-link",
      "payment link",
      "ironflip",
      "iron-flip",
      "aster-p",
      "aster p",
      "vertu-classics",
      "vertu classics",
    ];
    
    categories = categories.filter((category) => {
      const categoryName = normalizeCategory(category.name || "");
      const categorySlug = normalizeCategory(category.slug || "");
      
      const isExcluded = excludedCategories.some((excluded) => {
        const normalizedExcluded = normalizeCategory(excluded);
        return categoryName === normalizedExcluded || categorySlug === normalizedExcluded;
      });
      
      if (isExcluded) {
        console.log(`[WordPress] 过滤分类: ${category.name} (slug: ${category.slug})`);
        return false;
      }
      return true;
    });

    if (!categories.length) {
      return null;
    }

    console.log(
      `[WordPress] 根据分类匹配 (keyword=${trimmedKeyword}) 命中 ${categories.length} 个分类：${categories
        .map((c) => c.slug || c.name)
        .join(", ")}`
    );

    const uniqueProducts = new Map<number, any>();

    // 如果有多个目标产品名称，或者是泛词搜索，增加搜索数量以确保能获取到所有相关产品
    // 完整泛词识别：支持所有常见的手机、手表、戒指、耳机泛词和组合
    // 完整的手机泛词模式
    const phoneP = /\b(phone|phones|smartphone|smartphones|mobile|mobiles|cellphone|cellphones|mobile\s+phone|mobile\s+phones|smart\s+phone|luxury\s+phone|luxury\s+mobile|premium\s+phone|premium\s+mobile|high-?end\s+phone|flagship\s+phone|business\s+phone|expensive\s+phone|designer\s+phone|exclusive\s+phone|VERTU\s+phone|VERTU\s+mobile|secure\s+phone|encrypted\s+phone|Web3\s+phone|AI\s+phone|executive\s+phone|VIP\s+phone)\b/i;
    const watchP = /\b(watch|watches|timepiece|timepieces|smartwatch|smartwatches|smart\s+watch|luxury\s+watch|premium\s+watch)\b/i;
    const ringP = /\b(ring|rings|smart\s+ring|luxury\s+ring|premium\s+ring|diamond\s+ring|jewellery|jewelry)\b/i;
    const earbudP = /\b(earbud|earbuds|earphone|earphones|headphone|headphones)\b/i;
    const specificP = /(flip|fold|foldable|folding|keyboard|keypad|signature|agent|quantum|metavertu|grand\s+watch|metawatch|meta\s+ring)/i;
    
    const isGenericCategorySearch = (phoneP.test(trimmedKeyword) || watchP.test(trimmedKeyword) || ringP.test(trimmedKeyword) || earbudP.test(trimmedKeyword)) &&
                                    !specificP.test(trimmedKeyword);
    const perPage = isGenericCategorySearch ? 100 : (targetProductNames.length > 1 ? 20 : 10);

    console.log(`[WordPress] 分类搜索关键词"${trimmedKeyword}"${isGenericCategorySearch ? '（泛词）' : ''}，per_page=${perPage}`);

    for (const category of categories) {
      try {
        // 只要求产品已发布，不限制库存状态
        const categoryParams: any = {
          category: category.id,
          per_page: perPage,
          status: "publish", // 只要求已发布
        };
        
        const productsResp = await client.get("/products", {
          params: categoryParams,
        });

        const list: any[] = Array.isArray(productsResp.data) ? productsResp.data : [];
        list.forEach((product) => {
          if (!uniqueProducts.has(product.id)) {
            uniqueProducts.set(product.id, product);
          }
        });
      } catch (error: any) {
        console.warn(
          `[WordPress] 分类 ${category.slug || category.name} 拉取产品失败:`,
          error.response?.status || error.message
        );
        continue;
      }
    }

    // 对于手机泛词分类搜索，额外搜索核心产品以确保覆盖
    if (isGenericCategorySearch && phoneP.test(trimmedKeyword)) {
      console.log(`[WordPress] 🔍 分类搜索：检测到手机泛词，额外搜索核心产品...`);
      
      const corePhoneProducts = ['Agent Q', 'Quantum Flip', 'Signature'];
      
      for (const productName of corePhoneProducts) {
        try {
          const coreResponse = await client.get("/products", {
            params: {
              search: productName,
              per_page: 10,
              status: "publish",
            },
          });
          
          if (coreResponse.data && Array.isArray(coreResponse.data) && coreResponse.data.length > 0) {
            console.log(`[WordPress] ✅ 分类搜索找到核心产品 "${productName}": ${coreResponse.data.length} 个`);
            coreResponse.data.forEach((product: any) => {
              if (!uniqueProducts.has(product.id)) {
                uniqueProducts.set(product.id, product);
              }
            });
          }
        } catch (error) {
          console.log(`[WordPress] ⚠️ 分类搜索核心产品 "${productName}" 失败，继续...`);
        }
      }
      
      console.log(`[WordPress] 分类搜索合并核心产品后，总计 ${uniqueProducts.size} 个产品`);
    }
    
    if (!uniqueProducts.size) {
      return null;
    }

    const collectedProducts = Array.from(uniqueProducts.values());
    const filteredRaw = filterRawProductsByTargetNames(collectedProducts, targetProductNames, trimmedKeyword);
    
    // 如果有目标产品名称但未找到匹配的产品，记录警告但不立即返回 null
    if (targetProductNames.length && filteredRaw.length === 0) {
      console.warn(`[WordPress] 分类检索未找到指定产品（${trimmedKeyword}）: ${targetProductNames.join(", ")}`);
      return null;
    }
    
    if (targetProductNames.length > 1) {
      console.log(
        `[WordPress] ✅ 通过分类检索获取 ${collectedProducts.length} 个产品，匹配到 ${filteredRaw.length} 个目标产品（目标产品: ${targetProductNames.join(", ")})`
      );
    } else {
      console.log(
        `[WordPress] ✅ 通过分类检索获取 ${collectedProducts.length} 个产品`
      );
    }

    const products = parseProductsData(filteredRaw, apiName);
    const relatedProducts = await fetchWooCommerceRelatedProducts(
      client,
      filteredRaw,
      apiName,
      products
    );
    return { products, relatedProducts };
  } catch (error: any) {
    console.warn(
      `[WordPress] 分类检索失败（${trimmedKeyword}）:`,
      error.response?.status || error.message
    );
    return null;
  }
}

async function fetchWooCommerceFallbackProducts(
  client: ReturnType<typeof axios.create>,
  apiName: string,
  targetProductNames: string[] = []
): Promise<ProductFetchResult | null> {
  try {
    // Fallback：只要求已发布
    const response = await client.get("/products", {
      params: {
        per_page: 20,
        status: "publish", // 只要求已发布
        orderby: "date",
        order: "desc",
      },
    });

    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      console.log(`[WordPress] ✅ ${apiName} 默认 fallback 返回 ${response.data.length} 个产品`);
      const filteredRaw = filterRawProductsByTargetNames(response.data, targetProductNames);
      if (targetProductNames.length && filteredRaw.length === 0) {
        console.warn(`[WordPress] fallback 未找到指定产品`);
        return null;
      }
      const products = parseProductsData(filteredRaw, apiName);
      const relatedProducts = await fetchWooCommerceRelatedProducts(
        client,
        filteredRaw,
        apiName,
        products
      );
      return { products, relatedProducts };
    }
  } catch (error: any) {
    console.warn(`[WordPress] ${apiName} fallback 获取产品失败:`, error.response?.status || error.message);
  }
  return null;
}

async function fetchWooCommerceUpsells(
  client: ReturnType<typeof axios.create>,
  productsData: any[],
  apiName: string,
  primaryProducts: ProductSummary[]
): Promise<ProductSummary[]> {
  try {
    // 获取所有主产品的 upsell_ids（交叉销售产品）
    const upsellIds = Array.from(
      new Set(
        productsData
          .flatMap((product) => product.upsell_ids || [])
          .filter((id: number) => !primaryProducts.some((p) => p.id === id))
      )
    ).slice(0, 8);

    if (upsellIds.length === 0) {
      console.log(`[WordPress] 主产品没有 upsells，尝试使用 related_ids 作为备用`);
      // 如果没有 upsells，回退到使用 related_ids
      const relatedIds = Array.from(
        new Set(
          productsData
            .flatMap((product) => product.related_ids || [])
            .filter((id: number) => !primaryProducts.some((p) => p.id === id))
        )
      ).slice(0, 8);

      if (relatedIds.length === 0) {
        return [];
      }

      const response = await client.get("/products", {
        params: { include: relatedIds.join(","), per_page: relatedIds.length },
      });

      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        console.log(`[WordPress] ✅ 成功获取关联产品 (${response.data.length} 个)`);
        return parseProductsData(response.data, apiName);
      }
      return [];
    }

    console.log(`[WordPress] 找到 ${upsellIds.length} 个 upsell 产品 ID:`, upsellIds);

    const response = await client.get("/products", {
      params: { 
        include: upsellIds.join(","), 
        per_page: upsellIds.length,
        status: "publish", // 只要求已发布
      },
    });

    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      console.log(`[WordPress] ✅ 成功获取 upsell 产品 (${response.data.length} 个)`);
      return parseProductsData(response.data, apiName);
    }
  } catch (error: any) {
    console.warn(`[WordPress] Upsell 产品获取失败:`, error.response?.status || error.message);
  }

  return [];
}

// 保留旧函数名作为别名，以防其他地方使用
async function fetchWooCommerceRelatedProducts(
  client: ReturnType<typeof axios.create>,
  productsData: any[],
  apiName: string,
  primaryProducts: ProductSummary[]
): Promise<ProductSummary[]> {
  // 现在使用 upsells 而不是 related_ids
  return fetchWooCommerceUpsells(client, productsData, apiName, primaryProducts);
}

async function fetchWordpressStandardProducts(
  client: ReturnType<typeof axios.create>,
  keywordVariants: string[],
  apiName: string,
  targetProductNames: string[] = []
): Promise<ProductFetchResult | null> {
  for (const term of keywordVariants) {
    const trimmed = term.trim();
    if (!trimmed) continue;
    try {
      const response = await client.get("/products", {
        params: {
          search: trimmed,
          per_page: 10,
          _embed: true,
          status: "publish", // 只要求已发布
        },
      });

      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        console.log(`[WordPress] ✅ ${apiName} （search=${trimmed}）返回 ${response.data.length} 个产品`);
        const filteredRaw = filterRawProductsByTargetNames(response.data, targetProductNames);
        if (targetProductNames.length && filteredRaw.length === 0) {
          console.warn(`[WordPress] ${apiName} search=${trimmed} 未找到指定产品`);
          continue;
        }
        return {
          products: parseProductsData(filteredRaw, apiName),
          relatedProducts: [],
        };
      }
    } catch (error: any) {
      console.warn(`[WordPress] ${apiName} search=${trimmed} 失败:`, error.response?.status || error.message);
      continue;
    }
  }

  try {
    const fallbackResp = await client.get("/products", {
      params: {
        per_page: 10,
        status: "publish", // 只要求已发布
        _embed: true,
      },
    });

    if (fallbackResp.data && Array.isArray(fallbackResp.data) && fallbackResp.data.length > 0) {
      console.log(`[WordPress] ✅ ${apiName} fallback 返回 ${fallbackResp.data.length} 个产品`);
      const filteredRaw = filterRawProductsByTargetNames(fallbackResp.data, targetProductNames);
      if (targetProductNames.length && filteredRaw.length === 0) {
        console.warn(`[WordPress] ${apiName} fallback 未找到指定产品`);
        return null;
      }
      return {
        products: parseProductsData(filteredRaw, apiName),
        relatedProducts: [],
      };
    }
  } catch (error: any) {
    console.warn(`[WordPress] ${apiName} fallback 失败:`, error.response?.status || error.message);
  }

  return null;
}

function buildKeywordVariants(keyword: string, preferredNames: string[] = []): string[] {
  const variants = new Set<string>();

  preferredNames.forEach((name) => {
    const preferred = name?.trim();
    if (!preferred) return;
    variants.add(preferred);
    variants.add(preferred.toLowerCase());
  });

  const trimmed = (keyword || "").trim();

  if (trimmed) {
    variants.add(trimmed);
    variants.add(trimmed.toLowerCase());
  }

  const normalized = trimmed.toLowerCase();
  if (normalized) {
    const withoutBrand = normalized.replace(/vertu/g, "").trim();
    if (withoutBrand) {
      variants.add(withoutBrand);
    }

    // 提取关键词中的产品相关词汇（支持多个产品关键词）
    // 例如："smart ring vs smart watch" 会提取 "ring" 和 "watch"
    const tokens = normalized
      .split(/[^a-z0-9+]+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
    
    // 检查这些词汇是否匹配产品关键词提示
    const productKeywords: string[] = [];
    for (const hint of PRODUCT_KEYWORD_HINTS) {
      const matchedKeywords = hint.keywords.filter(kw => 
        tokens.some(token => token.includes(kw) || kw.includes(token)) || normalized.includes(kw)
      );
      if (matchedKeywords.length > 0) {
        // 如果匹配到产品关键词，添加对应的产品名称和关键词本身
        hint.productNames.forEach((name) => variants.add(name));
        productKeywords.push(...matchedKeywords);
      }
    }
    
    // 添加匹配到的产品关键词本身（如 "ring", "watch"）
    productKeywords.forEach(kw => variants.add(kw));
    
    // 添加其他有意义的词汇（长度>=4的）
    tokens
      .filter((token) => token.length >= 4)
      .forEach((token) => variants.add(token));
  }

  variants.add("VERTU");

  return Array.from(variants)
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, MAX_KEYWORD_VARIANTS);
}

function extractTargetProductNames(keyword: string): string[] {
  const normalizedKeyword = normalizePhrase(keyword);
  if (!normalizedKeyword) {
    return [];
  }

  const matches = new Set<string>();
  
  // 1. 直接匹配产品名称（精确匹配）
  for (const entry of PRODUCT_NAME_ENTRIES) {
    if (entry.normalized && normalizedKeyword.includes(entry.normalized)) {
      matches.add(entry.canonical);
    }
  }
  
  // 2. 通过产品关键词提示匹配（支持多个产品关键词）
  // 例如："smart ring vs smart watch" 应该匹配到 ring 和 watch 相关的产品
  for (const hint of PRODUCT_KEYWORD_HINTS) {
    // 检查关键词中是否包含该提示的关键词
    const matchedKeywords = hint.keywords.filter(kw => normalizedKeyword.includes(kw));
    if (matchedKeywords.length > 0) {
      // 如果匹配到，添加该提示对应的所有产品
      hint.productNames.forEach(name => matches.add(name));
      console.log(`[WordPress] 通过关键词提示匹配到产品: ${hint.productNames.join(", ")} (匹配关键词: ${matchedKeywords.join(", ")})`);
    }
  }

  return Array.from(matches);
}

function filterRawProductsByTargetNames(productsData: any[], targetNames: string[], originalSearchTerm?: string): any[] {
  if (!targetNames.length) {
    return productsData;
  }

  const normalizedTargets = targetNames.map(normalizePhrase).filter(Boolean);
  if (!normalizedTargets.length) {
    return productsData;
  }

  // 重要优化：如果原始搜索词是通用类别关键词（如"phone"、"ring"），
  // 应该返回所有相关类别的产品，而不仅仅是知识库中定义的特定产品
  // 例如：关键词"phone"应该返回所有手机产品，而不仅仅是"Agent Q"、"Quantum Flip"、"Metavertu Max"
  
  // 检查是否是通用类别关键词（优先检查原始搜索词）
  let categoryKeyword: string | undefined;
  let isGenericCategoryKeyword = false;
  
  if (originalSearchTerm) {
    const normalizedSearchTerm = normalizePhrase(originalSearchTerm);
    const searchTermLower = normalizedSearchTerm.toLowerCase();
    
    // 检查是否是类别关键词（支持所有常见组合词）
    // 完整泛词模式：包含所有手机、手表、戒指、耳机的常见表达
    // 完整的手机泛词模式 - 包含所有长尾词
    const phoneGen = /\b(phone|phones|smartphone|smartphones|mobile|mobiles|cellphone|cellphones|handset|handsets|mobile\s+phone|mobile\s+phones|smart\s+phone|smart\s+phones|cell\s+phone|cell\s+phones|luxury\s+phone|luxury\s+phones|luxury\s+mobile|luxury\s+smartphone|premium\s+phone|premium\s+phones|premium\s+mobile|premium\s+smartphone|high-?end\s+phone|high-?end\s+phones|flagship\s+phone|flagship\s+phones|business\s+phone|business\s+phones|5G\s+phone|5G\s+phones|expensive\s+phone|expensive\s+phones|designer\s+phone|designer\s+phones|exclusive\s+phone|exclusive\s+phones|boutique\s+phone|boutique\s+phones|VERTU\s+phone|VERTU\s+phones|VERTU\s+mobile|VERTU\s+smartphone|secure\s+phone|secure\s+phones|privacy\s+phone|encrypted\s+phone|encrypted\s+phones|crypto\s+phone|Web3\s+phone|AI\s+phone|AI\s+phones|concierge\s+phone|titanium\s+phone|ceramic\s+phone|leather\s+phone|gold\s+phone|diamond\s+phone|executive\s+phone|executive\s+phones|VIP\s+phone|VIP\s+phones)\b/i;
    const watchGen = /\b(watch|watches|timepiece|timepieces|wristwatch|wristwatches|smartwatch|smartwatches|smart\s+watch|smart\s+watches|luxury\s+watch|premium\s+watch|high-?end\s+watch|designer\s+watch)\b/i;
    const ringGen = /\b(ring|rings|smart\s+ring|smart\s+rings|wearable\s+ring|luxury\s+ring|premium\s+ring|diamond\s+ring|gold\s+ring|jewellery|jewelry)\b/i;
    const earbudGen = /\b(earbud|earbuds|earphone|earphones|headphone|headphones|wireless\s+earbud|bluetooth\s+earbud|luxury\s+earbud|premium\s+earbud)\b/i;
    
    const isGenericPattern = phoneGen.test(originalSearchTerm) || watchGen.test(originalSearchTerm) || ringGen.test(originalSearchTerm) || earbudGen.test(originalSearchTerm);
    const isSpecificModel = /(flip|fold|foldable|folding|keyboard|keypad|signature|agent|quantum|metavertu|grand\s+watch|metawatch|meta\s+ring)/i.test(originalSearchTerm);
    
    if (isGenericPattern && !isSpecificModel) {
      isGenericCategoryKeyword = true;
      // 提取类别关键词的基础形式
      if (searchTermLower.includes("phone") || searchTermLower.includes("mobile")) {
        categoryKeyword = "phone";
      } else if (searchTermLower.includes("ring")) {
        categoryKeyword = "ring";
      } else if (searchTermLower.includes("watch")) {
        categoryKeyword = "watch";
      } else if (searchTermLower.includes("earbud")) {
        categoryKeyword = "earbud";
      }
      console.log(`[WordPress] ✓ 识别为泛词关键词: "${originalSearchTerm}" → 类别: "${categoryKeyword}"`);
    }
  }
  
  // 如果没有从原始搜索词检测到，尝试从目标产品名称检测
  if (!isGenericCategoryKeyword) {
    isGenericCategoryKeyword = normalizedTargets.some(target => {
      const targetLower = target.toLowerCase();
      return targetLower.includes("ring") || targetLower.includes("watch") || 
             targetLower.includes("earbud") || targetLower.includes("phone");
    });
    
    if (isGenericCategoryKeyword && !categoryKeyword) {
      categoryKeyword = normalizedTargets.find(target => {
        const targetLower = target.toLowerCase();
        return targetLower.includes("ring") || targetLower.includes("watch") || 
               targetLower.includes("earbud") || targetLower.includes("phone");
      });
    }
  }
  
  // 如果是通用类别关键词，返回所有相关类别的产品
  if (isGenericCategoryKeyword && categoryKeyword) {
    console.log(`[WordPress] ========== 泛词过滤 ==========`);
    console.log(`[WordPress] 检测到通用类别关键词"${categoryKeyword}"（原始: "${originalSearchTerm}"）`);
    console.log(`[WordPress] 准备过滤 ${productsData.length} 个产品...`);
    
    // 对于 phone 类别，需要特殊处理：匹配所有包含 "vertu"、"phone"、"smartphone" 等关键词的产品
    // 以及特定产品名称（Agent Q、Quantum Flip、Metavertu 等）
    const filtered = productsData.filter((product) => {
      const rawName = product?.name || product?.title?.rendered || product?.slug || "";
      const normalizedProductName = normalizePhrase(rawName).toLowerCase();
      
      // 检查产品分类
      const categories = product?.categories || [];
      const categoryNames = categories.map((cat: any) => normalizePhrase(cat?.name || "").toLowerCase()).join(" ");
      
      if (categoryKeyword === "phone") {
        // 手机产品：匹配 "vertu"、"phone"、"smartphone"、特定型号名称
        return normalizedProductName.includes("vertu") ||
               normalizedProductName.includes("phone") ||
               normalizedProductName.includes("smartphone") ||
               normalizedProductName.includes("agent") ||
               normalizedProductName.includes("quantum") ||
               normalizedProductName.includes("metavertu") ||
               normalizedProductName.includes("ivertu") ||
               normalizedProductName.includes("signature") ||
               categoryNames.includes("phone") ||
               categoryNames.includes("smartphone");
      } else if (categoryKeyword === "ring") {
        // 戒指产品
        return normalizedProductName.includes("ring") ||
               categoryNames.includes("ring") ||
               categoryNames.includes("jewellery") ||
               categoryNames.includes("jewelry");
      } else if (categoryKeyword === "watch") {
        // 手表产品
        return normalizedProductName.includes("watch") ||
               categoryNames.includes("watch") ||
               categoryNames.includes("timepiece");
      } else if (categoryKeyword === "earbud") {
        // 耳机产品
        return normalizedProductName.includes("earbud") ||
               normalizedProductName.includes("earphone") ||
               categoryNames.includes("earbud") ||
               categoryNames.includes("earphone") ||
               categoryNames.includes("audio");
      }
      
      return false;
    });
    
    if (filtered.length > 0) {
      console.log(`[WordPress] 通用类别"${categoryKeyword}"过滤后找到 ${filtered.length} 个产品:`);
      filtered.slice(0, 10).forEach((p: any, idx: number) => {
        console.log(`[WordPress]   ${idx + 1}. ${p.name || p.title?.rendered}`);
      });
      if (filtered.length > 10) {
        console.log(`[WordPress]   ... 还有 ${filtered.length - 10} 个产品`);
      }
      console.log(`[WordPress] ====================================`);
      
      // 泛词返回所有匹配的产品
      const maxProducts = Math.min(100, filtered.length);
      return filtered.slice(0, maxProducts);
    } else {
      console.log(`[WordPress] ⚠️ 泛词过滤后没有找到任何产品！`);
      console.log(`[WordPress] 原始产品数量: ${productsData.length}`);
      console.log(`[WordPress] 过滤条件: categoryKeyword="${categoryKeyword}"`);
    }
  }

  // 否则，使用原来的逻辑：过滤产品，只要产品名称包含任何一个目标关键词就匹配
  const filtered = productsData.filter((product) => {
    const rawName = product?.name || product?.title?.rendered || product?.slug || "";
    const normalizedProductName = normalizePhrase(rawName);
    return normalizedTargets.some((target) => normalizedProductName.includes(target));
  });

  if (!filtered.length) {
    return [];
  }

  // 优化：当有多个产品关键词时，返回所有匹配的产品，而不是只返回一个
  // 例如："smart ring vs smart watch" 应该返回所有 ring 和 watch 相关的产品
  // 设置一个合理的上限，避免返回过多产品（最多返回 20 个）
  const maxProducts = Math.min(20, filtered.length);
  return filtered.slice(0, maxProducts);
}

function normalizePhrase(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface PublishPageInput {
  credentials: WordpressCredentials;
  title: string;
  slug: string;
  htmlContent: string;
  useElementor?: boolean; // 是否使用 Elementor 保存页面
}

/**
 * 将 HTML 内容转换为 Elementor 的 HTML Widget JSON 格式
 */
function convertHtmlToElementorFormat(htmlContent: string): string {
  // Elementor 的 HTML Widget 结构
  const elementorData = [
    {
      id: `elementor-${Date.now()}`,
      elType: "widget",
      widgetType: "html",
      settings: {
        html: htmlContent,
      },
      elements: [],
    },
  ];

  return JSON.stringify(elementorData);
}

export async function publishPage({ credentials, title, slug, htmlContent, useElementor = false }: PublishPageInput) {
  const client = createClient(credentials);
  try {
    // 处理slug：如果包含路径分隔符，提取实际的slug部分
    // 例如：luxury-life-guides/complete-guide-to-sleep-ring -> complete-guide-to-sleep-ring
    let actualSlug = slug;
    let urlPrefix = "";
    
    if (slug.includes("/")) {
      const parts = slug.split("/");
      if (parts.length >= 2 && parts[0] === "luxury-life-guides") {
        // 提取实际的slug（去掉前缀部分）
        actualSlug = parts.slice(1).join("-"); // 将剩余部分用连字符连接
        urlPrefix = "luxury-life-guides";
        console.log(`[WordPress] 📁 使用自定义URL前缀: ${urlPrefix}/${actualSlug}`);
      } else {
        // 如果格式不对，使用整个slug（去掉斜杠）
        actualSlug = slug.replace(/\//g, "-");
        console.warn(`[WordPress] ⚠️ Slug包含斜杠但格式不正确，转换为: ${actualSlug}`);
      }
    } else if (slug.startsWith("luxury-life-guides-")) {
      // 如果slug以 "luxury-life-guides-" 开头，提取实际部分
      actualSlug = slug.replace(/^luxury-life-guides-/, "");
      urlPrefix = "luxury-life-guides";
      console.log(`[WordPress] 📁 从slug中提取URL前缀: ${urlPrefix}/${actualSlug}`);
    } else {
      // 如果slug不包含前缀，添加前缀标记
      urlPrefix = "luxury-life-guides";
      console.log(`[WordPress] 📁 为页面添加URL前缀: ${urlPrefix}/${actualSlug}`);
    }
    // WordPress REST API 默认会过滤 HTML，移除 <style> 和 <script> 标签
    // 我们需要提取 <body> 内容，并将 <style> 和 <script> 内联到内容中
    // 或者使用 WordPress 的 content.raw 字段（如果支持）
    
    // 检查是否是完整的 HTML 文档
    const isFullHtmlDocument = htmlContent.trim().startsWith('<!DOCTYPE') || htmlContent.trim().startsWith('<html');
    
    let contentToSave = htmlContent;
    
    if (isFullHtmlDocument) {
      // 提取 <head> 中的 <style> 和 <script>
      const styleMatch = htmlContent.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      const scriptMatch = htmlContent.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
      
      // 提取 <body> 内容（不包含 <body> 标签本身）
      const bodyMatch = htmlContent.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const bodyContent = bodyMatch ? bodyMatch[1] : htmlContent;
      
      // 将 <style> 和 <script> 内联到 body 内容中
      let styles = '';
      if (styleMatch) {
        styles = styleMatch.map(style => {
          // 保持原始的 <style> 标签和内容，确保没有额外的换行
          return style.trim();
        }).join('\n');
      }
      
      let scripts = '';
      if (scriptMatch) {
        scripts = scriptMatch.map(script => {
          // 保持原始的 <script> 标签和内容，确保没有额外的换行
          return script.trim();
        }).join('\n');
      }
      
      // 组合内容：样式在开头，脚本在结尾
      // 注意：WordPress REST API 不支持 HTML 块格式（<!-- wp:html -->），
      // 因为 REST API 使用的是不同的内容处理方式，HTML 块格式会被移除
      // 我们需要直接保存 HTML，依赖用户的 'unfiltered_html' 权限来保留 <style> 和 <script> 标签
      const rawHtml = (styles ? styles + '\n' : '') + bodyContent.trim() + (scripts ? '\n' + scripts : '');
      
      // 直接保存 HTML，不包装在 HTML 块格式中
      // WordPress REST API 会处理内容，但如果我们有 'unfiltered_html' 权限，样式和脚本会被保留
      contentToSave = rawHtml;
      
      console.log(`[WordPress] 提取 HTML 文档: styles=${styleMatch?.length || 0}, scripts=${scriptMatch?.length || 0}, bodyLength=${bodyContent.length}`);
      console.log(`[WordPress] 组合后的内容长度: ${contentToSave.length}`);
      console.log(`[WordPress] 直接保存 HTML（不包装在 HTML 块格式中，因为 REST API 不支持）`);
      console.log(`[WordPress] ⚠️ 重要：确保 WordPress 用户有 'unfiltered_html' 权限，否则 <style> 和 <script> 标签会被过滤`);
      
      // 检查组合后的内容是否包含实际数据
      if (bodyContent.includes('product-card')) {
        console.log(`[WordPress] ✅ Body 内容包含产品卡片结构`);
      }
      if (bodyContent.includes('{{')) {
        console.warn(`[WordPress] ⚠️ Body 内容仍包含 Handlebars 占位符，模板可能未正确渲染`);
      }
    } else {
      // 如果不是完整的 HTML 文档，直接保存
      contentToSave = htmlContent.trim();
      console.log(`[WordPress] 非完整 HTML 文档，直接保存`);
    }
    
    console.log(`[WordPress] 发布页面: title=${title}, slug=${slug}, contentLength=${contentToSave.length}, isFullHtml=${isFullHtmlDocument}`);
    
    // 发布前最终检查
    const hasUnrenderedPlaceholders = contentToSave.includes('{{') || contentToSave.includes('{{{');
    if (hasUnrenderedPlaceholders) {
      console.error(`[WordPress] ❌ 错误：发布前检查发现内容仍包含 Handlebars 占位符！`);
      console.error(`[WordPress] 这意味着模板渲染失败，数据没有被正确替换`);
      console.error(`[WordPress] 内容预览（前 1000 字符）:`);
      console.error(contentToSave.substring(0, 1000));
      throw new Error('模板渲染失败：内容仍包含未替换的 Handlebars 占位符。请检查模板和数据是否正确传递。');
    }
    
    // WordPress REST API 的 content 字段是字符串
    // 需要确保 WordPress 用户有 'unfiltered_html' 权限才能保存 <style> 和 <script> 标签
    // 如果没有权限，WordPress 会过滤掉这些标签
    console.log(`[WordPress] 准备发布内容，包含样式: ${contentToSave.includes('<style')}, 包含脚本: ${contentToSave.includes('<script')}`);
    console.log(`[WordPress] 内容格式: 直接保存 HTML（依赖 'unfiltered_html' 权限）`);
    console.log(`[WordPress] 内容预览（前 200 字符）: ${contentToSave.substring(0, 200)}`);
    console.log(`[WordPress] ⚠️ 重要提示：`);
    console.log(`[WordPress]   - 如果 WordPress 用户没有 'unfiltered_html' 权限，<style> 和 <script> 标签会被过滤`);
    console.log(`[WordPress]   - 如果内容被 wpautop 处理（添加 <p> 标签），需要安装插件禁用 wpautop`);
    console.log(`[WordPress]   - 解决方案：确保用户是管理员，或在 WordPress 中添加 'unfiltered_html' 权限`);
    
    // WordPress REST API 的 content 字段处理方式：
    // 1. 如果用户有 'unfiltered_html' 权限，WordPress 会保存原始 HTML
    // 2. 如果没有权限，WordPress 会过滤 <style> 和 <script> 标签
    // 3. WordPress 的 wpautop 过滤器会自动将换行转换为 <p> 标签
    // 4. HTML 块格式 <!-- wp:html --> 可以防止 wpautop 处理，但需要主题支持
    
    // 尝试多种方法保存内容
    let response;
    try {
      if (useElementor) {
        // 使用 Elementor 方式保存页面
        console.log(`[WordPress] 🎨 使用 Elementor 方式保存页面`);
        
        // 先创建 WordPress 页面
        try {
          const pageData: any = {
            title,
            slug: actualSlug,
            content: "", // Elementor 页面内容为空，实际内容存储在 Elementor 元数据中
            status: "publish",
            // 确保页面可被搜索引擎索引
            meta: {
              // SEO相关meta字段
              _yoast_wpseo_meta_robots_noindex: "0", // 0 = 允许索引，1 = 禁止索引
              _yoast_wpseo_meta_robots_nofollow: "0", // 0 = 允许跟踪，1 = 禁止跟踪
              _yoast_wpseo_meta_robots_adv: "", // 高级robots设置（空字符串表示使用默认）
            },
          };
          
          // 如果设置了URL前缀，在创建页面时直接设置meta字段
          // WordPress端的代码已经注册了_custom_url_prefix字段，可以通过REST API设置
          if (urlPrefix) {
            pageData.meta._custom_url_prefix = urlPrefix;
            console.log(`[WordPress] 📝 在创建页面时设置URL前缀: ${urlPrefix}`);
          }
          
          response = await client.post("/pages", pageData);
          const pageId = response.data.id;
          console.log(`[WordPress] ✅ WordPress 页面创建成功，ID: ${pageId}`);
          
          // 验证URL前缀是否已设置（如果创建时设置失败，尝试更新）
          if (urlPrefix) {
            try {
              // 尝试通过PUT方法更新，确保meta字段已设置
              await client.put(`/pages/${pageId}`, {
                meta: {
                  _custom_url_prefix: urlPrefix,
                },
              });
              console.log(`[WordPress] ✅ URL前缀已确认设置: ${urlPrefix}`);
            } catch (updateError: any) {
              // 如果更新失败，WordPress端的自动设置功能会处理
              console.log(`[WordPress] 💡 如果meta字段设置失败，WordPress端会自动检测并设置（基于slug模式）`);
            }
          }
        } catch (createError: any) {
          console.error(`[WordPress] ❌ 创建 WordPress 页面失败:`, createError.message);
          throw createError;
        }

        const pageId = response.data.id;

        // 确保URL前缀已存储（在Elementor元数据更新之前）
        // 注意：WordPress REST API的meta端点可能不存在，我们通过更新页面时设置meta字段
        // 这将在下面的Elementor元数据更新时一起处理

        // 将 HTML 转换为 Elementor 格式
        const elementorData = convertHtmlToElementorFormat(contentToSave);

        // 更新 Elementor 元数据
        try {
          // Elementor 使用自定义字段（meta）存储页面数据
          // 需要通过 WordPress REST API 的 meta 字段更新
          // 注意：WordPress REST API 的 meta 字段需要特殊处理
          
          // 方法 1：尝试直接更新 meta 字段
          try {
            const metaData: any = {
              _elementor_data: elementorData,
              _elementor_template_type: "wp-page",
              _elementor_edit_mode: "builder",
              _elementor_version: "3.0.0",
              _elementor_pro_version: "",
            };
            
            // 同时存储URL前缀（如果之前失败）
            if (urlPrefix) {
              metaData._custom_url_prefix = urlPrefix;
            }
            
            await client.post(`/pages/${pageId}`, {
              meta: metaData,
            });
            console.log(`[WordPress] ✅ Elementor 元数据更新成功（方法 1）`);
          } catch (metaError: any) {
            // 方法 2：如果 meta 字段更新失败，尝试使用 PUT 方法更新页面
            console.log(`[WordPress] 方法 1 失败，尝试使用 PUT 方法更新页面`);
            try {
              const metaData: any = {
                _elementor_data: elementorData,
                _elementor_template_type: "wp-page",
                _elementor_edit_mode: "builder",
                _elementor_version: "3.0.0",
                _elementor_pro_version: "",
              };
              
              // 同时存储URL前缀
              if (urlPrefix) {
                metaData._custom_url_prefix = urlPrefix;
              }
              
              // 使用 PUT 方法更新页面，包含 meta 字段
              await client.put(`/pages/${pageId}`, {
                meta: metaData,
              });
              
              console.log(`[WordPress] ✅ Elementor 元数据更新成功（方法 2）`);
              if (urlPrefix) {
                console.log(`[WordPress] ✅ URL前缀已存储（方法 2）: ${urlPrefix}`);
              }
            } catch (metaApiError: any) {
              // 如果meta字段更新仍然失败，尝试使用WordPress的update_post_meta功能
              // 但这需要WordPress插件支持，或者手动在后台设置
              console.warn(`[WordPress] ⚠️ Meta字段更新失败:`, metaApiError.message);
              console.warn(`[WordPress] 提示：WordPress REST API可能不支持直接更新meta字段`);
              console.warn(`[WordPress] 解决方案：请在WordPress后台手动为页面ID ${pageId} 添加自定义字段：`);
              console.warn(`[WordPress]   字段名: _custom_url_prefix`);
              console.warn(`[WordPress]   字段值: ${urlPrefix || 'luxury-life-guides'}`);
              // 不抛出错误，让流程继续
            }
          }
        } catch (elementorError: any) {
          console.warn(`[WordPress] ⚠️ Elementor 元数据更新失败，但页面已创建`);
          console.warn(`[WordPress] 这可能是因为：`);
          console.warn(`  1. Elementor 插件未安装或未激活`);
          console.warn(`  2. WordPress 用户没有编辑 Elementor 页面的权限`);
          console.warn(`  3. Elementor REST API 未启用`);
          console.warn(`  4. WordPress REST API 不支持直接更新 meta 字段`);
          console.warn(`[WordPress] 解决方案：`);
          console.warn(`  1. 确保 Elementor 插件已安装并激活`);
          console.warn(`  2. 确保 WordPress 用户有编辑页面的权限`);
          console.warn(`  3. 页面已创建（ID: ${pageId}），您可以在 WordPress 后台：`);
          console.warn(`     a. 编辑页面 → 使用 Elementor 编辑器`);
          console.warn(`     b. 添加 HTML Widget → 粘贴以下内容：`);
          console.warn(`     c. 内容预览（前 500 字符）: ${contentToSave.substring(0, 500)}`);
          console.warn(`[WordPress] 错误详情:`, elementorError.message);
          
          // 如果 Elementor 元数据更新失败，回退到标准方式保存内容
          console.log(`[WordPress] 回退到标准方式保存内容`);
          try {
            response = await client.post(`/pages/${pageId}`, {
              content: contentToSave,
            });
            console.log(`[WordPress] ✅ 已使用标准方式保存内容`);
          } catch (fallbackError: any) {
            console.error(`[WordPress] ❌ 标准方式保存也失败:`, fallbackError.message);
            // 即使失败，页面也已经创建，所以继续执行
          }
        }
      } else {
        // 标准 WordPress 方式保存
        // 方法 1：尝试使用 content.raw 字段（如果 WordPress REST API 支持）
        // 注意：不是所有 WordPress 版本都支持 content.raw
        try {
          const pageData: any = {
            title,
            slug: actualSlug,
            content: {
              raw: contentToSave,
              rendered: contentToSave,
            },
            status: "publish",
            // 确保页面可被搜索引擎索引
            meta: {
              // SEO相关meta字段
              _yoast_wpseo_meta_robots_noindex: "0", // 0 = 允许索引，1 = 禁止索引
              _yoast_wpseo_meta_robots_nofollow: "0", // 0 = 允许跟踪，1 = 禁止跟踪
              _yoast_wpseo_meta_robots_adv: "", // 高级robots设置（空字符串表示使用默认）
            },
          };
          
          // 如果设置了URL前缀，在创建页面时直接设置meta字段
          if (urlPrefix) {
            pageData.meta._custom_url_prefix = urlPrefix;
          }
          
          response = await client.post("/pages", pageData);
          const pageId = response.data.id;
          console.log(`[WordPress] ✅ 使用 content.raw 字段保存成功, ID: ${pageId}`);
          
          // 如果meta字段未成功设置，尝试使用PUT方法更新
          if (urlPrefix) {
            try {
              await client.put(`/pages/${pageId}`, {
                meta: {
                  _custom_url_prefix: urlPrefix,
                },
              });
              console.log(`[WordPress] ✅ URL前缀已存储: ${urlPrefix}`);
            } catch (metaError: any) {
              console.warn(`[WordPress] ⚠️ 无法通过REST API存储URL前缀:`, metaError.message);
              console.log(`[WordPress] 💡 WordPress端会自动检测并设置URL前缀（基于slug模式）`);
              console.log(`[WordPress] 💡 如果自动设置失败，请检查 wordpress-url-rewrite.php 代码是否已添加到 functions.php`);
            }
          }
        } catch (rawError: any) {
          // 如果 content.raw 失败，回退到标准 content 字段
          console.log(`[WordPress] content.raw 方法失败，回退到标准 content 字段`);
          
          const pageData: any = {
            title,
            slug: actualSlug,
            content: contentToSave,
            status: "publish",
            // 确保页面可被搜索引擎索引
            meta: {
              // SEO相关meta字段
              _yoast_wpseo_meta_robots_noindex: "0", // 0 = 允许索引，1 = 禁止索引
              _yoast_wpseo_meta_robots_nofollow: "0", // 0 = 允许跟踪，1 = 禁止跟踪
              _yoast_wpseo_meta_robots_adv: "", // 高级robots设置（空字符串表示使用默认）
            },
          };
          
          // 如果设置了URL前缀，在创建页面时直接设置meta字段
          if (urlPrefix) {
            pageData.meta._custom_url_prefix = urlPrefix;
          }
          
          response = await client.post("/pages", pageData);
          const pageId = response.data.id;
          console.log(`[WordPress] ✅ 使用标准 content 字段保存成功, ID: ${pageId}`);
          
          // 如果meta字段未成功设置，尝试使用PUT方法更新
          if (urlPrefix) {
            try {
              await client.put(`/pages/${pageId}`, {
                meta: {
                  _custom_url_prefix: urlPrefix,
                },
              });
              console.log(`[WordPress] ✅ URL前缀已存储: ${urlPrefix}`);
            } catch (metaError: any) {
              console.warn(`[WordPress] ⚠️ 无法通过REST API存储URL前缀:`, metaError.message);
              console.log(`[WordPress] 💡 WordPress端会自动检测并设置URL前缀（基于slug模式）`);
              console.log(`[WordPress] 💡 如果自动设置失败，请检查 wordpress-url-rewrite.php 代码是否已添加到 functions.php`);
            }
          }
        }
      }
    } catch (postError: any) {
      // 如果两种方法都失败，提供详细的错误信息
      const errorStatus = postError.response?.status;
      const errorData = postError.response?.data;
      
      if (errorStatus === 400) {
        // 400 错误可能是内容格式问题
        console.error(`[WordPress] ❌ 400 错误：内容格式可能有问题`);
        console.error(`[WordPress] 错误详情:`, errorData);
        throw new Error(`WordPress API 返回 400 错误。可能的原因：
1. 内容格式不正确
2. WordPress 用户没有 'unfiltered_html' 权限
3. WordPress 主题不支持 HTML 块格式

解决方案：
1. 确保 WordPress 用户是管理员或有 'unfiltered_html' 权限
2. 检查 WordPress 主题是否支持 HTML 块
3. 考虑安装插件来禁用 wpautop 过滤器（如 "Disable wpautop"）`);
      }
      
      throw postError;
    }
    
    // 检查响应数据格式
    if (!response.data) {
      throw new Error("WordPress API 返回空数据");
    }
    
    // 如果返回的是字符串，可能是错误
    if (typeof response.data === 'string') {
      console.error("[WordPress] 发布页面返回字符串（可能是错误）:");
      console.error("[WordPress] 响应内容（前500字符）:", response.data.substring(0, 500));
      
      if (response.data.includes('<html') || response.data.includes('<!DOCTYPE')) {
        throw new Error(`WordPress API 返回了 HTML 页面而不是 JSON 数据。可能的原因：
1. WordPress REST API 未启用
2. 认证失败，返回了登录页面
3. 权限不足

请检查：
- WordPress URL 是否正确: ${credentials.url}
- 用户名和应用密码是否正确
- 用户是否有发布页面的权限`);
      }
      
      throw new Error(`WordPress API 返回了意外的字符串格式: ${response.data.substring(0, 200)}`);
    }
    
    // 验证发布是否成功
    const pageData = response.data;
    const pageId = pageData.id;
    const pageLink = pageData.link || pageData.guid?.rendered;
    const pageStatus = pageData.status;
    
    if (!pageId) {
      throw new Error("WordPress API 返回的数据中没有页面 ID，发布可能失败");
    }
    
    if (pageStatus !== 'publish') {
      console.warn(`[WordPress] 页面状态不是 'publish': ${pageStatus}`);
    }
    
    // 如果使用 Elementor，内容存储在元数据中，而不是 content 字段
    if (useElementor) {
      console.log(`[WordPress] 🎨 使用 Elementor 方式保存，内容存储在 Elementor 元数据中`);
      console.log(`[WordPress] ✅ 页面已创建，ID: ${pageId}`);
      console.log(`[WordPress] ✅ Elementor 元数据已更新`);
      console.log(`[WordPress] 📝 注意：Elementor 的内容存储在 _elementor_data 元数据中，不在标准的 content 字段中`);
      console.log(`[WordPress] 📝 页面在前端显示时，Elementor 会自动渲染元数据中的内容`);
      
      // 验证URL前缀自定义字段是否存储成功
      // 注意：WordPress REST API的meta端点可能不存在，我们通过获取页面数据来验证
      if (urlPrefix) {
        try {
          const pageResponse = await client.get(`/pages/${pageId}`);
          const pageData = pageResponse.data;
          // WordPress REST API可能不会返回meta字段，除非明确注册
          // 所以我们只能提示用户手动检查
          console.log(`[WordPress] 💡 提示：请在WordPress后台验证页面ID ${pageId} 的自定义字段：`);
          console.log(`[WordPress]   字段名: _custom_url_prefix`);
          console.log(`[WordPress]   字段值: ${urlPrefix}`);
          console.log(`[WordPress]   如果字段不存在，请手动添加以确保URL重写规则生效`);
        } catch (checkError: any) {
          console.warn(`[WordPress] ⚠️ 无法验证URL前缀自定义字段:`, checkError.message);
          console.warn(`[WordPress] 提示：请手动在WordPress后台检查页面ID ${pageId} 的自定义字段`);
        }
      }
      
      // Elementor 方式不需要检查 content 字段
      return response.data;
    }
    
    // 标准 WordPress 方式：检查 content 字段
    const savedContent = pageData.content?.rendered || pageData.content?.raw || '';
    
    // 检查保存的内容是否包含样式和脚本
    const hasStyle = savedContent.includes('<style') || savedContent.includes('</style>');
    const hasScript = savedContent.includes('<script') || savedContent.includes('</script>');
    
    // 检查是否包含动态数据（产品、FAQ 等）
    const hasProducts = savedContent.includes('product-card') || savedContent.includes('products-grid');
    const hasFAQ = savedContent.includes('accordion') || savedContent.includes('faq');
    const hasHandlebarsPlaceholders = savedContent.includes('{{') || savedContent.includes('{{{');
    
    if (isFullHtmlDocument && (!hasStyle || !hasScript)) {
      console.warn(`[WordPress] ⚠️ 警告：页面内容可能被过滤了！`);
      console.warn(`[WordPress] 原始内容包含样式和脚本，但保存的内容中：hasStyle=${hasStyle}, hasScript=${hasScript}`);
      console.warn(`[WordPress] 这可能是因为 WordPress 用户没有 'unfiltered_html' 权限`);
      console.warn(`[WordPress] 解决方案：确保 WordPress 用户有管理员权限或 'unfiltered_html' 权限`);
    }
    
    if (hasHandlebarsPlaceholders) {
      console.error(`[WordPress] ❌ 错误：保存的内容仍包含 Handlebars 占位符！`);
      console.error(`[WordPress] 这说明模板渲染失败，数据没有被正确替换`);
      console.error(`[WordPress] 保存的内容预览（前 500 字符）:`);
      console.error(savedContent.substring(0, 500));
    }
    
    // 检查 CSS 是否被 wpautop 处理（被 <p> 标签包裹）
    const hasWpautopIssue = savedContent.includes('</p>\n<p>') && savedContent.includes('<style');
    const hasWpautopIssue2 = savedContent.includes('</p><p>') && savedContent.includes('<style');
    const hasWpautopIssue3 = savedContent.match(/<style[^>]*>[\s\S]*?<\/p>[\s\S]*?<p>[\s\S]*?<\/style>/);
    
    if (hasWpautopIssue || hasWpautopIssue2 || hasWpautopIssue3) {
      console.error(`[WordPress] ❌ 严重错误：CSS 被 wpautop 过滤器处理，被 <p> 标签包裹！`);
      console.error(`[WordPress] 这说明 WordPress 的 wpautop 过滤器正在处理内容`);
      console.error(`[WordPress] 可能的原因：`);
      console.error(`  1. WordPress 用户没有 'unfiltered_html' 权限（最常见）`);
      console.error(`  2. WordPress 的 wpautop 过滤器自动处理了内容`);
      console.error(`  3. WordPress 主题或插件干扰了内容处理`);
      console.error(`[WordPress] 解决方案（按优先级）：`);
      console.error(`  方案 1（必须）：确保 WordPress 用户是管理员或有 'unfiltered_html' 权限`);
      console.error(`    - 在 WordPress 后台：用户 → 所有用户 → 编辑用户 → 角色选择"管理员"`);
      console.error(`    - 或者使用代码添加权限（在主题的 functions.php 中）：`);
      console.error(`      add_filter('user_has_cap', function($caps) { $caps['unfiltered_html'] = true; return $caps; }, 10, 1);`);
      console.error(`  方案 2：在 WordPress 中禁用 wpautop 过滤器`);
      console.error(`    - 方法 A：安装插件 "Disable wpautop" 或 "Raw HTML"`);
      console.error(`    - 方法 B：在主题的 functions.php 中添加：`);
      console.error(`      remove_filter('the_content', 'wpautop');`);
      console.error(`      remove_filter('the_excerpt', 'wpautop');`);
      console.error(`  方案 3：检查 WordPress 主题是否干扰内容`);
      console.error(`    - 切换到 WordPress 默认主题（如 Twenty Twenty-Four）测试`);
      console.error(`  方案 4：检查是否有插件干扰`);
      console.error(`    - 暂时停用所有插件，测试是否解决问题`);
      console.error(`[WordPress] 保存的内容中 CSS 部分预览:`);
      const cssMatch = savedContent.match(/<style[^>]*>[\s\S]{0,500}/);
      if (cssMatch) {
        console.error(cssMatch[0]);
      }
    }
    
    // 检查内容是否被 WordPress 主题样式覆盖
    if (hasStyle && hasScript && hasProducts) {
      console.log(`[WordPress] ✅ 内容检查通过：样式、脚本和产品数据都已保存`);
      console.log(`[WordPress] 💡 提示：如果前端显示仍然不正确，可能是以下原因：`);
      console.log(`[WordPress]   1. WordPress 主题的 CSS 覆盖了页面样式（检查主题的 style.css）`);
      console.log(`[WordPress]   2. 浏览器缓存问题（按 Ctrl+F5 强制刷新）`);
      console.log(`[WordPress]   3. WordPress 缓存插件（清除缓存）`);
      console.log(`[WordPress]   4. 页面模板设置（确保使用"默认模板"）`);
    }
    
    console.log(`[WordPress] 页面发布成功: ID=${pageId}, URL=${pageLink || '未提供'}, Status=${pageStatus}`);
    console.log(`[WordPress] 保存的内容长度: ${savedContent.length}, 原始内容长度: ${contentToSave.length}`);
    console.log(`[WordPress] 内容检查: 样式=${hasStyle}, 脚本=${hasScript}, 产品=${hasProducts}, FAQ=${hasFAQ}, 占位符=${hasHandlebarsPlaceholders}, wpautop问题=${hasWpautopIssue || hasWpautopIssue2 || !!hasWpautopIssue3}`);
    
    // 详细的内容对比分析
    const originalStyleCount = (contentToSave.match(/<style[^>]*>/gi) || []).length;
    const savedStyleCount = (savedContent.match(/<style[^>]*>/gi) || []).length;
    const originalScriptCount = (contentToSave.match(/<script[^>]*>/gi) || []).length;
    const savedScriptCount = (savedContent.match(/<script[^>]*>/gi) || []).length;
    
    if (originalStyleCount !== savedStyleCount) {
      console.warn(`[WordPress] ⚠️ 警告：样式标签数量不匹配！原始: ${originalStyleCount}, 保存后: ${savedStyleCount}`);
      console.warn(`[WordPress] 这说明 WordPress 可能过滤了部分 <style> 标签`);
    }
    
    if (originalScriptCount !== savedScriptCount) {
      console.warn(`[WordPress] ⚠️ 警告：脚本标签数量不匹配！原始: ${originalScriptCount}, 保存后: ${savedScriptCount}`);
      console.warn(`[WordPress] 这说明 WordPress 可能过滤了部分 <script> 标签`);
    }
    
    // 注意：WordPress REST API 不支持 HTML 块格式，所以不检查 HTML 块格式标记
    // 我们直接保存 HTML，依赖 'unfiltered_html' 权限来保留样式和脚本
    
    // 如果所有检查都通过，但仍然有问题，提供额外的诊断建议
    if (hasStyle && hasScript && hasProducts && !hasWpautopIssue && !hasWpautopIssue2 && !hasWpautopIssue3) {
      console.log(`[WordPress] ✅ 所有内容检查通过！`);
      console.log(`[WordPress] 💡 如果前端显示仍然不正确，请检查：`);
      console.log(`[WordPress]   1. 浏览器开发者工具（F12）查看是否有 CSS/JS 错误`);
      console.log(`[WordPress]   2. 检查 WordPress 主题是否覆盖了页面样式`);
      console.log(`[WordPress]   3. 清除浏览器缓存和 WordPress 缓存`);
      console.log(`[WordPress]   4. 检查页面模板设置（WordPress 后台 → 页面 → 编辑 → 页面属性 → 模板）`);
    }
    
    // 验证URL前缀自定义字段是否存储成功（标准WordPress方式）
    // 注意：WordPress REST API的meta端点可能不存在，我们只能提示用户手动检查
    if (urlPrefix && pageId) {
      console.log(`[WordPress] 💡 提示：请在WordPress后台验证页面ID ${pageId} 的自定义字段：`);
      console.log(`[WordPress]   字段名: _custom_url_prefix`);
      console.log(`[WordPress]   字段值: ${urlPrefix}`);
      console.log(`[WordPress]   如果字段不存在，请手动添加以确保URL重写规则生效`);
      console.log(`[WordPress] 💡 提示：请确保已将 wordpress-url-rewrite.php 代码添加到主题的 functions.php`);
      console.log(`[WordPress] 💡 提示：然后进入 设置 → 固定链接 → 保存更改（刷新重写规则）`);
    }
    
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 400) {
      const errorData = error.response?.data || "";
      const errorText = typeof errorData === "string" ? errorData : JSON.stringify(errorData);
      
      if (errorText.includes("plain HTTP request was sent to HTTPS port")) {
        // 尝试从环境变量获取代理地址，或使用默认值
        const httpProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "http://127.0.0.1:7890";
        
        // 检查 WordPress URL 是否需要代理
        const wpUrl = new URL(credentials.url);
        const wpHostname = wpUrl.hostname;
        const noProxy = process.env.NO_PROXY || "";
        const wordpressProxy = process.env.WORDPRESS_PROXY || "";
        const shouldDisableProxy = noProxy.includes(wpHostname) || noProxy.includes("*");
        
        let solution = "";
        if (wordpressProxy) {
          solution = `WordPress 已配置专门的代理，但可能配置不正确。请检查：
1. WORDPRESS_PROXY 配置是否正确：
   WORDPRESS_PROXY=${wordpressProxy}

2. 如果代理需要认证，格式应为：
   WORDPRESS_PROXY=http://username:password@proxy-host:port

3. 如果 proxy-vertu.vertu.com 是代理服务器，需要知道端口号：
   WORDPRESS_PROXY=http://proxy-vertu.vertu.com:端口

4. 或者尝试禁用代理（如果 WordPress 可以直接访问）：
   NO_PROXY=${wpHostname},vertu.com`;
        } else if (shouldDisableProxy) {
          solution = `WordPress 网站可能不需要代理。解决方案：
1. 在 backend/.env 文件中添加 NO_PROXY 配置：
   NO_PROXY=${wpHostname},vertu.com

2. 或者确保同时配置了 HTTP_PROXY 和 HTTPS_PROXY：
   HTTP_PROXY=${httpProxy}
   HTTPS_PROXY=${httpProxy}`;
        } else {
          solution = `解决方案（三选一）：

方案1：如果 WordPress 不需要代理，添加 NO_PROXY：
NO_PROXY=${wpHostname},vertu.com

方案2：如果 WordPress 需要专门的代理，添加 WORDPRESS_PROXY：
WORDPRESS_PROXY=http://127.0.0.1:10808
# 或者如果 proxy-vertu.vertu.com 是代理服务器：
# WORDPRESS_PROXY=http://proxy-vertu.vertu.com:端口

方案3：如果 WordPress 使用通用代理，确保同时配置：
HTTP_PROXY=${httpProxy}
HTTPS_PROXY=${httpProxy}`;
        }
        
        throw new Error(`WordPress API 错误：HTTPS 请求配置问题。

问题：HTTPS 请求通过 HTTP 代理发送，导致失败。

${solution}

当前 WordPress URL: ${credentials.url}
当前 HTTP_PROXY: ${process.env.HTTP_PROXY || "未配置"}
当前 HTTPS_PROXY: ${process.env.HTTPS_PROXY || "未配置"}
当前 NO_PROXY: ${process.env.NO_PROXY || "未配置"}
当前 WORDPRESS_PROXY: ${wordpressProxy || "未配置"}

配置完成后，请重启服务器。`);
      }
    }
    throw error;
  }
}
