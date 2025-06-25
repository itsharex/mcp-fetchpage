# MCP FetchPage

Intelligent web page fetching with automatic cookie support and CSS selector extraction.

## What it does

- **Chrome Extension**: Save cookies from logged-in websites
- **MCP Server**: Intelligent page fetching with HTTP → SPA fallback and CSS selector support

## Features

- 🤖 **Intelligent Fetching**: Automatically chooses HTTP or browser method
- 🍪 **Smart Cookie Management**: Uses actual cookie expiration times, not fixed 24-hour limit  
- 🎯 **Advanced CSS Selector Support**: Handles multiple nodes, filters nested elements automatically
- 🌐 **Domain Presets**: Built-in selectors for common websites (WeChat, Knowledge Planet, etc.)
- 📱 **SPA Support**: Full JavaScript rendering when needed
- 📄 **Progress Notifications**: Real-time status updates
- 🛠️ **Dual Debug Tools**: Both standalone script and MCP Inspector support

## Setup

### 1. Install Chrome Extension

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `~/Downloads/fetch-with-cookie/chrome-extension`

### 2. Install MCP Server

```bash
cd ~/Downloads/fetch-with-cookie/mcp-server
npm install
```

### 3. Configure Editor

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

⚠️ **Important**: Replace `/Users/YOUR_USERNAME` with your actual username!

```json
{
  "mcpServers": {
    "mcp-fetchpage": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/Downloads/fetch-with-cookie/mcp-server/server.js"]
    }
  }
}
```

**Get your username**: Run `echo $HOME` in terminal to see your full path.

**Cursor** (Settings > Cursor Settings > Tools & Integrations > MCP Tools):
```json
{
  "mcpServers": {
    "mcp-fetchpage": {
      "command": "node",
      "args": ["~/Downloads/fetch-with-cookie/mcp-server/server.js"]
    }
  }
}
```

Restart your editor after configuration.

## Usage

### Basic Usage
1. **Login** to a website in Chrome
2. **Click** the "Fetch With Cookie" extension icon  
3. **Click** "Save Cookies" button
4. **Use** in Claude/Cursor: `fetchpage(url="https://example.com")`

### Advanced Usage

```javascript
// Basic intelligent fetching
fetchpage(url="https://example.com")

// Force specific method
fetchpage(url="https://example.com", forceMethod="spa")

// Extract specific content with CSS selector
fetchpage(url="https://example.com", waitFor="#main-content")

// WeChat articles (automatic selector)
fetchpage(url="https://mp.weixin.qq.com/s/xxxxx")
```

### Domain Presets

The system automatically uses optimized selectors for:
- **mp.weixin.qq.com** → `.rich_media_wrp` (WeChat articles)
- **wx.zsxq.com** → `.content` (Knowledge Planet)
- **cnblogs.com** → `.post` (Blog Garden)
- Add more in `mcp-server/domain-selectors.json`

### Debug Tools

```bash
# Standalone debug script (recommended for development)
cd mcp-server
node debug.js test-page "https://example.com"
node debug.js inspect-spa "https://example.com" "#content"

# MCP Inspector (for integration testing)
npx @modelcontextprotocol/inspector
# Then visit http://localhost:6274
```

## Parameters

- `url` (required): The URL to fetch
- `waitFor` (optional): CSS selector to extract specific content
- `forceMethod` (optional): Force "http" or "spa" method
- `skipCookies` (optional): Skip loading cookies
- `headless` (optional): Run browser in headless mode (default: true)
- `timeout` (optional): Timeout in milliseconds (default: 30000)

## File Structure

```
~/Downloads/fetch-with-cookie/
├── README.md                   # This file
├── README-zh.md               # Chinese version  
├── chrome-extension/          # Chrome extension
├── mcp-server/               # MCP server
│   ├── server.js            # Main server
│   ├── domain-selectors.json # Domain selector config
│   └── package.json
└── cookies/                  # Saved cookies
```

## Troubleshooting

- **Extension not working**: Make sure you're on a normal website (not chrome:// pages)
- **No cookies found**: Try logging in again and saving cookies
- **MCP not connecting**: Check Node.js installation and restart your editor
- **Path error**: Make sure to use full path `/Users/YOUR_USERNAME/...` instead of `~/...`
- **CSS selector not working**: Verify the selector exists on the page

That's it! 🍪