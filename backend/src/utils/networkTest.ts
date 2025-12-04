/**
 * 网络连接测试工具
 */

/**
 * 测试是否能访问 Google AI API
 */
export async function testGoogleAIConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch('https://generativelanguage.googleapis.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000), // 5秒超时
    });
    
    if (response.ok || response.status < 500) {
      return {
        success: true,
        message: '可以访问 Google AI API',
      };
    } else {
      return {
        success: false,
        message: `连接失败，状态码: ${response.status}`,
      };
    }
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    
    if (errorMessage.includes('fetch failed') || errorMessage.includes('ECONNREFUSED')) {
      return {
        success: false,
        message: '无法连接到 Google AI API。可能的原因：\n1. 网络无法访问 Google 服务（需要配置代理）\n2. DNS 解析失败\n3. 防火墙阻止连接',
      };
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      return {
        success: false,
        message: '连接超时，请检查网络连接或配置代理',
      };
    }
    
    return {
      success: false,
      message: `连接测试失败: ${errorMessage}`,
    };
  }
}

/**
 * 测试 DNS 解析
 */
export async function testDNSResolution(): Promise<{ success: boolean; message: string }> {
  try {
    // 简单的 DNS 测试
    const testUrl = 'https://generativelanguage.googleapis.com';
    const url = new URL(testUrl);
    
    return {
      success: true,
      message: `DNS 解析成功: ${url.hostname}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: `DNS 解析失败: ${error.message}`,
    };
  }
}

