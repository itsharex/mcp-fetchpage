#!/usr/bin/env node

import puppeteer from 'puppeteer';

console.log('🧪 测试 Puppeteer 基本功能...');

try {
  console.log('1. 检查 Puppeteer 版本...');
  console.log(`Puppeteer 版本: ${puppeteer.executablePath ? '已安装' : '未找到'}`);

  console.log('2. 启动浏览器...');
  const browser = await puppeteer.launch({
    headless: true,  // 先用 headless 模式测试
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });

  console.log('3. 创建页面...');
  const page = await browser.newPage();

  console.log('4. 访问简单页面...');
  await page.goto('https://www.google.com', { 
    waitUntil: 'domcontentloaded',
    timeout: 10000 
  });

  console.log('5. 获取页面标题...');
  const title = await page.title();
  console.log(`页面标题: ${title}`);

  console.log('6. 关闭浏览器...');
  await browser.close();

  console.log('✅ Puppeteer 测试成功!');

} catch (error) {
  console.error('❌ Puppeteer 测试失败:', error.message);
  console.error('详细错误:', error);
  
  // 提供一些调试建议
  console.log('\n🔧 调试建议:');
  console.log('1. 检查是否有足够的内存');
  console.log('2. 检查是否有Chrome浏览器权限问题');
  console.log('3. 尝试重启终端');
  console.log('4. 检查网络连接');
}