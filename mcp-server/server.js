#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';
import os from 'os';
import puppeteer from 'puppeteer';

// Cookie存储目录 - 统一使用Downloads下的mcp-fetch-page目录
const COOKIE_DIR = path.join(os.homedir(), 'Downloads', 'mcp-fetch-page', 'cookies');
// 页面内容存储目录
const PAGES_DIR = path.join(os.homedir(), 'Downloads', 'mcp-fetch-page', 'pages');

// 优先使用系统已安装的 Chrome，避免依赖 Puppeteer 管理的浏览器下载
function resolveSystemChromePath() {
  try {
    const candidates = [];
    const platform = process.platform;

    if (platform === 'darwin') {
      // 常见的 macOS 安装路径（稳定版 / Beta / Canary）
      candidates.push(
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
      );
    } else if (platform === 'win32') {
      const programFiles = process.env['PROGRAMFILES'] || 'C\\\x3a\\Program Files';
      const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C\\\x3a\\Program Files (x86)';
      const localAppData = process.env['LOCALAPPDATA'] || 'C\\\x3a\\Users\\%USERNAME%\\AppData\\Local';
      candidates.push(
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
      );
    } else {
      // Linux 常见路径
      candidates.push(
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium'
      );
    }

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return p;
      } catch (_) {}
    }
    return null;
  } catch (_) {
    return null;
  }
}

// 加载域名选择器配置
let domainSelectors = {};
try {
  const currentDir = path.dirname(import.meta.url.replace('file://', ''));
  const configPath = path.join(currentDir, 'domain-selectors.json');
  const configContent = fs.readFileSync(configPath, 'utf8');
  domainSelectors = JSON.parse(configContent);
} catch (error) {
  // 如果配置文件不存在或读取失败，使用空配置
  domainSelectors = {};
}


// 根据URL获取对应的CSS选择器
function getSelectorForDomain(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // 精确匹配
    if (domainSelectors[hostname]) {
      return domainSelectors[hostname];
    }
    
    // 子域名匹配（去掉www等前缀）
    const mainDomain = hostname.replace(/^(www\.|m\.|mobile\.)/, '');
    if (domainSelectors[mainDomain]) {
      return domainSelectors[mainDomain];
    }
    
    // 部分匹配（查找包含的域名）
    for (const [domain, selector] of Object.entries(domainSelectors)) {
      if (hostname.includes(domain) || domain.includes(mainDomain)) {
        return selector;
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}


class CookieManager {
  constructor() {
    this.cookiesCache = {};
  }

  // 列出所有cookie文件路径
  listAllCookieFiles() {
    if (!fs.existsSync(COOKIE_DIR)) {
      return [];
    }
    const files = fs.readdirSync(COOKIE_DIR);
    const result = [];
    for (const file of files) {
      // 仅匹配 *_cookies.json 及可能的重复命名 *_cookies (n).json
      if (/_cookies(\s*\(\d+\))?\.json$/i.test(file)) {
        result.push(path.join(COOKIE_DIR, file));
      }
    }
    return result;
  }

  // 从所有文件加载并合并cookie和localStorage（仅分域名）
  loadAndMergeAllCookies() {
    const files = this.listAllCookieFiles();
    if (files.length === 0) {
      return null;
    }

    const merged = {
      cookies: [],
      localStorageByDomain: {}
    };

    const seenKeys = new Set(); // 用于cookie去重：name|domain|path

    for (const filePath of files) {
      try {
        const data = this.loadCookiesFromFile(filePath);
        if (!data) continue;
        const filename = path.basename(filePath);
        // 从文件名提取来源域名: <domain>_cookies.json 或 <domain>_cookies (n).json
        let sourceDomain = null;
        const m = filename.match(/^(.*?)_cookies(\s*\(\d+\))?\.json$/i);
        if (m && m[1]) {
          sourceDomain = m[1].replace(/^www\./, '');
        }

        // 合并cookies
        const cookies = Array.isArray(data.cookies) ? data.cookies : [];
        for (const c of cookies) {
          if (!c || !c.name || !c.value || !c.domain) continue;
          const pathVal = c.path || '/';
          const key = `${c.name}|${c.domain}|${pathVal}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          merged.cookies.push({ ...c, path: pathVal });
        }

        // 合并localStorage到对应域（后读覆盖先读）
        if (data.localStorage && typeof data.localStorage === 'object' && sourceDomain) {
          if (!merged.localStorageByDomain[sourceDomain]) {
            merged.localStorageByDomain[sourceDomain] = {};
          }
          Object.assign(merged.localStorageByDomain[sourceDomain], data.localStorage);
        }
      } catch (err) {
        // 忽略单个文件解析错误
        continue;
      }
    }

    if (merged.cookies.length === 0 && Object.keys(merged.localStorageByDomain).length === 0) {
      return null;
    }
    return merged;
  }

  findCookieFile(domain) {
    const cleanDomain = domain.replace('www.', '');
    
    if (!fs.existsSync(COOKIE_DIR)) {
      return null;
    }
    
    // 读取目录中的所有文件
    const files = fs.readdirSync(COOKIE_DIR);
    
    // 生成可能的文件名模式（包括浏览器重命名的版本）
    const baseNames = [
      `${domain}_cookies`,
      `${cleanDomain}_cookies`,
      `www.${cleanDomain}_cookies`
    ];
    
    const matchingFiles = [];
    
    for (const file of files) {
      // 检查文件是否匹配任何基础名称模式
      for (const baseName of baseNames) {
        // 匹配原始文件名或带编号的重复文件名
        // 例如: example.com_cookies.json, example.com_cookies (1).json, example.com_cookies (2).json
        const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*\\(\\d+\\))?\\.json$`);
        
        if (pattern.test(file)) {
          const filePath = path.join(COOKIE_DIR, file);
          const stats = fs.statSync(filePath);
          
          matchingFiles.push({
            path: filePath,
            filename: file,
            modifiedTime: stats.mtime,
            baseName: baseName
          });
          break; // 避免同一个文件匹配多个baseName
        }
      }
    }
    
    if (matchingFiles.length === 0) {
      return null;
    }
    
    // 按修改时间降序排序，返回最新的文件
    matchingFiles.sort((a, b) => b.modifiedTime - a.modifiedTime);
    
    const latestFile = matchingFiles[0];
    
    // 如果有多个文件，在控制台输出信息
    if (matchingFiles.length > 1) {
      console.error(`📁 为域名 ${domain} 找到 ${matchingFiles.length} 个cookie文件:`);
      matchingFiles.forEach((file, index) => {
        const isLatest = index === 0 ? ' (最新)' : '';
        console.error(`   ${file.filename} - ${file.modifiedTime.toLocaleString()}${isLatest}`);
      });
      console.error(`🎯 选择最新文件: ${latestFile.filename}`);
    }
    
    return latestFile.path;
  }

  loadCookiesFromFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`加载cookie文件失败 ${filePath}:`, error.message);
      return null;
    }
  }

  parseCookieData(cookieData) {
    try {
      return JSON.parse(cookieData);
    } catch (error) {
      throw new Error(`无效的cookie JSON格式: ${error.message}`);
    }
  }

  saveCookiesToFile(domain, cookieData) {
    if (!fs.existsSync(COOKIE_DIR)) {
      fs.mkdirSync(COOKIE_DIR, { recursive: true });
    }
    
    const cleanDomain = domain.replace('www.', '');
    const filePath = path.join(COOKIE_DIR, `${cleanDomain}_cookies.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(cookieData, null, 2), 'utf8');
    console.error(`✅ Cookie已保存到: ${filePath}`);
  }

  isCookieExpired(cookieData) {
    try {
      if (!cookieData || !cookieData.cookies) return true;
      
      const now = new Date();
      let hasExpiredCookies = false;
      let expiredCount = 0;
      let totalWithExpiration = 0;
      const expiredCookieNames = [];
      
      // 检查每个Cookie的过期时间
      for (const cookie of cookieData.cookies) {
        if (cookie.expirationDate) {
          totalWithExpiration++;
          // expirationDate是Unix时间戳（秒），需要转换为毫秒
          const expireTime = new Date(cookie.expirationDate * 1000);
          if (now > expireTime) {
            hasExpiredCookies = true;
            expiredCount++;
            expiredCookieNames.push(cookie.name);
          }
        }
        // 如果Cookie没有过期时间，认为是会话Cookie，不检查过期
      }
      
      // 如果有设置过期时间的Cookie，并且其中有些已过期，则返回过期信息
      if (hasExpiredCookies && totalWithExpiration > 0) {
        console.error(`⚠️  检测到 ${expiredCount}/${totalWithExpiration} 个Cookie已过期:`);
        console.error(`   过期Cookie: ${expiredCookieNames.join(', ')}`);
        return true;
      }
      
      // 如果所有Cookie都没有过期时间，或都未过期，则认为有效
      return false;
    } catch (error) {
      console.error('Cookie过期检测失败:', error);
      return true;
    }
  }

  cookiesToString(cookieData) {
    const cookies = [];
    for (const cookie of cookieData.cookies || []) {
      cookies.push(`${cookie.name}=${cookie.value}`);
    }
    return cookies.join('; ');
  }
}

// 保存页面内容到文件（成功或失败都保存）
function savePageContent(url, content, title, isError = false) {
  try {
    // 创建pages目录
    if (!fs.existsSync(PAGES_DIR)) {
      fs.mkdirSync(PAGES_DIR, { recursive: true });
    }
    
    // 根据URL生成文件名
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    const pathname = urlObj.pathname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const statusSuffix = isError ? '_ERROR' : '';
    const filename = `${domain}${pathname}_${timestamp}${statusSuffix}.md`;
    const filePath = path.join(PAGES_DIR, filename);
    
    // 保存为Markdown文件
    const textContent = content;
    
    fs.writeFileSync(filePath, textContent, 'utf8');
    return filePath;
  } catch (error) {
    console.error(`❌ 保存页面内容失败:`, error.message);
    return null;
  }
}


// 创建MCP服务器
const server = new Server(
  {
    name: 'mcp-fetch-page',
    version: '0.3.0',
  },
  {
    capabilities: {
      tools: {},
      notifications: {},
    },
  }
);

const cookieManager = new CookieManager();

// 注册工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetchpage',
        description: 'Fetch web pages using browser automation with full JavaScript rendering. Supports automatic cookie management, localStorage, CSS selectors, and dynamic content. Cookies are automatically loaded from local storage if available.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch'
            },
            waitFor: {
              type: 'string',
              description: 'CSS selector to extract specific content only (optional, extracts only content within this selector)'
            },
            headless: {
              type: 'boolean',
              description: 'Run browser in headless mode (optional, default: true)'
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds (default: 30000)',
              default: 30000
            }
          },
          required: ['url']
        }
      }
    ]
  };
});


// 处理SPA页面请求的函数（使用Puppeteer）
async function handleFetchSpaWithCookies(args, sendProgress = null, shouldSaveFile = true) {
  const { url, waitFor, timeout = 30000, headless = true } = args;

  if (!url) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: URL parameter is required'
        }
      ]
    };
  }

  let browser = null;


    // 解析域名
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // 获取cookie数据 - 自动从文件加载所有cookies
    let cookieData = null;

    // 自动合并所有cookie文件，解决短链/跨域跳转漏cookie问题
    const merged = cookieManager.loadAndMergeAllCookies();
    // 收集需要在返回内容中提示给用户的信息（例如 cookie 过期提醒）
    const advisoryNotes = [];
    if (merged) {
      const hasExpired = cookieManager.isCookieExpired(merged);
      cookieData = merged;
      if (sendProgress) await sendProgress(0, 1, `已读取Cookie（合并 ${cookieData.cookies?.length || 0} 个${hasExpired ? '，包含过期项' : ''}）`);
      if (hasExpired) {
        advisoryNotes.push(
          '⚠️ 检测到部分 Cookie 可能已过期：如果内容需要登录但无法访问，建议使用 Chrome 扩展 “Fetch Page MCP Tools” 刷新本地登录信息后重试。',
          `步骤：\n1) 打开并登录：${url}\n2) 通过扩展保存 cookies/localStorage\n3) 回到对话再次调用 mcp fetchpage`
        );
      }
    } else {
      cookieData = null;
      if (sendProgress) await sendProgress(0, 1, '无Cookie');
    }
    
    // 启动Puppeteer浏览器，使用系统 Chrome（避免下载受管浏览器）
    const launchOptions = {
      headless: headless,
      defaultViewport: null, // 允许浏览器使用默认视口
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
        '--disable-web-security' // 有助于cookie设置
        // 移除 --no-zygote 和 --single-process 参数，这些会导致 frame detached 错误
      ]
    };
    
    // 直接写死系统 Chrome 路径（若存在），否则尝试使用 channel: 'chrome'
    const systemChrome = resolveSystemChromePath();
    if (systemChrome) {
      launchOptions.executablePath = systemChrome;
    } else {
      // 在 macOS/Windows 上，Puppeteer 可通过 channel 使用系统浏览器
      // 若仍未找到，将回退到默认行为（可能报未安装受管浏览器的错误）
      launchOptions.channel = 'chrome';
    }

    browser = await puppeteer.launch(launchOptions);
    
    const page = await browser.newPage();
    
    // 只在无头模式下设置视口大小
    if (headless) {
      await page.setViewport({
        width: 1366,
        height: 768,
        deviceScaleFactor: 1,
        hasTouch: false,
        isLandscape: true,
        isMobile: false,
      });
    }
    
    // 设置随机用户代理
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
    ];
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
    await page.setUserAgent(randomUserAgent);
    
    // 禁用自动化检测标志
    await page.evaluateOnNewDocument(() => {
      // 删除webdriver属性
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
      
      // 修改plugins长度
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // 修改语言设置
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      
      // 删除自动化控制标志
      delete Object.getPrototypeOf(navigator).webdriver;
      
      // 覆盖权限查询
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // 模拟真实的Chrome运行时
      Object.defineProperty(window, 'chrome', {
        get: () => ({
          runtime: {},
          loadTimes: function() {},
          csi: function() {},
          app: {}
        }),
      });
    });
    
    // 使用正确的browser.setCookie API设置cookies（带SameSite映射与健壮性）
    if (cookieData && cookieData.cookies && cookieData.cookies.length > 0) {
      try {
        const mapSameSite = (val) => {
          if (!val) return null;
          const lower = String(val).toLowerCase();
          if (lower === 'lax') return 'Lax';
          if (lower === 'strict') return 'Strict';
          if (lower === 'none' || lower === 'no_restriction') return 'None';
          if (lower === 'unspecified' || lower === 'default') return null;
          return null;
        };
        
        const context = page.browserContext();
        const cookiesToSet = [];
        for (const cookie of cookieData.cookies) {
          if (!cookie || !cookie.name || !cookie.value || !cookie.domain) continue;
          const entry = {
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: !!cookie.secure,
            httpOnly: !!cookie.httpOnly
          };
          const mapped = mapSameSite(cookie.sameSite);
          if (mapped) entry.sameSite = mapped;
          if (cookie.expirationDate) entry.expires = cookie.expirationDate;
          cookiesToSet.push(entry);
        }
        if (cookiesToSet.length > 0) {
          await context.setCookie(...cookiesToSet);
          if (sendProgress) await sendProgress(1, 1, `已设置 ${cookiesToSet.length} 个Cookie`);
        }
      } catch (error) {
        // 静默处理cookie设置错误（避免泄露敏感信息），但保留简要计数
      }
    } else {
    }
    
    // 在导航之前设置localStorage（如果有的话）
    // 在导航之前设置localStorage（按域名作用域写入，避免污染其他域）
    if (cookieData && cookieData.localStorageByDomain && Object.keys(cookieData.localStorageByDomain).length > 0) {
      await page.evaluateOnNewDocument((byDomain) => {
        try {
          const host = (location.hostname || '').replace(/^www\./, '');
          const candidates = [];
          for (const domain of Object.keys(byDomain)) {
            const d = String(domain).replace(/^www\./, '');
            if (host === d || host.endsWith('.' + d)) {
              candidates.push(d);
            }
          }
          for (const d of candidates) {
            const bucket = byDomain[d] || {};
            for (const [k, v] of Object.entries(bucket)) {
              try { window.localStorage.setItem(k, v); } catch (e) {}
            }
          }
        } catch (e) {
          // 忽略localStorage错误
        }
      }, cookieData.localStorageByDomain);
    }
    
    // 发送进度通知：设置完成，开始导航
    if (sendProgress) await sendProgress(4, 10, "开始页面导航");
    
    // 导航到目标页面（添加更多错误处理）
    let response;
    try {
      response = await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: timeout 
      });
      
      // 检查页面是否正常加载
      if (response.status() >= 400) {
        throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
      }
      
    } catch (error) {
      throw new Error(`页面导航失败: ${error.message}`);
    }
    
    // 等待JavaScript执行完成
    try {
      await new Promise(r => setTimeout(r, 500));
      if (!page.isClosed()) {
        const readyState = await page.evaluate(() => document.readyState).catch(() => 'unknown');
        if (readyState !== 'complete') {
          await page.waitForFunction(() => document.readyState === 'complete', { timeout: 10000 }).catch(() => {});
        }
      }
    } catch (error) {
      // 继续执行，不抛出异常
    }
    
    // 等待动态内容渲染
    await new Promise(r => setTimeout(r, 800));
    
    // 模拟用户滚动行为
    try {
      if (!page.isClosed()) {
        const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
        const viewportHeight = await page.evaluate(() => window.innerHeight);
        
        if (scrollHeight > viewportHeight) {
          // 分段滚动，每次检查页面状态
          let currentPosition = 0;
          const stepSize = 300;
          
          while (currentPosition < scrollHeight - viewportHeight) {
            if (page.isClosed()) break;
            
            await page.evaluate((position) => {
              window.scrollTo(0, position);
            }, currentPosition);
            
            currentPosition += stepSize;
            await new Promise(r => setTimeout(r, 100)); // 短暂等待
          }
          
          // 滚动回顶部
          if (!page.isClosed()) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await new Promise(r => setTimeout(r, 500));
          }
        }
        
      }
    } catch (error) {
      // 如果是frame detached错误，不要抛出异常，继续执行
      if (!error.message.includes('detached')) {
        throw error;
      }
    }
    
    await new Promise(r => setTimeout(r, 500));
    
    // 获取页面内容
    const content = await page.content();
    const title = await page.title();
    let debugInfo = {};
    let cleanContent = { title: '', bodyText: '' };
    
    try {
      if (!page.isClosed()) {
        debugInfo = await page.evaluate(() => {
          const body = document.body;
          const textContent = body.textContent || body.innerText || '';
          
          return {
            textLength: textContent.length,
            hasApp: !!document.querySelector('#app, #root, .app, .main, main, [data-reactroot]'),
            hasReactElements: document.querySelectorAll('[data-reactid], [data-react-checksum]').length,
            hasVueElements: document.querySelectorAll('[data-v-]').length,
            scriptCount: document.querySelectorAll('script[src]').length,
            stylesheetCount: document.querySelectorAll('link[rel="stylesheet"]').length,
            hasReact: !!window.React,
            hasVue: !!window.Vue,
            hasAngular: !!window.Angular,
            hasJQuery: !!(window.$ || window.jQuery),
            readyState: document.readyState,
            firstTextPreview: textContent.substring(0, 200).replace(/\s+/g, ' ').trim()
          };
        });
        
        
        // 提取并转换为Markdown格式内容
        cleanContent = await page.evaluate((customSelector) => {
          const title = document.title || '';
          
          // 自定义HTML转Markdown函数，重点保留原始换行和空白
          function htmlToMarkdown(element) {
            if (!element) return '';
            
            let targetElement = element;
            
            // 如果用户指定了CSS选择器，提取该选择器内的所有内容
            if (customSelector) {
              const customElements = element.querySelectorAll(customSelector);
              if (customElements.length > 0) {
                // 当有多个匹配节点时，去除包含关系的重复节点
                const filteredElements = filterNestedElements(Array.from(customElements));
                
                if (filteredElements.length === 1) {
                  targetElement = filteredElements[0];
                } else if (filteredElements.length > 1) {
                  // 多个节点：创建包装容器，整合所有内容
                  const wrapper = document.createElement('div');
                  filteredElements.forEach((elem, index) => {
                    if (index > 0) {
                      // 在多个内容块之间添加分隔符
                      const separator = document.createElement('hr');
                      wrapper.appendChild(separator);
                    }
                    wrapper.appendChild(elem.cloneNode(true));
                  });
                  targetElement = wrapper;
                } else {
                  // 经过过滤后没有元素
                  return `错误：CSS选择器 "${customSelector}" 匹配到的元素存在完全包含关系，已被过滤`;
                }
              } else {
                // 如果找不到指定选择器，返回错误信息
                return `错误：未找到CSS选择器 "${customSelector}" 对应的元素`;
              }
              
              // 辅助函数：过滤掉被其他元素包含的节点
              function filterNestedElements(elements) {
                return elements.filter(element => {
                  // 检查当前元素是否被其他元素包含
                  return !elements.some(otherElement => {
                    return otherElement !== element && otherElement.contains(element);
                  });
                });
              }
            } else {
              // 默认行为：获取页面主要内容区域
              const contentSelectors = [
                'main', 'article', '[role="main"]', 
                '.content', '.main', '.post', '.article',
                '#content', '#main', '#post', '#article'
              ];
              
              for (let selector of contentSelectors) {
                const found = element.querySelector(selector);
                if (found && found.textContent.trim().length > 100) {
                  targetElement = found;
                  break;
                }
              }
            }
            
            // 移除不需要的元素
            const cloned = targetElement.cloneNode(true);
            const elementsToRemove = [
              'script', 'style', 'nav', 'header', 'footer', 
              '.ad', '.advertisement', '.sidebar', '.menu',
              '[class*="nav"]', '[class*="menu"]', '[class*="sidebar"]'
            ];
            
            elementsToRemove.forEach(selector => {
              const elements = cloned.querySelectorAll(selector);
              elements.forEach(el => el.remove());
            });
            
            // 递归处理节点，保留原始文本格式
            function processNode(node) {
              if (node.nodeType === Node.TEXT_NODE) {
                // 文本节点：保留换行，但清理每行开头的空格
                const text = node.textContent;
                // 按行分割，清理每行开头的空格，但保留换行符
                return text.split('\n').map(line => line.trimStart()).join('\n');
              }
              
              if (node.nodeType !== Node.ELEMENT_NODE) return '';
              
              const tag = node.tagName.toLowerCase();
              let content = '';
              
              // 递归处理子节点
              for (let child of node.childNodes) {
                content += processNode(child);
              }
              
              // 根据标签类型进行Markdown转换
              switch (tag) {
                case 'h1':
                  return `\n# ${content.trim()}\n\n`;
                case 'h2':
                  return `\n## ${content.trim()}\n\n`;
                case 'h3':
                  return `\n### ${content.trim()}\n\n`;
                case 'h4':
                  return `\n#### ${content.trim()}\n\n`;
                case 'h5':
                  return `\n##### ${content.trim()}\n\n`;
                case 'h6':
                  return `\n###### ${content.trim()}\n\n`;
                  
                case 'p':
                  return content + '\n\n';
                  
                case 'br':
                  return '\n';
                  
                case 'strong':
                case 'b':
                  return `**${content}**`;
                  
                case 'em':
                case 'i':
                  return `*${content}*`;
                  
                case 'code':
                  return `\`${content}\``;
                  
                case 'pre':
                  return `\n\`\`\`\n${content}\n\`\`\`\n\n`;
                  
                case 'blockquote':
                  const lines = content.split('\n');
                  return '\n' + lines.map(line => line.trim() ? `> ${line}` : '>').join('\n') + '\n\n';
                  
                case 'ul':
                  let ulResult = '\n';
                  const liElements = node.querySelectorAll(':scope > li');
                  liElements.forEach(li => {
                    ulResult += `- ${li.textContent.trim()}\n`;
                  });
                  return ulResult + '\n';
                  
                case 'ol':
                  let olResult = '\n';
                  const olLiElements = node.querySelectorAll(':scope > li');
                  olLiElements.forEach((li, index) => {
                    olResult += `${index + 1}. ${li.textContent.trim()}\n`;
                  });
                  return olResult + '\n';
                  
                case 'a':
                  const href = node.getAttribute('href') || '#';
                  const linkText = content.trim();
                  return linkText ? `[${linkText}](${href})` : '';
                  
                case 'img':
                  const src = node.getAttribute('src') || '';
                  const alt = node.getAttribute('alt') || 'image';
                  return `![${alt}](${src})`;
                  
                case 'table':
                  return '\n' + convertTable(node) + '\n\n';
                  
                case 'hr':
                  return '\n---\n\n';
                  
                case 'div':
                case 'span':
                case 'section':
                case 'article':
                default:
                  // 对于容器元素和其他元素，直接返回内容，保持原始格式
                  return content;
              }
            }
            
            // 表格转换函数
            function convertTable(table) {
              const rows = table.querySelectorAll('tr');
              if (rows.length === 0) return '';
              
              let markdown = '';
              let isFirstRow = true;
              
              for (let row of rows) {
                const cells = row.querySelectorAll('td, th');
                if (cells.length === 0) continue;
                
                let rowText = '|';
                for (let cell of cells) {
                  rowText += ` ${cell.textContent.trim()} |`;
                }
                markdown += rowText + '\n';
                
                // 添加表头分隔符
                if (isFirstRow) {
                  let separator = '|';
                  for (let i = 0; i < cells.length; i++) {
                    separator += ' --- |';
                  }
                  markdown += separator + '\n';
                  isFirstRow = false;
                }
              }
              
              return markdown;
            }
            
            return processNode(cloned);
          }
          
          const markdownContent = htmlToMarkdown(document.body);
          
          return {
            title: title,
            bodyText: markdownContent
          };
        }, waitFor);
      } else {
        // 使用已获取的content作为备用
        const title = await page.title().catch(() => '');
        cleanContent = { title: title, bodyText: content || '' };
      }
    } catch (error) {
      if (error.message.includes('detached')) {
        // 使用已获取的HTML内容作为备用
        const title = await page.title().catch(() => '');
        cleanContent = { title: title, bodyText: content || '' };
      } else {
        throw error;
      }
    }
    
    // 压缩连续空行
    const compressedBodyText = cleanContent.bodyText.replace(/\n{3,}/g, '\n\n');
    
    // 保存Markdown格式内容到文件
    let textContent = `Title: ${cleanContent.title}\n\n${compressedBodyText}`;
    if (advisoryNotes && advisoryNotes.length > 0) {
      textContent += `\n\n---\nNotes:\n${advisoryNotes.join('\n')}`;
    }
    if (shouldSaveFile) {
      const savedFilePath = savePageContent(url, textContent, cleanContent.title);
    }
    
    const cleanResult = textContent;
    
    if (browser) {
      await browser.close();
    }
    
    return {
      content: [
        {
          type: 'text',
          text: cleanResult
        }
      ]
    };
}



// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request, extras = {}) => {
  const { name: toolName, arguments: args } = request.params;

  // 检查progressToken的位置 - 可能在extras或request._meta中
  const progressToken = extras.progressToken || request.params._meta?.progressToken;

  // 创建进度通知发送函数
  const sendProgress = async (progress, total, message) => {
    if (progressToken) {
      try {
        await server.notification({
          method: "notifications/progress",
          params: {
            progressToken,
            progress,
            total,
            message
          }
        });
      } catch (error) {
        // 静默处理通知错误
      }
    }
  };

  if (toolName === 'fetchpage') {
    try {
      return await handleFetchSpaWithCookies(request.params.arguments, sendProgress);
    } catch (error) {
      const args = request.params.arguments || {};
      const url = args.url || '';
      const friendly = [
        '❌ Fetch failed in browser mode.',
        error && error.message ? `Reason: ${error.message}` : null,
        '',
        '建议：使用 Chrome 扩展 “Fetch Page MCP Tools” 写入本地登录信息后重试。',
        '步骤：',
        `1) 打开并登录：${url || '目标网站'}`,
        '2) 点击扩展保存 cookies/localStorage',
        '3) 回到对话中再次调用 mcp fetchpage',
      ].filter(Boolean).join('\n');

      // 保存错误内容，便于排查
      try { savePageContent(url || 'about:blank', friendly, 'Fetch Error', true); } catch (_) {}

      return {
        content: [
          { type: 'text', text: friendly }
        ]
      };
    }
  } else {
    throw new Error(`Unknown tool: ${toolName}`);
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Fetch Page MCP Server started');
}

main().catch(console.error);
