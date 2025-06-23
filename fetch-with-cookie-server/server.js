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
    
    const possibleNames = [
      `${domain}_cookies.json`,
      `${cleanDomain}_cookies.json`,
      `www.${cleanDomain}_cookies.json`
    ];
    
    for (const name of possibleNames) {
      const filePath = path.join(COOKIE_DIR, name);
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    }
    
    return null;
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
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'fetch_with_cookies') {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { url, cookies } = request.params.arguments;
  
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
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Fetch With Cookie MCP Server started');
}

main().catch(console.error);