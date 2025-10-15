# Release Instructions

## Automated Release (Recommended)

The project now has automated GitHub Actions workflow that handles Chrome extension packaging and release creation.

### Quick Release Steps

1. **Update version numbers** in all files:
   ```bash
   # Update version in package.json, server.js, and manifest.json
   npm version patch  # for bug fixes (0.1.0 → 0.1.1)
   npm version minor  # for new features (0.1.0 → 0.2.0)
   npm version major  # for breaking changes (0.1.0 → 1.0.0)
   ```

2. **Update CHANGELOG.md** with release notes

3. **Commit changes**:
   ```bash
   git add .
   git commit -m "chore: release v$(node -p "require('./package.json').version")"
   ```

4. **Create and push tag**:
   ```bash
   git tag v$(node -p "require('./package.json').version")
   git push origin main
   git push origin --tags
   ```

5. **GitHub Actions will automatically**:
   - Package the Chrome extension as ZIP
   - Create a GitHub Release
   - Attach the extension ZIP to the release
   - Generate release notes

6. **Publish to npm** (manual step):
   ```bash
   npm publish
   ```

### What GitHub Actions Does

When you push a tag (e.g., `v0.1.0`), the workflow (`.github/workflows/release.yml`) will:

1. ✅ Checkout code
2. ✅ Extract version from `package.json`
3. ✅ Package Chrome extension as `mcp-fetch-page-extension-v{version}.zip`
4. ✅ Create GitHub Release with:
   - Extension ZIP file
   - Installation instructions
   - NPM configuration example
   - Link to CHANGELOG
5. ✅ Provide release summary

---

## Manual Release (Alternative)

If you prefer manual release or GitHub Actions is unavailable:

### 1. Update Version

Update version in these files:
- `package.json`
- `mcp-server/server.js`
- `chrome-extension/manifest.json`

```bash
npm version patch  # or minor, major
```

### 2. Update CHANGELOG.md

Add release notes for the new version.

### 3. Package Chrome Extension

Run the packaging script:
```bash
./scripts/package-extension.sh
```

This will create a ZIP file in the `dist/` directory.

### 4. Commit and Push

```bash
git add .
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag v$(node -p "require('./package.json').version")
git push origin main
git push origin --tags
```

### 5. Create GitHub Release Manually

1. Go to https://github.com/kaiye/mcp-fetch-page/releases
2. Click "Draft a new release"
3. Choose the tag that was just created (e.g., `v0.1.0`)
4. Set the release title to the version (e.g., `v0.1.0`)
5. Add release notes from CHANGELOG.md
6. Upload the extension ZIP file from `dist/`
7. Click "Publish release"

### 6. Publish to npm

```bash
npm publish
```

---

## Release Checklist

- [ ] Version updated in `package.json`
- [ ] Version updated in `mcp-server/server.js`
- [ ] Version updated in `chrome-extension/manifest.json`
- [ ] CHANGELOG.md updated with release notes
- [ ] Changes committed to git
- [ ] Git tag created and pushed
- [ ] GitHub release created (automatic or manual)
- [ ] Chrome extension ZIP available in release
- [ ] npm package published
- [ ] Test installation with `npx mcp-fetch-page@latest`
- [ ] Test Chrome extension installation from release

---

## Testing Before Release

### Test MCP Server
```bash
cd mcp-server
node server.js
```

### Test Chrome Extension
1. Load unpacked extension in Chrome
2. Visit a website and login
3. Save cookies using the extension
4. Verify cookie file created in `~/Downloads/mcp-fetch-page/cookies/`

### Test Integration
1. Configure MCP in Claude Desktop
2. Try fetching a page: `fetchpage(url="https://example.com")`
3. Verify Markdown output is clean (no CSS/styles)

---

## Version Numbering

Following [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes (e.g., removed parameters, changed API)
- **MINOR** (0.x.0): New features, backward compatible
- **PATCH** (0.0.x): Bug fixes, backward compatible

### Examples:
- `0.1.0` → `0.1.1`: Bug fix (patch)
- `0.1.0` → `0.2.0`: New feature (minor)
- `0.1.0` → `1.0.0`: Breaking change (major)

---

## Troubleshooting

### GitHub Actions fails
- Check workflow logs at: https://github.com/kaiye/mcp-fetch-page/actions
- Verify `GITHUB_TOKEN` has write permissions
- Ensure tag format is `vX.Y.Z` (with 'v' prefix)

### Extension ZIP not created
- Check if `chrome-extension/` directory exists
- Verify no syntax errors in manifest.json
- Run packaging script manually first

### npm publish fails
- Verify you're logged in: `npm whoami`
- Check if version already exists: `npm view mcp-fetch-page versions`
- Ensure package.json is valid: `npm pkg fix`
