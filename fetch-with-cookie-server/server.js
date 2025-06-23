#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import os from 'os';
import puppeteer from 'puppeteer';

// Cookie存储目录 - 统一使用Downloads下的fetch-with-cookie目录
const COOKIE_DIR = path.join(os.homedir(), 'Downloads', 'fetch-with-cookie', 'cookies');

class CookieManager {
  constructor() {
    this.cookiesCache = {};
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
      const timestamp = cookieData.timestamp;
      if (!timestamp) return true;
      
      const cookieTime = new Date(timestamp);
      const now = new Date();
      const age = now - cookieTime;
      
      // 如果cookie超过24小时认为过期
      return age > 24 * 60 * 60 * 1000;
    } catch {
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

// 创建HTTP(S)请求的Promise包装
function makeRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: headers,
      timeout: 30000
    };

    const req = lib.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.end();
  });
}

// 创建MCP服务器
const server = new Server(
  {
    name: 'fetch-with-cookie',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const cookieManager = new CookieManager();

// 检测响应是否表明cookie已失效的函数
function detectInvalidCookieResponse(response, originalUrl) {
  const { statusCode, data, headers } = response;
  
  // 1. 检查重定向到登录页面
  if (statusCode >= 300 && statusCode < 400) {
    const location = headers.location || headers.Location;
    if (location && (
      location.includes('login') || 
      location.includes('signin') || 
      location.includes('auth') ||
      location.includes('sso')
    )) {
      return {
        invalid: true,
        reason: '被重定向到登录页面，cookie可能已失效'
      };
    }
  }
  
  // 2. 检查401未授权状态
  if (statusCode === 401) {
    return {
      invalid: true,
      reason: '返回401未授权状态，cookie已失效'
    };
  }
  
  // 3. 检查响应内容中的登录相关关键词
  const lowerContent = data.toLowerCase();
  const loginKeywords = [
    'please log in',
    'please sign in',
    'login required',
    'session expired',
    'authentication required',
    'access denied',
    '请登录',
    '请先登录',
    '登录已过期',
    '会话已过期',
    'login form',
    'sign in form',
    'username',
    'password'
  ];
  
  const loginKeywordCount = loginKeywords.filter(keyword => 
    lowerContent.includes(keyword)
  ).length;
  
  // 4. 检查是否包含登录表单元素
  const hasLoginForm = lowerContent.includes('<form') && (
    lowerContent.includes('type="password"') ||
    lowerContent.includes('name="password"') ||
    lowerContent.includes('id="password"')
  );
  
  // 5. 内容异常短可能是错误页面
  const isContentTooShort = data.length < 200;
  
  // 综合判断
  if (loginKeywordCount >= 2 || hasLoginForm || 
      (loginKeywordCount >= 1 && isContentTooShort)) {
    return {
      invalid: true,
      reason: `检测到登录相关内容，cookie可能已失效 (关键词数量: ${loginKeywordCount}${hasLoginForm ? ', 包含登录表单' : ''})`
    };
  }
  
  return { invalid: false };
}

// 注册工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_with_cookies',
        description: 'Fetch web pages with cookies. Automatically loads cookies from local files or prompts to get new ones.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'fetch_spa_with_cookies',
        description: 'Fetch SPA (Single Page Application) pages using headless browser. Automatically loads cookies if available, but works without cookies too. Waits for JavaScript to load dynamic content.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch'
            },
            waitFor: {
              type: 'string',
              description: 'CSS selector to wait for before extracting content (optional). If not provided, waits for at least 2 nested div elements in body.'
            },
            skipCookies: {
              type: 'boolean',
              description: 'Skip loading cookies even if available (optional, default: false)'
            },
            headless: {
              type: 'boolean',
              description: 'Run in headless mode (optional, default: true)'
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

// 处理普通HTTP请求的函数
async function handleFetchWithCookies(args) {
  const { url, cookies } = args;
  
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

  try {
    // 解析域名
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    let cookieString = '';
    
    // 1. 检查是否提供了cookie参数
    if (cookies) {
      try {
        const cookieData = cookieManager.parseCookieData(cookies);
        cookieString = cookieManager.cookiesToString(cookieData);
        
        // 保存到文件以备下次使用
        cookieManager.saveCookiesToFile(domain, cookieData);
        
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Cookie format error: ${error.message}`
            }
          ]
        };
      }
    }
    // 2. 如果没有提供cookies，尝试从文件加载
    else {
      const cookieFile = cookieManager.findCookieFile(domain);
      if (cookieFile) {
        const cookieData = cookieManager.loadCookiesFromFile(cookieFile);
        if (cookieData) {
          // 检查是否过期
          if (cookieManager.isCookieExpired(cookieData)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Found cookie file for ${domain}, but it's expired (>24 hours).\n\nPlease use the Chrome extension to get fresh cookies:\n1. Visit ${url} and login\n2. Use the Fetch With Cookie extension\n3. Try again`
                }
              ]
            };
          }
          
          cookieString = cookieManager.cookiesToString(cookieData);
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Cannot read cookie file for ${domain}.\n\nPlease use the Chrome extension to get cookies.`
              }
            ]
          };
        }
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `❌ No cookie file found for ${domain}.\n\nPlease:\n1. Visit ${url} and login in browser\n2. Use the Fetch With Cookie extension\n3. Try again\n\nCookies will be saved to:\n${COOKIE_DIR}`
            }
          ]
        };
      }
    }
    
    // 构建请求头
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    
    if (cookieString) {
      headers['Cookie'] = cookieString;
    }
    
    // 发起请求
    try {
      const response = await makeRequest(url, headers);
      
      // 检测cookie是否可能已失效
      const cookieValidation = detectInvalidCookieResponse(response, url);
      if (cookieValidation.invalid && cookieString) {
        // Cookie似乎已失效，提示用户重新获取
        const urlObj = new URL(url);
        return {
          content: [
            {
              type: 'text',
              text: `❌ Cookie可能已失效！\n\n` +
                    `检测结果: ${cookieValidation.reason}\n` +
                    `状态码: ${response.statusCode}\n` +
                    `响应长度: ${response.data.length} 字符\n\n` +
                    `请重新获取cookie：\n` +
                    `1. 在浏览器中访问 ${url}\n` +
                    `2. 确保已登录\n` +
                    `3. 使用Chrome扩展重新保存cookie\n` +
                    `4. 重试此请求\n\n` +
                    `如果认为这是误判，请检查以下响应内容的前500字符：\n` +
                    `${response.data.substring(0, 500)}${response.data.length > 500 ? '...' : ''}`
            }
          ]
        };
      }
      
      const cookieCount = cookieString ? cookieString.split(';').length : 0;
      
      const result = `✅ Successfully fetched ${url}\n` +
                    `Status: ${response.statusCode}\n` +
                    `Cookies used: ${cookieCount}\n` +
                    `Response size: ${response.data.length} characters\n\n` +
                    `Page content:\n` +
                    response.data;
      
      return {
        content: [
          {
            type: 'text',
            text: result
          }
        ]
      };
      
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Request failed: ${error.message}`
          }
        ]
      };
    }
    
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ]
    };
  }
}

// 处理SPA页面请求的函数（使用Puppeteer）
async function handleFetchSpaWithCookies(args) {
  const { url, waitFor, timeout = 30000, cookies, skipCookies = false, headless = true } = args;
  
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
  
  try {
    // 解析域名
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    // 获取cookie数据
    let cookieData = null;
    
    if (skipCookies) {
      console.error('ℹ️  skipCookies=true，跳过cookie加载');
    } else if (cookies) {
      try {
        cookieData = cookieManager.parseCookieData(cookies);
        cookieManager.saveCookiesToFile(domain, cookieData);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Cookie format error: ${error.message}`
            }
          ]
        };
      }
    } else {
      // 只加载最新的cookie文件（Chrome扩展已经包含了所有相关域名的cookies）
      const cookieFile = cookieManager.findCookieFile(domain);
      if (cookieFile) {
        cookieData = cookieManager.loadCookiesFromFile(cookieFile);
        if (cookieData) {
          // 检查是否过期
          if (cookieManager.isCookieExpired(cookieData)) {
            return {
              content: [
                {
                  type: 'text',
                  text: `❌ Found cookie file for ${domain}, but it's expired (>24 hours).\n\nPlease use the Chrome extension to get fresh cookies:\n1. Visit ${url} and login\n2. Use the Fetch With Cookie extension\n3. Try again`
                }
              ]
            };
          }
          
          console.error(`✅ 加载cookie文件: ${cookieFile}`);
          console.error(`🍪 包含 ${cookieData.cookies?.length || 0} 个cookies`);
          console.error(`📦 包含 ${cookieData.totalLocalStorage || 0} 个localStorage项目`);
        } else {
          return {
            content: [
              {
                type: 'text',
                text: `❌ Cannot read cookie file for ${domain}.\n\nPlease use the Chrome extension to get cookies.`
              }
            ]
          };
        }
      } else {
        console.error(`⚠️  No cookie file found for ${domain}, proceeding without cookies`);
        cookieData = null;
      }
    }
    
    // 启动Puppeteer浏览器，添加反检测参数
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
        '--no-zygote',
        '--single-process'
      ]
    });
    
    const page = await browser.newPage();
    
    // 设置视口大小模拟真实浏览器
    await page.setViewport({
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false,
    });
    
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
    
    // 注入cookies - 文件中已包含所有相关域名的cookies
    if (cookieData && cookieData.cookies && cookieData.cookies.length > 0) {
      try {
        // 先访问域名根路径以建立context
        const urlObj = new URL(url);
        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}`;
        console.error(`🌐 先访问: ${baseUrl}`);
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        
        // 按域名分组显示cookies
        const cookiesByDomain = {};
        cookieData.cookies.forEach(cookie => {
          const domain = cookie.domain;
          if (!cookiesByDomain[domain]) {
            cookiesByDomain[domain] = 0;
          }
          cookiesByDomain[domain]++;
        });
        console.error(`🍪 Cookie分布:`, JSON.stringify(cookiesByDomain, null, 2));
        
        // 设置所有cookies
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
          } catch (cookieError) {
            console.error(`❌ 设置cookie失败 ${cookie.name} (${cookie.domain}):`, cookieError.message);
          }
        }
        
        console.error(`✅ 已设置 ${cookieData.cookies.length} 个cookies (来自 ${Object.keys(cookiesByDomain).length} 个域名)`);
        
        // 设置localStorage数据
        if (cookieData.localStorage && Object.keys(cookieData.localStorage).length > 0) {
          console.error(`📦 设置localStorage数据...`);
          try {
            await page.evaluate((localStorageData) => {
              for (const [key, value] of Object.entries(localStorageData)) {
                try {
                  window.localStorage.setItem(key, value);
                } catch (error) {
                  console.error(`localStorage设置失败 ${key}:`, error.message);
                }
              }
            }, cookieData.localStorage);
            console.error(`✅ 已设置 ${Object.keys(cookieData.localStorage).length} 个localStorage项目`);
          } catch (error) {
            console.error(`❌ 设置localStorage时出错:`, error.message);
          }
        }
        
      } catch (error) {
        console.error('❌ 设置cookies时出错:', error.message);
        console.error('⚠️  将继续不使用cookies访问页面');
      }
    } else {
      console.error('ℹ️  无cookies，直接访问页面');
    }
    
    // 导航到目标页面
    const response = await page.goto(url, { 
      waitUntil: 'networkidle2',
      timeout: timeout 
    });
    
    // 如果指定了等待元素，则等待该元素出现
    if (waitFor) {
      try {
        await page.waitForSelector(waitFor, { timeout: timeout });
      } catch (error) {
        console.error(`等待元素 ${waitFor} 超时:`, error.message);
      }
    } else {
      // 默认等待逻辑：等待body中至少有两层嵌套的div结构
      try {
        await page.waitForFunction(
          () => {
            const nestedDivs = document.querySelectorAll('body div div');
            return nestedDivs.length >= 2;
          },
          { timeout: timeout }
        );
        console.error('✅ 检测到页面结构已加载（至少2层div嵌套）');
      } catch (error) {
        console.error('⚠️  等待页面结构超时，继续获取当前内容:', error.message);
      }
    }
    
    // 模拟真实用户行为 - 随机滚动页面
    try {
      await page.evaluate(() => {
        return new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 200;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if(totalHeight >= scrollHeight - window.innerHeight){
              clearInterval(timer);
              resolve();
            }
          }, 100);
        });
      });
      
      // 滚动回顶部
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch (error) {
      console.error('滚动页面时出错:', error.message);
    }
    
    // 等待额外的时间让动态内容加载
    await page.waitForTimeout(2000);
    
    // 验证cookies是否正确设置
    const currentCookies = await page.cookies();
    console.error(`📋 当前页面cookies数量: ${currentCookies.length}`);
    
    // 获取页面内容
    const content = await page.content();
    const title = await page.title();
    
    const cookieCount = cookieData ? cookieData.cookies.length : 0;
    
    const result = `✅ Successfully fetched SPA page ${url}\n` +
                  `Status: ${response.status()}\n` +
                  `Title: ${title}\n` +
                  `Cookies loaded: ${cookieCount}\n` +
                  `Cookies active: ${currentCookies.length}\n` +
                  `Response size: ${content.length} characters\n` +
                  `Wait selector: ${waitFor || 'default (2-level div nesting)'}\n\n` +
                  `Page content:\n` +
                  content;
    
    return {
      content: [
        {
          type: 'text',
          text: result
        }
      ]
    };
    
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `SPA fetch failed: ${error.message}`
        }
      ]
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  
  if (toolName === 'fetch_with_cookies') {
    return await handleFetchWithCookies(request.params.arguments);
  } else if (toolName === 'fetch_spa_with_cookies') {
    return await handleFetchSpaWithCookies(request.params.arguments);
  } else {
    throw new Error(`Unknown tool: ${toolName}`);
  }
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Fetch With Cookie MCP Server started');
}

main().catch(console.error);