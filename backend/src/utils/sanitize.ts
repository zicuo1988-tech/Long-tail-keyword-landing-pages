/**
 * 轻量级敏感信息清洗工具
 * 仅删除/掩码已知的敏感字段，防止在接口或日志中透出账号密码/API Key
 */

type AnyRecord = Record<string, any>;

const SENSITIVE_FIELDS = new Set([
  "googleApiKey",
  "apiKey",
  "appPassword",
  "consumerKey",
  "consumerSecret",
  "accessToken",
  "refreshToken",
]);

/**
 * 对 WordPress 凭证进行掩码处理：
 * - 保留 url、username，移除密码/密钥
 */
function sanitizeWordpressCredentials(value: AnyRecord) {
  if (!value) return value;
  const { url, username } = value;
  return { url, username };
}

/**
 * 递归移除已知敏感字段
 */
export function sanitizeSensitive(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeSensitive(item));
  }

  if (obj && typeof obj === "object") {
    // 针对 WordPress 凭证单独处理
    if (obj.wordpress) {
      return {
        ...sanitizeSensitive({ ...obj, wordpress: sanitizeWordpressCredentials(obj.wordpress) }),
      };
    }

    const result: AnyRecord = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.has(key)) {
        continue; // 直接删除敏感字段
      }
      result[key] = sanitizeSensitive(value);
    }
    return result;
  }

  return obj;
}





