// 后台脚本，用于处理扩展的后台逻辑
chrome.runtime.onInstalled.addListener(() => {
    console.log('Cookie Exporter 扩展已安装');
});

// 监听下载完成事件，可以添加额外的处理逻辑
chrome.downloads.onChanged.addListener((downloadDelta) => {
    if (downloadDelta.state && downloadDelta.state.current === 'complete') {
        console.log('Cookie文件下载完成');
    }
});