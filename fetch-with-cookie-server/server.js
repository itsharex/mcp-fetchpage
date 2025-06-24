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
// 页面内容存储目录
const PAGES_DIR = path.join(os.homedir(), 'Downloads', 'fetch-with-cookie', 'pages');

// 统一的HTML转Markdown函数（整合了智能内容提取和过滤）
function htmlToMarkdown(htmlContent) {
  let result = htmlContent;
  
  // 第一步：尝试提取主要内容区域（参考SPA版本的智能内容检测）
  const contentSelectors = [
    // 主要内容容器
    '<main[^>]*>([\\s\\S]*?)<\/main>',
    '<article[^>]*>([\\s\\S]*?)<\/article>',
    '<div[^>]*role="main"[^>]*>([\\s\\S]*?)<\/div>',
    // 常见类名模式
    '<div[^>]*class="[^"]*\\bcontent\\b[^"]*"[^>]*>([\\s\\S]*?)<\/div>',
    '<div[^>]*class="[^"]*\\bmain\\b[^"]*"[^>]*>([\\s\\S]*?)<\/div>',
    '<div[^>]*class="[^"]*\\bpost\\b[^"]*"[^>]*>([\\s\\S]*?)<\/div>',
    '<div[^>]*class="[^"]*\\barticle\\b[^"]*"[^>]*>([\\s\\S]*?)<\/div>',
    // ID选择器
    '<div[^>]*id="content"[^>]*>([\\s\\S]*?)<\/div>',
    '<div[^>]*id="main"[^>]*>([\\s\\S]*?)<\/div>',
    '<div[^>]*id="post"[^>]*>([\\s\\S]*?)<\/div>',
    '<div[^>]*id="article"[^>]*>([\\s\\S]*?)<\/div>'
  ];
  
  // 尝试找到主要内容区域
  let mainContent = null;
  let bestMatch = null;
  let maxLength = 0;
  
  for (const selector of contentSelectors) {
    const match = result.match(new RegExp(selector, 'gi'));
    if (match && match[0]) {
      const extractedContent = match[0].match(new RegExp(selector, 'i'))?.[1];
      if (extractedContent && extractedContent.trim().length > maxLength) {
        bestMatch = extractedContent;
        maxLength = extractedContent.trim().length;
      }
    }
  }
  
  // 只有当找到的内容明显比原始内容要好时才使用（至少是原始内容的20%且大于500字符）
  if (bestMatch && maxLength > 500 && maxLength > result.length * 0.2) {
    mainContent = bestMatch;
    result = mainContent;
  }
  
  // 第二步：移除不需要的元素（增强版，参考SPA版本）
  result = result
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // 移除script
    .replace(/<style\b[^>]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')   // 移除style
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')                      // 移除导航
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')                // 移除头部
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')                // 移除尾部
    // 移除广告和侧边栏（SPA版本的增强过滤）
    .replace(/<div[^>]*class="[^"]*\\bad\\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') // 广告
    .replace(/<div[^>]*class="[^"]*advertisement[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') // 广告
    .replace(/<div[^>]*class="[^"]*\\bsidebar\\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') // 侧边栏
    .replace(/<div[^>]*class="[^"]*\\bmenu\\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') // 菜单
    .replace(/<div[^>]*class="[^"]*\\bnav\\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '') // 导航
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '');                 // 侧边内容
  
  // 首先处理代码块（最高优先级，避免其内容被其他规则影响）
  result = result
    .replace(/<div[^>]*class="cnblogs_code"[^>]*>([\s\S]*?)<\/div>/gi, (match, content) => {
      // 处理博客园代码块
      return content.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (preMatch, preContent) => {
        const cleanContent = preContent
          .replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1')  // 移除span标签但保留内容
          .replace(/<[^>]+>/g, '')                           // 移除其他HTML标签
          .replace(/&nbsp;/g, ' ')                          // 替换HTML实体
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        return '\n```\n' + cleanContent + '\n```\n\n';
      });
    })
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content) => {
      // 处理普通pre标签
      const cleanContent = content
        .replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1')    // 移除span但保留内容
        .replace(/<[^>]+>/g, '')                             // 移除HTML标签
        .replace(/&nbsp;/g, ' ')                            // 替换HTML实体
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return '\n```\n' + cleanContent + '\n```\n\n';
    });
  
  // 然后处理其他标签
  result = result
    // 标题转换
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (match, level, content) => {
      const cleanContent = content.replace(/<[^>]+>/g, '').trim();
      const hashes = '#'.repeat(parseInt(level));
      return `\n${hashes} ${cleanContent}\n\n`;
    })
    
    // 段落处理（处理复杂嵌套）
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (match, content) => {
      // 递归处理段落内的格式化标签
      const processedContent = content
        .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
        .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
        .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
        .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (codeMatch, codeContent) => {
          const cleanCode = codeContent
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
          return '`' + cleanCode + '`';
        })
        .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
        .replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1')  // 移除span但保留内容
        .replace(/<[^>]+>/g, '');                          // 移除剩余标签
      
      return '\n' + processedContent.trim() + '\n\n';
    })
    
    // 换行
    .replace(/<br\s*\/?>/gi, '\n')
    
    // 列表
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (match, content) => {
      const items = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (liMatch, liContent) => {
        const cleanContent = liContent.replace(/<[^>]+>/g, '').trim();
        return '- ' + cleanContent + '\n';
      });
      return '\n' + items + '\n';
    })
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (match, content) => {
      let counter = 1;
      const items = content.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (liMatch, liContent) => {
        const cleanContent = liContent.replace(/<[^>]+>/g, '').trim();
        return `${counter++}. ` + cleanContent + '\n';
      });
      return '\n' + items + '\n';
    })
    
    // 引用和分隔线
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (match, content) => {
      const cleanContent = content.replace(/<[^>]+>/g, '').trim();
      return '\n> ' + cleanContent.replace(/\n/g, '\n> ') + '\n\n';
    })
    .replace(/<hr\s*\/?>/gi, '\n---\n\n')
    
    // 处理剩余的格式化标签
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (match, content) => {
      const cleanContent = content
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
      return '`' + cleanContent + '`';
    })
    
    // 处理表格（增强版表格转换）
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, tableContent) => {
      let tableMarkdown = '\n';
      
      // 处理表头
      const theadMatch = tableContent.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
      let hasHeader = false;
      if (theadMatch) {
        const headerRows = theadMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        if (headerRows && headerRows[0]) {
          const headerCells = headerRows[0].match(/<th[^>]*>([\s\S]*?)<\/th>/gi) || headerRows[0].match(/<td[^>]*>([\s\S]*?)<\/td>/gi);
          if (headerCells) {
            const headerRow = headerCells.map(cell => {
              return cell.replace(/<[^>]+>/g, '').trim();
            }).join(' | ');
            const separatorRow = headerCells.map(() => '---').join(' | ');
            tableMarkdown += `| ${headerRow} |\n| ${separatorRow} |\n`;
            hasHeader = true;
          }
        }
      }
      
      // 处理表格主体
      const tbodyMatch = tableContent.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i) || [null, tableContent];
      const bodyRows = tbodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
      if (bodyRows) {
        bodyRows.forEach((row, index) => {
          const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || row.match(/<th[^>]*>([\s\S]*?)<\/th>/gi);
          if (cells) {
            const rowData = cells.map(cell => {
              return cell.replace(/<[^>]+>/g, '').trim();
            }).join(' | ');
            tableMarkdown += `| ${rowData} |\n`;
            
            // 如果没有表头且这是第一行，添加分隔符
            if (!hasHeader && index === 0) {
              const separatorRow = cells.map(() => '---').join(' | ');
              tableMarkdown += `| ${separatorRow} |\n`;
            }
          }
        });
      }
      
      return tableMarkdown + '\n';
    })
    
    // 处理链接和图片
    .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<img[^>]*src=["']([^"']*)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, '![$2]($1)')
    .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']*)["'][^>]*>/gi, '![$1]($2)')
    
    // 移除剩余的HTML标签
    .replace(/<[^>]+>/g, '')
    
    // 处理HTML实体
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    
    // 清理空白
    .replace(/[ \t]+/g, ' ')                    // 合并空格和制表符
    .split('\n').map(line => line.trimStart()).join('\n')  // 清理行首空格
    .replace(/\n{3,}/g, '\n\n')                // 压缩连续空行
    .trim();
  
  return result;
}

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
    name: 'mcp-fetchpage',
    version: '2.0.0',
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
        name: 'fetchpage',
        description: 'Intelligent web page fetching with automatic cookie support. Tries HTTP first, then falls back to browser rendering if needed. Automatically detects and handles login requirements.',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'The URL to fetch'
            },
            waitFor: {
              type: 'string',
              description: 'CSS selector to wait for before extracting content (optional, used in browser mode)'
            },
            skipCookies: {
              type: 'boolean',
              description: 'Skip loading cookies even if available (optional, default: false)'
            },
            forceMethod: {
              type: 'string',
              enum: ['http', 'spa'],
              description: 'Force specific fetching method (optional): "http" for HTTP-only, "spa" for browser-only'
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

// 处理普通HTTP请求的函数
async function handleFetchWithCookies(args, sendProgress = null, shouldSaveFile = true) {
  const { url, cookies, skipCookies = false } = args;
  
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
    console.error(`🌐 HTTP方法: ${url}`);
    
    // 解析域名
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    let cookieString = '';
    
    // 检查是否跳过cookie
    if (skipCookies) {
      console.error('🚫 跳过Cookie');
    }
    // 1. 检查是否提供了cookie参数
    else if (cookies) {
      try {
        const cookieData = cookieManager.parseCookieData(cookies);
        cookieString = cookieManager.cookiesToString(cookieData);
        
        // 保存到文件以备下次使用
        cookieManager.saveCookiesToFile(domain, cookieData);
        
      } catch (error) {
        const errorMessage = `Cookie format error: ${error.message}`;
        if (shouldSaveFile) {
          const savedFilePath = savePageContent(url, errorMessage, 'Cookie格式错误', true);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: errorMessage
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
            console.error('⚠️  Cookie已过期');
            cookieString = '';
          } else {
            cookieString = cookieManager.cookiesToString(cookieData);
            console.error(`✅ 读取Cookie: ${cookieData.cookies?.length || 0}个`);
          }
        } else {
          console.error('❌ Cookie文件损坏');
          cookieString = '';
        }
      } else {
        console.error('ℹ️  无Cookie文件');
        cookieString = '';
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
        // Cookie似乎已失效，保存错误信息到文件
        const errorMessage = `❌ Cookie可能已失效！\n\n` +
                    `检测结果: ${cookieValidation.reason}\n` +
                    `状态码: ${response.statusCode}\n` +
                    `响应长度: ${response.data.length} 字符\n\n` +
                    `请重新获取cookie：\n` +
                    `1. 在浏览器中访问 ${url}\n` +
                    `2. 确保已登录\n` +
                    `3. 使用Chrome扩展重新保存cookie\n` +
                    `4. 重试此请求\n\n` +
                    `如果认为这是误判，请检查以下响应内容的前500字符：\n` +
                    `${response.data.substring(0, 500)}${response.data.length > 500 ? '...' : ''}`;
        
        if (shouldSaveFile) {
          const savedFilePath = savePageContent(url, errorMessage, 'Cookie失效错误', true);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: errorMessage
            }
          ]
        };
      }
      
      const cookieCount = cookieString ? cookieString.split(';').length : 0;
      
      // 提取页面标题
      let pageTitle = url; // 默认使用URL作为标题
      const titleMatch = response.data.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch) {
        pageTitle = titleMatch[1].trim();
      }
      
      // 使用HTML转Markdown函数处理内容
      const markdownContent = htmlToMarkdown(response.data);
      
      // 添加页面信息头部（包含cookie状态）
      const cookieStatus = cookieString ? `使用本地Cookie (${cookieCount}个)` : '无Cookie访问';
      const pageInfo = `URL: ${url}
标题: ${pageTitle}
Cookie状态: ${cookieStatus}
获取时间: ${new Date().toISOString()}
内容长度: ${markdownContent.length} 字符

`;
      
      // 保存Markdown格式内容到文件
      const cleanResult = pageInfo + markdownContent;
      if (shouldSaveFile) {
        const savedFilePath = savePageContent(url, cleanResult, pageTitle);
      }
      
      
      return {
        content: [
          {
            type: 'text',
            text: cleanResult
          }
        ]
      };
      
    } catch (error) {
      const errorMessage = `Request failed: ${error.message}`;
      if (shouldSaveFile) {
        const savedFilePath = savePageContent(url, errorMessage, '请求失败', true);
      }
      
      return {
        content: [
          {
            type: 'text',
            text: errorMessage
          }
        ]
      };
    }
    
  } catch (error) {
    const errorMessage = `Error: ${error.message}`;
    if (shouldSaveFile) {
      const savedFilePath = savePageContent(url, errorMessage, '系统错误', true);
    }
    
    return {
      content: [
        {
          type: 'text',
          text: errorMessage
        }
      ]
    };
  }
}

// 处理SPA页面请求的函数（使用Puppeteer）
async function handleFetchSpaWithCookies(args, sendProgress = null, shouldSaveFile = true) {
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
  
  console.error(`🤖 SPA方法: ${url}`);
    
    // 解析域名
    const urlObj = new URL(url);
    const domain = urlObj.hostname;
    
    // 获取cookie数据
    let cookieData = null;
    
    if (skipCookies) {
      console.error('🚫 跳过Cookie');
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
          
          console.error(`✅ 读取Cookie: ${cookieData.cookies?.length || 0}个`);
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
        console.error('ℹ️  无Cookie文件');
        cookieData = null;
      }
    }
    
    // 启动Puppeteer浏览器，使用最完整的启动参数（解决cookie设置问题）
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
    
    // 使用正确的browser.setCookie API设置cookies
    if (cookieData && cookieData.cookies && cookieData.cookies.length > 0) {
      try {
        console.error('🔧 使用BrowserContext.setCookie设置cookies...');
        
        let successCount = 0;
        let failCount = 0;
        
        // 准备cookies数组
        const cookiesToSet = cookieData.cookies.map(cookie => ({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false,
          sameSite: cookie.sameSite || 'Lax',
          ...(cookie.expirationDate && { expires: cookie.expirationDate })
        }));
        
        // 使用BrowserContext.setCookie一次性设置所有cookies (Puppeteer 24正确方法)
        const context = page.browserContext();
        await context.setCookie(...cookiesToSet);
        successCount = cookiesToSet.length;
        console.error(`✅ 使用BrowserContext.setCookie成功设置 ${successCount} 个cookies`);
        
        // 详细显示设置的cookies
        cookiesToSet.forEach(cookie => {
          console.error(`  - ${cookie.name} (${cookie.domain}${cookie.path})`);
        });
        
        console.error(`📊 Cookie设置完成: 成功 ${successCount}/${cookieData.cookies.length} 个, 失败 ${failCount} 个`);
        
      } catch (error) {
        console.error('❌ 设置cookies时出错:', error.message);
        console.error('⚠️  将继续不使用cookies访问页面');
      }
    } else {
      console.error('ℹ️  无cookies，直接访问页面');
    }
    
    // 在导航之前设置localStorage（如果有的话）
    if (cookieData && cookieData.localStorage && Object.keys(cookieData.localStorage).length > 0) {
      console.error(`📦 预设置localStorage数据...`);
      // 在新页面上设置初始化脚本
      await page.evaluateOnNewDocument((localStorageData) => {
        for (const [key, value] of Object.entries(localStorageData)) {
          try {
            window.localStorage.setItem(key, value);
            console.log(`✅ 预设 localStorage: ${key}`);
          } catch (error) {
            console.error(`❌ 预设 localStorage失败 ${key}:`, error.message);
          }
        }
      }, cookieData.localStorage);
      console.error(`✅ 已预设 ${Object.keys(cookieData.localStorage).length} 个localStorage项目`);
    }
    
    // 发送进度通知：设置完成，开始导航
    if (sendProgress) await sendProgress(4, 10, "开始页面导航");
    
    // 导航到目标页面（添加更多错误处理）
    console.error(`🌐 正在导航到: ${url}`);
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
    
    // 等待JavaScript执行完成的多重策略
    if (waitFor) {
      console.error(`⏳ 等待指定元素: ${waitFor}`);
      try {
        await page.waitForSelector(waitFor, { timeout: timeout });
        console.error(`✅ 找到指定元素: ${waitFor}`);
      } catch (error) {
        console.error(`❌ 等待元素 ${waitFor} 超时:`, error.message);
      }
    } else {
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
        cleanContent = await page.evaluate(() => {
          const title = document.title || '';
          
          // 自定义HTML转Markdown函数，重点保留原始换行和空白
          function htmlToMarkdown(element) {
            if (!element) return '';
            
            // 获取页面主要内容区域
            const contentSelectors = [
              'main', 'article', '[role="main"]', 
              '.content', '.main', '.post', '.article',
              '#content', '#main', '#post', '#article'
            ];
            
            let targetElement = element;
            for (let selector of contentSelectors) {
              const found = element.querySelector(selector);
              if (found && found.textContent.trim().length > 100) {
                targetElement = found;
                break;
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
        });
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
    const textContent = `Title: ${cleanContent.title}\n\n${compressedBodyText}`;
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

// 统一的fetchpage处理函数 - 智能渐进式页面抓取
async function handleFetchPage(args, sendProgress) {
  console.error('🚀 启动智能页面抓取:', args.url);
  
  const { url, forceMethod, skipCookies = false, headless = true, timeout = 30000, waitFor } = args;
  
  // 如果强制指定了方法，直接使用（保存文件）
  if (forceMethod === 'http') {
    console.error('🔧 强制使用HTTP方法');
    return await handleFetchWithCookies(args, sendProgress, true);
  } else if (forceMethod === 'spa') {
    console.error('🔧 强制使用SPA方法');
    return await handleFetchSpaWithCookies(args, sendProgress, true);
  }
  
  // 智能渐进式抓取逻辑
  await sendProgress(1, 4, '开始智能页面抓取');
  
  try {
    // 第一步：尝试HTTP方法
    console.error('📡 第一次尝试：使用HTTP方法抓取');
    await sendProgress(2, 4, '尝试HTTP方法抓取');
    
    const httpResult = await handleFetchWithCookies(args, sendProgress, false);
    
    // 分析HTTP结果
    const httpContent = httpResult.content[0].text;
    const analysisResult = analyzePageContent(httpContent, url);
    
    console.error(`🔍 HTTP结果分析: ${analysisResult.reason}`);
    
    // 如果检测到需要登录，直接返回提示
    if (analysisResult.needsLogin) {
      // 保存登录提示信息
      savePageContent(url, analysisResult.loginMessage, '需要登录', true);
      console.error('📄 已保存登录提示到文件');
      
      return {
        content: [{
          type: 'text',
          text: analysisResult.loginMessage
        }]
      };
    }
    
    // 如果内容质量好，直接返回（保存HTTP结果）
    if (analysisResult.isGoodContent) {
      console.error('✅ HTTP方法获取内容成功，直接返回');
      // 保存最终结果
      const httpContent = httpResult.content[0].text;
      const titleMatch = httpContent.match(/^Title: (.+)$/m);
      const pageTitle = titleMatch ? titleMatch[1] : url;
      savePageContent(url, httpContent, pageTitle);
      return httpResult;
    }
    
    // 第二步：内容质量不佳，尝试SPA方法
    console.error('🌐 第二次尝试：使用SPA方法抓取');
    await sendProgress(3, 4, '切换到SPA方法抓取');
    
    const spaResult = await handleFetchSpaWithCookies(args, sendProgress, false);
    const spaContent = spaResult.content[0].text;
    const spaAnalysis = analyzePageContent(spaContent, url);
    
    console.error(`🔍 SPA结果分析: ${spaAnalysis.reason}`);
    
    // 如果SPA检测到需要登录
    if (spaAnalysis.needsLogin) {
      // 保存登录提示信息
      savePageContent(url, spaAnalysis.loginMessage, '需要登录', true);
      console.error('📄 已保存SPA登录提示到文件');
      
      return {
        content: [{
          type: 'text',
          text: spaAnalysis.loginMessage
        }]
      };
    }
    
    // 比较两个结果，返回更好的那个（保存最终结果）
    await sendProgress(4, 4, '完成页面抓取');
    
    let finalResult, finalContent, resultType;
    if (spaAnalysis.isGoodContent || spaContent.length > httpContent.length * 1.2) {
      console.error('✅ SPA方法获得更好结果，返回SPA结果');
      finalResult = spaResult;
      finalContent = spaContent;
      resultType = 'SPA';
    } else {
      console.error('✅ HTTP方法结果较好，返回HTTP结果');
      finalResult = httpResult;
      finalContent = httpContent;
      resultType = 'HTTP';
    }
    
    // 保存最终结果
    const titleMatch = finalContent.match(/^Title: (.+)$/m);
    const pageTitle = titleMatch ? titleMatch[1] : url;
    savePageContent(url, finalContent, pageTitle);
    console.error(`📄 已保存${resultType}结果到文件`);
    
    return finalResult;
    
  } catch (error) {
    console.error('❌ 智能抓取过程出错:', error.message);
    
    // 如果HTTP失败，尝试SPA作为备选
    try {
      console.error('🌐 HTTP失败，尝试SPA备选方案');
      await sendProgress(3, 4, 'HTTP失败，尝试SPA备选');
      const spaFallbackResult = await handleFetchSpaWithCookies(args, sendProgress, false);
      
      // 保存SPA备选结果
      const spaFallbackContent = spaFallbackResult.content[0].text;
      const titleMatch = spaFallbackContent.match(/^Title: (.+)$/m);
      const pageTitle = titleMatch ? titleMatch[1] : url;
      savePageContent(url, spaFallbackContent, pageTitle);
      console.error('📄 已保存SPA备选结果到文件');
      
      return spaFallbackResult;
    } catch (spaError) {
      console.error('❌ SPA备选也失败:', spaError.message);
      const errorContent = `页面抓取失败:\\n\\nHTTP方法错误: ${error.message}\\nSPA方法错误: ${spaError.message}\\n\\n建议：\\n1. 检查URL是否正确\\n2. 检查网络连接\\n3. 如果页面需要登录，请使用浏览器扩展获取cookie`;
      
      // 保存错误信息
      savePageContent(url, errorContent, '页面抓取失败', true);
      console.error('📄 已保存错误信息到文件');
      
      return {
        content: [{
          type: 'text',
          text: errorContent
        }]
      };
    }
  }
}

// 页面内容分析函数
function analyzePageContent(content, url) {
  const analysis = {
    needsLogin: false,
    isGoodContent: false,
    reason: '',
    loginMessage: ''
  };
  
  // 1. 检测登录需求
  const lowerContent = content.toLowerCase();
  const loginKeywords = [
    'please log in', 'please sign in', 'login required', 'session expired',
    'authentication required', 'access denied', '请登录', '请先登录', 
    '登录已过期', '会话已过期', 'login form', 'sign in form'
  ];
  
  const loginKeywordCount = loginKeywords.filter(keyword => 
    lowerContent.includes(keyword)
  ).length;
  
  const hasLoginForm = lowerContent.includes('<form') && (
    lowerContent.includes('type="password"') ||
    lowerContent.includes('name="password"') ||
    lowerContent.includes('id="password"')
  );
  
  if (loginKeywordCount >= 2 || hasLoginForm || 
      (loginKeywordCount >= 1 && content.length < 500)) {
    analysis.needsLogin = true;
    analysis.reason = `检测到登录需求 (关键词数量: ${loginKeywordCount}${hasLoginForm ? ', 包含登录表单' : ''})`;
    analysis.loginMessage = `🔒 页面需要登录访问: ${url}\\n\\n💡 建议操作：\\n1. 使用浏览器打开页面并完成登录\\n2. 使用Chrome扩展导出cookie到本地\\n3. 重新运行此工具，将自动加载cookie\\n\\n🔧 Chrome扩展下载地址：\\n- Cookie导出扩展 (搜索 "Cookie Editor" 或类似工具)\\n\\n📝 cookie保存路径：\\n${COOKIE_DIR}`;
    return analysis;
  }
  
  // 2. 评估内容质量
  const textLength = content.replace(/<[^>]+>/g, '').length;
  const hasStructure = content.includes('</h') || content.includes('</p>') || content.includes('</div>');
  const isErrorPage = lowerContent.includes('404') || lowerContent.includes('error') || lowerContent.includes('not found');
  
  if (textLength > 500 && hasStructure && !isErrorPage) {
    analysis.isGoodContent = true;
    analysis.reason = `内容质量良好 (文本长度: ${textLength}, 有结构: ${hasStructure})`;
  } else {
    analysis.reason = `内容质量不佳 (文本长度: ${textLength}, 有结构: ${hasStructure}, 错误页面: ${isErrorPage})`;
  }
  
  return analysis;
}


// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request, { progressToken } = {}) => {
  const { name: toolName, arguments: args } = request.params;
  
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
        console.error(`📊 发送进度通知: ${message} (${progress}/${total})`);
      } catch (error) {
        console.error('❌ 发送进度通知失败:', error.message);
      }
    }
  };
  
  if (toolName === 'fetchpage') {
    return await handleFetchPage(request.params.arguments, sendProgress);
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