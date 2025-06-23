#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import os from 'os';

const COOKIE_DIR = path.join(os.homedir(), 'Downloads', 'fetch-with-cookie', 'cookies');

class CookieManager {
  findCookieFile(domain) {
    const cleanDomain = domain.replace('www.', '');
    
    if (!fs.existsSync(COOKIE_DIR)) {
      return null;
    }
    
    const files = fs.readdirSync(COOKIE_DIR);
    const baseNames = [
      `${domain}_cookies`,
      `${cleanDomain}_cookies`,
      `www.${cleanDomain}_cookies`
    ];
    
    const matchingFiles = [];
    
    for (const file of files) {
      for (const baseName of baseNames) {
        const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*\\(\\d+\\))?\\.json$`);
        
        if (pattern.test(file)) {
          const filePath = path.join(COOKIE_DIR, file);
          const stats = fs.statSync(filePath);
          
          matchingFiles.push({
            path: filePath,
            filename: file,
            modifiedTime: stats.mtime
          });
          break;
        }
      }
    }
    
    if (matchingFiles.length === 0) {
      return null;
    }
    
    matchingFiles.sort((a, b) => b.modifiedTime - a.modifiedTime);
    return matchingFiles[0].path;
  }

  loadCookiesFromFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`❌ 加载cookie文件失败:`, error.message);
      return null;
    }
  }
}

async function testWithCookies() {
  const url = 'https://wx.zsxq.com/group/458522225218/topic/5125481221245544';
  
  console.log('🧪 测试带cookies访问知识星球...');
  console.log(`🎯 目标URL: ${url}`);

  const cookieManager = new CookieManager();
  const urlObj = new URL(url);
  const domain = urlObj.hostname;

  // 查找最新的cookie文件（Chrome扩展已包含所有相关域名的cookies）
  console.log(`🔍 查找 ${domain} 的cookie文件...`);
  const cookieFile = cookieManager.findCookieFile(domain);
  
  if (!cookieFile) {
    console.log('❌ 没有找到cookie文件');
    console.log('请使用Chrome扩展先保存cookies');
    return;
  }

  console.log(`✅ 找到cookie文件: ${cookieFile}`);
  
  const cookieData = cookieManager.loadCookiesFromFile(cookieFile);
  if (!cookieData) {
    console.log('❌ cookie文件加载失败');
    return;
  }

  console.log(`🍪 加载了 ${cookieData.cookies?.length || 0} 个cookies`);
  console.log(`📦 加载了 ${cookieData.totalLocalStorage || 0} 个localStorage项目`);
  
  // 按域名分组显示cookies
  const cookiesByDomain = {};
  if (cookieData.cookies) {
    cookieData.cookies.forEach(cookie => {
      const domain = cookie.domain;
      if (!cookiesByDomain[domain]) {
        cookiesByDomain[domain] = 0;
      }
      cookiesByDomain[domain]++;
    });
    console.log(`🍪 Cookie分布:`, cookiesByDomain);
  }
  
  // 显示localStorage信息
  if (cookieData.localStorage && Object.keys(cookieData.localStorage).length > 0) {
    console.log(`📦 localStorage内容:`);
    Object.keys(cookieData.localStorage).forEach(key => {
      const value = cookieData.localStorage[key];
      const preview = value.length > 50 ? value.substring(0, 50) + '...' : value;
      console.log(`   ${key}: ${preview}`);
    });
  }

  let browser = null;

  try {
    console.log('🚀 启动浏览器...');
    browser = await puppeteer.launch({
      headless: false,  // 显示浏览器窗口
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage'
      ]
    });

    const page = await browser.newPage();

    // 设置视口
    await page.setViewport({ width: 1366, height: 768 });

    // 设置User-Agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // 反检测
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      delete Object.getPrototypeOf(navigator).webdriver;
    });

    if (cookieData && cookieData.cookies && cookieData.cookies.length > 0) {
      console.log('🍪 设置cookies...');
      
      // 先访问域名根路径以建立context
      const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
      console.log(`🌐 先访问: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      
      // 设置每个cookie
      for (const cookie of cookieData.cookies) {
        try {
          await page.setCookie({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain.startsWith('.') ? cookie.domain : '.' + cookie.domain.replace(/^\./, ''),
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
            sameSite: cookie.sameSite || 'Lax'
          });
          console.log(`✅ 设置cookie: ${cookie.name} (${cookie.domain})`);
        } catch (cookieError) {
          console.error(`❌ 设置cookie失败 ${cookie.name}:`, cookieError.message);
        }
      }
      console.log(`✅ 已设置 ${cookieData.cookies.length} 个cookies`);
    }

    // 设置localStorage数据
    if (cookieData.localStorage && Object.keys(cookieData.localStorage).length > 0) {
      console.log(`📦 设置localStorage数据...`);
      try {
        await page.evaluate((localStorageData) => {
          for (const [key, value] of Object.entries(localStorageData)) {
            try {
              window.localStorage.setItem(key, value);
              console.log(`✅ 设置localStorage: ${key}`);
            } catch (error) {
              console.error(`❌ 设置localStorage失败 ${key}:`, error.message);
            }
          }
        }, cookieData.localStorage);
        console.log(`✅ 已设置 ${Object.keys(cookieData.localStorage).length} 个localStorage项目`);
      } catch (error) {
        console.error(`❌ 设置localStorage时出错:`, error.message);
      }
    }

    console.log(`📄 访问目标页面: ${url}`);
    const response = await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });

    console.log(`📊 状态码: ${response.status()}`);
    console.log(`📝 页面标题: ${await page.title()}`);

    // 检查当前cookies
    const currentCookies = await page.cookies();
    console.log(`🍪 当前页面cookies数量: ${currentCookies.length}`);

    // 等待页面结构
    try {
      await page.waitForFunction(
        () => {
          const nestedDivs = document.querySelectorAll('body div div');
          return nestedDivs.length >= 2;
        },
        { timeout: 10000 }
      );
      console.log('✅ 页面结构已加载');
    } catch (error) {
      console.log('⚠️  等待页面结构超时');
    }

    // 获取页面内容
    const content = await page.content();
    console.log(`📏 页面内容长度: ${content.length} 字符`);

    // 检查登录状态
    if (content.includes('登录') || content.includes('请先登录')) {
      console.log('❌ 仍然需要登录 - cookies可能已过期');
    } else if (content.includes('知识星球') && content.length > 10000) {
      console.log('✅ 页面正常加载，cookies有效！');
    } else {
      console.log('⚠️  页面状态不确定，请查看浏览器窗口');
    }

    console.log('\n🔍 浏览器窗口已打开，请查看页面内容');
    console.log('按 Ctrl+C 结束测试');

    // 保持浏览器打开
    await new Promise(() => {});

  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  } finally {
    // 注意：由于要保持浏览器打开，这里不自动关闭
  }
}

testWithCookies().catch(console.error);

process.on('SIGINT', () => {
  console.log('\n🛑 测试结束');
  process.exit(0);
});