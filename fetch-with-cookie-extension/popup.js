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
            
            // Try to get cookies for current domain
            let cookies = await chrome.cookies.getAll({ domain: currentDomain });
            console.log('Direct domain match result:', cookies.length);
            
            // If not found, try without www prefix
            if (cookies.length === 0 && currentDomain.startsWith('www.')) {
                const rootDomain = currentDomain.substring(4);
                cookies = await chrome.cookies.getAll({ domain: rootDomain });
                console.log('Without www result:', cookies.length);
            }
            
            // If still not found, try with www prefix
            if (cookies.length === 0 && !currentDomain.startsWith('www.')) {
                const wwwDomain = 'www.' + currentDomain;
                const wwwCookies = await chrome.cookies.getAll({ domain: wwwDomain });
                cookies = cookies.concat(wwwCookies);
                console.log('With www result:', wwwCookies.length);
            }
            
            // If still not found, try all related cookies (including subdomains)
            if (cookies.length === 0) {
                const allCookies = await chrome.cookies.getAll({});
                cookies = allCookies.filter(cookie => {
                    return cookie.domain === currentDomain || 
                           cookie.domain === '.' + currentDomain ||
                           cookie.domain.endsWith('.' + currentDomain) ||
                           currentDomain.endsWith(cookie.domain.replace(/^\./, ''));
                });
                console.log('Filtered related cookies result:', cookies.length);
            }
            
            if (cookies.length === 0) {
                throw new Error('No cookies found');
            }
            
            // Prepare cookie data
            const cookieData = {
                domain: currentDomain,
                url: currentUrl,
                timestamp: new Date().toISOString(),
                totalCookies: cookies.length,
                cookies: cookies.map(cookie => ({
                    name: cookie.name,
                    value: cookie.value,
                    domain: cookie.domain,
                    path: cookie.path,
                    secure: cookie.secure,
                    httpOnly: cookie.httpOnly,
                    sameSite: cookie.sameSite,
                    expirationDate: cookie.expirationDate
                }))
            };
            
            // Create JSON content
            const jsonContent = JSON.stringify(cookieData, null, 2);
            
            // Download file to fetch-with-cookie/cookies directory
            const blob = new Blob([jsonContent], { type: 'application/json' });
            const downloadUrl = URL.createObjectURL(blob);
            
            await chrome.downloads.download({
                url: downloadUrl,
                filename: `fetch-with-cookie/cookies/${currentDomain.replace(/[^a-zA-Z0-9.-]/g, '_')}_cookies.json`,
                saveAs: false
            });
            
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
            
            status.textContent = `Successfully saved ${cookies.length} cookies to fetch-with-cookie/cookies/`;
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