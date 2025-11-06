// 在document_start阶段执行
(() => {
    // 优先从本地存储获取启用状态
    const getEnabledScripts = () => {
        try {
            const hostname = window.location.hostname;
            const storageData = localStorage.getItem('AntiDebug_Breaker');
            if (storageData) {
                const parsed = JSON.parse(storageData);
                return parsed[hostname] || [];
            }
        } catch (e) {
            console.warn('[AntiDebug] Failed to read localStorage', e);
        }
        return [];
    };

    // 从扩展存储获取最新状态
    const hostname = window.location.hostname;
    chrome.storage.local.get([hostname], (result) => {
        const latestEnabledScripts = result[hostname] || [];

        // 更新本地存储
        try {
            const storageData = localStorage.getItem('AntiDebug_Breaker') || '{}';
            const parsed = JSON.parse(storageData);
            parsed[hostname] = latestEnabledScripts.filter(
                id => typeof id === 'string' && id.trim() !== ''
            );
            localStorage.setItem('AntiDebug_Breaker', JSON.stringify(parsed));
        } catch (e) {
            console.warn('[AntiDebug] Failed to update localStorage', e);
        }
    });

    // 监听来自popup的更新
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'scripts_updated' && message.hostname === hostname) {
            // 更新本地存储
            try {
                const storageData = localStorage.getItem('AntiDebug_Breaker') || '{}';
                const parsed = JSON.parse(storageData);
                parsed[hostname] = message.enabledScripts;
                localStorage.setItem('AntiDebug_Breaker', JSON.stringify(parsed));
            } catch (e) {
                console.warn('[AntiDebug] Failed to update localStorage', e);
            }
        }
        
        // 监听popup请求Vue数据
        if (message.type === 'REQUEST_VUE_ROUTER_DATA') {
            // 转发请求到页面脚本
            window.postMessage({
                type: 'REQUEST_VUE_ROUTER_DATA',
                source: 'antidebug-extension'
            }, '*');
            sendResponse({success: true});
        }
        
        // 🆕 监听popup触发Vue重扫描请求
        if (message.type === 'TRIGGER_VUE_RESCAN') {
            // 转发重扫描请求到页面脚本
            window.postMessage({
                type: 'MANUAL_RESCAN_VUE',
                source: 'antidebug-extension'
            }, '*');
            sendResponse({success: true});
        }
        
        return true;
    });

    // 监听来自页面脚本的 Vue Router 数据
    window.addEventListener('message', (event) => {
        // 只接受来自同一窗口的消息
        if (event.source !== window) return;
        
        // 检查消息类型
        if (event.data && event.data.type === 'VUE_ROUTER_DATA' && event.data.source === 'get-vue-script') {
            // 转发到 background/popup
            chrome.runtime.sendMessage({
                type: 'VUE_ROUTER_DATA',
                data: event.data.data
            }).catch(err => {
                // 忽略错误（popup可能未打开）
            });
        }
    });
})();
