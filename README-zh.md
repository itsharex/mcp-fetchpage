# Fetch With Cookie

一个用于抓取需要登录的网页的简单工具。

## 功能说明

- **Chrome扩展**: 保存已登录网站的cookies
- **MCP服务器**: 在Claude/Cursor中使用保存的cookies抓取网页

## 安装配置

### 1. 安装Chrome扩展

1. 打开 `chrome://extensions/`
2. 开启"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择 `~/Downloads/fetch-with-cookie/fetch-with-cookie-extension`

### 2. 安装MCP服务器

```bash
cd ~/Downloads/fetch-with-cookie/fetch-with-cookie-server
npm install
```

### 3. 配置编辑器

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

⚠️ **重要**: 将 `/Users/YOUR_USERNAME` 替换为你的实际用户名！

```json
{
  "mcpServers": {
    "fetch-with-cookie": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/Downloads/fetch-with-cookie/fetch-with-cookie-server/server.js"]
    }
  }
}
```

**获取用户名**: 在终端运行 `echo $HOME` 查看完整路径。

**Cursor** (Settings > Cursor Settings > Tools & Integrations > MCP Tools):
```json
{
  "mcpServers": {
    "fetch-with-cookie": {
      "command": "node",
      "args": ["~/Downloads/fetch-with-cookie/fetch-with-cookie-server/server.js"]
    }
  }
}
```

配置完成后重启编辑器。

## 使用方法

1. **登录**网站（在Chrome中）
2. **点击**"Fetch With Cookie"扩展图标
3. **点击**"Save Cookies"按钮
4. **在Claude/Cursor中使用**: `fetch_with_cookies(url="https://example.com")`

扩展会将cookies保存到 `~/Downloads/fetch-with-cookie/cookies/`，MCP服务器会自动使用它们。

## 使用示例

```javascript
// 抓取知识星球私有文章
fetch_with_cookies(url="https://articles.zsxq.com/id_xxxxx.html")

// 抓取公司内网
fetch_with_cookies(url="https://internal.company.com/docs")

// 抓取私有GitHub仓库
fetch_with_cookies(url="https://github.com/your-private-repo")
```

## 文件结构

```
~/Downloads/fetch-with-cookie/
├── README.md                      # 英文说明
├── README-zh.md                   # 中文说明（本文件）
├── fetch-with-cookie-extension/   # Chrome扩展
├── fetch-with-cookie-server/      # MCP服务器
└── cookies/                       # 保存的cookies
```

## 常见问题

- **扩展无法使用**: 确保在正常网站使用（不是chrome://页面）
- **找不到cookies**: 重新登录网站并保存cookies
- **MCP连接失败**: 检查Node.js安装并重启编辑器
- **路径错误**: 确保使用完整路径 `/Users/YOUR_USERNAME/...` 而不是 `~/...`

就这么简单！🍪