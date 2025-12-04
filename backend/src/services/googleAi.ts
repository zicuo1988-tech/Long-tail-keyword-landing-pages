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
  templateType?: string; // 模板类型：template-1, template-2, template-3（template-3无字数限制）
  knowledgeBaseContent?: string;
  onStatusUpdate?: (message: string) => void; // 可选：状态更新回调
}

export interface GenerateTitleOptions {
  apiKey?: string;
  keyword: string;
  titleType?: string; // 标题类型：purchase, informational, review, commercial, how-to, recommendations, services-guides, tech-insights, comparison, expert, best, top, most
  onStatusUpdate?: (message: string) => void;
}

export interface GeneratedContent {
  articleContent: string;
  extendedContent?: string; // 扩展内容（用于模板3的第二部分，不重复）
  pageDescription?: string; // 页面描述（用于模板2和模板3）
  metaDescription?: string; // SEO meta description (150-160 characters)
  metaKeywords?: string; // SEO meta keywords (comma-separated)
  faqItems: Array<{ question: string; answer: string }>;
}

/**
 * 使用官方 SDK 生成内容
 */
async function generateWithKey(apiKey: string, keyword: string, pageTitle: string, titleType?: string, templateType?: string, knowledgeBaseContent?: string): Promise<GeneratedContent> {
  // 根据模板类型设置内容长度限制
  // template-3 无字数限制
  const isTemplate3 = templateType === "template-3";
  const currentMinLength = MIN_ARTICLE_LENGTH;
  const currentMaxLength = isTemplate3 ? 10000 : MAX_ARTICLE_LENGTH; // template-3 允许更长的内容
  
  // 初始化 Google AI 客户端
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // 获取模型实例（根据模板类型调整 maxOutputTokens）
  const model = genAI.getGenerativeModel({ 
    model: DEFAULT_MODEL,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: isTemplate3 ? 8192 : 4096, // template-3 允许更长的内容
    },
  });

  console.log(`[GoogleAI] Using model: ${DEFAULT_MODEL} with SDK`);

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

  // 生成文章内容的提示词
  const kbContent = (knowledgeBaseContent && knowledgeBaseContent.trim()) || KNOWLEDGE_BASE;
  
  // 提取知识库中明确列出的产品名称
  const knownProducts = extractProductNamesFromKnowledgeBase(kbContent);
  
  // 根据关键词匹配相关产品（只提及与关键词相关的产品）
  const relevantProducts = extractRelevantProductsFromKeyword(keyword, knownProducts);
  
  console.log(`[GoogleAI] Keyword: "${keyword}"`);
  console.log(`[GoogleAI] Relevant products matched: ${relevantProducts.length > 0 ? relevantProducts.join(", ") : "None - will use general VERTU content"}`);
  console.log(`[GoogleAI] Title type: ${titleType || 'not specified'} - content will be tailored to match this type`);

  // 根据标题类型生成内容风格指导
  const getContentStyleByType = (type?: string): string => {
    if (!type) return "";
    
    const styleMap: Record<string, string> = {
      "purchase": `CONTENT STYLE (Purchase/Transaction Type):
- Focus on WHERE TO BUY, PRICING, DEALS, and PURCHASE OPTIONS
- Emphasise value, discounts, special offers, and buying process
- Include information about purchase locations, payment options, and delivery
- Use action-oriented language: "Buy", "Purchase", "Shop for", "Find the Best"
- Highlight competitive pricing, deals, and value propositions`,
      
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
- Focus on DEALS, DISCOUNTS, SPECIAL OFFERS, and PRICING
- Emphasise savings, promotions, and limited-time offers
- Include pricing information, discount codes, and special deals
- Use promotional language: "Best Deals", "Discounts", "Special Offers", "Best Prices"
- Highlight value and savings opportunities`,
      
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

  const articlePrompt = `You are an expert SEO content strategist specialising in concise, high-value content. Write a BRIEF, SEO-optimised article about "${keyword}" that directly answers the user's search query without unnecessary length.

${contentStyleGuide ? `${contentStyleGuide}\n\n` : ""}

CRITICAL REQUIREMENTS:
- You MUST write in British English (UK English) only
- You MUST NOT include any Chinese characters, words, or phrases
- Use British English spelling (e.g., "colour", "realise", "centre", "organise")
- ALL product information MUST come EXCLUSIVELY from the knowledge base provided below
- NO fabricated information, NO assumptions, NO external knowledge beyond the knowledge base
- Content MUST be COMPLETE - every section must be fully written, no incomplete sentences or cut-off content

SEO OPTIMISATION REQUIREMENTS (Focused on Concise, High-Value Content):
1. KEYWORD OPTIMISATION:
   - Use "${keyword}" naturally in the main H2 heading, first paragraph, and 2-3 times throughout (natural density)
   - Include semantic variations related to "${keyword}"
   - Place "${keyword}" in the first sentence of the introduction

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
   - First sentence MUST include "${keyword}" and directly answer the search query
   - Second sentence provides key value proposition from knowledge base
   - Be concise and direct
   - Example: "Looking for ${keyword}? VERTU offers [specific benefit] that [value proposition]."

3. QUESTION-BASED SUBHEADINGS (use <h2> tags - MAXIMUM 2-3 headings):
   - Use question format that directly relates to "${keyword}"
   - Each H2 must include "${keyword}" or clear semantic variation
   - Examples:
     * "Why Choose ${keyword}?"
     * "What Makes ${keyword} Different?"
     * "How to Choose the Best ${keyword}?"
   - Limit to 2-3 headings maximum to keep content brief

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
   - ONE concise summary sentence
   - Reinforce value proposition using knowledge base facts
   - Example: "VERTU offers ${keyword} with [key benefit from knowledge base] to meet your needs."

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
${relevantProducts.length > 0 
  ? relevantProducts.map(p => `- ${p}`).join('\n')
  : (keyword.toLowerCase().includes("laptop") || keyword.toLowerCase().includes("notebook") || keyword.toLowerCase().includes("computer") || keyword.toLowerCase().includes("pc"))
    ? `- Focus on VERTU brand and luxury technology products relevant to "${keyword}"
- If "${keyword}" relates to laptops/notebooks/computers, discuss VERTU's approach to luxury technology, craftsmanship, and premium devices
- Do NOT mention specific product names unless they are directly related to "${keyword}"
- Keep content general and relevant to the keyword, focusing on VERTU's brand values and luxury technology positioning`
    : `- Focus on VERTU brand and general luxury mobile phone features relevant to "${keyword}"
- Do NOT mention specific product names unless they are directly related to "${keyword}"
- Keep content general and relevant to the keyword only`}

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

CONTENT ENRICHMENT GUIDELINES:
- Use the knowledge base data extensively to create rich, detailed descriptions
- Quote specific numbers, measurements, and technical details from the knowledge base
- Reference actual features, materials, and services mentioned in the knowledge base
- Create engaging narratives around the verified facts from the knowledge base
- Use varied sentence structures and descriptive language while staying factual
- Connect different aspects of the knowledge base to create comprehensive content

OUTPUT FORMAT (BRIEF, COMPLETE, SEO-Optimised HTML):
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
- Ensure the main H2 heading includes "${keyword}" naturally
- Use H2 tags for all headings (main heading and question-based subheadings)
- Keep HTML clean and semantic for better SEO crawling
- Total content must be between ${currentMinLength} and ${currentMaxLength} characters${isTemplate3 ? " (no strict limit for template-3)" : " (one screen)"}

EXAMPLE OUTPUT STRUCTURE (BRIEF, ONE-SCREEN FORMAT):
<h2>Where to Buy ${keyword} - Expert Guide</h2>
<p>Looking for ${keyword}? VERTU offers [specific benefit from knowledge base] that [value proposition].</p>

<h2>Why Choose ${keyword}?</h2>
<ol>
  <li>[Benefit 1] - [Specific detail from knowledge base]</li>
  <li>[Benefit 2] - [Specific detail from knowledge base]</li>
  <li>[Benefit 3] - [Specific detail from knowledge base]</li>
</ol>
<p>[One brief sentence connecting the benefits]</p>

<h2>What Makes ${keyword} Different?</h2>
<ol>
  <li>[Unique feature 1] - [Specific detail from knowledge base]</li>
  <li>[Unique feature 2] - [Specific detail from knowledge base]</li>
  <li>[Unique feature 3] - [Specific detail from knowledge base]</li>
</ol>
<p>[One brief sentence with context]</p>

<p>[One concise conclusion sentence reinforcing value proposition]</p>

IMPORTANT: 
- Keep total word count between 400-600 words
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

      const articleResult = await model.generateContent(promptToUse);
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
        model: DEFAULT_MODEL,
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
    const finalArticleContent = articleText
      .replace(/```[a-z]*\s*/gi, "") // 移除所有 ```language 格式
      .replace(/```\s*/g, "") // 移除所有剩余的 ```
      .trim();

    // 验证生成的内容是否包含知识库外的产品信息
    validateContentAgainstKnowledgeBase(finalArticleContent, knownProducts, "article content");
    
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

    // 生成页面描述（仅用于模板2和模板3，生成完整的描述段落）
    let pageDescription = "";
    const needsFullDescription = templateType === "template-2" || templateType === "template-3";
    
    if (needsFullDescription) {
      try {
        console.log(`[GoogleAI] Generating comprehensive page description for ${templateType}...`);
        const descModel = genAI.getGenerativeModel({
          model: DEFAULT_MODEL,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 300, // 增加token数量以支持更完整的描述
          },
        });
        
        const descPrompt = `You are an expert SEO content writer. Write a COMPREHENSIVE, COMPLETE description paragraph (3-5 sentences, 200-300 characters) for a page about "${keyword}" with title "${pageTitle}".

CRITICAL REQUIREMENTS:
- You MUST write in British English (UK English) only
- You MUST NOT include any Chinese characters, words, or phrases
- Use British English spelling (e.g., "colour", "realise", "centre", "organise")
- Write a COMPLETE paragraph (3-5 sentences), NOT just 2 sentences
- The description should be comprehensive and informative
- Include the keyword "${keyword}" naturally in the first sentence
- Provide key value propositions and benefits
- Mention specific features or advantages from the knowledge base
- Be engaging and compelling
- NO HTML tags, just plain text

DESCRIPTION STRUCTURE:
1. First sentence: Introduce the topic with the keyword "${keyword}" and main value proposition
2. Second sentence: Highlight key benefits or features
3. Third sentence: Provide additional details or advantages
4. Fourth sentence (optional): Mention specific use cases or applications
5. Fifth sentence (optional): Conclude with a compelling call-to-action or summary

TARGET LENGTH: 200-300 characters (comprehensive but not too long)

Knowledge base context: ${knowledgeBaseContent ? knowledgeBaseContent.substring(0, 1000) : "N/A"}

Write the complete description paragraph now:`;

        const descResult = await descModel.generateContent(descPrompt);
        const descResponse = await descResult.response;
        pageDescription = descResponse.text().trim();
        
        // 验证并优化描述长度
        if (pageDescription.length < 150) {
          console.warn(`[GoogleAI] Page description is too short (${pageDescription.length} chars), expected 200-300 chars`);
        } else if (pageDescription.length > 400) {
          // 如果太长，截取前350个字符并添加省略号
          pageDescription = pageDescription.substring(0, 350).trim() + "...";
          console.warn(`[GoogleAI] Page description was too long, truncated to 350 characters`);
        }
        
        // 验证内容质量
        validateContent(pageDescription, "page description");
        
        console.log(`[GoogleAI] Generated comprehensive page description: ${pageDescription.length} characters`);
      } catch (error) {
        console.warn(`[GoogleAI] Failed to generate comprehensive page description:`, error);
        // 如果生成失败，尝试从文章内容提取更长的段落
        try {
          const firstTwoParagraphs = finalArticleContent.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
          if (firstTwoParagraphs && firstTwoParagraphs.length > 0) {
            let extractedDesc = "";
            for (let i = 0; i < Math.min(2, firstTwoParagraphs.length); i++) {
              const paraText = stripHtmlTags(firstTwoParagraphs[i]).trim();
              extractedDesc += paraText + " ";
            }
            extractedDesc = extractedDesc.trim();
            // 限制在300字符左右
            if (extractedDesc.length > 300) {
              extractedDesc = extractedDesc.substring(0, 300).trim() + "...";
            }
            pageDescription = extractedDesc;
            console.log(`[GoogleAI] Extracted page description from article content: ${pageDescription.length} characters`);
          } else {
            pageDescription = `Discover ${keyword} - Expert guide with comprehensive information, detailed recommendations, and valuable insights to help you make informed decisions.`;
          }
        } catch (extractError) {
          console.warn(`[GoogleAI] Failed to extract description from article:`, extractError);
          pageDescription = `Discover ${keyword} - Expert guide with comprehensive information, detailed recommendations, and valuable insights to help you make informed decisions.`;
        }
      }
    } else {
      // 如果不是模板2或3，pageDescription保持为空字符串（模板1不需要描述）
      pageDescription = "";
    }
    
    // 确保模板2和3一定有描述（如果还是空，使用默认值）
    if (needsFullDescription) {
      if (!pageDescription || pageDescription.trim().length === 0) {
        console.warn(`[GoogleAI] ⚠️ Page description is empty for ${templateType}, using default comprehensive description`);
        pageDescription = `Discover ${keyword} - Expert guide with comprehensive information, detailed recommendations, and valuable insights to help you make informed decisions.`;
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

    // 为模板3生成扩展内容（第二部分，不重复）
    let extendedContent = "";
    if (isTemplate3) {
      try {
        console.log(`[GoogleAI] Generating extended content for template-3...`);
        const extendedModel = genAI.getGenerativeModel({
          model: DEFAULT_MODEL,
          generationConfig: {
            temperature: 0.8,
            topP: 0.95,
            topK: 40,
            maxOutputTokens: 4096, // 允许较长的扩展内容
          },
        });

        const extendedPrompt = `You are an expert SEO content writer. Write an EXTENDED, COMPREHENSIVE content section (different from the main content) about "${keyword}" with title "${pageTitle}".

CRITICAL REQUIREMENTS:
- You MUST write in British English (UK English) only
- You MUST NOT include any Chinese characters, words, or phrases
- This content should be DIFFERENT and COMPLEMENTARY to the main content
- Focus on deeper insights, additional details, advanced topics, or related aspects
- Use British English spelling (e.g., "colour", "realise", "centre", "organise")
- ALL product information MUST come EXCLUSIVELY from the knowledge base provided below
- NO fabricated information, NO assumptions, NO external knowledge beyond the knowledge base

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

        const extendedResult = await extendedModel.generateContent(extendedPrompt);
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
      errorMessage = `模型 ${DEFAULT_MODEL} 不可用。错误信息: ${errorMessage}`;
      console.error(`[GoogleAI] 模型 ${DEFAULT_MODEL} 不可用，请检查模型名称是否正确`);
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

  // 检查是否提到了其他产品（不在相关产品列表中）
  const allKnownProducts = [
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

  const mentionedProducts: string[] = [];
  for (const product of allKnownProducts) {
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
      keywords: ["watch", "horology", "timepiece", "chronograph", "grand watch"],
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

  // 通过关键词提示匹配
  for (const hint of productKeywordHints) {
    const matchesKeyword = hint.keywords.some((kw) => keywordLower.includes(kw.toLowerCase()));
    if (matchesKeyword) {
      // 如果产品列表为空（如笔记本电脑），表示该类别产品将从WordPress动态获取
      // 这种情况下返回空数组，让内容生成使用通用的VERTU品牌内容
      if (hint.productNames.length === 0) {
        // 笔记本电脑等类别，不强制匹配特定产品，允许使用通用内容
        console.log(`[GoogleAI] Keyword "${keyword}" matches category (laptop/notebook), will use general VERTU content`);
        return []; // 返回空数组，表示没有特定产品匹配，使用通用内容
      }
      
      for (const productName of hint.productNames) {
        if (knownProducts.includes(productName) && !relevantProducts.includes(productName)) {
          relevantProducts.push(productName);
        }
      }
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

function isArticleRich(html: string, templateType?: string): boolean {
  const plainText = stripHtmlTags(html).replace(/\s+/g, " ").trim();
  
  // 根据模板类型设置内容长度限制
  const isTemplate3 = templateType === "template-3";
  const currentMinLength = MIN_ARTICLE_LENGTH;
  const currentMaxLength = isTemplate3 ? 10000 : MAX_ARTICLE_LENGTH;
  
  // 检查内容长度
  const isWithinLength = plainText.length >= currentMinLength && (isTemplate3 || plainText.length <= currentMaxLength);
  
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
  const model = genAI.getGenerativeModel({
    model: DEFAULT_MODEL,
    generationConfig: {
      temperature: 0.9, // 提高温度以增加多样性
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 100,
    },
  });

  // 定义标题类型映射
  const titleTypeMap: Record<string, string> = {
    "purchase": "purchase/transaction type (e.g., 'Buy', 'Purchase', 'Shop for', 'Find the Best', 'Where to Buy', 'Best Deals on')",
    "informational": "informational/guide type (e.g., 'Complete Guide to', 'Everything About', 'Ultimate Guide to', 'All You Need to Know About')",
    "review": "review/comparison type (e.g., 'Best', 'Top Rated', 'Review', 'Comparison', 'Top 10', 'Best Rated')",
    "commercial": "commercial/deal type (e.g., 'Best Deals on', 'Discounts for', 'Special Offers on', 'Best Prices for')",
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
    if (!type || !titleTypeMap[type]) {
      // 如果没有指定类型，随机选择一个
      const allFallbacks = [
        `Buy ${keyword} - Best Deals & Reviews`,
        `Complete Guide to ${keyword}`,
        `Best ${keyword} - Top Rated & Reviews`,
        `${keyword} - Expert Buying Guide`,
        `How to Choose the Best ${keyword}`,
        `Top-rated ${keyword}: Expert Recommendations`,
        `${keyword} Usage Guide: Complete Manual`,
        `${keyword} Comparison: Tech Insights`,
        `Best ${keyword}: Quality & Performance Guide`,
        `Top ${keyword}: Premium Choices Reviewed`,
        `Most Popular ${keyword}: Best-Selling Models`,
      ];
      return allFallbacks[Math.floor(Math.random() * allFallbacks.length)];
    }

    // 根据类型生成对应的备用标题
    const typeFallbacks: Record<string, string[]> = {
      "purchase": [
        `Buy ${keyword} - Best Deals & Reviews`,
        `Purchase ${keyword} - Where to Buy`,
        `Shop for ${keyword} - Best Prices`,
        `Find the Best ${keyword} - Deals & Reviews`,
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
        `Best Deals on ${keyword}`,
        `Discounts for ${keyword}`,
        `Special Offers on ${keyword}`,
        `Best Prices for ${keyword}`,
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
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
  };

  const titlePrompt = `Generate a diverse, SEO-friendly page title in British English for the keyword "${keyword}".

CRITICAL REQUIREMENTS:
- You MUST write in British English (UK English) only
- You MUST NOT include any Chinese characters, words, or phrases
- The title should be a ${selectedType} title
- The title MUST include the exact keyword "${keyword}"
- The title should be SEO-friendly, compelling, and natural-sounding
- Keep it concise (maximum 65 characters recommended, but can be slightly longer if needed for clarity)
- Use British English spelling and vocabulary (e.g., "colour", "realise", "centre", "organise")
- Be creative and vary the title style - don't always use the same format
- Consider the context when choosing title type:
  * If keyword is about choosing/buying: use "How to" type (e.g., "How to choose a luxury phone")
  * If keyword is about recommendations/ratings: use "Recommendations" type (e.g., "Top-rated Luxury Phone")
  * If keyword is about services/features: use "Services Guides" type (e.g., "Ruby Key usage")
  * If keyword is about comparison/tech: use "Tech Insights" type (e.g., "Claude Sonnet 4.5 vs Gemini 3 Pro")
  * If keyword suggests best/quality: use "Best" type (e.g., "Best Luxury Phone: Quality & Performance")
  * If keyword suggests top/premium: use "Top" type (e.g., "Top Luxury Phones: Premium Choices")
  * If keyword suggests popularity/trending: use "Most" type (e.g., "Most Popular Luxury Phone")
  * If keyword suggests a product: use purchase/comparison types
  * If keyword is informational: use guide types
  * If keyword is technical: use how-to/tech insights types

EXAMPLES OF GOOD TITLES:
- "Buy Best Android Phones - Best Deals & Reviews"
- "Complete Guide to Android Phones: Everything You Need to Know"
- "Best Android Phones 2024: Top Rated Models Compared"
- "How to Choose the Best Android Phone: Expert Buying Guide"
- "Top-rated Luxury Phone: Expert Recommendations"
- "Ruby Key Usage Guide: Complete Service Manual"
- "Claude Sonnet 4.5 vs Gemini 3 Pro: Tech Comparison"
- "Android Phones vs iPhone: Which is Better for You?"
- "Best Deals on Android Phones: Discounts & Special Offers"
- "Best Luxury Phone: Quality & Performance Guide"
- "Top Luxury Phones: Premium Choices Reviewed"
- "Top 10 Luxury Phones: Complete Ranking List"
- "Most Popular Luxury Phone: Best-Selling Models"

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

    console.log(`[GoogleAI] Generated title: ${cleanedTitle}`);
    return cleanedTitle;
  } catch (error: any) {
    console.error(`[GoogleAI] Error generating title:`, error);
    // 如果生成失败，使用对应类型的备用标题
    const fallbackTitle = getFallbackTitleByType(keyword, titleType);
    console.log(`[GoogleAI] 使用备用标题（类型: ${titleType || '随机'}）: ${fallbackTitle}`);
    return fallbackTitle;
  }
}

export async function generatePageTitle({ apiKey, keyword, titleType, onStatusUpdate }: GenerateTitleOptions): Promise<string> {
  if (apiKey) {
    return generateTitleWithKey(apiKey, keyword, titleType);
  }

  return withApiKey(
    (key) => generateTitleWithKey(key, keyword, titleType),
    3, // maxRetries (标题生成失败影响较小，重试次数可以少一些)
    onStatusUpdate
  );
}

export async function generateHtmlContent({ apiKey, keyword, pageTitle, titleType, templateType, knowledgeBaseContent, onStatusUpdate }: GenerateContentOptions): Promise<GeneratedContent> {
  // 如果提供了 apiKey，直接使用（向后兼容）
  if (apiKey) {
    return generateWithKey(apiKey, keyword, pageTitle, titleType, templateType, knowledgeBaseContent || KNOWLEDGE_BASE);
  }

  // 否则使用 API Key 管理器（支持多 Key 轮换和故障转移）
  return withApiKey(
    (key) => generateWithKey(key, keyword, pageTitle, titleType, templateType, knowledgeBaseContent || KNOWLEDGE_BASE),
    5, // maxRetries
    onStatusUpdate // 传递状态更新回调
  );
}
