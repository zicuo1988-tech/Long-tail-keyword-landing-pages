import { GoogleGenerativeAI } from "@google/generative-ai";
import { withApiKey } from "./apiKeyManager.js";
import { KNOWLEDGE_BASE } from "../knowledgeBase.js";

const DEFAULT_MODEL = "gemini-2.5-pro";
const MIN_ARTICLE_LENGTH = 400; // 最少字符数（一屏内容）
const MAX_ARTICLE_LENGTH = 800; // 最大字符数（确保不超过一屏）
const MIN_HEADING_COUNT = 2; // 至少 2 个H2标题（主标题 + 2-3个子标题，不使用H1）
const MIN_PARAGRAPH_COUNT = 3; // 至少 3 个段落（介绍 + 支持段落 + 结论）

export interface GenerateContentOptions {
  apiKey?: string; // 可选：如果提供则直接使用，否则从管理器获取
  keyword: string;
  pageTitle: string;
  titleType?: string; // 标题类型：用于调整内容风格和FAQ重点
  templateType?: string; // 模板类型：template-1, template-2, template-3/4/5（3/4/5长内容模式，无严格字数上限）
  userPrompt?: string; // 可选：用户提供的内容提示词和想法，AI将按照此提示词生成内容
  knowledgeBaseContent?: string;
  onStatusUpdate?: (message: string) => void; // 可选：状态更新回调
  shouldAbort?: () => boolean; // 可选的检查是否应该中止的回调（用于暂停功能）
}

export interface GenerateTitleOptions {
  apiKey?: string;
  keyword: string;
  titleType?: string; // 标题类型：purchase, informational, review, commercial, how-to, recommendations, services-guides, tech-insights, comparison, expert, best, top, most
  onStatusUpdate?: (message: string) => void;
  shouldAbort?: () => boolean; // 可选的检查是否应该中止的回调（用于暂停功能）
}

export interface GeneratedContent {
  articleContent: string;
  extendedContent?: string; // 扩展内容（用于模板3/4/5的第二部分，不重复，附在末尾）
  pageDescription?: string; // 页面描述（用于模板2和模板3）
  metaDescription?: string; // SEO meta description (150-160 characters)
  metaKeywords?: string; // SEO meta keywords (comma-separated)
  faqItems: Array<{ question: string; answer: string }>;
}

/**
 * 使用官方 SDK 生成内容
 */
async function generateWithKey(apiKey: string, keyword: string, pageTitle: string, titleType?: string, templateType?: string, userPrompt?: string, knowledgeBaseContent?: string): Promise<GeneratedContent> {
  // 根据模板类型设置内容长度限制
  // template-3/4/5 为长内容模式，无严格字数上限
  const isTemplate3 = templateType === "template-3";
  const isTemplate4 = templateType === "template-4";
  const isTemplate5 = templateType === "template-5";
  const isLongFormTemplate = isTemplate3 || isTemplate4 || isTemplate5;
  const isTemplate4Or5 = isTemplate4 || isTemplate5;
  const currentMinLength = MIN_ARTICLE_LENGTH;
  const currentMaxLength = isLongFormTemplate ? 12000 : MAX_ARTICLE_LENGTH; // 模板3/4/5 允许更长的内容
  
  // 获取当前年份（动态，避免硬编码）
  const currentYear = new Date().getFullYear();
  
  // 统一使用稳定模型，避免 preview 模型触发更多限流
  const modelName = DEFAULT_MODEL;
  
  // 初始化 Google AI 客户端
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // 获取模型实例（根据模板类型和 Key 类型调整 maxOutputTokens）
  const model = genAI.getGenerativeModel({ 
    model: modelName,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: isLongFormTemplate ? 8192 : 4096, // 模板3/4/5 允许更长的内容
    },
  });

  console.log(`[GoogleAI] Using model: ${modelName} with SDK`);

  // 验证内容是否包含中文字符
  function containsChinese(text: string): boolean {
    return /[\u4e00-\u9fff]/.test(text);
  }

  // 验证并记录警告
  function validateContent(content: string, contentType: string): void {
    if (containsChinese(content)) {
      console.warn(`[GoogleAI] WARNING: Generated ${contentType} contains Chinese characters. This should not happen.`);
      console.warn(`[GoogleAI] Content preview: ${content.substring(0, 200)}...`);
    }
  }

  // 简单的带抖动重试（用于官方429/配额限流）
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  async function requestWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
    maxRetries = 3,
    baseDelay = 1200
  ): Promise<T> {
    let attempt = 0;
    while (true) {
      try {
        return await fn();
      } catch (err: any) {
        attempt += 1;
        const status = err?.status || err?.code;
        const message = err?.message || "";
        const is429 =
          status === 429 ||
          /too many requests/i.test(message) ||
          /resource has been exhausted/i.test(message) ||
          /quota/i.test(message) ||
          /RESOURCE_EXHAUSTED/i.test(message);
        if (!is429 || attempt > maxRetries) {
          console.warn(`[GoogleAI] ${label} request failed (attempt ${attempt}/${maxRetries}):`, message || err);
          throw err;
        }
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 300);
        console.warn(`[GoogleAI] ${label} hit 429/quota (attempt ${attempt}), retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }

  // 生成文章内容的提示词
  const kbContent = (knowledgeBaseContent && knowledgeBaseContent.trim()) || KNOWLEDGE_BASE;
  
  // 提取知识库中明确列出的产品名称
  const knownProducts = extractProductNamesFromKnowledgeBase(kbContent);
  
  // 根据关键词匹配相关产品（只提及与关键词相关的产品）
  const relevantProducts = extractRelevantProductsFromKeyword(keyword, knownProducts);
  
  // 检测性别和目标受众
  const combinedText = `${keyword.toLowerCase()} ${pageTitle.toLowerCase()}`;
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
  const isPhoneKeyword = keyword.toLowerCase().includes("phone") || keyword.toLowerCase().includes("smartphone") || 
                         keyword.toLowerCase().includes("mobile") || keyword.toLowerCase().includes("cell") ||
                         pageTitle.toLowerCase().includes("phone") || pageTitle.toLowerCase().includes("smartphone") ||
                         pageTitle.toLowerCase().includes("mobile") || pageTitle.toLowerCase().includes("cell");
  
  console.log(`[GoogleAI] Keyword: "${keyword}"`);
  console.log(`[GoogleAI] Page Title: "${pageTitle}"`);
  if (isMenTarget) {
    console.log(`[GoogleAI] Target audience: Men/Husband (will filter out women's products)`);
  } else if (isWomenTarget) {
    console.log(`[GoogleAI] Target audience: Women/Wife (will filter out men's products)`);
  }
  if (isPhoneKeyword) {
    console.log(`[GoogleAI] Product type: Phone (will prioritize phone products)`);
  }
  console.log(`[GoogleAI] Relevant products matched: ${relevantProducts.length > 0 ? relevantProducts.join(", ") : "None - will use general VERTU content"}`);
  console.log(`[GoogleAI] Title type: ${titleType || 'not specified'} - content will be tailored to match this type`);
  if (userPrompt && userPrompt.trim()) {
    console.log(`[GoogleAI] User prompt provided: "${userPrompt.substring(0, 100)}${userPrompt.length > 100 ? '...' : ''}" - content will follow user's direction`);
  }

  // 根据标题类型生成内容风格指导
  const getContentStyleByType = (type?: string): string => {
    if (!type) return "";
    
    const styleMap: Record<string, string> = {
      "purchase": `CONTENT STYLE (Purchase/Transaction Type):
- Focus on WHERE TO BUY, OFFICIAL CHANNELS, AUTHORISED RETAILERS, and PURCHASE OPTIONS
- Emphasise authenticity, official stores, authorised dealers, and buying process
- Include information about purchase locations, payment options, and delivery
- Use action-oriented language: "Buy", "Purchase", "Shop", "Find the Best" (avoid "Shop for where to buy" - redundant)
- Highlight official channels, authorised retailers, and premium quality (avoid discount language like "Best Prices" or "Cheapest")
- For luxury brands: Emphasise "Official Store", "Authorised Retailer", "Premium Collection"`,
      
      "informational": `CONTENT STYLE (Informational/Guide Type):
- Focus on COMPREHENSIVE INFORMATION, FEATURES, and DETAILED EXPLANATIONS
- Provide complete overview, specifications, and key facts
- Use educational language: "Complete Guide", "Everything About", "All You Need to Know"
- Include detailed features, benefits, and use cases
- Structure as a comprehensive reference guide`,
      
      "review": `CONTENT STYLE (Review/Comparison Type):
- Focus on RATINGS, COMPARISONS, PROS/CONS, and EVALUATIONS
- Emphasise quality, performance, and user experience
- Include comparisons with alternatives and detailed assessments
- Use evaluative language: "Best", "Top Rated", "Review", "Comparison"
- Highlight strengths, weaknesses, and recommendations`,
      
      "commercial": `CONTENT STYLE (Commercial/Deal Type):
- Focus on PREMIUM COLLECTIONS, EXCLUSIVE SELECTIONS, and OFFICIAL STORE
- Emphasise authenticity, authorised retailers, and official channels
- Include pricing information, official availability, and authorised dealers
- Use premium language: "Premium Collection", "Exclusive Selection", "Official Store", "Authorised Retailer"
- Highlight quality, craftsmanship, and official channels (avoid discount language like "Best Prices" or "Cheapest")
- For luxury brands: NEVER use discount language - use "Premium", "Official", "Exclusive" instead`,
      
      "how-to": `CONTENT STYLE (How-to Type):
- Focus on STEP-BY-STEP GUIDES, SELECTION PROCESS, and PRACTICAL ADVICE
- Emphasise how to choose, how to use, and how to select
- Include actionable steps, selection criteria, and practical tips
- Use instructional language: "How to Choose", "How to Find", "How to Select", "How to Buy"
- Provide clear, actionable guidance`,
      
      "recommendations": `CONTENT STYLE (Recommendations Type):
- Focus on TOP PICKS, RECOMMENDED OPTIONS, and EXPERT SUGGESTIONS
- Emphasise quality, reliability, and expert opinions
- Include curated lists, top-rated options, and professional recommendations
- Use recommendation language: "Top-rated", "Recommended", "Best Rated", "Top Picks"
- Highlight expert-endorsed choices`,
      
      "services-guides": `CONTENT STYLE (Services Guides Type):
- Focus on USAGE, OPERATION, SERVICE FEATURES, and USER GUIDES
- Emphasise how to use, service benefits, and operational details
- Include usage instructions, service features, and getting started guides
- Use service-oriented language: "Usage Guide", "User Guide", "Service Guide", "Getting Started"
- Provide practical service information`,
      
      "tech-insights": `CONTENT STYLE (Tech Insights Type):
- Focus on TECHNICAL COMPARISONS, FEATURES, and TECHNOLOGY ANALYSIS
- Emphasise technical specifications, feature comparisons, and tech details
- Include detailed comparisons, technical analysis, and feature breakdowns
- Use technical language: "Comparison", "Tech Comparison", "Which is Better", "Feature Comparison"
- Provide in-depth technical insights`,
      
      "comparison": `CONTENT STYLE (Comparison Type):
- Focus on COMPARISONS, ALTERNATIVES, and SIDE-BY-SIDE EVALUATIONS
- Emphasise differences, similarities, and relative advantages
- Include detailed comparisons with alternatives and competitive analysis
- Use comparison language: "vs", "Comparison", "Which is Better", "Best vs"
- Highlight differences and help users make informed choices`,
      
      "expert": `CONTENT STYLE (Expert/Authority Type):
- Focus on EXPERT ANALYSIS, PROFESSIONAL INSIGHTS, and IN-DEPTH EVALUATIONS
- Emphasise professional expertise, detailed analysis, and authoritative opinions
- Include expert recommendations, professional reviews, and detailed assessments
- Use expert language: "Expert Guide", "Professional Review", "In-Depth Analysis"
- Provide authoritative, professional insights`,
      
      "best": `CONTENT STYLE (Best Type):
- Focus on BEST OPTIONS, QUALITY, and TOP CHOICES
- Emphasise quality, value, and top-rated selections
- Include best-in-class options, quality assessments, and top recommendations
- Use best-focused language: "Best", "Best Rated", "Best Quality", "Best Value", "Best Choice"
- Highlight superior options and quality`,
      
      "top": `CONTENT STYLE (Top Type):
- Focus on TOP RATED, PREMIUM CHOICES, and HIGH-QUALITY OPTIONS
- Emphasise top-tier selections, premium quality, and high ratings
- Include top-rated options, premium choices, and quality picks
- Use top-focused language: "Top", "Top Rated", "Top Quality", "Top Picks", "Top Choices"
- Highlight premium, top-tier selections`,
      
      "top-ranking": `CONTENT STYLE (Top Ranking Type):
- Focus on RANKINGS, LISTS, and NUMBERED TOP SELECTIONS
- Emphasise ranked lists, top 10/top 5 formats, and comparative rankings
- Include numbered rankings (e.g., "#1", "#2", "Top 10"), ranked lists, and comparative positions
- Use ranking-focused language: "Top 10", "Top 5", "Top Rankings", "Top List", "Ranking of", "Top Rated List"
- Structure content as a ranked list with clear positions and comparisons
- Highlight ranking positions, comparative analysis, and list-based recommendations`,
      
      "most": `CONTENT STYLE (Most Type):
- Focus on MOST POPULAR, MOST RECOMMENDED, and MOST TRUSTED OPTIONS
- Emphasise popularity, recommendations, and trusted choices
- Include most popular options, most recommended selections, and trusted picks
- Use most-focused language: "Most Popular", "Most Rated", "Most Recommended", "Most Trusted"
- Highlight popular, well-recommended options`,
    };
    
    return styleMap[type] || "";
  };

  const contentStyleGuide = getContentStyleByType(titleType);

  // 处理用户提示词
  const userPromptSection = userPrompt && userPrompt.trim() 
    ? `\n\nUSER-SPECIFIED CONTENT DIRECTION (MUST FOLLOW):
The user has provided specific guidance for content creation. You MUST incorporate these ideas and directions into the article:
"${userPrompt.trim()}"

IMPORTANT: While following the user's direction, you MUST still:
- Maintain British English grammar and vocabulary
- Adhere to the knowledge base (no fabricated information)
- Follow the content structure requirements (H2 headings, paragraphs, lists)
- Keep the content concise and SEO-optimised
- Match the selected title type style`
    : "";

  const articlePrompt = `You are an expert SEO content strategist specialising in high-value content. ${isLongFormTemplate ? "Write a COMPREHENSIVE, DETAILED article" : "Write a BRIEF, SEO-optimised article"} about "${keyword}" that directly answers the user's search query${isLongFormTemplate ? ", providing richer depth while remaining factual and tightly aligned to the title" : " without unnecessary length"}.

TITLE-INTENT LOCK (CRITICAL):
- The page title is "${pageTitle}". ALL content must stay tightly aligned to this title and its core intent.
- Do NOT drift into unrelated themes (e.g., craftsmanship, materials, or other product categories) unless explicitly relevant to the title.
- If the title is about rankings/features/minimalist smart phones, focus on ranking logic, feature explanations, user benefits, and why each feature matters for minimalist smart phones.
- If the title/keyword is about wearables, hearables, or watches (e.g., "wearable", "hearable", "earbud", "watch", "timepiece"), DO NOT deep-dive into phone hardware. You may mention Agent Q / Quantum Flip at most once as a control hub/context link, but keep it to one short sentence and return immediately to the wearable/hearable/watch topic.
- Brand naming rule: ONLY use "VERTU" in headings/phrasing if the title或keyword明确包含 "VERTU"；否则保持中性表达（写 "wearables" 而不是 "VERTU wearables"），避免强行加品牌前缀。
- Use knowledge base facts only when they are relevant to the title intent; ignore irrelevant KB parts.
- It is BETTER to add new, relevant, factual detail that fits the title than to include off-topic KB snippets.

GENDER AND TARGET AUDIENCE MATCHING (CRITICAL):
- If the title/keyword mentions "husband", "men", "men's", "male", "for him", "gift for him" → content MUST focus on products suitable for MEN/HUSBANDS, NOT women's products
- If the title/keyword mentions "wife", "women", "women's", "ladies", "female", "for her", "gift for her" → content MUST focus on products suitable for WOMEN/WIVES, NOT men's products
- DO NOT recommend women's products (e.g., women's bags, ladies' accessories) when the title is about gifts for husbands/men
- DO NOT recommend men's products when the title is about gifts for wives/women
- Product recommendations MUST match the target audience specified in the title

PRODUCT TYPE MATCHING (CRITICAL):
- If the title/keyword explicitly mentions "phone", "smartphone", "mobile phone" → content MUST focus on PHONE products, NOT watches, rings, or bags
- If the title/keyword explicitly mentions "watch", "timepiece" → content MUST focus on WATCH products, NOT phones
- If the title/keyword explicitly mentions "ring", "jewellery" → content MUST focus on RING products, NOT phones or watches
- If the title/keyword explicitly mentions "earbud", "earphone" → content MUST focus on EARBUD products, NOT phones or watches
- Product recommendations MUST match the product type specified in the title/keyword

${contentStyleGuide ? `${contentStyleGuide}\n\n` : ""}${userPromptSection}

CRITICAL REQUIREMENTS:
- You MUST write in British English (UK English) ONLY - this is non-negotiable
- You MUST NOT include any Chinese characters, words, or phrases
- You MUST NOT use American English spelling, grammar, or vocabulary
- ALL product information MUST come EXCLUSIVELY from the knowledge base provided below
- NO fabricated information, NO assumptions, NO external knowledge beyond the knowledge base
- Content MUST be COMPLETE - every section must be fully written, no incomplete sentences or cut-off content

CRITICAL: KEYWORD-CONTENT TOPIC MATCHING (MANDATORY):
- The content MUST be about "${keyword}" and ONLY about "${keyword}" or directly related topics
- If the keyword is about "watches" or "timepieces" → content MUST be about watches, NOT phones
- If the keyword is about "phones" or "mobile phones" → content MUST be about phones, NOT watches
- If the keyword is about "rings" → content MUST be about rings, NOT phones or watches
- If the keyword is about "earbuds" → content MUST be about earbuds, NOT phones or watches
- DO NOT write about unrelated product categories - this is a CRITICAL SEO requirement
- The page title is "${pageTitle}" - your content MUST match this title's topic exactly
- If the title mentions "watches" but you write about "phones", this is a SEVERE error that will hurt SEO
- If the title mentions "phones" but you write about "watches", this is a SEVERE error that will hurt SEO
- ALWAYS verify: Does my content match the keyword "${keyword}" and title "${pageTitle}"? If not, rewrite it.

BRITISH ENGLISH REQUIREMENTS (CRITICAL - MUST FOLLOW):
1. SPELLING (British English only):
   - Use "colour" NOT "color"
   - Use "realise" NOT "realize"
   - Use "centre" NOT "center"
   - Use "organise" NOT "organize"
   - Use "customise" NOT "customize"
   - Use "analyse" NOT "analyze"
   - Use "optimise" NOT "optimize"
   - Use "recognise" NOT "recognize"
   - Use "favour" NOT "favor"
   - Use "behaviour" NOT "behavior"
   - Use "honour" NOT "honor"
   - Use "labour" NOT "labor"
   - Use "defence" NOT "defense"
   - Use "licence" (noun) NOT "license" (noun) - but "license" (verb) is correct
   - Use "practise" (verb) NOT "practice" (verb) - but "practice" (noun) is correct
   - Use "travelling" NOT "traveling"
   - Use "cancelled" NOT "canceled"
   - Use "labelled" NOT "labeled"
   - Use "modelling" NOT "modeling"
   - Use "programme" (schedule/show) NOT "program" (except for computer programs)
   - Use "cheque" (payment) NOT "check" (payment)
   - Use "tyre" NOT "tire"
   - Use "aluminium" NOT "aluminum"
   - Use "sulphur" NOT "sulfur"
   - Use "grey" NOT "gray"
   - Use "whilst" NOT "while" (preferred in formal British English)
   - Use "amongst" NOT "among" (preferred in formal British English)

2. GRAMMAR (British English conventions):
   - Use collective nouns with plural verbs when referring to groups: "The team are..." NOT "The team is..."
   - Use "have got" NOT "have gotten" (British English doesn't use "gotten")
   - Use "different to" or "different from" NOT "different than"
   - Use "at the weekend" NOT "on the weekend"
   - Use "in hospital" NOT "in the hospital" (when referring to being a patient)
   - Use "at university" NOT "at the university" (when referring to studying)
   - Use "needn't" NOT "don't need to" (more common in British English)
   - Use "shan't" NOT "won't" (in formal British English for "shall not")
   - Use "I should like to" NOT "I would like to" (more formal British English)

3. VOCABULARY (British English words only):
   - Use "mobile phone" or "mobile" NOT "cell phone" or "cellular phone"
   - Use "lift" NOT "elevator"
   - Use "flat" NOT "apartment"
   - Use "boot" (car) NOT "trunk"
   - Use "bonnet" (car) NOT "hood"
   - Use "petrol" NOT "gas" or "gasoline"
   - Use "pavement" NOT "sidewalk"
   - Use "trousers" NOT "pants" (pants means underwear in British English)
   - Use "jumper" NOT "sweater"
   - Use "trainers" NOT "sneakers"
   - Use "biscuit" NOT "cookie"
   - Use "crisps" NOT "chips" (chips are thick-cut fries in British English)
   - Use "chips" NOT "fries" (thin-cut fries)
   - Use "aubergine" NOT "eggplant"
   - Use "courgette" NOT "zucchini"
   - Use "correspondence" NOT "mail" (in formal contexts)
   - Use "post" NOT "mail" (for sending letters)
   - Use "queue" NOT "line" (for waiting)
   - Use "fortnight" NOT "two weeks"
   - Use "holiday" NOT "vacation"
   - Use "autumn" NOT "fall"
   - Use "rubbish" NOT "trash" or "garbage"
   - Use "bin" NOT "trash can" or "garbage can"
   - Use "car park" NOT "parking lot"
   - Use "motorway" NOT "highway" or "freeway"
   - Use "roundabout" NOT "traffic circle" or "rotary"
   - Use "zebra crossing" NOT "crosswalk"
   - Use "chemist" NOT "pharmacy" or "drugstore"
   - Use "shop" NOT "store" (in most contexts)
   - Use "high street" NOT "main street"
   - Use "bill" NOT "check" (in restaurants)
   - Use "current account" NOT "checking account"
   - Use "current" NOT "present" (for time reference: "at the current time")
   - Use "whilst" NOT "while" (preferred in formal writing)
   - Use "amongst" NOT "among" (preferred in formal writing)

4. PUNCTUATION (British English conventions):
   - Place full stops and commas outside quotation marks: "word", not "word,"
   - Use single quotation marks for quotes, double for quotes within quotes: 'He said "hello"'
   - Use "..." (ellipsis) with spaces: "word . . . word" (though modern British English often uses "word...word")

5. DATE AND TIME FORMAT:
   - Use "day month year": "25 December ${currentYear}" NOT "December 25, ${currentYear}"
   - Use "25/12/${currentYear}" NOT "12/25/${currentYear}"
   - Use "half past three" NOT "three-thirty" (in spoken form)
   - Use "quarter to" and "quarter past" NOT "quarter of" or "quarter after"
   
CRITICAL: YEAR AND DATE ACCURACY (MANDATORY):
- The current year is ${currentYear} (as of the content generation date)
- ONLY mention specific years if they are explicitly stated in the knowledge base
- If the knowledge base does NOT contain a specific year, use the current year (${currentYear}) or avoid mentioning specific years
- DO NOT use outdated years (e.g., ${currentYear - 1} or earlier) unless explicitly stated in the knowledge base
- If you must reference a time period, use relative terms like "current", "latest", "recent" instead of hardcoded years
- Examples:
  * WRONG: "Best Luxury Phones 2024" (if knowledge base doesn't mention 2024 and it's now ${currentYear})
  * CORRECT: "Best Luxury Phones ${currentYear}" or "Best Luxury Phones" (without year)
  * WRONG: "A 2024 Evaluation" (if knowledge base doesn't mention 2024 and it's now ${currentYear})
  * CORRECT: "A ${currentYear} Evaluation" or "A Current Evaluation"
- This ensures content remains accurate and doesn't appear outdated

EXAMPLES OF BRITISH vs AMERICAN ENGLISH:
- BRITISH: "The team are travelling to the centre of London to organise a programme."
- AMERICAN: "The team is traveling to the center of London to organize a program."
- BRITISH: "I should like to buy a mobile phone from the shop on the high street."
- AMERICAN: "I would like to buy a cell phone from the store on main street."
- BRITISH: "We need to queue at the car park near the motorway."
- AMERICAN: "We need to line up at the parking lot near the highway."

CRITICAL GRAMMAR RULES (MUST FOLLOW):
1. ALWAYS use proper articles (a/an/the) - this is essential for natural English:
   - WRONG: "Looking for luxury phone?" (missing article)
   - CORRECT: "Looking for a luxury phone?" or "Looking for the luxury phone?"
   - WRONG: "VERTU offers premium experience" (missing article)
   - CORRECT: "VERTU offers a premium experience" or "VERTU offers the premium experience"
   - Use "a/an" for general references, "the" for specific references
   - Example: "A luxury phone from VERTU" (general) vs "The luxury phone you're considering" (specific)

2. AVOID cheap-sounding vocabulary - replace with premium alternatives:
   - NEVER use: "Best Prices", "Cheapest", "Best Value", "Affordable", "Budget", "Deal", "Discount"
   - REPLACE with: "Premium", "Exclusive", "Handcrafted", "Official", "Authorised", "Craftsmanship", "Quality"
   - WRONG: "Best prices for luxury phones"
   - CORRECT: "Premium luxury phones from authorised retailers"
   - WRONG: "Best value option"
   - CORRECT: "Premium selection" or "Exclusive collection"

3. Natural SEO - avoid obvious keyword stuffing:
   - Use keywords naturally, not mechanically
   - WRONG: "luxury phone luxury phone luxury phone" (obvious stuffing)
   - CORRECT: "luxury phone" used naturally 2-3 times throughout
   - Vary phrasing: use "premium device", "handcrafted phone", "luxury smartphone" as alternatives
   - Focus on readability first, SEO second

SEO OPTIMISATION REQUIREMENTS (Natural, Not Obvious):
1. KEYWORD OPTIMISATION (Natural Integration):
   - Use "${keyword}" naturally in the main H2 heading, first paragraph, and 2-3 times throughout (natural density)
   - Include semantic variations related to "${keyword}" (e.g., "premium device", "handcrafted phone", "luxury smartphone")
   - Place "${keyword}" in the first sentence of the introduction, but make it feel natural
   - AVOID keyword stuffing - readability and brand image come first
   - Use synonyms and related terms to avoid repetition
   - Example: Instead of repeating "luxury phone" 5 times, use "premium device", "handcrafted phone", "luxury smartphone" as variations

2. CONTENT LENGTH (CRITICAL - Must fit on one screen):
   - Target: 400-600 words MAXIMUM (approximately one screen of content)
   - Every word must add value - no filler content
   - Focus on directly answering the keyword question
   - Be concise but complete - ensure all sections are fully written

3. TITLE & HEADING STRUCTURE:
   - IMPORTANT: Do NOT use H1 tags - the page already has one H1 (the page title)
   - Main heading: Use H2 tag that includes "${keyword}" (50-60 characters ideal)
   - Use 2-3 question-based H2 headings maximum (including the main heading)
   - Each heading must directly relate to the keyword search intent

4. USER INTENT MATCHING (Primary Focus):
   - Directly answer: "What is ${keyword}?" or "Where to buy ${keyword}?" or "How to choose ${keyword}?"
   - Get straight to the point - users want immediate answers
   - Provide clear, actionable information without lengthy explanations
   - Focus on answering the specific question behind "${keyword}"

5. READABILITY & UX (One-Screen Optimisation):
   - Use very short paragraphs (1-2 sentences max)
   - Use numbered lists (3-5 items per list, concise points)
   - Eliminate redundant information
   - Make every sentence count

CONTENT STRUCTURE TEMPLATE (BRIEF, ONE-SCREEN FORMAT - follow this exact structure):

1. MAIN HEADING (use <h2> tag - ONE line only):
   - IMPORTANT: Use H2, NOT H1 (the page already has one H1 for the page title)
   - MUST include "${keyword}" naturally
   - Format: "Where to Buy [Keyword]" or "Complete Guide to [Keyword]" or "Best [Keyword]"
   - 50-60 characters maximum
   - Example: "Where to Buy ${keyword} - Expert Guide"

2. INTRODUCTION PARAGRAPH (use <p> tag - 2 sentences MAXIMUM):
   - First sentence MUST include "${keyword}" with proper articles (a/an/the) and directly answer the search query
   - Second sentence provides key value proposition from knowledge base
   - Be concise, direct, and refined (private butler tone, not salesperson)
   - Use proper grammar: "Looking for a ${keyword}?" or "Considering the ${keyword}?"
   - Example: "Looking for a ${keyword}? VERTU offers [specific benefit] that [value proposition]." (with proper articles)
   - AVOID: "Looking for ${keyword}?" (missing article - sounds unnatural)

3. QUESTION-BASED SUBHEADINGS (use <h2> tags - MAXIMUM 2-3 headings):
   - CRITICAL: Subheadings MUST match the main title's topic and scope
   - If title is about "Purchase Options" → content should ONLY cover payment methods and purchase channels (NOT shipping, warranty, returns)
   - If title is about "Shopping Experience" → content can cover payment, shipping, warranty, returns (comprehensive shopping experience)
   - If title is about "Service Commitment" → content should cover service, warranty, returns, support
   - Use question format that directly relates to "${keyword}" AND matches the title scope
   - Each H2 must include "${keyword}" or clear semantic variation
   - Examples (match title scope):
     * Title: "Where to Buy ${keyword}" → H2: "Official Purchase Channels" or "Authorised Retailers"
     * Title: "Why Shop at VERTU Official?" → H2: "Official Shopping Benefits" or "Exclusive Advantages"
     * Title: "Our Service Commitment" → H2: "Comprehensive Warranty" or "Hassle-Free Returns"
   - Limit to 2-3 headings maximum to keep content brief
   - AVOID expanding beyond the title's scope (e.g., don't add shipping/warranty if title only asks about "purchase options")

4. NUMBERED LISTS UNDER EACH QUESTION (use <ol> with <li> tags):
   - Under each H2, provide ONE concise numbered list (3-5 items maximum)
   - Each list item: ONE clear sentence with specific detail from knowledge base
   - Format: "[Benefit/Feature] - [Specific detail from knowledge base]"
   - Example:
     <h2>Why Choose ${keyword}?</h2>
     <ol>
       <li>[Benefit 1] - [Specific detail from knowledge base]</li>
       <li>[Benefit 2] - [Specific detail from knowledge base]</li>
       <li>[Benefit 3] - [Specific detail from knowledge base]</li>
     </ol>

5. BRIEF SUPPORTING PARAGRAPH (use <p> tag - ONE paragraph after each list, 1-2 sentences):
   - Add ONE short paragraph after each numbered list
   - Connect the points logically
   - Use specific details from knowledge base
   - Keep it brief (1-2 sentences maximum)

6. CONCLUSION PARAGRAPH (use <p> tag - 1-2 sentences MAXIMUM):
   - ONE concise summary sentence with proper articles
   - Reinforce value proposition using knowledge base facts
   - Use refined, understated language (private butler tone)
   - Example: "VERTU offers a ${keyword} with [key benefit from knowledge base] to meet your requirements." (with proper articles, refined tone)
   - AVOID: "VERTU offers ${keyword}..." (missing article) or "Don't miss out on..." (salesperson tone)

CONTENT REQUIREMENTS (BRIEF, ONE-SCREEN, COMPLETE):
- Target: 400-600 words MAXIMUM (must fit on one screen without scrolling)
- Every section MUST be COMPLETE - no incomplete sentences, no cut-off content
- Use concise, factual language (only knowledge base facts)
- Include specific numbers, specifications, and features from knowledge base (but be brief)
- Structure: Introduction → 2-3 Questions → Brief Lists → Short Conclusion
- Make content highly scannable: clear headings, concise numbered lists, very short paragraphs
- Each section must be fully written - ensure all sentences are complete
- Focus on directly answering the keyword question - eliminate unnecessary content
- Use semantic keywords naturally but sparingly (don't over-optimise)

BRAND VOICE & TONE (Private Butler, Not Salesperson):
- Write as a knowledgeable, discreet private butler, not a pushy salesperson
- Tone should be: Professional, Refined, Helpful, Understated, Confident
- AVOID salesperson language:
  * WRONG: "Don't miss out!", "Limited time offer!", "Act now!", "Best deal ever!"
  * WRONG: "You won't believe...", "Amazing value!", "Incredible savings!"
  * WRONG: Exclamation marks everywhere! (use sparingly)
- USE private butler language:
  * CORRECT: "We are pleased to present..." (formal, refined)
  * CORRECT: "Each device is assembled by English master artisans..." (factual, elegant)
  * CORRECT: "The Concierge Service is available 24/7..." (helpful, professional)
  * CORRECT: "Our service commitment includes..." (confident, understated)
- Write with authority and expertise, not desperation
- Focus on facts, craftsmanship, and service - let quality speak for itself
- Use passive voice sparingly - prefer active voice for clarity
- Example transformation:
  * Salesperson: "Get the BEST luxury phone NOW at AMAZING prices! Don't miss out!"
  * Private Butler: "We present a selection of handcrafted luxury phones, each assembled by English master artisans and backed by our comprehensive service commitment."

CRITICAL: TITLE-CONTENT MATCHING REQUIREMENTS:
- The content MUST match the title's scope and topic exactly
- If the page title asks about "Purchase Options" → content should ONLY cover:
  * Payment methods (credit cards, Apple Pay, Google Pay, financing)
  * Purchase channels (online store, authorised retailers, official website)
  * DO NOT include: shipping, warranty, returns (these are separate topics)
- If the page title asks about "Shopping Experience" or "Why Shop Official" → content CAN cover:
  * Payment methods, shipping, warranty, returns (comprehensive shopping experience)
- If the page title asks about "Service Commitment" → content should cover:
  * Warranty, returns, customer service, support
- If the page title asks about "How to Choose" → content should cover:
  * Selection criteria, features to consider, comparison factors
- DO NOT expand beyond the title's scope - stay focused on what the title promises
- Example mismatch to AVOID:
  * Title: "What Purchase Options Are Available?" 
  * Content: Payment methods ✓, Shipping ✗, Warranty ✗, Returns ✗
  * This mismatch confuses users - it's like showing "restaurant decoration" under "Menu"

KNOWLEDGE BASE (CRITICAL - use ONLY this data for ALL product information. This is your ONLY source of truth):
${kbContent}

TRUTHFULNESS REQUIREMENTS:
- ONLY use facts, specifications, prices, materials, and features explicitly stated in the knowledge base above
- If information is NOT in the knowledge base, DO NOT mention it - skip it entirely
- DO NOT make assumptions, inferences, or educated guesses
- DO NOT use external knowledge or general industry information
- If a product detail is missing from the knowledge base, simply omit that detail rather than inventing it
- All product names, prices, specifications, and features MUST match the knowledge base exactly

RELEVANT PRODUCTS FOR THIS KEYWORD "${keyword}" (you MUST focus ONLY on these products - do NOT mention other unrelated products):
${(() => {
  // 构建产品推荐约束
  let productGuidance = "";
  
  // 性别约束
  if (isMenTarget && !isWomenTarget) {
    productGuidance += `- CRITICAL: The title/keyword is about gifts for HUSBANDS/MEN
- You MUST recommend products suitable for MEN/HUSBANDS ONLY
- DO NOT recommend women's products (e.g., women's bags, ladies' accessories, women's jewellery)
- Focus on products that men/husbands would appreciate (phones, watches, men's accessories)\n`;
  } else if (isWomenTarget && !isMenTarget) {
    productGuidance += `- CRITICAL: The title/keyword is about gifts for WIVES/WOMEN
- You MUST recommend products suitable for WOMEN/WIVES ONLY
- DO NOT recommend men's products
- Focus on products that women/wives would appreciate\n`;
  }
  
  // 产品类型约束
  if (isPhoneKeyword) {
    productGuidance += `- CRITICAL: The title/keyword explicitly mentions PHONES/SMARTPHONES
- You MUST recommend PHONE products ONLY (Agent Q, Quantum Flip, Metavertu, etc.)
- DO NOT recommend watches, rings, bags, or other non-phone products
- Focus ONLY on phone-related products from the knowledge base\n`;
  }
  
  if (relevantProducts.length > 0) {
    return productGuidance + relevantProducts.map(p => `- ${p}`).join('\n');
  } else if (keyword.toLowerCase().includes("laptop") || keyword.toLowerCase().includes("notebook") || keyword.toLowerCase().includes("computer") || keyword.toLowerCase().includes("pc")) {
    return productGuidance + `- Focus on VERTU brand and luxury technology products relevant to "${keyword}"
- If "${keyword}" relates to laptops/notebooks/computers, discuss VERTU's approach to luxury technology, craftsmanship, and premium devices
- Do NOT mention specific product names unless they are directly related to "${keyword}"
- Keep content general and relevant to the keyword, focusing on VERTU's brand values and luxury technology positioning`;
  } else if (keyword.toLowerCase().includes("watch") || keyword.toLowerCase().includes("timepiece") || keyword.toLowerCase().includes("horology") || keyword.toLowerCase().includes("chronograph")) {
    return productGuidance + `- CRITICAL: The keyword "${keyword}" is about WATCHES/TIMEPIECES
- You MUST write about watches (Grand Watch, Metawatch) ONLY
- DO NOT mention phones (Agent Q, Quantum Flip, Metavertu, etc.) - they are NOT relevant to "${keyword}"
- DO NOT mention rings, earbuds, or other product categories
- Focus ONLY on watch-related products and features from the knowledge base`;
  } else if (keyword.toLowerCase().includes("ring") || keyword.toLowerCase().includes("jewellery") || keyword.toLowerCase().includes("jewelry")) {
    return productGuidance + `- CRITICAL: The keyword "${keyword}" is about RINGS/JEWELLERY
- You MUST write about rings (Meta Ring, AI Diamond Ring, AI Meta Ring) ONLY
- DO NOT mention phones, watches, earbuds, or other product categories
- Focus ONLY on ring-related products and features from the knowledge base`;
  } else if (keyword.toLowerCase().includes("earbud") || keyword.toLowerCase().includes("earphone") || keyword.toLowerCase().includes("audio")) {
    return productGuidance + `- CRITICAL: The keyword "${keyword}" is about EARBUDS/AUDIO
- You MUST write about earbuds (Phantom Earbuds, OWS Earbuds) ONLY
- DO NOT mention phones, watches, rings, or other product categories
- Focus ONLY on earbud-related products and features from the knowledge base`;
  } else {
    return productGuidance + `- Focus on VERTU brand and general luxury mobile phone features relevant to "${keyword}"
- Do NOT mention specific product names unless they are directly related to "${keyword}"
- Keep content general and relevant to the keyword only`;
  }
})()}

AUTHORISED PRODUCT NAMES (complete list - for reference only, but you MUST focus on relevant products above):
${knownProducts.map(p => `- ${p}`).join('\n')}

ABSOLUTE PROHIBITIONS:
- DO NOT mention any product names that are NOT directly related to "${keyword}"
- DO NOT mention products from the authorised list if they are NOT relevant to "${keyword}"
- DO NOT include unrelated product information just to fill content
- DO NOT invent specifications, prices, materials, or features
- DO NOT use external knowledge or general industry information
- DO NOT fabricate product comparisons or features
- If a product is not in the knowledge base, do NOT mention it at all
- If information is missing from the knowledge base, skip it entirely rather than making assumptions
- CRITICAL: If keyword is about "watches" → DO NOT mention phones, rings, earbuds
- CRITICAL: If keyword is about "phones" → DO NOT mention watches, rings, earbuds
- CRITICAL: If keyword is about "rings" → DO NOT mention phones, watches, earbuds
- CRITICAL: If keyword is about "earbuds" → DO NOT mention phones, watches, rings
- This is a SEVERE SEO violation if content topic does not match keyword topic

CONTENT ENRICHMENT GUIDELINES:
- Use the knowledge base data extensively to create rich, detailed descriptions
- Quote specific numbers, measurements, and technical details from the knowledge base
- Reference actual features, materials, and services mentioned in the knowledge base
- Create engaging narratives around the verified facts from the knowledge base
- Use varied sentence structures and descriptive language while staying factual
- Connect different aspects of the knowledge base to create comprehensive content
- Only include knowledge base facts that are directly relevant to the title intent; drop anything that feels off-topic or forced.

OUTPUT FORMAT (${isLongFormTemplate ? "COMPREHENSIVE" : "BRIEF"}, COMPLETE, SEO-Optimised HTML):
- Output only valid HTML with proper semantic structure
- IMPORTANT: Do NOT use <h1> tags - the page already has one H1 (the page title)
- Use semantic HTML tags: <h2> (for main heading and subheadings), <p>, <ol>, <li>
- Ensure proper nesting and closing tags
- Do NOT include <html>, <head>, or <body> tags (just the content fragment)
- Do NOT add markdown code blocks (\`\`\`html, \`\`\`, etc.)
- Do NOT include any explanatory text outside the HTML
- Do NOT include Chinese characters
- CRITICAL: Every sentence MUST be complete - no incomplete thoughts, no cut-off content
- CRITICAL: Every section MUST be fully written - all paragraphs, lists, and headings must be complete
- CRITICAL: Every sentence MUST use proper articles (a/an/the) - this is essential for natural English
- CRITICAL: Use refined, professional tone (private butler, not salesperson) - avoid cheap-sounding words
- Ensure the main H2 heading includes "${keyword}" naturally
- Use H2 tags for all headings (main heading and question-based subheadings)
- Keep HTML clean and semantic for better SEO crawling
- Total content must be at least ${currentMinLength} characters${isLongFormTemplate ? " (no strict upper limit for templates 3/4/5; provide as much factual, title-aligned detail as needed)" : ` and no more than ${currentMaxLength} characters (one screen)`}

EXAMPLE OUTPUT STRUCTURE (BRIEF, ONE-SCREEN FORMAT - WITH PROPER GRAMMAR AND REFINED TONE):
<h2>Where to Buy a ${keyword} - Expert Guide</h2>
<p>Looking for a ${keyword}? VERTU offers [specific benefit from knowledge base] that [value proposition].</p>

<h2>Why Choose a ${keyword}?</h2>
<ol>
  <li>[Benefit 1] - [Specific detail from knowledge base with proper articles]</li>
  <li>[Benefit 2] - [Specific detail from knowledge base with proper articles]</li>
  <li>[Benefit 3] - [Specific detail from knowledge base with proper articles]</li>
</ol>
<p>[One brief sentence connecting the benefits - refined, professional tone]</p>

<h2>What Makes a ${keyword} Different?</h2>
<ol>
  <li>[Unique feature 1] - [Specific detail from knowledge base with proper articles]</li>
  <li>[Unique feature 2] - [Specific detail from knowledge base with proper articles]</li>
  <li>[Unique feature 3] - [Specific detail from knowledge base with proper articles]</li>
</ol>
<p>[One brief sentence with context - refined, professional tone]</p>

<p>[One concise conclusion sentence reinforcing value proposition - with proper articles and refined tone]</p>

NOTE: Notice the proper use of articles (a/an/the) throughout, and the refined, professional tone (private butler, not salesperson).

IMPORTANT: 
${isLongFormTemplate ? "- No hard word limit: prioritise depth, completeness, and factual richness while staying tightly aligned to the title and keyword\n- Aim to cover the topic thoroughly so readers do not need to look elsewhere" : "- Keep total word count between 400-600 words"}
- Every sentence must be complete
- No incomplete thoughts or cut-off content
- Focus on directly answering the keyword question`;

  // 生成FAQ内容的提示词（SEO优化版本）
  const faqPrompt = `You are an expert SEO strategist and user experience specialist. Generate EXACTLY 6 highly relevant, keyword-focused FAQ items in British English for the search query "${keyword}".

CRITICAL REQUIREMENTS:
- You MUST generate EXACTLY 6 FAQ items (no more, no less)
- You MUST write in British English (UK English) only
- You MUST NOT include any Chinese characters, words, or phrases
- Each FAQ must directly address real user search intent related to "${keyword}"
- Questions should be natural, conversational, and match how users actually search
- Answers must be comprehensive (2-4 sentences), factual, and directly answer the question
- AVOID generic, template-like questions - make each FAQ specific to "${keyword}"

SEO & USER INTENT ANALYSIS FOR "${keyword}":
Think about what users are REALLY asking when they search for "${keyword}":
1. What is the user's primary intent? (Information, Purchase, Comparison, How-to, etc.)
2. What specific questions would they have about "${keyword}"?
3. What concerns or doubts might they have?
4. What information gaps need to be filled?
5. What would make them confident to take action?

${titleType ? `FAQ FOCUS BY TITLE TYPE (${titleType}):
${(() => {
  const faqFocusMap: Record<string, string> = {
    "purchase": `- Focus on PURCHASE-RELATED questions: "Where to buy ${keyword}?", "What is the price of ${keyword}?", "Are there deals on ${keyword}?", "How to purchase ${keyword}?", "What payment options are available for ${keyword}?"
- Emphasise buying process, pricing, deals, and purchase locations
- Include questions about discounts, special offers, and value propositions`,
    
    "informational": `- Focus on INFORMATION-RELATED questions: "What is ${keyword}?", "What are the features of ${keyword}?", "How does ${keyword} work?", "What are the benefits of ${keyword}?"
- Emphasise comprehensive information, features, and detailed explanations
- Include questions about specifications, capabilities, and use cases`,
    
    "review": `- Focus on REVIEW/COMPARISON questions: "Is ${keyword} worth it?", "What are the pros and cons of ${keyword}?", "How does ${keyword} compare to alternatives?", "What are users saying about ${keyword}?"
- Emphasise ratings, comparisons, pros/cons, and evaluations
- Include questions about quality, performance, and user experience`,
    
    "commercial": `- Focus on DEAL/PRICING questions: "Are there discounts on ${keyword}?", "What are the best deals for ${keyword}?", "Is ${keyword} on sale?", "What special offers are available for ${keyword}?"
- Emphasise deals, discounts, special offers, and pricing
- Include questions about savings, promotions, and value`,
    
    "how-to": `- Focus on HOW-TO/SELECTION questions: "How to choose ${keyword}?", "How to select the best ${keyword}?", "How to use ${keyword}?", "What to consider when buying ${keyword}?"
- Emphasise step-by-step guidance, selection criteria, and practical advice
- Include questions about choosing, using, and selecting`,
    
    "recommendations": `- Focus on RECOMMENDATION questions: "What are the best ${keyword} options?", "Which ${keyword} is recommended?", "What are top-rated ${keyword}?", "What do experts recommend for ${keyword}?"
- Emphasise top picks, recommended options, and expert suggestions
- Include questions about quality, reliability, and expert opinions`,
    
    "services-guides": `- Focus on USAGE/SERVICE questions: "How to use ${keyword}?", "What services are included with ${keyword}?", "How does ${keyword} service work?", "What support is available for ${keyword}?"
- Emphasise usage, operation, service features, and user guides
- Include questions about functionality, services, and support`,
    
    "tech-insights": `- Focus on TECHNICAL/COMPARISON questions: "What are the technical features of ${keyword}?", "How does ${keyword} compare technically?", "What technology does ${keyword} use?", "What are the technical specifications of ${keyword}?"
- Emphasise technical comparisons, features, and technology analysis
- Include questions about specifications, technology, and technical details`,
    
    "comparison": `- Focus on COMPARISON questions: "How does ${keyword} compare to alternatives?", "What is the difference between ${keyword} and [alternative]}?", "Which is better: ${keyword} or [alternative]?", "What are the advantages of ${keyword} over competitors?"
- Emphasise comparisons, alternatives, and side-by-side evaluations
- Include questions about differences, similarities, and relative advantages`,
    
    "expert": `- Focus on EXPERT/ANALYSIS questions: "What do experts say about ${keyword}?", "What is the expert opinion on ${keyword}?", "What is the professional analysis of ${keyword}?", "What are expert recommendations for ${keyword}?"
- Emphasise expert analysis, professional insights, and authoritative opinions
- Include questions about expert evaluations, professional reviews, and detailed assessments`,
    
    "best": `- Focus on BEST/QUALITY questions: "What is the best ${keyword}?", "What are the best features of ${keyword}?", "What makes ${keyword} the best choice?", "What are the best-rated ${keyword}?"
- Emphasise best options, quality, and top choices
- Include questions about quality, value, and superior options`,
    
    "top": `- Focus on TOP/PREMIUM questions: "What are the top ${keyword}?", "What are top-rated ${keyword}?", "What makes ${keyword} a top choice?", "What are the top features of ${keyword}?"
- Emphasise top-rated, premium choices, and high-quality options
- Include questions about top-tier selections, premium quality, and high ratings`,
    
    "top-ranking": `- Focus on RANKING/LIST questions: "What are the top 10 ${keyword}?", "What is the ranking of ${keyword}?", "What are the top-ranked ${keyword}?", "What is the top ${keyword} list?", "Which ${keyword} ranks highest?"
- Emphasise rankings, numbered lists, and comparative positions
- Include questions about top 10/top 5 lists, ranking positions, and comparative rankings
- Use ranking-focused language: "Top 10", "Top 5", "Ranking", "Top List", "Ranked"`,
    
    "most": `- Focus on MOST/POPULAR questions: "What are the most popular ${keyword}?", "What are the most recommended ${keyword}?", "What are the most trusted ${keyword}?", "What makes ${keyword} the most popular choice?"
- Emphasise most popular, most recommended, and most trusted options
- Include questions about popularity, recommendations, and trusted choices`,
  };
  
  return faqFocusMap[titleType] || "";
})()}
` : ""}

FAQ STRUCTURE (MUST FOLLOW THIS EXACT ORDER):

1. FIRST 3 FAQ ITEMS: Keyword-Specific, High-Value Questions
   These MUST be directly related to "${keyword}" and address real user search intent:
   
   - Question 1: Should address the PRIMARY user intent (e.g., "What is ${keyword}?", "How does ${keyword} work?", "Where can I buy ${keyword}?")
   - Question 2: Should address SPECIFIC features, benefits, or concerns related to "${keyword}" (e.g., "What makes ${keyword} different?", "What should I consider when choosing ${keyword}?", "Is ${keyword} worth it?")
   - Question 3: Should address a DEEPER user concern or decision-making factor (e.g., "How to choose the best ${keyword}?", "What are the key features of ${keyword}?", "Why choose ${keyword} over alternatives?")
   
   CRITICAL for first 3 FAQs:
   - Use SPECIFIC information from the knowledge base about products relevant to "${keyword}"
   - Include actual product names, features, specifications, or benefits from the knowledge base
   - Reference specific details like materials, prices, features, or services when available
   - Make answers concrete and factual - avoid vague statements
   - If "${keyword}" relates to a specific product, mention that product by name with accurate details
   - If "${keyword}" is general, focus on VERTU's approach to that category with specific examples

2. LAST 3 FAQ ITEMS: General Shopping/Payment/Shipping/Return Questions
   Select 3 DIFFERENT questions from the "GLOBAL SHOPPING / PAYMENT / SHIPPING / RETURN FAQ" section in the knowledge base
   - Use the EXACT questions and answers from the knowledge base
   - Do NOT modify or invent information
   - Choose diverse categories (e.g., one Shopping, one Payment, one Shipping/Return)

KNOWLEDGE BASE (YOUR ONLY SOURCE OF TRUTH - use ONLY this data):
${kbContent}

RELEVANT PRODUCTS FOR KEYWORD "${keyword}" (use these in the first 3 FAQs when relevant):
${relevantProducts.length > 0 
  ? relevantProducts.map(p => `- ${p}`).join('\n')
  : `- Focus on VERTU brand and luxury technology products relevant to "${keyword}"
- Use specific product examples from the knowledge base when discussing "${keyword}"`}

AUTHORISED PRODUCT NAMES (complete list - only mention if relevant to "${keyword}"):
${knownProducts.map(p => `- ${p}`).join('\n')}

FAQ GENERATION GUIDELINES (SEO & UX Best Practices):

For Keyword-Specific FAQs (First 3):
1. Question Format:
   - Use natural, conversational language (how users actually ask)
   - Include "${keyword}" naturally in the question
   - Make questions specific, not generic
   - Examples of GOOD questions:
     * "What is ${keyword} and what makes it special?"
     * "How do I choose the best ${keyword} for my needs?"
     * "What features should I look for in ${keyword}?"
   - Examples of BAD questions (too generic):
     * "What is a phone?" (too generic)
     * "How to buy products?" (not keyword-specific)

2. Answer Format:
   - Start with a direct answer to the question
   - Include SPECIFIC details from the knowledge base (product names, features, prices, materials, etc.)
   - Reference actual products when relevant to "${keyword}"
   - Provide actionable information
   - End with value proposition or next step
   - Minimum 2 sentences, maximum 4 sentences

3. SEO Optimization:
   - Naturally include "${keyword}" and semantic variations in answers
   - Use long-tail keyword variations when appropriate
   - Include related product names when relevant
   - Make content scannable and informative

ABSOLUTE PROHIBITIONS:
- Do NOT invent specs, features, prices, or product names not in the knowledge base
- Do NOT use generic, template-like questions that could apply to any keyword
- Do NOT mention products that are NOT relevant to "${keyword}" in the first 3 FAQs
- Do NOT use external knowledge or general industry information
- Do NOT create vague or generic answers - be specific and factual
- For the LAST 3 FAQs, use ONLY the exact questions and answers from the knowledge base's FAQ section
- Do NOT combine or modify the general FAQ answers

TRUTHFULNESS REQUIREMENTS:
- ALL information MUST come from the knowledge base provided above
- For keyword-related FAQs (first 3), use SPECIFIC product information relevant to "${keyword}"
- Include actual product names, features, specifications, prices, or materials when available
- If "${keyword}" matches a specific product, provide detailed, accurate information about that product
- If information is missing from the knowledge base, focus on what IS available rather than making assumptions
- For general FAQs (last 3), use ONLY the exact content from "GLOBAL SHOPPING / PAYMENT / SHIPPING / RETURN FAQ" section

Return in JSON format only:
{
  "faq": [
    {"question": "Specific question about ${keyword} addressing primary user intent", "answer": "Detailed answer with specific information from knowledge base (2-4 sentences)"},
    {"question": "Specific question about ${keyword} addressing features/benefits/concerns", "answer": "Detailed answer with specific information from knowledge base (2-4 sentences)"},
    {"question": "Specific question about ${keyword} addressing deeper concerns/decision factors", "answer": "Detailed answer with specific information from knowledge base (2-4 sentences)"},
    {"question": "EXACT question from knowledge base Shopping/Payment/Shipping/Return FAQ", "answer": "EXACT answer from knowledge base FAQ section"},
    {"question": "EXACT question from knowledge base Shopping/Payment/Shipping/Return FAQ", "answer": "EXACT answer from knowledge base FAQ section"},
    {"question": "EXACT question from knowledge base Shopping/Payment/Shipping/Return FAQ", "answer": "EXACT answer from knowledge base FAQ section"}
  ]
}

Output only the JSON, no additional text or Chinese characters.`;

  try {
    // 1. 生成文章内容（带质量检测，必要时重试一次）
    console.log(`[GoogleAI] Generating article content...`);
    let articleText = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const promptToUse =
        attempt === 1
          ? articlePrompt
          : `${articlePrompt}

The previous attempt was incomplete, too long, or did not follow the required BRIEF, ONE-SCREEN structure. You MUST:
1. IMPORTANT: Do NOT use <h1> tags - use <h2> for the main heading (the page already has one H1)
2. Include a main <h2> heading at the start that includes "${keyword}" naturally (ONE line only)
3. Add a BRIEF introduction paragraph (2 sentences MAX) that includes "${keyword}" in the first sentence
4. Use 2-3 question-format subheadings (<h2> tags with question marks) that include "${keyword}" or semantic variations
4. Include ONE concise numbered list (<ol> with 3-5 <li> items) under each question heading
5. Add ONE brief supporting paragraph (1-2 sentences) after each numbered list
6. Include a BRIEF conclusion paragraph (1-2 sentences) at the end
7. Keep content between ${currentMinLength} and ${currentMaxLength} characters${isTemplate3 ? " (no strict limit for template-3)" : " (ONE SCREEN MAXIMUM)"}
8. Ensure ALL content is COMPLETE - no incomplete sentences, no cut-off content
9. Use specific numbers, specifications, and features from the knowledge base ONLY (but be concise)
10. Focus on directly answering the keyword question - eliminate unnecessary content
11. Every sentence must be complete and add value - no filler content`;

      const articleResult = await requestWithRetry(() => model.generateContent(promptToUse), "article.generateContent");
      const articleResponse = await articleResult.response;
      articleText = articleResponse.text() || "";

      if (!articleText.trim()) {
        console.warn(`[GoogleAI] Attempt ${attempt} returned empty content.`);
        continue;
      }

      // 验证生成的文章内容是否包含中文
      validateContent(articleText, "article content");

      // 验证SEO要求：主H2标题和第一段应包含关键词
      // 检查是否有H1标签（不应该有）
      const h1Match = articleText.match(/<h1[^>]*>/i);
      if (h1Match) {
        console.warn(`[GoogleAI] ⚠️ Article contains H1 tag - this should be H2. The page already has one H1 (the page title).`);
      }
      
      // 检查主H2标题（第一个H2）
      const h2Matches = articleText.match(/<h2[^>]*>([\s\S]*?)<\/h2>/gi);
      const firstH2Match = h2Matches ? articleText.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) : null;
      const firstParagraphMatch = articleText.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
      
      if (firstH2Match && !firstH2Match[1].toLowerCase().includes(keyword.toLowerCase())) {
        console.warn(`[GoogleAI] Main H2 heading does not include keyword "${keyword}". H2 content: ${firstH2Match[1].substring(0, 100)}`);
      }
      
      if (firstParagraphMatch && !firstParagraphMatch[1].toLowerCase().includes(keyword.toLowerCase())) {
        console.warn(`[GoogleAI] First paragraph does not include keyword "${keyword}". First paragraph: ${firstParagraphMatch[1].substring(0, 100)}`);
      }

      // 验证标题和内容匹配（如果提供了pageTitle）
      if (pageTitle && pageTitle.trim()) {
        const titleLower = pageTitle.toLowerCase();
        const contentLower = articleText.toLowerCase();
        
        // 检查标题范围匹配
        // 如果标题问的是"Purchase Options"，内容应该只讲购买相关，不应该讲物流、保修、退换货
        if (titleLower.includes("purchase option") || titleLower.includes("payment method") || titleLower.includes("how to pay")) {
          const hasShipping = contentLower.includes("shipping") || contentLower.includes("delivery") || contentLower.includes("logistics");
          const hasWarranty = contentLower.includes("warranty") || contentLower.includes("guarantee");
          const hasReturns = contentLower.includes("return") || contentLower.includes("exchange") || contentLower.includes("refund");
          
          if (hasShipping || hasWarranty || hasReturns) {
            console.warn(`[GoogleAI] ⚠️ Title-Content Mismatch: Title asks about "Purchase Options" but content includes shipping/warranty/returns. Title scope: purchase/payment only.`);
          }
        }
        
        // 如果标题问的是"Shopping Experience"或"Why Shop Official"，内容可以包含所有方面
        if (titleLower.includes("shopping experience") || titleLower.includes("why shop") || titleLower.includes("service commitment")) {
          // 这些标题允许涵盖全面的购物体验，包括支付、物流、保修、退换货
          console.log(`[GoogleAI] ✅ Title scope allows comprehensive shopping experience content.`);
        }
      }

      if (isArticleRich(articleText, templateType)) {
        break;
      }

      console.warn(
        `[GoogleAI] Attempt ${attempt} article is below quality threshold (length/headings/paragraphs).`
      );

      if (attempt === 2 && !isArticleRich(articleText, templateType)) {
        console.warn(`[GoogleAI] Using best-effort article despite failing quality checks.`);
      }
    }

    if (!articleText || !articleText.trim()) {
      throw new Error("Google AI Studio API did not return article content");
    }

    // 清理文章内容中的 markdown 代码块标记（如 ```html, ```, ```json 等）
    // 移除所有可能的代码块标记变体
    articleText = articleText
      .replace(/```html\s*/gi, "")
      .replace(/```HTML\s*/gi, "")
      .replace(/```json\s*/gi, "")
      .replace(/```JSON\s*/gi, "")
      .replace(/```markdown\s*/gi, "")
      .replace(/```md\s*/gi, "")
      .replace(/```\s*/g, "") // 移除所有剩余的 ```
      .replace(/^```|```$/gm, "") // 移除行首行尾的 ```
      .trim();
    
    // 将任何H1标签替换为H2（确保页面只有一个H1，即页面标题）
    articleText = articleText
      .replace(/<h1([^>]*)>/gi, "<h2$1>")
      .replace(/<\/h1>/gi, "</h2>");

    // 验证内容长度（确保不超过一屏）
    const plainTextLength = stripHtmlTags(articleText).replace(/\s+/g, " ").trim().length;
    if (!isTemplate3 && plainTextLength > currentMaxLength) {
      console.warn(`[GoogleAI] ⚠️ 内容过长 (${plainTextLength} 字符)，超过一屏限制 (${currentMaxLength} 字符)`);
      console.warn(`[GoogleAI] 提示：内容需要精简，确保不超过一屏`);
    } else if (isTemplate3) {
      console.log(`[GoogleAI] ✅ 模板3：内容长度 ${plainTextLength} 字符（无字数限制）`);
    }
    
    // 检查内容是否完整（没有未完成的句子）
    const hasIncompleteContent = /\b(and|or|but|however|although|because|since|when|where|which|that)\s*$/i.test(
      stripHtmlTags(articleText).trim()
    );
    if (hasIncompleteContent) {
      console.warn(`[GoogleAI] ⚠️ 检测到可能未完成的内容（以连接词结尾）`);
    }

    // 在两次请求之间添加延迟，避免频率过高
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 2. 生成FAQ内容
    console.log(`[GoogleAI] Generating FAQ content...`);
    let faqItems: Array<{ question: string; answer: string }> = [];
    
    try {
      // 创建 FAQ 模型实例（使用较高的 temperature 以生成更多样化、更相关的FAQ）
      const faqModel = genAI.getGenerativeModel({
        model: modelName, // 使用相同的模型（优先 Key 使用 gemini-3-pro-preview）
        generationConfig: {
          temperature: 0.9, // 提高温度以生成更多样化、更自然的FAQ
          topP: 0.95,
          topK: 40,
          maxOutputTokens: 2048, // 增加输出长度以支持更详细的FAQ答案
        },
      });

      const faqResult = await faqModel.generateContent(faqPrompt);
      const faqResponse = await faqResult.response;
      const faqText = faqResponse.text();

      if (faqText) {
        try {
          // 尝试解析JSON，可能包含markdown代码块
          const cleanedText = faqText.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const faqData = JSON.parse(cleanedText);
          faqItems = faqData.faq || faqData || [];
          
          // 验证 FAQ 内容是否包含中文
          faqItems.forEach((item: any, index: number) => {
            if (item.question && containsChinese(item.question)) {
              console.warn(`[GoogleAI] WARNING: FAQ question ${index + 1} contains Chinese characters.`);
            }
            if (item.answer && containsChinese(item.answer)) {
              console.warn(`[GoogleAI] WARNING: FAQ answer ${index + 1} contains Chinese characters.`);
            }
          });
        } catch (parseError) {
          console.warn("[GoogleAI] Failed to parse FAQ JSON, using fallback:", parseError);
          // 如果解析失败，尝试从文本中提取
          faqItems = extractFAQFromText(faqText);
        }
      }
      
      // 验证提取的 FAQ 文本是否包含中文
      if (faqText) {
        validateContent(faqText, "FAQ text");
      }
    } catch (faqError) {
      console.warn(`[GoogleAI] FAQ generation failed, using fallback FAQ:`, faqError);
      // FAQ 失败不影响整体，使用备用 FAQ
    }

    // 确保有 6 个 FAQ（前3条关键词相关，后3条通用FAQ）
    const TARGET_FAQ_COUNT = 6;
    let finalFaqItems = faqItems.length > 0 ? faqItems : [];
    
    // 如果 FAQ 少于 6 个，补充到 6 个
    if (finalFaqItems.length < TARGET_FAQ_COUNT) {
      console.log(`[GoogleAI] FAQ items (${finalFaqItems.length}) are less than ${TARGET_FAQ_COUNT}, generating additional FAQs...`);
      
      // 分离关键词相关FAQ和通用FAQ
      const keywordRelatedFaqs = finalFaqItems.filter((_, index) => index < 3);
      const generalFaqs = finalFaqItems.filter((_, index) => index >= 3);
      
      // 补充关键词相关FAQ（前3条）
      if (keywordRelatedFaqs.length < 3) {
        const fallbackKeywordFaqs = generateFallbackKeywordFAQ(keyword);
        const needed = 3 - keywordRelatedFaqs.length;
        const existingQuestions = new Set(keywordRelatedFaqs.map(f => f.question.toLowerCase()));
        const additionalKeywordFaqs = fallbackKeywordFaqs
          .filter(f => !existingQuestions.has(f.question.toLowerCase()))
          .slice(0, needed);
        keywordRelatedFaqs.push(...additionalKeywordFaqs);
      }
      
      // 补充通用FAQ（后3条）
      if (generalFaqs.length < 3) {
        const generalFaqTemplates = getGeneralFAQFromKnowledgeBase();
        const needed = 3 - generalFaqs.length;
        const existingQuestions = new Set(generalFaqs.map(f => f.question.toLowerCase()));
        const additionalGeneralFaqs = generalFaqTemplates
          .filter(f => !existingQuestions.has(f.question.toLowerCase()))
          .slice(0, needed);
        generalFaqs.push(...additionalGeneralFaqs);
      }
      
      // 合并：前3条关键词相关 + 后3条通用FAQ
      finalFaqItems = [
        ...keywordRelatedFaqs.slice(0, 3),
        ...generalFaqs.slice(0, 3)
      ];
      
      console.log(`[GoogleAI] Final FAQ items count: ${finalFaqItems.length} (${keywordRelatedFaqs.slice(0, 3).length} keyword-related + ${generalFaqs.slice(0, 3).length} general)`);
    }
    
    // 最终清理：确保没有任何 markdown 代码块标记残留
    let finalArticleContent = articleText
      .replace(/```[a-z]*\s*/gi, "") // 移除所有 ```language 格式
      .replace(/```\s*/g, "") // 移除所有剩余的 ```
      .trim();

    // 如果内容尾部没有句号/问号/感叹号，补一段收束句，避免被截断
    if (!/[.!?]\s*<\/p>\s*$/.test(finalArticleContent) && !/[.!?]\s*$/.test(finalArticleContent)) {
      const closing = pageTitle && pageTitle.trim().length > 0
        ? `This guide provides a complete view of ${pageTitle}, helping you make an informed decision.`
        : `This guide provides a complete view of ${keyword}, helping you make an informed decision.`;
      finalArticleContent = `${finalArticleContent}<p>${closing}</p>`;
    }

    // 验证生成的内容是否包含知识库外的产品信息
    validateContentAgainstKnowledgeBase(finalArticleContent, knownProducts, "article content");
    
    // 验证内容主题是否与关键词/标题匹配（SEO关键验证）
    validateContentTopicMatch(finalArticleContent, keyword, pageTitle, "article content");
    
    // 验证内容中的年份信息是否准确（避免过时年份）
    validateYearAccuracy(finalArticleContent, currentYear, "article content");
    
    // 验证内容是否包含与关键词无关的产品
    if (relevantProducts.length > 0) {
      validateContentRelevance(finalArticleContent, relevantProducts, keyword, "article content");
      finalFaqItems.forEach((item, index) => {
        validateContentRelevance(item.answer, relevantProducts, keyword, `FAQ answer ${index + 1}`);
      });
    }
    
    finalFaqItems.forEach((item, index) => {
      validateContentAgainstKnowledgeBase(item.answer, knownProducts, `FAQ answer ${index + 1}`);
    });
    
    // 验证FAQ与关键词的相关性（特别是前3个FAQ）
    const keywordLower = keyword.toLowerCase();
    finalFaqItems.slice(0, 3).forEach((item, index) => {
      const questionLower = item.question.toLowerCase();
      const answerLower = item.answer.toLowerCase();
      
      // 检查问题是否包含关键词或相关词汇
      const questionRelevant = questionLower.includes(keywordLower) || 
                               keywordLower.split(' ').some(word => word.length > 3 && questionLower.includes(word));
      
      // 检查答案是否包含关键词或相关产品信息
      const answerRelevant = answerLower.includes(keywordLower) || 
                            keywordLower.split(' ').some(word => word.length > 3 && answerLower.includes(word)) ||
                            (relevantProducts.length > 0 && relevantProducts.some(p => answerLower.includes(p.toLowerCase())));
      
      if (!questionRelevant && !answerRelevant) {
        console.warn(`[GoogleAI] ⚠️ FAQ ${index + 1} may not be relevant to keyword "${keyword}". Question: "${item.question.substring(0, 80)}..."`);
      }
      
      // 检查是否过于模板化（包含通用词汇）
      const genericPhrases = ['many people', 'various benefits', 'different options', 'general information', 'comprehensive guide'];
      const isGeneric = genericPhrases.some(phrase => answerLower.includes(phrase));
      if (isGeneric) {
        console.warn(`[GoogleAI] ⚠️ FAQ ${index + 1} may be too generic/template-like. Consider making it more specific to "${keyword}".`);
      }
    });

    // 生成页面描述（用于模板2、模板3、模板4和模板5，生成完整的描述段落）
    let pageDescription = "";
    const needsFullDescription = templateType === "template-2" || templateType === "template-3" || templateType === "template-4" || templateType === "template-5";
    
    if (needsFullDescription) {
      try {
        console.log(`[GoogleAI] Generating comprehensive page description for ${templateType}...`);
        // 模板4和模板5需要更长的描述（400-600字符），其他模板保持200-300字符
        const targetMinLength = isTemplate4Or5 ? 400 : 200;
        const targetMaxLength = isTemplate4Or5 ? 600 : 300;
        const maxOutputTokens = isTemplate4Or5 ? 600 : 300;
        const sentenceCount = isTemplate4Or5 ? "6-8 sentences" : "3-5 sentences";
        
        const descModel = genAI.getGenerativeModel({
          model: modelName, // 使用相同的模型（优先 Key 使用 gemini-3-pro-preview）
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: maxOutputTokens,
          },
        });
        
        const descPrompt = `You are an expert SEO content writer and user engagement specialist. Write a COMPREHENSIVE, DETAILED description paragraph (${sentenceCount}, ${targetMinLength}-${targetMaxLength} characters) for a page about "${keyword}" with title "${pageTitle}".

CRITICAL REQUIREMENTS:
- You MUST write in British English (UK English) ONLY - this is non-negotiable
- You MUST NOT include any Chinese characters, words, or phrases
- You MUST NOT use American English spelling, grammar, or vocabulary
- Use British English spelling: "colour", "realise", "centre", "organise", "customise", "optimise", "recognise", "favour", "behaviour", "honour", "labour", "defence", "travelling", "cancelled", "labelled", "modelling", "programme", "cheque", "tyre", "aluminium", "sulphur", "grey", "whilst", "amongst"
- Use British vocabulary: "mobile phone" NOT "cell phone", "shop" NOT "store", "lift" NOT "elevator", "flat" NOT "apartment", "petrol" NOT "gas", "pavement" NOT "sidewalk", "trousers" NOT "pants", "biscuit" NOT "cookie", "crisps" NOT "chips", "post" NOT "mail", "queue" NOT "line", "holiday" NOT "vacation", "autumn" NOT "fall", "rubbish" NOT "trash", "bin" NOT "trash can", "car park" NOT "parking lot", "motorway" NOT "highway", "roundabout" NOT "traffic circle", "chemist" NOT "pharmacy", "high street" NOT "main street"
- Write a COMPLETE, DETAILED paragraph (${sentenceCount}), NOT just 2-3 sentences
- The description MUST be STRONGLY RELATED to the page title "${pageTitle}" - extract key concepts, themes, and value propositions from the title
- The description should be comprehensive, informative, and provide substantial value to readers
- Include the keyword "${keyword}" naturally in the first sentence
- Extract and incorporate key terms from the title "${pageTitle}" throughout the description
- Provide detailed value propositions, benefits, and unique selling points
- Mention specific features, advantages, or insights from the knowledge base
- Include relevant context, use cases, or applications
- Be engaging, compelling, and persuasive
- NO HTML tags, just plain text

SEO & USER RETENTION OBJECTIVES:
- Hook readers immediately with a compelling opening that directly addresses their search intent
- Build trust and credibility by demonstrating deep knowledge and expertise
- Create curiosity and interest to encourage users to continue reading the full page
- Use natural language that matches how users search and think about "${keyword}"
- Include semantic variations and related terms to improve SEO relevance
- Address potential user questions or concerns implicitly
- Create a sense of value and urgency that motivates continued engagement
- Use persuasive language that highlights unique benefits and differentiators

DESCRIPTION STRUCTURE (${sentenceCount}):
1. First sentence: Introduce the topic with the keyword "${keyword}" and directly reference the title "${pageTitle}" - establish strong connection and hook the reader
2. Second sentence: Extract key themes from the title and highlight primary value propositions that address user needs
3. Third sentence: Provide detailed benefits or features related to the title's focus, emphasising what makes this valuable
4. Fourth sentence: Expand on specific advantages, use cases, or applications mentioned in or implied by the title
5. Fifth sentence: Add additional context, insights, or details that strengthen the connection to the title and build credibility
${isTemplate4Or5 ? `6. Sixth sentence: Provide more depth on specific aspects relevant to the title, addressing potential user questions
7. Seventh sentence: Mention practical considerations, expert insights, or unique differentiators that create value
8. Eighth sentence (optional): Conclude with a compelling summary that reinforces the title's value proposition and encourages engagement` : `6. Sixth sentence (optional): Conclude with a compelling call-to-action or summary that encourages continued reading`}

TITLE ANALYSIS:
- Analyze the page title: "${pageTitle}"
- Identify key concepts: ${pageTitle.split(' ').filter(w => w.length > 3).slice(0, 5).join(', ')}
- Extract value propositions from the title
- Ensure every sentence reinforces or relates to the title's main message
- Consider what user intent the title represents and address it directly

TARGET LENGTH: ${targetMinLength}-${targetMaxLength} characters (${isTemplate4Or5 ? 'comprehensive and detailed, designed to engage and retain users' : 'comprehensive but concise'})

Knowledge base context: ${knowledgeBaseContent ? knowledgeBaseContent.substring(0, isTemplate4Or5 ? 1500 : 1000) : "N/A"}

Write the complete, detailed description paragraph now. Make sure it is STRONGLY RELATED to the title "${pageTitle}", provides substantial value, and effectively engages users to continue reading:`;

        const descResult = await requestWithRetry(() => descModel.generateContent(descPrompt), "description.generateContent");
        const descResponse = await descResult.response;
        pageDescription = descResponse.text().trim();
        
        // 验证并优化描述长度
        if (pageDescription.length < targetMinLength) {
          console.warn(`[GoogleAI] Page description is too short (${pageDescription.length} chars), expected ${targetMinLength}-${targetMaxLength} chars`);
        } else if (pageDescription.length > targetMaxLength + 100) {
          // 如果太长，截取前(targetMaxLength-50)个字符并添加省略号
          const truncateLength = targetMaxLength - 50;
          pageDescription = pageDescription.substring(0, truncateLength).trim() + "...";
          console.warn(`[GoogleAI] Page description was too long, truncated to ${truncateLength} characters`);
        }
        
        // 验证内容质量
        validateContent(pageDescription, "page description");
        
        console.log(`[GoogleAI] Generated comprehensive page description: ${pageDescription.length} characters`);
        } catch (error) {
          console.warn(`[GoogleAI] Failed to generate comprehensive page description:`, error);
          // 如果生成失败，尝试从文章内容提取更长的段落
          try {
            const paragraphCount = isTemplate4Or5 ? 3 : 2; // 模板4和模板5提取更多段落
            const firstParagraphs = finalArticleContent.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
            if (firstParagraphs && firstParagraphs.length > 0) {
              let extractedDesc = "";
              for (let i = 0; i < Math.min(paragraphCount, firstParagraphs.length); i++) {
                const paraText = stripHtmlTags(firstParagraphs[i]).trim();
                extractedDesc += paraText + " ";
              }
              extractedDesc = extractedDesc.trim();
              // 根据模板类型限制长度
              const maxExtractLength = isTemplate4Or5 ? 550 : 300;
              if (extractedDesc.length > maxExtractLength) {
                extractedDesc = extractedDesc.substring(0, maxExtractLength).trim() + "...";
              }
              pageDescription = extractedDesc;
              console.log(`[GoogleAI] Extracted page description from article content: ${pageDescription.length} characters`);
            } else {
              // 生成备用描述，模板4和模板5需要更详细
              if (isTemplate4Or5) {
                pageDescription = `Discover ${keyword} - Our comprehensive guide to "${pageTitle}" provides in-depth analysis, expert recommendations, and detailed insights. Explore key features, benefits, and practical considerations to help you make informed decisions. Whether you're seeking premium quality, cutting-edge technology, or exceptional value, this guide covers everything you need to know about ${keyword}.`;
              } else {
                pageDescription = `Discover ${keyword} - Expert guide with comprehensive information, detailed recommendations, and valuable insights to help you make informed decisions.`;
              }
            }
          } catch (extractError) {
            console.warn(`[GoogleAI] Failed to extract description from article:`, extractError);
            // 生成备用描述，模板4和模板5需要更详细
            if (isTemplate4Or5) {
              pageDescription = `Discover ${keyword} - Our comprehensive guide to "${pageTitle}" provides in-depth analysis, expert recommendations, and detailed insights. Explore key features, benefits, and practical considerations to help you make informed decisions. Whether you're seeking premium quality, cutting-edge technology, or exceptional value, this guide covers everything you need to know about ${keyword}.`;
            } else {
              pageDescription = `Discover ${keyword} - Expert guide with comprehensive information, detailed recommendations, and valuable insights to help you make informed decisions.`;
            }
          }
        }
    } else {
      // 如果不是模板2、3、4或5，pageDescription保持为空字符串（模板1不需要描述）
      pageDescription = "";
    }
    
    // 确保模板2、3、4和5一定有描述（如果还是空，使用默认值）
    if (needsFullDescription) {
      if (!pageDescription || pageDescription.trim().length === 0) {
        console.warn(`[GoogleAI] ⚠️ Page description is empty for ${templateType}, using default comprehensive description`);
        // 模板4和模板5需要更详细的默认描述
        if (isTemplate4Or5) {
          pageDescription = `Discover ${keyword} - Our comprehensive guide to "${pageTitle}" provides in-depth analysis, expert recommendations, and detailed insights. Explore key features, benefits, and practical considerations to help you make informed decisions. Whether you're seeking premium quality, cutting-edge technology, or exceptional value, this guide covers everything you need to know about ${keyword}.`;
        } else {
          pageDescription = `Discover ${keyword} - Expert guide with comprehensive information, detailed recommendations, and valuable insights to help you make informed decisions.`;
        }
        console.log(`[GoogleAI] ✅ Page description generated for ${templateType}: ${pageDescription.length} characters`);
      } else {
        console.log(`[GoogleAI] ✅ Page description generated for ${templateType}: ${pageDescription.length} characters`);
      }
    }

    // 生成SEO meta description (150-160 characters, optimized for Google)
    let metaDescription = "";
    try {
      // 从pageDescription或文章内容生成meta description
      let descSource = pageDescription || stripHtmlTags(finalArticleContent).substring(0, 200);
      
      // 确保包含关键词
      if (!descSource.toLowerCase().includes(keyword.toLowerCase())) {
        descSource = `${keyword} - ${descSource}`;
      }
      
      // 优化长度：150-160字符（Google推荐）
      if (descSource.length > 160) {
        metaDescription = descSource.substring(0, 157).trim() + "...";
      } else if (descSource.length < 120) {
        // 如果太短，补充内容
        metaDescription = descSource + " Expert guide with detailed information and recommendations.";
        if (metaDescription.length > 160) {
          metaDescription = metaDescription.substring(0, 157).trim() + "...";
        }
      } else {
        metaDescription = descSource;
      }
    } catch (error) {
      console.warn(`[GoogleAI] Failed to generate meta description:`, error);
      metaDescription = `${keyword} - Expert guide and recommendations. Discover the best options and detailed information.`;
    }

    // 生成SEO meta keywords (相关关键词，逗号分隔)
    let metaKeywords = "";
    try {
      // 从关键词和标题中提取主要关键词
      const keywordWords = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const titleWords = pageTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
      
      // 组合关键词：主关键词 + 标题中的关键词 + 相关词汇
      const allKeywords = new Set<string>();
      keywordWords.forEach(w => allKeywords.add(w));
      titleWords.forEach(w => allKeywords.add(w));
      
      // 添加相关SEO词汇
      allKeywords.add("buy");
      allKeywords.add("guide");
      allKeywords.add("review");
      allKeywords.add("best");
      allKeywords.add("luxury");
      
      // 限制关键词数量（5-10个）
      metaKeywords = Array.from(allKeywords).slice(0, 10).join(", ");
    } catch (error) {
      console.warn(`[GoogleAI] Failed to generate meta keywords:`, error);
      metaKeywords = keyword + ", buy, guide, review, best, luxury";
    }

    // 为模板3/4/5生成扩展内容（第二部分，不重复，放在页面末尾）
    let extendedContent = "";
    if (isLongFormTemplate) {
      try {
        console.log(`[GoogleAI] Generating extended content for ${templateType}...`);
        const extendedModel = genAI.getGenerativeModel({
          model: modelName, // 使用相同的模型（优先 Key 使用 gemini-3-pro-preview）
          generationConfig: {
            temperature: 0.8,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 4096, // 允许较长的扩展内容
          },
        });

        const extendedPrompt = `You are an expert SEO content writer. Write an EXTENDED, COMPREHENSIVE content section (different from the main content) about "${keyword}" with title "${pageTitle}". Place this section AFTER the main content to provide additional value.

CRITICAL REQUIREMENTS:
- You MUST write in British English (UK English) only
- You MUST NOT include any Chinese characters, words, or phrases
- This content should be DIFFERENT and COMPLEMENTARY to the main content
- Focus on deeper insights, additional details, advanced topics, or related aspects
- Use British English spelling (e.g., "colour", "realise", "centre", "organise")
- ALL product information MUST come EXCLUSIVELY from the knowledge base provided below
- NO fabricated information, NO assumptions, NO external knowledge beyond the knowledge base
- Maintain strong alignment with the page title and keyword; avoid unrelated tangents

CONTENT FOCUS (choose one or combine):
- Advanced features and technical details
- Comparison with alternatives
- Use cases and applications
- Maintenance and care tips
- Future trends and developments
- Expert recommendations and best practices
- Detailed specifications and benefits

CONTENT STRUCTURE:
1. Use H2 headings (2-4 headings) for different topics
2. Include detailed paragraphs (3-5 sentences each)
3. Use numbered or bulleted lists where appropriate
4. Provide comprehensive information
5. NO word limit - be thorough and detailed

KNOWLEDGE BASE (use ONLY this data):
${kbContent.substring(0, 3000)}

Write the extended content in HTML format with proper tags (<h2>, <p>, <ol>, <ul>, <li>). Do NOT include H1 tags.`;

        const extendedResult = await requestWithRetry(() => extendedModel.generateContent(extendedPrompt), "extended.generateContent");
        const extendedResponse = await extendedResult.response;
        extendedContent = extendedResponse.text().trim();

        // 清理markdown代码块标记
        extendedContent = extendedContent
          .replace(/```html\s*/gi, "")
          .replace(/```HTML\s*/gi, "")
          .replace(/```json\s*/gi, "")
          .replace(/```JSON\s*/gi, "")
          .replace(/```markdown\s*/gi, "")
          .replace(/```md\s*/gi, "")
          .replace(/```\s*/g, "")
          .replace(/^```|```$/gm, "")
          .trim();

        // 将任何H1标签替换为H2
        extendedContent = extendedContent
          .replace(/<h1([^>]*)>/gi, "<h2$1>")
          .replace(/<\/h1>/gi, "</h2>");

        // 验证内容
        validateContent(extendedContent, "extended content");
        validateContentAgainstKnowledgeBase(extendedContent, knownProducts, "extended content");

        console.log(`[GoogleAI] ✅ Extended content generated: ${stripHtmlTags(extendedContent).length} characters`);
        
        // 验证扩展内容不为空
        if (!extendedContent || extendedContent.trim().length === 0) {
          console.warn(`[GoogleAI] ⚠️ Extended content is empty after generation, attempting fallback...`);
          // 尝试从文章内容提取额外段落作为扩展内容
          const allParagraphs = finalArticleContent.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
          if (allParagraphs && allParagraphs.length > 2) {
            // 使用第3段及之后的段落作为扩展内容
            let fallbackContent = "";
            for (let i = 2; i < Math.min(allParagraphs.length, 5); i++) {
              fallbackContent += allParagraphs[i] + "\n";
            }
            if (fallbackContent.trim().length > 0) {
              extendedContent = fallbackContent.trim();
              console.log(`[GoogleAI] ✅ Using fallback extended content from article: ${stripHtmlTags(extendedContent).length} characters`);
            }
          }
        }
      } catch (error) {
        console.warn(`[GoogleAI] Failed to generate extended content:`, error);
        // 如果生成失败，尝试从文章内容提取额外段落作为扩展内容
        try {
          const allParagraphs = finalArticleContent.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
          if (allParagraphs && allParagraphs.length > 2) {
            let fallbackContent = "";
            for (let i = 2; i < Math.min(allParagraphs.length, 5); i++) {
              fallbackContent += allParagraphs[i] + "\n";
            }
            if (fallbackContent.trim().length > 0) {
              extendedContent = fallbackContent.trim();
              console.log(`[GoogleAI] ✅ Using fallback extended content from article (after error): ${stripHtmlTags(extendedContent).length} characters`);
            }
          }
        } catch (fallbackError) {
          console.warn(`[GoogleAI] Failed to extract fallback extended content:`, fallbackError);
          // 如果所有方法都失败，extendedContent保持为空字符串
        }
      }
      
      // 最终验证：确保模板3有扩展内容
      if (isTemplate3 && (!extendedContent || extendedContent.trim().length === 0)) {
        console.warn(`[GoogleAI] ⚠️ Template-3 extended content is still empty, this may cause the second content section not to display`);
      }
    }

    return {
      articleContent: finalArticleContent,
      extendedContent: (extendedContent && extendedContent.trim().length > 0) ? extendedContent : undefined, // 扩展内容（仅用于模板3，确保非空）
      pageDescription: pageDescription,
      metaDescription: metaDescription,
      metaKeywords: metaKeywords,
      faqItems: finalFaqItems.slice(0, 8), // 最多保留 8 个，但至少 5 个
    };
  } catch (error: any) {
    // 处理 SDK 错误，转换为统一格式
    console.error(`[GoogleAI] Error:`, error);
    
    // SDK 错误通常包含 status 或 statusCode
    let statusCode: number | undefined;
    let errorMessage = error.message || "Request failed";
    let isApiKeyError = false;

    // 检查是否是 API Key 相关错误
    if (error.status) {
      statusCode = error.status;
    } else if (error.statusCode) {
      statusCode = error.statusCode;
    } else if (error.code) {
      // 网络错误代码
      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        statusCode = 408;
        errorMessage = "Request timeout - Google AI API 响应超时，请检查网络连接或稍后重试";
      } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        statusCode = 0;
        errorMessage = "Network error - 无法连接到 Google AI API，请检查网络连接";
      }
    }

    // 处理 "fetch failed" 错误（网络连接问题）
    if (errorMessage.includes("fetch failed") || errorMessage.includes("TypeError: fetch failed")) {
      statusCode = 0;
      errorMessage = `网络连接失败 - 无法访问 Google AI API。可能的原因：
1. 网络无法访问 Google 服务（可能需要配置代理）
2. DNS 解析失败
3. 防火墙阻止连接

解决方案：
- 如果在中国大陆，需要配置代理访问 Google API
- 检查网络连接是否正常
- 尝试在浏览器中访问 https://generativelanguage.googleapis.com 测试连接`;
      console.error(`[GoogleAI] 网络连接失败，错误详情:`, error);
    }

    // 处理 404 错误（模型不存在）
    if (statusCode === 404 || errorMessage.includes("not found") || errorMessage.includes("404")) {
      statusCode = 404;
      errorMessage = `模型 ${modelName} 不可用。错误信息: ${errorMessage}`;
      console.error(`[GoogleAI] 模型 ${modelName} 不可用，请检查模型名称是否正确`);
    }

    // 处理 400 地理位置限制错误（User location is not supported）
    if (statusCode === 400 && (errorMessage.includes("User location is not supported") || errorMessage.includes("location is not supported"))) {
      statusCode = 400;
      errorMessage = `地理位置限制 (400)：您所在的地理位置不支持使用 Google Gemini API。

可能的原因：
1. 您所在的国家/地区（如中国大陆）不在 Google Gemini API 的支持范围内
2. 网络请求被识别为来自不支持的地区

解决方案：
1. 【推荐】配置代理服务器（VPN/代理）：
   - 设置 HTTP_PROXY 或 HTTPS_PROXY 环境变量
   - 例如：HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890
   - 或在代码中配置代理（需要修改 GoogleGenerativeAI SDK 配置）

2. 使用支持的地区：
   - 将服务器部署到支持 Google Gemini API 的地区（如美国、欧洲等）
   - 或使用云服务商提供的代理服务

3. 检查网络环境：
   - 确认您的网络可以访问 Google 服务
   - 尝试在浏览器中访问 https://generativelanguage.googleapis.com 测试连接

注意：切换 API Key 无法解决此问题，这是地理位置限制。`;
      console.error(`[GoogleAI] 地理位置限制错误：用户所在地区不支持使用 Google Gemini API`);
      // 这不是 API Key 错误，所以不设置 isApiKeyError = true
    }

    // 处理 429 配额限制错误（需要特殊处理，提取 retryDelay）
    if (statusCode === 429 || errorMessage.includes("429") || errorMessage.includes("quota") || errorMessage.includes("Too Many Requests")) {
      statusCode = 429;
      isApiKeyError = true; // 429 应该切换 Key 或重试
      
      // 尝试从错误详情中提取 retryDelay
      let retryDelaySeconds = 60; // 默认 60 秒
      try {
        if (error.errorDetails) {
          const retryInfo = error.errorDetails.find((detail: any) => detail["@type"] === "type.googleapis.com/google.rpc.RetryInfo");
          if (retryInfo?.retryDelay) {
            // retryDelay 可能是 "42s" 格式
            const delayStr = String(retryInfo.retryDelay).replace("s", "");
            retryDelaySeconds = Math.ceil(parseFloat(delayStr)) || 60;
          }
        }
        // 也尝试从错误消息中提取
        const retryMatch = errorMessage.match(/retry in ([\d.]+)s/i);
        if (retryMatch) {
          retryDelaySeconds = Math.ceil(parseFloat(retryMatch[1])) || 60;
        }
      } catch (e) {
        // 如果提取失败，使用默认值
      }
      
      // 将 retryDelay 附加到错误对象
      (error as any).retryDelaySeconds = retryDelaySeconds;
      errorMessage = `API 配额限制 (429)：已达到请求频率限制。建议等待 ${retryDelaySeconds} 秒后重试，或切换到下一个 API Key。`;
    }

    // 从错误消息中判断是否是 API Key 错误
    const errorMsgLower = errorMessage.toLowerCase();
    if (
      errorMsgLower.includes("api key") ||
      errorMsgLower.includes("quota") ||
      errorMsgLower.includes("permission") ||
      errorMsgLower.includes("403") ||
      errorMsgLower.includes("401") ||
      errorMsgLower.includes("429")
    ) {
      isApiKeyError = true;
      if (!statusCode) {
        if (errorMsgLower.includes("401")) statusCode = 401;
        else if (errorMsgLower.includes("403")) statusCode = 403;
        else if (errorMsgLower.includes("429")) statusCode = 429;
      }
    }

    // 创建增强的错误对象
    const enhancedError = new Error(`[HTTP ${statusCode || 0}] ${errorMessage}`);
    (enhancedError as any).statusCode = statusCode || 0;
    (enhancedError as any).isApiKeyError = isApiKeyError || statusCode === 401 || statusCode === 403 || statusCode === 429;
    (enhancedError as any).retryDelaySeconds = (error as any).retryDelaySeconds;
    
    throw enhancedError;
  }
}

// 所有已知的产品名称列表
const ALL_KNOWN_PRODUCTS = [
  "Agent Q",
  "Quantum Flip",
  "Metavertu Max",
  "Metavertu Curve",
  "Metavertu",
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
];

/**
 * 从内容中提取提到的所有产品名称
 * @param content 要检查的内容
 * @returns 提到的产品名称数组
 */
export function extractMentionedProductsFromContent(content: string): string[] {
  if (!content) return [];

  const contentLower = content.toLowerCase();
  const mentionedProducts: string[] = [];

  // 按长度从长到短排序，优先匹配更长的产品名称（避免部分匹配问题）
  const sortedProducts = [...ALL_KNOWN_PRODUCTS].sort((a, b) => b.length - a.length);

  for (const product of sortedProducts) {
    const productLower = product.toLowerCase();
    // 使用单词边界匹配，确保是完整的产品名称
    // 例如："Metavertu" 应该匹配 "Metavertu Max" 或 "Metavertu"，但不应该匹配 "Metavertu Curve" 中的部分
    const productWords = productLower.split(/\s+/);
    const firstWord = productWords[0];
    
    // 检查内容中是否包含完整的产品名称
    if (contentLower.includes(productLower)) {
      // 避免重复添加（如果已经添加了更长的产品名称，跳过较短的）
      const isAlreadyIncluded = mentionedProducts.some(existing => {
        const existingLower = existing.toLowerCase();
        return existingLower.includes(productLower) || productLower.includes(existingLower);
      });
      
      if (!isAlreadyIncluded) {
        mentionedProducts.push(product);
      }
    } else if (productWords.length > 1 && contentLower.includes(firstWord)) {
      // 对于多词产品，如果第一个词匹配，也考虑添加（但要更谨慎）
      // 例如：如果内容提到 "Metavertu"，但没有明确提到 "Metavertu Max"，我们仍然添加 "Metavertu"
      const isAlreadyIncluded = mentionedProducts.some(existing => {
        const existingLower = existing.toLowerCase();
        return existingLower.startsWith(firstWord) || firstWord.startsWith(existingLower.split(/\s+/)[0]);
      });
      
      if (!isAlreadyIncluded && product === "Metavertu") {
        // 对于 "Metavertu" 这个通用名称，如果提到但没提到具体型号，也添加
        mentionedProducts.push(product);
      }
    }
  }

  return mentionedProducts;
}

/**
 * 验证内容主题是否与关键词/标题匹配（SEO关键验证）
 * 确保内容不会偏离主题（如关键词是手表但内容写手机）
 */
function validateContentTopicMatch(
  content: string,
  keyword: string,
  pageTitle: string,
  contentType: string
): void {
  if (!content || !keyword || !pageTitle) return;

  const contentLower = content.toLowerCase();
  const keywordLower = keyword.toLowerCase();
  const titleLower = pageTitle.toLowerCase();

  // 定义产品类别关键词
  const productCategoryKeywords = {
    watch: ["watch", "timepiece", "horology", "chronograph", "wristwatch", "grand watch", "metawatch"],
    phone: ["phone", "mobile", "smartphone", "handset", "device", "agent q", "quantum flip", "metavertu", "signature", "ivertu"],
    ring: ["ring", "jewellery", "jewelry", "diamond ring", "meta ring"],
    earbud: ["earbud", "earphone", "earphones", "audio", "phantom", "ows"],
  };

  // 检测关键词属于哪个类别
  const detectCategory = (text: string): string[] => {
    const categories: string[] = [];
    for (const [category, keywords] of Object.entries(productCategoryKeywords)) {
      if (keywords.some(kw => text.includes(kw))) {
        categories.push(category);
      }
    }
    return categories;
  };

  const keywordCategories = detectCategory(keywordLower);
  const titleCategories = detectCategory(titleLower);
  const contentCategories = detectCategory(contentLower);

  // 检查内容是否偏离主题
  const isTopicMismatch = (keywordCats: string[], contentCats: string[]): boolean => {
    if (keywordCats.length === 0) return false; // 无法确定类别，跳过检查
    
    // 如果关键词是手表，但内容提到手机（且没有提到手表）
    if (keywordCats.includes("watch") && contentCats.includes("phone") && !contentCats.includes("watch")) {
      return true;
    }
    // 如果关键词是手机，但内容提到手表（且没有提到手机）
    if (keywordCats.includes("phone") && contentCats.includes("watch") && !contentCats.includes("phone")) {
      return true;
    }
    // 如果关键词是手表，但内容提到戒指（且没有提到手表）
    if (keywordCats.includes("watch") && contentCats.includes("ring") && !contentCats.includes("watch")) {
      return true;
    }
    // 如果关键词是手机，但内容提到戒指（且没有提到手机）
    if (keywordCats.includes("phone") && contentCats.includes("ring") && !contentCats.includes("phone")) {
      return true;
    }
    // 如果关键词是手表，但内容提到耳机（且没有提到手表）
    if (keywordCats.includes("watch") && contentCats.includes("earbud") && !contentCats.includes("watch")) {
      return true;
    }
    // 如果关键词是手机，但内容提到耳机（且没有提到手机）
    if (keywordCats.includes("phone") && contentCats.includes("earbud") && !contentCats.includes("phone")) {
      return true;
    }
    
    return false;
  };

  // 检查关键词-内容匹配
  if (isTopicMismatch(keywordCategories, contentCategories)) {
    console.error(
      `[GoogleAI] ⛔ SEVERE SEO ERROR: ${contentType} topic does NOT match keyword "${keyword}"!`
    );
    console.error(
      `[GoogleAI] ⛔ Keyword category: ${keywordCategories.join(", ") || "unknown"}`
    );
    console.error(
      `[GoogleAI] ⛔ Content category: ${contentCategories.join(", ") || "unknown"}`
    );
    console.error(
      `[GoogleAI] ⛔ This is a CRITICAL SEO violation - content must match keyword topic!`
    );
    console.error(
      `[GoogleAI] ⛔ Content preview: ${content.substring(0, 300)}...`
    );
  }

  // 检查标题-内容匹配
  if (titleCategories.length > 0 && isTopicMismatch(titleCategories, contentCategories)) {
    console.error(
      `[GoogleAI] ⛔ SEVERE SEO ERROR: ${contentType} topic does NOT match page title "${pageTitle}"!`
    );
    console.error(
      `[GoogleAI] ⛔ Title category: ${titleCategories.join(", ") || "unknown"}`
    );
    console.error(
      `[GoogleAI] ⛔ Content category: ${contentCategories.join(", ") || "unknown"}`
    );
    console.error(
      `[GoogleAI] ⛔ This is a CRITICAL SEO violation - content must match page title topic!`
    );
  }

  // 检查内容是否包含关键词的主要词汇
  const keywordWords = keywordLower.split(/\s+/).filter(w => w.length > 3);
  const hasKeywordWords = keywordWords.length > 0 && keywordWords.some(word => contentLower.includes(word));
  
  if (!hasKeywordWords && keywordWords.length > 0) {
    console.warn(
      `[GoogleAI] ⚠️ WARNING: ${contentType} may not contain key words from keyword "${keyword}"`
    );
    console.warn(
      `[GoogleAI] ⚠️ Expected words: ${keywordWords.join(", ")}`
    );
  }
}

// 验证内容是否包含与关键词无关的产品
function validateContentRelevance(
  content: string,
  relevantProducts: string[],
  keyword: string,
  contentType: string
): void {
  if (!content || !relevantProducts.length) return;

  const contentLower = content.toLowerCase();
  const relevantProductsLower = relevantProducts.map((p) => p.toLowerCase());
  const keywordLower = keyword.toLowerCase();

  const mentionedProducts: string[] = [];
  for (const product of ALL_KNOWN_PRODUCTS) {
    const productLower = product.toLowerCase();
    // 检查内容中是否提到该产品
    if (
      contentLower.includes(productLower) &&
      !relevantProductsLower.some((rel) => rel.includes(productLower) || productLower.includes(rel))
    ) {
      mentionedProducts.push(product);
    }
  }

  if (mentionedProducts.length > 0) {
    console.warn(
      `[GoogleAI] WARNING: ${contentType} mentions products not relevant to keyword "${keyword}": ${mentionedProducts.join(", ")}`
    );
    console.warn(
      `[GoogleAI] Relevant products for "${keyword}": ${relevantProducts.join(", ")}`
    );
  }
}

// 验证内容是否包含知识库外的产品信息
function validateContentAgainstKnowledgeBase(
  content: string,
  knownProducts: string[],
  contentType: string
): void {
  if (!content || !knownProducts.length) return;

  const contentLower = content.toLowerCase();
  const knownProductsLower = knownProducts.map((p) => p.toLowerCase());

  // 常见的 VERTU 产品名称模式（可能不在知识库中）
  const suspiciousPatterns = [
    /\bvertu\s+(?:constellation|signature|aster|ironflip|classic|retro)\b/gi,
    /\b(?:constellation|aster|ironflip)\s+(?:phone|handset|device)\b/gi,
  ];

  // 检查是否包含可疑的产品名称模式
  for (const pattern of suspiciousPatterns) {
    const matches = content.match(pattern);
    if (matches) {
      const uniqueMatches = Array.from(new Set(matches.map((m) => m.trim())));
      const unknownProducts = uniqueMatches.filter(
        (match) => !knownProductsLower.some((known) => match.toLowerCase().includes(known) || known.includes(match.toLowerCase()))
      );

      if (unknownProducts.length > 0) {
        console.warn(
          `[GoogleAI] WARNING: ${contentType} may contain product names not in knowledge base: ${unknownProducts.join(", ")}`
        );
        console.warn(
          `[GoogleAI] Authorised products: ${knownProducts.join(", ")}`
        );
      }
    }
  }

  // 检查是否提到了明显的非知识库产品（通过常见产品名称检测）
  const commonNonKbProducts = [
    "constellation",
    "aster p",
    "ironflip",
    "vertu classic",
    "vertu retro",
  ];

  for (const product of commonNonKbProducts) {
    if (
      contentLower.includes(product.toLowerCase()) &&
      !knownProductsLower.some((known) => known.includes(product.toLowerCase()) || product.toLowerCase().includes(known))
    ) {
      console.warn(
        `[GoogleAI] WARNING: ${contentType} mentions "${product}" which is not in the authorised product list`
      );
    }
  }
}

/**
 * 验证内容中的年份信息是否准确（避免过时年份）
 */
function validateYearAccuracy(
  content: string,
  currentYear: number,
  contentType: string
): void {
  if (!content) return;

  // 匹配4位数字年份（1900-2099）
  const yearPattern = /\b(19|20)\d{2}\b/g;
  const matches = content.match(yearPattern);
  
  if (!matches) return; // 没有年份信息，跳过检查

  const uniqueYears = Array.from(new Set(matches.map(m => parseInt(m, 10))));
  const outdatedYears: number[] = [];
  const futureYears: number[] = [];

  for (const year of uniqueYears) {
    // 检查是否比当前年份早1年以上（允许当前年份和去年）
    if (year < currentYear - 1) {
      outdatedYears.push(year);
    }
    // 检查是否比当前年份晚（未来年份，可能是错误）
    if (year > currentYear) {
      futureYears.push(year);
    }
  }

  if (outdatedYears.length > 0) {
    console.warn(
      `[GoogleAI] ⚠️ WARNING: ${contentType} contains potentially outdated years: ${outdatedYears.join(", ")} (current year: ${currentYear})`
    );
    console.warn(
      `[GoogleAI] ⚠️ These years may make the content appear outdated. Consider using current year (${currentYear}) or removing specific years unless they are explicitly stated in the knowledge base.`
    );
    console.warn(
      `[GoogleAI] ⚠️ Content preview: ${content.substring(0, 500)}...`
    );
  }

  if (futureYears.length > 0) {
    console.warn(
      `[GoogleAI] ⚠️ WARNING: ${contentType} contains future years: ${futureYears.join(", ")} (current year: ${currentYear})`
    );
    console.warn(
      `[GoogleAI] ⚠️ These years may be incorrect. Please verify if they are explicitly stated in the knowledge base.`
    );
  }
}

// 从知识库中提取产品名称的辅助函数
function extractProductNamesFromKnowledgeBase(kbContent: string): string[] {
  const products: string[] = [];
  const lines = kbContent.split("\n");
  
  // 查找产品名称的模式：
  // 1. 在 "### Basic info" 或 "PRODUCT NAME" 部分查找 "- Product name:"
  // 2. 查找用 "---" 分隔的产品标题行
  // 3. 查找在 FAQ 中提到的产品
  
  let inProductSection = false;
  let currentProduct = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    // 检测产品分隔符（如 "AGENT Q", "QUANTUM FLIP" 等）
    if (line.match(/^-{3,}/) && i > 0) {
      const prevLine = lines[i - 1]?.trim();
      if (prevLine && prevLine.length > 0 && !prevLine.startsWith("-") && !prevLine.startsWith("#")) {
        const productName = prevLine.replace(/^#+\s*/, "").trim();
        if (productName && productName.length > 0 && productName.length < 100) {
          products.push(productName);
        }
      }
    }
    
    // 检测 "- Product name:" 模式
    if (line.match(/^-\s*Product\s+name:\s*/i)) {
      const productName = line.replace(/^-\s*Product\s+name:\s*/i, "").trim();
      if (productName && productName.length > 0) {
        products.push(productName);
      }
    }
    
    // 检测在 FAQ 中提到的产品（如 "Quantum Flip", "Metavertu Max", "iVERTU"）
    const productMentions = line.match(/\b(Agent\s+Q|Quantum\s+Flip|Metavertu\s+Max|iVERTU|Metavertu\s+Curve|Meta\s+Ring|AI\s+Diamond\s+Ring|Signature\s+S\+|Signature\s+V|Signature\s+Cobra|Grand\s+Watch|Metawatch|Phantom\s+Earbuds)\b/gi);
    if (productMentions) {
      productMentions.forEach((mention) => {
        const cleaned = mention.trim();
        if (cleaned && !products.includes(cleaned)) {
          products.push(cleaned);
        }
      });
    }
  }
  
  // 去重并排序
  const uniqueProducts = Array.from(new Set(products.map(p => p.trim()).filter(p => p.length > 0)));
  
  // 确保至少包含明确列出的主要产品
  const mainProducts = ["Agent Q", "Quantum Flip", "Metavertu Max", "iVERTU"];
  mainProducts.forEach((product) => {
    if (!uniqueProducts.some(p => p.toLowerCase().includes(product.toLowerCase()) || product.toLowerCase().includes(p.toLowerCase()))) {
      uniqueProducts.push(product);
    }
  });
  
  return uniqueProducts.sort();
}

// 根据关键词提取相关产品的辅助函数
function extractRelevantProductsFromKeyword(keyword: string, knownProducts: string[]): string[] {
  if (!keyword || !knownProducts.length) {
    return [];
  }

  const keywordLower = keyword.toLowerCase().trim();
  const relevantProducts: string[] = [];
  const isPhoneKeyword = /\b(phone|phones|smartphone|smart phone|cellphone|cell phone|mobile)\b/i.test(keyword);
  const isWatchKeyword = /(watch|watches|timepiece|horology|chronograph)/i.test(keyword);
  const isRingKeyword = /\b(ring|jewellery|jewelry|jewel)\b/i.test(keyword);
  const isEarbudKeyword = /(earbud|earbuds|earphone|earphones|audio|hearable|hearables|headphone)/i.test(keyword);
  const isWearableBroadKeyword = /(wearable|wearables|wearable device|smart wearable)/i.test(keyword);

  const productMatchesCategory = (product: string, category: "watch" | "ring" | "earbud"): boolean => {
    const nameLower = product.toLowerCase();
    if (category === "watch") return /(watch|timepiece|horology|chronograph|grand watch|metawatch)/i.test(nameLower);
    if (category === "ring") return /(ring|jewellery|jewelry|meta ring|diamond)/i.test(nameLower);
    if (category === "earbud") return /(earbud|earbuds|earphone|earphones|audio|ows|phantom)/i.test(nameLower);
    return false;
  };

  // 产品关键词匹配规则
  const productKeywordHints: Array<{ keywords: string[]; productNames: string[] }> = [
    {
      keywords: ["flip", "fold", "foldable", "hinge", "clamshell", "dual screen", "quantum"],
      productNames: ["Quantum Flip"],
    },
    {
      keywords: ["web3", "crypto", "blockchain", "metaverse", "wallet", "defi", "metavertu", "meta vertu"],
      productNames: ["Metavertu Max", "Metavertu"],
    },
    {
      keywords: ["agent", "ai agent", "ruby", "aigs"],
      productNames: ["Agent Q"],
    },
    {
      keywords: ["signature", "bar phone", "classic", "artisan", "bespoke"],
      productNames: ["Signature S", "Signature S+", "Signature V", "Signature Cobra"],
    },
    {
      keywords: ["ring", "jewellery", "jewelry", "wearable", "diamond", "meta ring"],
      productNames: ["Meta Ring", "AI Diamond Ring", "AI Meta Ring"],
    },
    {
      keywords: ["watch", "watches", "horology", "timepiece", "chronograph", "grand watch", "smart watch", "smartwatch", "luxury watch", "luxury watches"],
      productNames: ["Grand Watch", "Metawatch"],
    },
    {
      keywords: ["earbud", "earbuds", "earphone", "earphones", "audio", "phantom"],
      productNames: ["Phantom Earbuds", "OWS Earbuds"],
    },
    {
      keywords: ["ivertu", "entry", "budget", "affordable"],
      productNames: ["iVERTU"],
    },
    {
      keywords: ["laptop", "notebook", "computer", "pc", "laptop computer", "portable computer", "ultrabook", "macbook"],
      productNames: [], // 笔记本电脑产品将从WordPress产品库中动态获取
    },
  ];

  // 直接匹配产品名称
  for (const product of knownProducts) {
    const productLower = product.toLowerCase();
    // 如果关键词包含产品名称，或者产品名称包含关键词的一部分
    if (
      keywordLower.includes(productLower) ||
      productLower.includes(keywordLower) ||
      keywordLower.split(/\s+/).some((word) => productLower.includes(word) && word.length >= 3)
    ) {
      if (!relevantProducts.includes(product)) {
        relevantProducts.push(product);
      }
    }
  }

  // 通过关键词提示匹配（按优先级排序：手表、戒指、耳机等特定类别优先于手机）
  // 重新排序：特定类别（手表、戒指、耳机）优先匹配，避免手机关键词误匹配
  const sortedHints = [...productKeywordHints]
    // 如果是 watch/ring/earbud 精确类目且不是广义可穿戴，则只保留对应类目提示
    .filter((hint) => {
      if (isWearableBroadKeyword) return true;
      if (isWatchKeyword) return hint.keywords.some(kw => /(watch|watches|timepiece|horology|chronograph)/i.test(kw));
      if (isRingKeyword) return hint.keywords.some(kw => /(ring|jewellery|jewelry|diamond)/i.test(kw));
      if (isEarbudKeyword) return hint.keywords.some(kw => /(earbud|earbuds|earphone|earphones|audio|ows|phantom)/i.test(kw));
      return true;
    })
    .sort((a, b) => {
    // 手表、戒指、耳机等特定类别优先
    const aIsSpecific = a.keywords.some(kw => ["watch", "watches", "ring", "earbud"].includes(kw.toLowerCase()));
    const bIsSpecific = b.keywords.some(kw => ["watch", "watches", "ring", "earbud"].includes(kw.toLowerCase()));
    if (aIsSpecific && !bIsSpecific) return -1;
    if (!aIsSpecific && bIsSpecific) return 1;
    return 0;
  });
  
  for (const hint of sortedHints) {
    const matchesKeyword = hint.keywords.some((kw) => keywordLower.includes(kw.toLowerCase()));
    if (matchesKeyword) {
      // 如果产品列表为空（如笔记本电脑），表示该类别产品将从WordPress动态获取
      // 这种情况下返回空数组，让内容生成使用通用的VERTU品牌内容
      if (hint.productNames.length === 0) {
        // 笔记本电脑等类别，不强制匹配特定产品，允许使用通用内容
        console.log(`[GoogleAI] Keyword "${keyword}" matches category (laptop/notebook), will use general VERTU content`);
        return []; // 返回空数组，表示没有特定产品匹配，使用通用内容
      }
      
      console.log(`[GoogleAI] Keyword "${keyword}" matches category: ${hint.keywords.join(", ")} → Products: ${hint.productNames.join(", ")}`);
      
      for (const productName of hint.productNames) {
        if (knownProducts.includes(productName) && !relevantProducts.includes(productName)) {
          relevantProducts.push(productName);
        }
      }
      
      // 如果匹配到特定类别（手表、戒指、耳机），立即返回，避免继续匹配其他类别
      const isSpecificCategory = hint.keywords.some(kw => ["watch", "watches", "ring", "earbud", "earbuds"].includes(kw.toLowerCase()));
      if (isSpecificCategory && relevantProducts.length > 0) {
        console.log(`[GoogleAI] Keyword "${keyword}" matched specific category, returning relevant products: ${relevantProducts.join(", ")}`);
        return relevantProducts;
      }
    }
  }

  // 类目精确过滤：非广义可穿戴时，只保留对应类目产品，避免混入其他品类
  if (!isWearableBroadKeyword) {
    if (isWatchKeyword) {
      const filtered = relevantProducts.filter(p => productMatchesCategory(p, "watch"));
      if (filtered.length > 0) return filtered;
    }
    if (isRingKeyword) {
      const filtered = relevantProducts.filter(p => productMatchesCategory(p, "ring"));
      if (filtered.length > 0) return filtered;
    }
    if (isEarbudKeyword) {
      const filtered = relevantProducts.filter(p => productMatchesCategory(p, "earbud"));
      if (filtered.length > 0) return filtered;
    }
  }

  return relevantProducts;
}

// 从文本中提取FAQ的辅助函数
function extractFAQFromText(text: string): Array<{ question: string; answer: string }> {
  const faqItems: Array<{ question: string; answer: string }> = [];
  const lines = text.split("\n").filter((line) => line.trim());

  let currentQuestion = "";
  let currentAnswer = "";

  for (const line of lines) {
    // Match English question patterns (Q, Question, etc.)
    if (line.match(/^[Qq](\d+)?[.:]?\s*[?]/) || line.match(/^Question\s*\d*[.:]?\s*[?]/i)) {
      if (currentQuestion && currentAnswer) {
        faqItems.push({ question: currentQuestion, answer: currentAnswer.trim() });
      }
      currentQuestion = line.replace(/^[Qq](\d+)?[.:]?\s*/, "").replace(/^Question\s*\d*[.:]?\s*/i, "").trim();
      currentAnswer = "";
    } else if (line.match(/^[Aa](\d+)?[.:]?\s*/) || line.match(/^Answer\s*\d*[.:]?\s*/i)) {
      currentAnswer = line.replace(/^[Aa](\d+)?[.:]?\s*/, "").replace(/^Answer\s*\d*[.:]?\s*/i, "").trim();
    } else if (currentQuestion) {
      currentAnswer += (currentAnswer ? " " : "") + line.trim();
    }
  }

  if (currentQuestion && currentAnswer) {
    faqItems.push({ question: currentQuestion, answer: currentAnswer.trim() });
  }

  return faqItems.length > 0 ? faqItems : [];
}

// 生成备用FAQ（英式英语）
// 生成关键词相关的备用FAQ（前3条）
// 注意：这是备用函数，仅在AI生成失败时使用。主要应依赖AI生成更相关的FAQ。
function generateFallbackKeywordFAQ(keyword: string): Array<{ question: string; answer: string }> {
  // 尝试根据关键词类型生成更相关的问题
  const keywordLower = keyword.toLowerCase();
  
  // 检测关键词类型，生成更相关的问题
  let question1 = `What is ${keyword}?`;
  let question2 = `How do I choose the best ${keyword}?`;
  let question3 = `What should I consider when buying ${keyword}?`;
  
  // 根据关键词类型调整问题
  if (keywordLower.includes('buy') || keywordLower.includes('purchase') || keywordLower.includes('where')) {
    question1 = `Where can I buy ${keyword}?`;
    question2 = `What should I look for when purchasing ${keyword}?`;
    question3 = `How do I choose the right ${keyword} for my needs?`;
  } else if (keywordLower.includes('best') || keywordLower.includes('top') || keywordLower.includes('review')) {
    question1 = `What makes ${keyword} the best choice?`;
    question2 = `What are the key features of ${keyword}?`;
    question3 = `Why should I consider ${keyword}?`;
  } else if (keywordLower.includes('guide') || keywordLower.includes('how to')) {
    question1 = `What is ${keyword} and how does it work?`;
    question2 = `What are the benefits of ${keyword}?`;
    question3 = `How do I get started with ${keyword}?`;
  }
  
  return [
    {
      question: question1,
      answer: `VERTU offers luxury ${keyword} with exceptional craftsmanship and premium materials. Our products combine cutting-edge technology with traditional British craftsmanship to deliver an unparalleled experience.`,
    },
    {
      question: question2,
      answer: `When choosing ${keyword}, consider factors such as materials, craftsmanship, technology features, and exclusive services. VERTU products are handcrafted in England using rare materials and offer personalised concierge services.`,
    },
    {
      question: question3,
      answer: `When purchasing ${keyword}, consider the brand's heritage, material quality, technological innovation, and after-sales service. VERTU provides one-year global warranty and exclusive concierge support for all products.`,
    },
  ];
}

// 从知识库中获取通用FAQ（后3条）
function getGeneralFAQFromKnowledgeBase(): Array<{ question: string; answer: string }> {
  // 这些是知识库中"GLOBAL SHOPPING / PAYMENT / SHIPPING / RETURN FAQ"部分的准确内容
  return [
    {
      question: "What kind of brand is VERTU?",
      answer: "VERTU is a British luxury mobile phone brand combining rare materials, cutting-edge technology, and exclusive services, crafting personal masterpieces that reflect the owner's status and taste.",
    },
    {
      question: "What is the warranty policy?",
      answer: "One-year global warranty from purchase; accessories (including battery) carry a six-month warranty. Concierge handles all warranty enquiries.",
    },
    {
      question: "What payment methods can I choose?",
      answer: "Major international credit/debit cards, Apple Pay, Google Pay, plus financing through Klarna. Available options are displayed at checkout.",
    },
    {
      question: "When will I receive my order?",
      answer: "After confirmation, orders are prepared and dispatched within 1–2 business days; delivery typically takes 5–7 business days.",
    },
    {
      question: "What is the process for returns or replacements?",
      answer: "Contact Concierge first. Protection policy: 7-day return, 15-day exchange, and a 1-year warranty covering craftsmanship and performance. Concierge contact: official.service@vertu.com | WhatsApp +44 7934 635 868 | Tel +86 400-1250-888.",
    },
    {
      question: "Tell me about the Concierge Service (Ruby Key).",
      answer: "Press the ruby button to reach a private assistant instantly. Six privilege pillars deliver 27 curated services across lifestyle, travel, reservations, and security.",
    },
  ];
}

function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/**
 * 将标题格式化为Title Case（首字母大写格式，符合SEO文章标题规范）
 * Title Case规则：
 * - 每个重要单词首字母大写
 * - 第一个和最后一个单词总是大写
 * - 短连接词（a, an, the, and, or, but, in, on, at, to, for, of, with等）不大写（除非是首尾单词）
 */
function formatTitleCase(title: string): string {
  if (!title || title.trim().length === 0) {
    return title;
  }
  
  // 定义不需要大写的短词（除非是首尾单词）
  const shortWords = new Set([
    "a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor",
    "of", "on", "or", "the", "to", "with", "up", "so", "yet"
  ]);
  
  // 分割标题为单词
  const words = title.trim().split(/\s+/);
  
  // 处理每个单词
  const formattedWords = words.map((word, index) => {
    const isFirstWord = index === 0;
    const isLastWord = index === words.length - 1;
    const wordLower = word.toLowerCase();
    
    // 移除标点符号，保留原始格式
    const hasPunctuation = /[.,:;!?\-—–]/.test(word);
    const punctuation = word.match(/[.,:;!?\-—–]+/g) || [];
    const cleanWord = word.replace(/[.,:;!?\-—–]+/g, "");
    const cleanWordLower = cleanWord.toLowerCase();
    
    // 如果单词包含连字符（如"AI-Powered"），需要分别处理每个部分
    if (cleanWord.includes("-")) {
      const parts = cleanWord.split("-");
      const formattedParts = parts.map(part => {
        const partLower = part.toLowerCase();
        if (shortWords.has(partLower) && !isFirstWord && !isLastWord) {
          return partLower;
        }
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      });
      return formattedParts.join("-") + (punctuation.join("") || "");
    }
    
    // 处理品牌名和专有名词（保持原样，如果已经是大写）
    if (cleanWord === cleanWord.toUpperCase() && cleanWord.length > 1) {
      // 可能是品牌名或缩写（如"VERTU", "AI", "SEO"）
      return word;
    }
    
    // 处理短词
    if (shortWords.has(cleanWordLower) && !isFirstWord && !isLastWord) {
      return cleanWordLower + (punctuation.join("") || "");
    }
    
    // 其他单词：首字母大写，其余小写
    const formatted = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
    return formatted + (punctuation.join("") || "");
  });
  
  return formattedWords.join(" ");
}

function isArticleRich(html: string, templateType?: string): boolean {
  const plainText = stripHtmlTags(html).replace(/\s+/g, " ").trim();
  
  // 根据模板类型设置内容长度限制
  const isTemplate3 = templateType === "template-3";
  const isTemplate4 = templateType === "template-4";
  const isTemplate5 = templateType === "template-5";
  const isLongFormTemplate = isTemplate3 || isTemplate4 || isTemplate5;
  const currentMinLength = MIN_ARTICLE_LENGTH;
  const currentMaxLength = isLongFormTemplate ? 12000 : MAX_ARTICLE_LENGTH;
  
  // 检查内容长度
  const isWithinLength = plainText.length >= currentMinLength && (isLongFormTemplate || plainText.length <= currentMaxLength);
  
  // 检查内容是否完整（没有未完成的句子）
  // 检查是否以句号、问号或感叹号结尾，或者以</p>、</li>、</h2>等标签结尾
  const isComplete = /[.!?]\s*$|<\/p>|<\/li>|<\/h[1-6]>|<\/ol>/.test(html.trim());
  
  // 检查是否有未完成的句子（以"and"、"or"、"but"等连接词结尾，可能是未完成）
  const hasIncompleteSentences = /\b(and|or|but|however|although|because|since|when|where|which|that)\s*$/i.test(plainText.trim());
  
  // 检查结构元素
  // 不应该有H1标签（页面已经有H1了）
  const hasH1 = /<h1[^>]*>/gi.test(html);
  if (hasH1) {
    console.warn(`[GoogleAI] ⚠️ Article contains H1 tag - should use H2 instead. The page already has one H1 (the page title).`);
  }
  
  // 检查H2标题（主标题和子标题）
  const hasH2 = /<h2[^>]*>/gi.test(html);
  const headingCount = (html.match(/<h[2-3][^>]*>/gi) || []).length;
  const paragraphCount = (html.match(/<p[^>]*>/gi) || []).length;
  
  // 检查是否有编号列表（<ol>）
  const hasNumberedList = /<ol[^>]*>[\s\S]*?<li/gi.test(html);
  
  // 检查是否有问题式标题（包含问号的 h2 或 h3）
  const questionHeadings = html.match(/<h[2-3][^>]*>[\s\S]*?\?/gi) || [];
  const hasQuestionHeadings = questionHeadings.length >= 1; // 至少1个问题式标题
  
  // 检查编号列表项数量（至少应该有 3 个列表项）
  const listItemCount = (html.match(/<li[^>]*>/gi) || []).length;
  const hasEnoughListItems = listItemCount >= 3;

  return (
    isWithinLength && // 内容长度在一屏范围内
    isComplete && // 内容完整
    !hasIncompleteSentences && // 没有未完成的句子
    !hasH1 && // 不应该有H1标签（页面已经有H1了）
    hasH2 && // 必须有H2主标题
    headingCount >= MIN_HEADING_COUNT && // 至少2个标题
    paragraphCount >= MIN_PARAGRAPH_COUNT && // 至少3个段落
    hasNumberedList && // 必须有编号列表
    hasEnoughListItems && // 列表项数量足够
    hasQuestionHeadings // 至少有1个问题式标题
  );
}

/**
 * 生成页面标题（多样化类型，包含长尾词）
 */
async function generateTitleWithKey(apiKey: string, keyword: string, titleType?: string): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // 获取当前年份（动态，避免硬编码）
  const currentYear = new Date().getFullYear();
  
  // 标题生成同样统一使用稳定模型
  const modelName = DEFAULT_MODEL;
  
  const model = genAI.getGenerativeModel({
    model: modelName, // 使用相应的模型
    generationConfig: {
      temperature: 0.9, // 提高温度以增加多样性
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 100,
    },
  });

  // 定义标题类型映射
  const titleTypeMap: Record<string, string> = {
    "purchase": "purchase/transaction type (e.g., 'Buy', 'Purchase', 'Find the Best', 'Premium Selection', 'Official Store')",
    "informational": "informational/guide type (e.g., 'Complete Guide to', 'Everything About', 'Ultimate Guide to', 'All You Need to Know About')",
    "review": "review/comparison type (e.g., 'Best', 'Top Rated', 'Review', 'Comparison', 'Top 10', 'Best Rated')",
    "commercial": "commercial/deal type (e.g., 'Premium Collection', 'Exclusive Selection', 'Official Store', 'Authorised Retailer')",
    "how-to": "How to type (e.g., 'How to Choose', 'How to Find', 'How to Select', 'How to Buy', 'How to Use')",
    "recommendations": "Recommendations type (e.g., 'Top-rated', 'Recommended', 'Best Rated', 'Top Picks', 'Highly Recommended')",
    "services-guides": "Services Guides type (e.g., 'Usage Guide', 'User Guide', 'Service Guide', 'How to Use', 'Getting Started')",
    "tech-insights": "Tech Insights type (e.g., 'vs', 'Comparison', 'Which is Better', 'Tech Comparison', 'Feature Comparison')",
    "comparison": "comparison type (e.g., 'vs', 'Comparison', 'Which is Better', 'Best vs')",
    "expert": "expert/authority type (e.g., 'Expert Guide to', 'Professional Review of', 'In-Depth Analysis of')",
    "best": "Best type (e.g., 'Best', 'Best Rated', 'Best Quality', 'Best Value', 'Best Choice', 'Best Options')",
    "top": "Top type (e.g., 'Top', 'Top Rated', 'Top Quality', 'Top Picks', 'Top Choices', 'Top Recommendations')",
    "top-ranking": "Top Ranking type (e.g., 'Top 10', 'Top 5', 'Top Rankings', 'Top List', 'Ranking of', 'Top Rated List')",
    "most": "Most type (e.g., 'Most Popular', 'Most Rated', 'Most Recommended', 'Most Trusted', 'Most Valued', 'Most Sought After')",
  };

  // 定义多种标题类型模板（用于随机选择，当没有指定类型时）
  const titleTypes = Object.values(titleTypeMap);

  // 根据用户选择或随机选择标题类型
  let selectedType: string;
  if (titleType && titleTypeMap[titleType]) {
    selectedType = titleTypeMap[titleType];
    console.log(`[GoogleAI] 使用用户选择的标题类型: ${titleType}`);
  } else {
    // 随机选择一种标题类型，确保多样性
    selectedType = titleTypes[Math.floor(Math.random() * titleTypes.length)];
    console.log(`[GoogleAI] 随机选择标题类型`);
  }

  // 根据标题类型生成对应的备用标题
  const getFallbackTitleByType = (keyword: string, type?: string): string => {
    let fallbackTitle: string;
    
    if (!type || !titleTypeMap[type]) {
      // 如果没有指定类型，随机选择一个
      // 注意：避免使用 "Best Prices" 和语法错误
      const allFallbacks = [
        `Buy ${keyword} - Official Store`,
        `Complete Guide to ${keyword}`,
        `Best ${keyword} - Top Rated & Reviews`,
        `${keyword} - Expert Buying Guide`,
        `How to Choose the Best ${keyword}`,
        `Top-rated ${keyword}: Expert Recommendations`,
        `${keyword} Usage Guide: Complete Manual`,
        `${keyword} Comparison: Tech Insights`,
        `Premium ${keyword}: Quality & Performance Guide`,
        `Top ${keyword}: Premium Choices Reviewed`,
        `Most Popular ${keyword}: Best-Selling Models`,
      ];
      fallbackTitle = allFallbacks[Math.floor(Math.random() * allFallbacks.length)];
    } else {
      // 根据类型生成对应的备用标题
      // 注意：避免使用 "Shop for where to buy" 这种语法错误
      // 避免使用 "Best Prices" 这种不符合奢侈品牌的表达
      const typeFallbacks: Record<string, string[]> = {
      "purchase": [
        `Buy ${keyword} - Official Store`,
        `Purchase ${keyword} - Premium Selection`,
        `Shop ${keyword} - Official Retailer`,
        `Find the Best ${keyword} - Expert Guide`,
      ],
      "informational": [
        `Complete Guide to ${keyword}`,
        `Everything About ${keyword}`,
        `Ultimate Guide to ${keyword}`,
        `All You Need to Know About ${keyword}`,
      ],
      "review": [
        `Best ${keyword} - Top Rated & Reviews`,
        `${keyword} Review: Top Rated Models`,
        `Top 10 ${keyword} - Best Rated`,
        `${keyword} Comparison: Best Rated`,
      ],
      "commercial": [
        `Premium ${keyword} Collection`,
        `Exclusive ${keyword} Selection`,
        `Official ${keyword} Store`,
        `Authorised ${keyword} Retailer`,
      ],
      "how-to": [
        `How to Choose the Best ${keyword}`,
        `How to Find ${keyword}`,
        `How to Select ${keyword}`,
        `How to Buy ${keyword}`,
      ],
      "recommendations": [
        `Top-rated ${keyword}: Expert Recommendations`,
        `Recommended ${keyword}: Top Picks`,
        `Best Rated ${keyword}: Highly Recommended`,
        `${keyword} Recommendations: Top Choices`,
      ],
      "services-guides": [
        `${keyword} Usage Guide: Complete Manual`,
        `${keyword} User Guide`,
        `${keyword} Service Guide`,
        `Getting Started with ${keyword}`,
      ],
      "tech-insights": [
        `${keyword} Comparison: Tech Insights`,
        `${keyword} Tech Comparison`,
        `Which ${keyword} is Better`,
        `${keyword} Feature Comparison`,
      ],
      "comparison": [
        `${keyword} Comparison: Which is Better`,
        `${keyword} vs Alternatives`,
        `Best ${keyword} Comparison`,
        `Comparing ${keyword} Options`,
      ],
      "expert": [
        `${keyword} - Expert Buying Guide`,
        `Expert Guide to ${keyword}`,
        `Professional Review of ${keyword}`,
        `In-Depth Analysis of ${keyword}`,
      ],
      "best": [
        `Best ${keyword}: Quality & Performance Guide`,
        `Best ${keyword} - Top Rated & Reviews`,
        `Best Rated ${keyword}: Quality Guide`,
        `Best ${keyword} Options: Top Choices`,
      ],
      "top": [
        `Top ${keyword}: Premium Choices Reviewed`,
        `Top Rated ${keyword}`,
        `Top ${keyword} Picks: Premium Selection`,
        `Top Quality ${keyword}: Expert Review`,
      ],
      "top-ranking": [
        `Top 10 ${keyword}: Complete Ranking List`,
        `Top 5 ${keyword}: Best Rankings`,
        `${keyword} Rankings: Top List`,
        `Top ${keyword} List: Comprehensive Rankings`,
      ],
      "most": [
        `Most Popular ${keyword}: Best-Selling Models`,
        `Most Recommended ${keyword}`,
        `Most Trusted ${keyword}`,
        `Most Valued ${keyword}: Popular Choices`,
      ],
    };

      const fallbacks = typeFallbacks[type] || typeFallbacks["best"];
      fallbackTitle = fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
    
    // 应用Title Case格式化
    return formatTitleCase(fallbackTitle);
  };

  const titlePrompt = `Generate a diverse, SEO-friendly page title in British English for the keyword "${keyword}".

CRITICAL SEO REQUIREMENTS:
- You MUST write in British English (UK English) ONLY - this is non-negotiable
- You MUST NOT include any Chinese characters, words, or phrases
- You MUST NOT use American English spelling, grammar, or vocabulary
- The title should be a ${selectedType} title
- The title MUST include the exact keyword "${keyword}" - preferably at the beginning or early in the title for maximum SEO impact
- The title should be SEO-friendly, compelling, and natural-sounding
- OPTIMAL LENGTH: 50-60 characters (this is the ideal length for search engine result pages - SERPs)
- Maximum 70 characters (beyond this, search engines may truncate the title in search results)
- Place the primary keyword near the beginning of the title for better SEO ranking
- Use natural language that users would actually search for
- Include action words or value propositions when appropriate
- Use British English spelling and vocabulary (e.g., "colour", "realise", "centre", "organise", "mobile phone", "shop", "whilst")
- Be creative and vary the title style - don't always use the same format

CRITICAL: TITLE CASE FORMATTING (MANDATORY):
- The title MUST be formatted in Title Case (also known as Headline Case)
- Title Case means: Capitalize the first letter of each major word
- Major words include: nouns, verbs, adjectives, adverbs, pronouns, and subordinating conjunctions
- Always capitalize the first and last word of the title, regardless of their type
- Words that should NOT be capitalized (unless they are the first or last word):
  * Articles: "a", "an", "the"
  * Short prepositions: "at", "by", "for", "in", "of", "on", "to", "up", "as", "but", "or", "nor"
  * Short conjunctions: "and", "or", "but", "nor", "so", "yet"
- Examples of Title Case:
  * CORRECT: "Best Luxury Phones: Complete Guide to Premium Devices"
  * CORRECT: "How to Choose the Best Mobile Phone for Business"
  * CORRECT: "Top 10 Most Secure Cell Phones: Rankings and Reviews"
  * WRONG: "best luxury phones: complete guide to premium devices" (all lowercase)
  * WRONG: "BEST LUXURY PHONES: COMPLETE GUIDE" (all uppercase)
  * WRONG: "Best luxury phones: complete guide to premium devices" (inconsistent)
- Brand names and proper nouns should always be capitalized: "VERTU", "iPhone", "Samsung"
- Numbers and abbreviations should follow standard capitalization rules

CRITICAL: YEAR ACCURACY (MANDATORY):
- The current year is ${currentYear} (as of the content generation date)
- ONLY include a specific year in the title if it is explicitly relevant and accurate
- If including a year, use the current year (${currentYear}) or avoid mentioning specific years
- DO NOT use outdated years (e.g., ${currentYear - 1} or earlier) unless explicitly required
- Prefer titles without specific years when possible (e.g., "Best Luxury Phones" instead of "Best Luxury Phones 2024")
- Examples:
  * WRONG: "Best Luxury Phones 2024" (if it's now ${currentYear} and 2024 is outdated)
  * CORRECT: "Best Luxury Phones ${currentYear}" or "Best Luxury Phones" (without year)
  * WRONG: "A 2024 Evaluation" (if it's now ${currentYear} and 2024 is outdated)
  * CORRECT: "A ${currentYear} Evaluation" or "A Current Evaluation"

BRITISH ENGLISH REQUIREMENTS (CRITICAL):
- Use British spelling: "colour", "realise", "centre", "organise", "customise", "optimise", "recognise", "favour", "behaviour", "honour", "labour", "defence", "travelling", "cancelled", "labelled", "modelling", "programme", "cheque", "tyre", "aluminium", "sulphur", "grey", "whilst", "amongst"
- Use British vocabulary: "mobile phone" NOT "cell phone", "shop" NOT "store", "lift" NOT "elevator", "flat" NOT "apartment", "petrol" NOT "gas", "pavement" NOT "sidewalk", "trousers" NOT "pants", "biscuit" NOT "cookie", "crisps" NOT "chips", "aubergine" NOT "eggplant", "courgette" NOT "zucchini", "post" NOT "mail", "queue" NOT "line", "holiday" NOT "vacation", "autumn" NOT "fall", "rubbish" NOT "trash", "bin" NOT "trash can", "car park" NOT "parking lot", "motorway" NOT "highway", "roundabout" NOT "traffic circle", "chemist" NOT "pharmacy", "high street" NOT "main street", "bill" NOT "check"
- Use British grammar: "The team are..." NOT "The team is...", "different to/from" NOT "different than", "at the weekend" NOT "on the weekend", "in hospital" NOT "in the hospital", "needn't" NOT "don't need to"

CRITICAL GRAMMAR RULES (MUST FOLLOW):
1. NEVER combine "Shop for" with "where to buy" - this creates grammatical errors like "Shop for where to buy"
   - WRONG: "Shop for where to buy luxury phones"
   - CORRECT: "Shop Luxury Phones - Official Store" or "Where to Buy Luxury Phones"
2. NEVER use "Best Prices" or "Cheapest" for luxury brands - use premium language instead
   - WRONG: "Best Prices for Luxury Phones" (sounds like cheap electronics)
   - CORRECT: "Premium Luxury Phones - Official Store" or "Handcrafted Luxury Phones"
3. Use PLURAL form for product categories (e.g., "Luxury Phones" not "Luxury Phone")
   - If keyword is a product category, use plural: "Luxury Phones", "Smartphones", "Watches"
   - If keyword is a specific product name, use as-is: "Agent Q", "Quantum Flip"
4. Avoid redundant phrases:
   - WRONG: "Shop for where to buy" (redundant)
   - WRONG: "Best prices cheapest" (redundant and cheap-sounding)
   - CORRECT: "Premium Selection" or "Official Store"

BRAND TONE GUIDELINES (for luxury brands like VERTU):
- Use premium language: "Premium", "Handcrafted", "Exclusive", "Official", "Authorised"
- Avoid discount language: NEVER use "Best Prices", "Cheapest", "Discounts", "Deals" (unless specifically commercial type)
- Emphasise quality: "Quality", "Craftsmanship", "Expert", "Professional"
- Use formal tone: "Official Store", "Authorised Retailer", "Premium Collection"

GRAMMAR EXAMPLES:
- CORRECT: "Buy Luxury Phones - Official Store"
- CORRECT: "Premium Luxury Phones - Handcrafted Selection"
- CORRECT: "Where to Buy Luxury Phones - Authorised Retailer"
- WRONG: "Shop for where to buy luxury phones" (grammatical error)
- WRONG: "Best Prices for Luxury Phones" (cheap-sounding, not luxury)

EXAMPLES OF GOOD TITLES (Natural, Not SEO Machine Text):
- "Buy Luxury Phones - Official Store" (declarative, natural)
- "The VERTU Online Shopping Experience" (natural, comprehensive)
- "Why Shop at VERTU Official?" (natural question users ask)
- "Complete Guide to Luxury Phones: Everything You Need to Know" (natural guide format)
- "Best Luxury Phones ${currentYear}: Top Rated Models Compared" (natural comparison, uses current year)
- "How to Choose the Best Luxury Phone: Expert Buying Guide" (natural how-to)
- "Top-rated Luxury Phones: Expert Recommendations" (natural recommendation)
- "Premium Luxury Phones - Handcrafted Collection" (natural, premium)
- "Our Service Commitment" (natural, service-focused)
- "Exclusive Benefits" (natural, benefit-focused)

EXAMPLES OF BAD TITLES (Too SEO-Optimised, Avoid These):
- "What Purchase Options Are Available for a Luxury Phone?" (stiff, search-engine-like)
- "What Are the Best Prices for Luxury Phones?" (awkward phrasing, cheap-sounding)
- "What Are the Features of Luxury Phones?" (too generic, SEO-optimised)
- "Where Can I Buy Luxury Phones?" (too search-engine-like, use "Where to Buy" instead)

Output only the title text, nothing else. No quotes, no explanations, just the title.`;

  try {
    console.log(`[GoogleAI] Generating page title for keyword: ${keyword}`);
    const result = await model.generateContent(titlePrompt);
    const response = await result.response;
    const title = response.text().trim();

    // 移除可能的引号
    const cleanedTitle = title.replace(/^["']|["']$/g, "").trim();

    if (!cleanedTitle || cleanedTitle.length === 0) {
      console.warn(`[GoogleAI] WARNING: Google AI returned empty title. Using fallback.`);
      // 直接返回备用标题，而不是抛出错误
      const fallbackTitle = getFallbackTitleByType(keyword, titleType);
      console.log(`[GoogleAI] 使用备用标题（类型: ${titleType || '随机'}）: ${fallbackTitle}`);
      return fallbackTitle;
    }

    // 验证标题是否包含关键词
    if (!cleanedTitle.toLowerCase().includes(keyword.toLowerCase())) {
      console.warn(`[GoogleAI] WARNING: Generated title does not include keyword. Title: "${cleanedTitle}", Keyword: "${keyword}"`);
      // 如果标题不包含关键词，使用对应类型的备用标题
      const fallbackTitle = getFallbackTitleByType(keyword, titleType);
      console.log(`[GoogleAI] 使用备用标题（类型: ${titleType || '随机'}）: ${fallbackTitle}`);
      return fallbackTitle;
    }

    // 验证是否包含中文
    if (/[\u4e00-\u9fff]/.test(cleanedTitle)) {
      console.warn(`[GoogleAI] WARNING: Generated title contains Chinese characters. Using fallback.`);
      // 使用对应类型的备用标题
      const fallbackTitle = getFallbackTitleByType(keyword, titleType);
      console.log(`[GoogleAI] 使用备用标题（类型: ${titleType || '随机'}）: ${fallbackTitle}`);
      return fallbackTitle;
    }
    
    // SEO优化：验证标题长度（50-60字符最佳，最多70字符）
    const titleLength = cleanedTitle.length;
    if (titleLength > 70) {
      console.warn(`[GoogleAI] ⚠️ SEO WARNING: Title is too long (${titleLength} characters). Search engines may truncate it in SERPs. Optimal length: 50-60 characters.`);
    } else if (titleLength >= 50 && titleLength <= 60) {
      console.log(`[GoogleAI] ✅ SEO OPTIMAL: Title length is perfect (${titleLength} characters) for search engine result pages.`);
    } else if (titleLength < 30) {
      console.warn(`[GoogleAI] ⚠️ SEO WARNING: Title is too short (${titleLength} characters). Consider adding more descriptive terms for better SEO visibility.`);
    } else {
      console.log(`[GoogleAI] ℹ️ Title length: ${titleLength} characters (acceptable, but 50-60 is optimal).`);
    }
    
    // SEO优化：检查关键词位置（关键词在标题前部更有利于SEO）
    const keywordPosition = cleanedTitle.toLowerCase().indexOf(keyword.toLowerCase());
    if (keywordPosition === 0) {
      console.log(`[GoogleAI] ✅ SEO OPTIMAL: Keyword "${keyword}" is at the beginning of the title - maximum SEO impact.`);
    } else if (keywordPosition > 0 && keywordPosition <= 20) {
      console.log(`[GoogleAI] ✅ SEO GOOD: Keyword "${keyword}" is in the first part of the title (position ${keywordPosition}) - good for SEO ranking.`);
    } else if (keywordPosition > 20) {
      console.warn(`[GoogleAI] ⚠️ SEO WARNING: Keyword "${keyword}" appears late in the title (position ${keywordPosition}). Consider moving it earlier for better SEO ranking.`);
    }

    // SEO优化：规范化标题格式为Title Case（首字母大写格式）
    const titleCasedTitle = formatTitleCase(cleanedTitle);
    
    console.log(`[GoogleAI] Generated title: ${titleCasedTitle}`);
    return titleCasedTitle;
  } catch (error: any) {
    console.error(`[GoogleAI] Error generating title:`, error);
    // 如果生成失败，使用对应类型的备用标题
    const fallbackTitle = getFallbackTitleByType(keyword, titleType);
    console.log(`[GoogleAI] 使用备用标题（类型: ${titleType || '随机'}）: ${fallbackTitle}`);
    return fallbackTitle;
  }
}

export async function generatePageTitle({ apiKey, keyword, titleType, onStatusUpdate, shouldAbort }: GenerateTitleOptions): Promise<string> {
  if (apiKey) {
    return generateTitleWithKey(apiKey, keyword, titleType);
  }

  return withApiKey(
    (key) => generateTitleWithKey(key, keyword, titleType),
    3, // maxRetries (标题生成失败影响较小，重试次数可以少一些)
    onStatusUpdate,
    shouldAbort // 传递暂停检查回调
  );
}

export async function generateHtmlContent({ apiKey, keyword, pageTitle, titleType, templateType, userPrompt, knowledgeBaseContent, onStatusUpdate, shouldAbort }: GenerateContentOptions): Promise<GeneratedContent> {
  // 如果提供了 apiKey，直接使用（向后兼容）
  if (apiKey) {
    return generateWithKey(apiKey, keyword, pageTitle, titleType, templateType, userPrompt, knowledgeBaseContent || KNOWLEDGE_BASE);
  }

  // 否则使用 API Key 管理器（支持多 Key 轮换和故障转移）
  return withApiKey(
    (key) => generateWithKey(key, keyword, pageTitle, titleType, templateType, userPrompt, knowledgeBaseContent || KNOWLEDGE_BASE),
    5, // maxRetries
    onStatusUpdate, // 传递状态更新回调
    shouldAbort // 传递暂停检查回调
  );
}
