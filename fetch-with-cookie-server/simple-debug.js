#!/usr/bin/env node

import puppeteer from 'puppeteer';

const url = process.argv[2];

if (!url) {
  console.log('用法: node simple-debug.js <URL>');
  process.exit(1);
}

console.log(`🔧 简单调试: ${url}`);

try {
  console.log('🚀 启动浏览器...');
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: 30000
  });

  console.log('📄 创建新页面...');
  const page = await browser.newPage();

  console.log('🌐 访问页面...');
  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  console.log(`✅ 成功! 状态码: ${response.status()}`);
  console.log(`📝 标题: ${await page.title()}`);
  
  console.log('🔍 浏览器窗口已打开，按 Ctrl+C 结束');
  
  // 保持浏览器打开
  await new Promise(() => {});

} catch (error) {
  console.error('❌ 错误:', error.message);
  process.exit(1);
}

process.on('SIGINT', () => {
  console.log('\n🛑 调试结束');
  process.exit(0);
});