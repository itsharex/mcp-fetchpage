document.addEventListener('DOMContentLoaded', async () => {
    const domainDiv = document.getElementById('currentDomain');
    const exportBtn = document.getElementById('exportBtn');
    const status = document.getElementById('status');
    
    let currentDomain = '';
    let currentUrl = '';
    
    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        currentUrl = tab.url;
        
        // Check for special pages
        if (currentUrl.startsWith('chrome://') || 
            currentUrl.startsWith('chrome-extension://') ||
            currentUrl.startsWith('edge://') ||
            currentUrl.startsWith('about:') ||
            currentUrl.startsWith('file://')) {
            domainDiv.textContent = 'Unsupported page type';
            exportBtn.disabled = true;
            status.textContent = 'Please use on normal websites';
            return;
        }
        
        const url = new URL(currentUrl);
        currentDomain = url.hostname;
        domainDiv.textContent = currentDomain;
        
        console.log('Current URL:', currentUrl);
        console.log('Parsed domain:', currentDomain);
        
    } catch (error) {
        console.error('Failed to get domain:', error);
        domainDiv.textContent = 'Cannot get domain';
        exportBtn.disabled = true;
        status.textContent = `Error: ${error.message}`;
        return;
    }
    
    exportBtn.addEventListener('click', async () => {
        exportBtn.disabled = true;
        exportBtn.textContent = 'Saving...';
        status.textContent = '';
        
        try {
            console.log('Getting cookies for domain:', currentDomain);
            
            // 总是收集所有相关域名的cookies
            const allCookies = await chrome.cookies.getAll({});
            
            // 提取主域名 (例如: wx.zsxq.com -> zsxq.com)
            const domainParts = currentDomain.split('.');
            const mainDomain = domainParts.slice(-2).join('.'); // 取最后两部分
            
            console.log('Main domain extracted:', mainDomain);
            
            // 查找所有相关的cookies
            const cookies = allCookies.filter(cookie => {
                const cookieDomain = cookie.domain.replace(/^\./, ''); // 去掉开头的点
                
                return (
                    // 精确匹配当前域名
                    cookie.domain === currentDomain ||
                    cookie.domain === '.' + currentDomain ||
                    
                    // 匹配主域名
                    cookie.domain === mainDomain ||
                    cookie.domain === '.' + mainDomain ||
                    
                    // 匹配www变体
                    cookie.domain === 'www.' + mainDomain ||
                    cookie.domain === '.' + 'www.' + mainDomain ||
                    
                    // 当前域名是子域，匹配父域的cookies
                    currentDomain.endsWith('.' + cookieDomain) ||
                    
                    // cookie域名是子域，当前页面是父域
                    cookieDomain.endsWith('.' + currentDomain) ||
                    cookieDomain.endsWith('.' + mainDomain)
                );
            });
            
            console.log('Total cookies found:', cookies.length);
            
            // 按域名分组显示找到的cookies
            const cookiesByDomain = {};
            cookies.forEach(cookie => {
                const domain = cookie.domain;
                if (!cookiesByDomain[domain]) {
                    cookiesByDomain[domain] = 0;
                }
                cookiesByDomain[domain]++;
            });
            
            console.log('Cookies by domain:', cookiesByDomain);
            
            // 获取localStorage数据
            console.log('Getting localStorage data...');
            let localStorage = {};
            try {
                // 注入脚本到当前页面获取localStorage
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: (await chrome.tabs.query({ active: true, currentWindow: true }))[0].id },
                    func: () => {
                        const storage = {};
                        try {
                            for (let i = 0; i < window.localStorage.length; i++) {
                                const key = window.localStorage.key(i);
                                const value = window.localStorage.getItem(key);
                                storage[key] = value;
                            }
                        } catch (e) {
                            console.error('Cannot access localStorage:', e);
                        }
                        return storage;
                    }
                });
                localStorage = result.result || {};
                console.log('localStorage retrieved:', Object.keys(localStorage).length, 'items');
            } catch (error) {
                console.warn('Failed to get localStorage:', error.message);
                localStorage = {};
            }

            if (cookies.length === 0 && Object.keys(localStorage).length === 0) {
                throw new Error('No cookies or localStorage found');
            }
            
            // Prepare cookie data (now includes localStorage)
            const cookieData = {
                domain: currentDomain,
                url: currentUrl,
                timestamp: new Date().toISOString(),
                totalCookies: cookies.length,
                totalLocalStorage: Object.keys(localStorage).length,
                cookies: cookies.map(cookie => ({
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain,
                    path: cookie.path,
                    secure: cookie.secure,
                    httpOnly: cookie.httpOnly,
                    sameSite: cookie.sameSite,
                    expirationDate: cookie.expirationDate
                })),
                localStorage: localStorage
            };
            
            // Create JSON content
            const jsonContent = JSON.stringify(cookieData, null, 2);
            
            // Download file to mcp-fetchpage/cookies directory
            const blob = new Blob([jsonContent], { type: 'application/json' });
            const downloadUrl = URL.createObjectURL(blob);
            
            // 先将期望的basename通知后台，确保最终文件名为 domain_cookies.json
            const basename = `${currentDomain.replace(/[^a-zA-Z0-9.-]/g, '_')}_cookies.json`;
            try {
                await chrome.runtime.sendMessage({ type: 'mcp:setDownloadBasename', basename });
            } catch (e) {
                console.warn('Failed to hint basename:', e);
            }

            await chrome.downloads.download({
                url: downloadUrl,
                filename: basename, // 后台会强制放入 mcp-fetchpage/cookies/
                saveAs: false
            });
            
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
            
            const domainCount = Object.keys(cookiesByDomain).length;
            const domainList = Object.keys(cookiesByDomain).join(', ');
            const localStorageCount = Object.keys(localStorage).length;
            
            status.textContent = `Successfully saved ${cookies.length} cookies and ${localStorageCount} localStorage items from ${domainCount} domain(s): ${domainList}`;
            status.className = 'status success';
            
        } catch (error) {
            console.error('Save failed:', error);
            status.textContent = `Save failed: ${error.message}`;
            status.className = 'status error';
        } finally {
            exportBtn.disabled = false;
            exportBtn.textContent = 'Save Cookies';
        }
    });
});