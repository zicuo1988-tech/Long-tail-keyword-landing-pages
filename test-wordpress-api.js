/**
 * WordPress API 测试脚本
 * 用于直接测试 WordPress API 是否能获取到 Agent Q、Quantum Flip、Signature 等产品
 */

const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function testWordPressAPI() {
  console.log('\n========== WordPress API 测试工具 ==========\n');
  
  // 从用户获取 WordPress 配置
  const config = await new Promise((resolve) => {
    console.log('请输入您的 WordPress 配置信息：\n');
    
    rl.question('WordPress URL (例如: https://vertu.com): ', (url) => {
      rl.question('WordPress 用户名: ', (username) => {
        rl.question('WordPress 应用密码: ', (password) => {
          rl.close();
          resolve({ url, username, password });
        });
      });
    });
  });

  const client = axios.create({
    baseURL: `${config.url}/wp-json/wc/v3`,
    auth: {
      username: config.username,
      password: config.password,
    },
    headers: {
      "Content-Type": "application/json",
    },
  });

  console.log('\n========== 测试开始 ==========\n');

  // 测试 1: 搜索 "Cell Phones"
  console.log('测试 1: 搜索关键词 "Cell Phones"...\n');
  try {
    const response1 = await client.get('/products', {
      params: {
        search: 'Cell Phones',
        per_page: 100,
        status: 'publish',
      }
    });
    
    console.log(`✅ 获取到 ${response1.data.length} 个产品\n`);
    console.log('产品列表:');
    response1.data.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.name}`);
      console.log(`     状态: ${p.status}, 库存: ${p.stock_status}`);
      console.log(`     分类: ${p.categories?.map(c => c.name).join(', ') || '无'}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试 2: 搜索 "Agent Q"
  console.log('\n测试 2: 搜索关键词 "Agent Q"...\n');
  try {
    const response2 = await client.get('/products', {
      params: {
        search: 'Agent Q',
        per_page: 20,
        status: 'publish',
      }
    });
    
    console.log(`✅ 获取到 ${response2.data.length} 个产品\n`);
    response2.data.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.name}`);
      console.log(`     状态: ${p.status}, 库存: ${p.stock_status}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试 3: 搜索 "Quantum Flip"
  console.log('\n测试 3: 搜索关键词 "Quantum Flip"...\n');
  try {
    const response3 = await client.get('/products', {
      params: {
        search: 'Quantum Flip',
        per_page: 20,
        status: 'publish',
      }
    });
    
    console.log(`✅ 获取到 ${response3.data.length} 个产品\n`);
    response3.data.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.name}`);
      console.log(`     状态: ${p.status}, 库存: ${p.stock_status}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试 4: 搜索 "Signature"
  console.log('\n测试 4: 搜索关键词 "Signature"...\n');
  try {
    const response4 = await client.get('/products', {
      params: {
        search: 'Signature',
        per_page: 20,
        status: 'publish',
      }
    });
    
    console.log(`✅ 获取到 ${response4.data.length} 个产品\n`);
    response4.data.forEach((p, idx) => {
      console.log(`  ${idx + 1}. ${p.name}`);
      console.log(`     状态: ${p.status}, 库存: ${p.stock_status}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  // 测试 5: 获取 Phones 分类的产品
  console.log('\n测试 5: 获取 "Phones" 分类的所有产品...\n');
  try {
    // 先获取 Phones 分类 ID
    const categoriesResponse = await client.get('/products/categories', {
      params: {
        search: 'Phones',
        per_page: 5,
      }
    });
    
    if (categoriesResponse.data.length > 0) {
      const phoneCategory = categoriesResponse.data[0];
      console.log(`找到分类: ${phoneCategory.name} (ID: ${phoneCategory.id})\n`);
      
      // 获取该分类下的所有产品
      const productsResponse = await client.get('/products', {
        params: {
          category: phoneCategory.id,
          per_page: 100,
          status: 'publish',
        }
      });
      
      console.log(`✅ 获取到 ${productsResponse.data.length} 个产品\n`);
      console.log('产品列表:');
      productsResponse.data.forEach((p, idx) => {
        console.log(`  ${idx + 1}. ${p.name}`);
        console.log(`     状态: ${p.status}, 库存: ${p.stock_status}`);
        console.log('');
      });
    } else {
      console.log('❌ 未找到 Phones 分类');
    }
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }

  console.log('\n========== 测试结束 ==========\n');
  console.log('📝 诊断建议:');
  console.log('1. 如果所有测试都返回 0 个产品，请检查 WordPress 认证信息是否正确');
  console.log('2. 如果 "Cell Phones" 搜索返回 0 个产品，说明 WordPress 搜索功能可能不支持空格或复合词');
  console.log('3. 如果 "Agent Q" 等搜索返回 0 个产品，说明这些产品在 WordPress 中可能：');
  console.log('   - 未发布（status 不是 "publish"）');
  console.log('   - 产品名称不包含搜索关键词');
  console.log('   - 产品被移动到其他站点或已删除');
  console.log('4. 建议在 WordPress 后台检查产品状态和名称');
}

testWordPressAPI().catch(console.error);

