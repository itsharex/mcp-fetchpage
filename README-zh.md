# MCP FetchPage

智能网页抓取工具，支持自动Cookie管理和CSS选择器内容提取。

## 功能说明

- **Chrome扩展**: 保存已登录网站的cookies
- **MCP服务器**: 智能页面抓取，HTTP → SPA回退机制，支持CSS选择器

## 核心特性

- 🤖 **智能抓取**: 自动选择HTTP或浏览器方法
- 🍪 **智能Cookie管理**: 使用Cookie实际过期时间，而非固定24小时限制
- 🎯 **高级CSS选择器支持**: 处理多个节点，自动过滤嵌套元素
- 🌐 **域名预设**: 内置常见网站的最佳选择器（微信、知识星球等）
- 📱 **SPA支持**: 完整JavaScript渲染支持
- 📄 **进度通知**: 实时状态更新
- 🛠️ **双重调试工具**: 支持独立脚本和MCP Inspector

## 安装配置

### 1. 安装MCP服务器

**方案A: 通过npm安装（推荐）**
```bash
npm install -g mcp-fetchpage
```

**方案B: 从源码安装**
```bash
cd ~/Downloads/mcp-fetchpage
npm install
```

### 2. 安装Chrome扩展

**如果通过npm安装:**
1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `/usr/local/lib/node_modules/mcp-fetchpage/chrome-extension`

**如果从源码安装:**
1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `~/Downloads/mcp-fetchpage/chrome-extension`

### 3. 配置编辑器

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

**如果通过npm全局安装:**
```json
{
  "mcpServers": {
    "mcp-fetchpage": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/mcp-fetchpage/mcp-server/server.js"]
    }
  }
}
```

**如果本地安装或从源码安装:**
```json
{
  "mcpServers": {
    "mcp-fetchpage": {
      "command": "node",
      "args": ["/path/to/mcp-fetchpage/mcp-server/server.js"]
    }
  }
}
```

**Cursor** (Settings > Cursor Settings > Tools & Integrations > MCP Tools):
```json
{
  "mcpServers": {
    "mcp-fetchpage": {
      "command": "node",
      "args": ["node_modules/mcp-fetchpage/mcp-server/server.js"]
    }
  }
}
```

配置完成后重启编辑器。

## 使用方法

### 基础用法
1. **登录**网站（在Chrome中）
2. **点击**"Fetch Page MCP Tools"扩展图标
3. **点击**"Save Cookies"按钮
4. **在Claude/Cursor中使用**: `fetchpage(url="https://example.com")`

### 高级用法

```javascript
// 基础智能抓取
fetchpage(url="https://example.com")

// 强制指定方法
fetchpage(url="https://example.com", forceMethod="spa")

// 使用CSS选择器提取特定内容
fetchpage(url="https://example.com", waitFor="#main-content")

// 微信公众号文章（自动选择器）
fetchpage(url="https://mp.weixin.qq.com/s/xxxxx")
```

### 域名预设

系统会自动为以下网站使用优化的选择器：
- **mp.weixin.qq.com** → `.rich_media_wrp` (微信公众号文章)
- **wx.zsxq.com** → `.content` (知识星球)
- **cnblogs.com** → `.post` (博客园)
- 在 `mcp-server/domain-selectors.json` 中添加更多

### 调试工具

```bash
# 独立调试脚本（推荐用于开发调试）
cd mcp-server
node debug.js test-page "https://example.com"
node debug.js test-spa "https://example.com" "#content"

# MCP Inspector（用于集成测试）
npx @modelcontextprotocol/inspector
# 然后访问 http://localhost:6274
```

## 参数说明

- `url` (必需): 要抓取的URL
- `waitFor` (可选): CSS选择器，提取特定内容
- `forceMethod` (可选): 强制使用 "http" 或 "spa" 方法
- `skipCookies` (可选): 跳过加载cookies
- `headless` (可选): 浏览器无头模式 (默认: true)
- `timeout` (可选): 超时时间毫秒 (默认: 30000)

## 文件结构

```
mcp-fetchpage/
├── package.json              # npm包配置
├── package-lock.json         # npm锁定文件
├── node_modules/             # npm依赖
├── README.md                 # 英文说明
├── README-zh.md              # 中文说明（本文件）
├── CLAUDE.md                 # Claude Code使用指南
├── chrome-extension/         # Chrome扩展
│   ├── manifest.json
│   ├── popup.js
│   ├── popup.html
│   └── background.js
└── mcp-server/              # MCP服务器
    ├── server.js            # 主服务器
    ├── debug.js             # 调试工具
    └── domain-selectors.json # 域名选择器配置
```

## 常见问题

- **扩展无法使用**: 确保在正常网站使用（不是chrome://页面）
- **找不到cookies**: 重新登录网站并保存cookies
- **MCP连接失败**: 检查Node.js安装并重启编辑器
- **路径错误**: 确保使用完整路径 `/Users/YOUR_USERNAME/...` 而不是 `~/...`
- **CSS选择器无效**: 验证选择器在页面中确实存在

就这么简单！🍪