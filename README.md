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

### 1. Install MCP Server

**Option A: Install from npm (Recommended)**
```bash
npm install -g mcp-fetchpage
```

**Option B: Install from source**
```bash
cd ~/Downloads/mcp-fetchpage
npm install
```

### 2. Install Chrome Extension

**If you installed from npm:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `/usr/local/lib/node_modules/mcp-fetchpage/chrome-extension`

**If you installed from source:**
1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `~/Downloads/mcp-fetchpage/chrome-extension`

### 3. Configure Editor

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

**If installed globally via npm:**
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

**If installed locally or from source:**
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

Restart your editor after configuration.

## Usage

### Basic Usage
1. **Login** to a website in Chrome
2. **Click** the "Fetch Page MCP Tools" extension icon  
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
node debug.js test-spa "https://example.com" "#content"

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
mcp-fetchpage/
├── package.json              # npm package config
├── package-lock.json         # npm lockfile
├── node_modules/             # npm dependencies
├── README.md                 # This file
├── README-zh.md              # Chinese version  
├── CLAUDE.md                 # Claude Code usage guide
├── chrome-extension/         # Chrome extension
│   ├── manifest.json
│   ├── popup.js
│   ├── popup.html
│   └── background.js
└── mcp-server/              # MCP server
    ├── server.js            # Main server
    ├── debug.js             # Debug tools
    └── domain-selectors.json # Domain selector config
```

## Troubleshooting

- **Extension not working**: Make sure you're on a normal website (not chrome:// pages)
- **No cookies found**: Try logging in again and saving cookies
- **MCP not connecting**: Check Node.js installation and restart your editor
- **Path error**: Make sure to use full path `/Users/YOUR_USERNAME/...` instead of `~/...`
- **CSS selector not working**: Verify the selector exists on the page

That's it! 🍪