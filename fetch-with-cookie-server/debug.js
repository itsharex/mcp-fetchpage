#!/usr/bin/env node

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import os from 'os';

// Cookie存储目录
const COOKIE_DIR = path.join(os.homedir(), 'Downloads', 'fetch-with-cookie', 'cookies');

class DebugCookieManager {
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

async function debugFetch(url, options = {}) {
  const {
    headless = false,  // 调试模式默认显示浏览器
    waitFor = null,
    timeout = 30000,
    skipCookies = false
  } = options;

  console.log(`🔧 开始调试: ${url}`);
  console.log(`📋 选项: headless=${headless}, waitFor=${waitFor}, timeout=${timeout}, skipCookies=${skipCookies}`);

  let browser = null;
  const cookieManager = new DebugCookieManager();

  try {
    // 解析域名
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    console.log(`🌐 域名: ${domain}`);

    // 获取cookie数据
    let cookieData = null;
    if (!skipCookies) {
      const cookieFile = cookieManager.findCookieFile(domain);
      if (cookieFile) {
        cookieData = cookieManager.loadCookiesFromFile(cookieFile);
        console.log(`🍪 找到cookie文件: ${cookieFile}`);
        console.log(`🍪 Cookie数量: ${cookieData?.cookies?.length || 0}`);
      } else {
        console.log(`⚠️  没有找到${domain}的cookie文件`);
      }
    } else {
      console.log(`⏭️  跳过cookie加载`);
    }

    // 启动浏览器
    console.log(`🚀 启动浏览器 (headless: ${headless})...`);
    browser = await puppeteer.launch({
      headless: headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=VizDisplayCompositor',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-sync',
        '--disable-translate',
        '--disable-default-apps',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--ignore-certificate-errors-spki-list'
      ],
      timeout: 60000  // 增加启动超时时间
    });

    const page = await browser.newPage();

    // 设置视口
    await page.setViewport({
      width: 1366,
      height: 768,
      deviceScaleFactor: 1
    });

    // 随机User-Agent
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(randomUserAgent);
    console.log(`👤 User-Agent: ${randomUserAgent}`);

    // 禁用自动化检测
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      delete Object.getPrototypeOf(navigator).webdriver;
      Object.defineProperty(window, 'chrome', {
        get: () => ({
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        }),
      });
    });

    // 设置页面事件监听
    page.on('error', (error) => {
      console.error('❌ 页面错误:', error.message);
    });

    page.on('pageerror', (error) => {
      console.error('❌ 页面JS错误:', error.message);
    });

    page.on('requestfailed', (request) => {
      console.warn(`⚠️  请求失败: ${request.url()} - ${request.failure()?.errorText}`);
    });

    // 设置cookies
    if (cookieData && cookieData.cookies && cookieData.cookies.length > 0) {
      console.log(`🍪 设置cookies...`);
      try {
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        console.log(`🌐 先访问域名根路径: ${baseUrl}`);
        
        // 增加重试机制
        let retryCount = 0;
        const maxRetries = 3;
        
        while (retryCount < maxRetries) {
          try {
            await page.goto(baseUrl, { 
              waitUntil: 'domcontentloaded', 
              timeout: 15000
            });
            break;
          } catch (gotoError) {
            retryCount++;
            console.warn(`⚠️  访问域名失败 (尝试 ${retryCount}/${maxRetries}): ${gotoError.message}`);
            if (retryCount >= maxRetries) {
              throw gotoError;
            }
            await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒后重试
          }
        }
        
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
            console.log(`✅ 设置cookie: ${cookie.name}`);
          } catch (cookieError) {
            console.error(`❌ 设置cookie失败 ${cookie.name}:`, cookieError.message);
          }
        }
        console.log(`✅ cookies设置完成`);
      } catch (error) {
        console.error('❌ 设置cookies时出错:', error.message);
        console.log('⚠️  将继续不使用cookies访问页面');
      }
    }

    // 访问目标页面
    console.log(`📄 访问页面: ${url}`);
    let response;
    
    // 增加访问页面的重试机制
    let pageRetryCount = 0;
    const maxPageRetries = 3;
    
    while (pageRetryCount < maxPageRetries) {
      try {
        console.log(`🔄 尝试访问页面 (${pageRetryCount + 1}/${maxPageRetries})...`);
        response = await page.goto(url, { 
          waitUntil: 'networkidle2',
          timeout: timeout 
        });
        break;
      } catch (pageError) {
        pageRetryCount++;
        console.warn(`⚠️  访问页面失败 (尝试 ${pageRetryCount}/${maxPageRetries}): ${pageError.message}`);
        
        if (pageRetryCount >= maxPageRetries) {
          // 最后一次尝试使用更宽松的等待策略
          console.log(`🔄 最后尝试使用宽松策略...`);
          try {
            response = await page.goto(url, { 
              waitUntil: 'domcontentloaded',
              timeout: timeout * 2
            });
            break;
          } catch (finalError) {
            throw new Error(`页面访问彻底失败: ${finalError.message}`);
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒后重试
      }
    }
    
    console.log(`📊 状态码: ${response.status()}`);
    console.log(`📝 页面标题: ${await page.title()}`);

    // 等待指定元素或默认结构
    if (waitFor) {
      console.log(`⏳ 等待元素: ${waitFor}`);
      try {
        await page.waitForSelector(waitFor, { timeout: timeout });
        console.log(`✅ 元素已出现: ${waitFor}`);
      } catch (error) {
        console.error(`❌ 等待元素超时: ${waitFor}`);
      }
    } else {
      console.log(`⏳ 等待页面结构加载...`);
      try {
        await page.waitForFunction(
          () => {
            const nestedDivs = document.querySelectorAll('body div div');
            return nestedDivs.length >= 2;
          },
          { timeout: timeout }
        );
        console.log(`✅ 页面结构已加载`);
      } catch (error) {
        console.error(`⚠️  等待页面结构超时`);
      }
    }

    // 获取当前cookies
    const currentCookies = await page.cookies();
    console.log(`🍪 当前页面cookies数量: ${currentCookies.length}`);

    // 获取页面内容
    const content = await page.content();
    console.log(`📏 页面内容长度: ${content.length} 字符`);

    if (!headless) {
      console.log(`\n🔍 浏览器窗口已打开，按 Ctrl+C 结束调试\n`);
      // 保持浏览器打开直到用户按Ctrl+C
      await new Promise(() => {});
    }

    return {
      status: response.status(),
      title: await page.title(),
      contentLength: content.length,
      cookiesCount: currentCookies.length,
      content: content
    };

  } catch (error) {
    console.error(`❌ 调试失败:`, error.message);
    throw error;
  } finally {
    if (browser && headless) {
      await browser.close();
    }
  }
}

// 命令行参数处理
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(`
🔧 Fetch With Cookie 调试工具

用法:
  node debug.js <URL> [选项]

选项:
  --headless        在后台运行 (默认: false，调试模式显示浏览器)
  --wait-for=SELECTOR  等待指定CSS选择器
  --timeout=MS      超时时间毫秒 (默认: 30000)
  --skip-cookies    跳过cookie加载

示例:
  node debug.js https://example.com
  node debug.js https://spa-site.com --wait-for=".content"
  node debug.js https://site.com --headless --timeout=60000
  node debug.js https://public-site.com --skip-cookies
`);
  process.exit(1);
}

const url = args[0];
const options = {};

// 解析命令行参数
for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--headless') {
    options.headless = true;
  } else if (arg === '--skip-cookies') {
    options.skipCookies = true;
  } else if (arg.startsWith('--wait-for=')) {
    options.waitFor = arg.split('=')[1];
  } else if (arg.startsWith('--timeout=')) {
    options.timeout = parseInt(arg.split('=')[1]);
  }
}

// 运行调试
debugFetch(url, options)
  .then(result => {
    console.log(`\n✅ 调试完成!`);
    console.log(`📊 结果: 状态=${result.status}, 标题="${result.title}", 内容=${result.contentLength}字符, Cookies=${result.cookiesCount}个`);
    
    if (options.headless) {
      process.exit(0);
    }
  })
  .catch(error => {
    console.error(`\n❌ 调试失败:`, error.message);
    process.exit(1);
  });

// 处理Ctrl+C
process.on('SIGINT', () => {
  console.log(`\n🛑 调试已停止`);
  process.exit(0);
});