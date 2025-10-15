// 后台脚本，用于处理扩展的后台逻辑
chrome.runtime.onInstalled.addListener(() => {
    console.log('Cookie Exporter 扩展已安装');
});

// 保存来自popup的建议basename，按tab维度存储，避免使用blob默认名
const pendingBasenameByTab = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message && message.type === 'mcp:setDownloadBasename' && typeof message.basename === 'string') {
      const tabId = sender && sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : null;
      if (tabId !== null) {
        pendingBasenameByTab.set(tabId, {
          basename: message.basename,
          ts: Date.now()
        });
      } else {
        // 若无tab上下文，则作为全局后备
        pendingBasenameByTab.set('global', {
          basename: message.basename,
          ts: Date.now()
        });
      }
      // 同步响应；不要返回 true（仅用于异步响应场景），避免消息端Promise悬挂
      sendResponse && sendResponse({ ok: true });
      return false;
    }
  } catch (e) {
    // 忽略错误
  }
  return false;
});

// 监听下载完成事件，可以添加额外的处理逻辑
chrome.downloads.onChanged.addListener((downloadDelta) => {
    if (downloadDelta.state && downloadDelta.state.current === 'complete') {
        console.log('Cookie文件下载完成');
    }
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  try {
    // 仅处理本扩展发起的下载
    if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
      return;
    }

    // 提取popup提供的basename（优先tab，其次global），避免使用blob默认名
    const tabId = typeof item.tabId === 'number' ? item.tabId : null;
    let hinted = null;
    if (tabId !== null && pendingBasenameByTab.has(tabId)) {
      hinted = pendingBasenameByTab.get(tabId);
      // 使用一次即清理，避免污染后续下载
      pendingBasenameByTab.delete(tabId);
    } else if (pendingBasenameByTab.has('global')) {
      hinted = pendingBasenameByTab.get('global');
      pendingBasenameByTab.delete('global');
    }

    // 清理过期hint（>30秒）
    for (const [key, value] of pendingBasenameByTab.entries()) {
      if (value && value.ts && Date.now() - value.ts > 30000) {
        pendingBasenameByTab.delete(key);
      }
    }

    // 仅处理JSON（我们的cookie导出）
    const rawName = (item.filename || '').split(/[\\/]/).pop() || 'cookies.json';
    const isJson = (item.mime && item.mime.includes('json')) || rawName.endsWith('.json');
    if (!isJson) {
      return;
    }

    const safeHint = hinted && typeof hinted.basename === 'string' ? hinted.basename : null;
    const baseName = safeHint || rawName || 'cookies.json';

    // 强制保存到子目录
    const targetPath = `mcp-fetch-page/cookies/${baseName}`;
    suggest({ filename: targetPath, conflictAction: 'overwrite' });
  } catch (e) {
    // 忽略错误，保持默认行为
  }
});

// (单一监听器) 避免重复注册多个 onDeterminingFilename