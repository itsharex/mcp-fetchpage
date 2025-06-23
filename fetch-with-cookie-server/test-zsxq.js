#!/usr/bin/env node

import puppeteer from 'puppeteer';

const url = 'https://wx.zsxq.com/group/458522225218/topic/5125481221245544';

console.log('🧪 测试访问知识星球...');

try {
  console.log('1. 启动浏览器 (headless模式)...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ]
  });

  const page = await browser.newPage();

  console.log('2. 设置User-Agent...');
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  console.log('3. 尝试访问知识星球首页...');
  const homeResponse = await page.goto('https://wx.zsxq.com/', { 
    waitUntil: 'domcontentloaded',
    timeout: 15000 
  });
  console.log(`首页访问成功: ${homeResponse.status()}`);

  console.log('4. 尝试访问目标页面...');
  const response = await page.goto(url, { 
    waitUntil: 'domcontentloaded',
    timeout: 15000 
  });

  console.log(`✅ 目标页面访问成功!`);
  console.log(`状态码: ${response.status()}`);
  console.log(`页面标题: ${await page.title()}`);

  const content = await page.content();
  console.log(`页面内容长度: ${content.length} 字符`);

  // 检查是否需要登录
  if (content.includes('登录') || content.includes('login') || content.includes('请先登录')) {
    console.log('⚠️  页面需要登录');
  } else {
    console.log('✅ 页面可以正常访问');
  }

  await browser.close();

} catch (error) {
  console.error('❌ 访问失败:', error.message);
  
  if (error.message.includes('net::ERR_')) {
    console.log('🔍 这是网络连接错误，可能的原因:');
    console.log('1. 网站服务器拒绝连接');
    console.log('2. 需要VPN或代理');
    console.log('3. 网站有地区限制');
    console.log('4. 防火墙阻拦');
  } else if (error.message.includes('timeout')) {
    console.log('🔍 这是超时错误，可能的原因:');
    console.log('1. 网络连接慢');
    console.log('2. 网站响应慢');
    console.log('3. 需要增加timeout时间');
  }
}