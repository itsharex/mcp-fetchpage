# Repository Guidelines

## Project Structure & Module Organization
- Root: `package.json`, `README.md`, `README-zh.md`.
- Server: `mcp-server/` (entry `server.js`, tools `debug.js`, config `domain-selectors.json`).
- Chrome Extension: `chrome-extension/` (`manifest.json`, `popup.js`, `background.js`).
- No committed cookies/pages; runtime data is stored under `~/Downloads/mcp-fetch-page/`.

## Build, Test, and Development Commands
- Run MCP server locally: `node mcp-server/server.js` or `npm start`.
- Debug (HTTP/SPA, selectors):
  - `cd mcp-server && node debug.js test-page "https://example.com"`
  - `cd mcp-server && node debug.js test-spa "https://example.com" "#content"`
- MCP Inspector (integration): `npx @modelcontextprotocol/inspector` then open http://localhost:6274.

## Coding Style & Naming Conventions
- Language: Node.js ES Modules (`type: module`), Node 18+.
- Indentation: 2 spaces; use semicolons; prefer single quotes.
- Filenames: kebab-case for scripts and assets (e.g., `debug.js`, `domain-selectors.json`).
- Imports: explicit extensions (e.g., `import x from './file.js'`).
- Config: keep domain presets in `mcp-server/domain-selectors.json`.

## Testing Guidelines
- No formal test suite yet. Validate behavior via `debug.js` and MCP Inspector.
- When adding tests, mirror directory structure under `mcp-server/__tests__/` and name files `*.test.js`.
- Aim for coverage of: HTTP fetch path, SPA path (Puppeteer), selector extraction, cookie handling.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, etc. Example: `feat: add SPA fallback for dynamic pages`.
- PRs should include: concise description, rationale, steps to verify (commands), and screenshots/logs when UI or extension behavior changes.
- Link related issues. Keep diffs focused; separate refactors from functional changes.

## Security & Configuration Tips
- Cookies are stored at `~/Downloads/mcp-fetch-page/cookies`; pages at `~/Downloads/mcp-fetch-page/pages` (do not commit user data).
- Prefer headless mode unless debugging (`headless: true` by default). Avoid logging sensitive headers/cookies.
- Add new domain selectors in `domain-selectors.json`; scope them to the minimal CSS required.

## Agent-Specific Notes
- This repo may be used by MCP-aware agents. Tools and paths referenced above are stable; keep CLI and JSON outputs deterministic for easier tooling.
