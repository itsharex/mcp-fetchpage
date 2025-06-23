# Fetch With Cookie

A simple tool to fetch web pages that require login using cookies.

## What it does

- **Chrome Extension**: Save cookies from logged-in websites
- **MCP Server**: Fetch web pages using saved cookies in Claude/Cursor

## Setup

### 1. Install Chrome Extension

1. Go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `~/Downloads/fetch-with-cookie/fetch-with-cookie-extension`

### 2. Install MCP Server

```bash
cd ~/Downloads/fetch-with-cookie/fetch-with-cookie-server
npm install
```

### 3. Configure Editor

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):

⚠️ **Important**: Replace `/Users/YOUR_USERNAME` with your actual username!

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

**Get your username**: Run `echo $HOME` in terminal to see your full path.

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

Restart your editor after configuration.

## Usage

1. **Login** to a website in Chrome
2. **Click** the "Fetch With Cookie" extension icon
3. **Click** "Save Cookies" button
4. **Use** in Claude/Cursor: `fetch_with_cookies(url="https://example.com")`

The extension saves cookies to `~/Downloads/fetch-with-cookie/cookies/` and the MCP server automatically uses them.

## Examples

```javascript
// Fetch a private article
fetch_with_cookies(url="https://articles.zsxq.com/id_xxxxx.html")

// Fetch company intranet
fetch_with_cookies(url="https://internal.company.com/docs")

// Fetch private GitHub repo
fetch_with_cookies(url="https://github.com/your-private-repo")
```

## File Structure

```
~/Downloads/fetch-with-cookie/
├── README.md                      # This file
├── README-zh.md                   # Chinese version
├── fetch-with-cookie-extension/   # Chrome extension
└── fetch-with-cookie-server/      # MCP server
└── cookies/                       # Saved cookies
```

## Troubleshooting

- **Extension not working**: Make sure you're on a normal website (not chrome:// pages)
- **No cookies found**: Try logging in again and saving cookies
- **MCP not connecting**: Check Node.js installation and restart your editor
- **Path error**: Make sure to use full path `/Users/YOUR_USERNAME/...` instead of `~/...`

That's it! 🍪