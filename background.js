// ====== 脚本注册管理 ====== //
const scriptRegistry = new Map(); // 存储: [hostname|scriptId] => 注册ID
let isInitialized = false;

// 生成全局唯一ID
function generateUniqueId() {
    return `ad_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// 注册脚本到主世界
async function registerScripts(hostname, scriptIds) {
    // 检查hostname是否有效
    if (!hostname || typeof hostname !== 'string' || hostname.trim() === '' || !hostname.includes('.')) {
        // console.warn('[AntiDebug] Skip script registration: Invalid hostname');
        return;
    }

    // 过滤有效脚本ID
    const validScriptIds = scriptIds.filter(
        id => typeof id === 'string' && id.trim() !== ''
    );

    // 创建当前应存在的键集合
    const currentKeys = new Set();
    validScriptIds.forEach(id => {
        currentKeys.add(`${hostname}|${id}`);
    });

    // === 1. 注销不再需要的脚本 ===
    const keysToRemove = [];
    for (const [key, regId] of scriptRegistry) {
        if (key.startsWith(`${hostname}|`) && !currentKeys.has(key)) {
            keysToRemove.push(key);
        }
    }

    if (keysToRemove.length > 0) {
        const removeIds = keysToRemove.map(key => scriptRegistry.get(key));

        try {
            await chrome.scripting.unregisterContentScripts({
                ids: removeIds
            });
            // console.log(`[AntiDebug] Unregistered scripts for ${hostname}:`, keysToRemove);

            // 清理注册表
            keysToRemove.forEach(key => scriptRegistry.delete(key));
        } catch (error) {
            if (!error.message.includes('Nonexistent')) {
                // console.error('[AntiDebug] Failed to unregister old scripts:', error);
            }
        }
    }

    // === 2. 注册新脚本 ===
    const scriptsToRegister = [];

    validScriptIds.forEach(id => {
        const key = `${hostname}|${id}`;

        // 如果尚未注册，则创建新注册项
        if (!scriptRegistry.has(key)) {
            const regId = generateUniqueId();
            scriptRegistry.set(key, regId);

            scriptsToRegister.push({
                id: regId,
                js: [`scripts/${id}.js`],
                matches: [`*://${hostname}/*`],
                runAt: 'document_start',
                world: 'MAIN'
            });
        }
    });

    if (scriptsToRegister.length > 0) {
        try {
            await chrome.scripting.registerContentScripts(scriptsToRegister);
            // console.log(`[AntiDebug] Registered new scripts for ${hostname}:`,
            //     scriptsToRegister.map(s => s.id));
        } catch (error) {
            console.error(`[AntiDebug] Failed to register scripts for ${hostname}:`, error);
        }
    }
}

// 初始化时清除所有旧注册
async function initializeScriptRegistry() {
    if (isInitialized) return;

    try {
        // 清除所有旧注册
        const registered = await chrome.scripting.getRegisteredContentScripts();
        const ourScripts = registered.filter(script => script.id.startsWith('ad_'));

        if (ourScripts.length > 0) {
            await chrome.scripting.unregisterContentScripts({
                ids: ourScripts.map(s => s.id)
            });
            // console.log('[AntiDebug] Cleared old script registrations');
        }

        isInitialized = true;
    } catch (error) {
        console.error('[AntiDebug] Initialization failed:', error);
    }
}

// ====== 初始化及原有徽章管理 ====== //
chrome.runtime.onStartup.addListener(initializeScriptRegistry);
chrome.runtime.onInstalled.addListener(initializeScriptRegistry);

chrome.storage.local.get(null, (data) => {
    // 先初始化注册表
    initializeScriptRegistry().then(() => {
        // 初始化存储结构
        Object.keys(data).forEach(hostname => {
            if (Array.isArray(data[hostname])) {
                // 确保计数基于有效的脚本ID
                const validCount = data[hostname].filter(
                    id => typeof id === 'string' && id.trim() !== ''
                ).length;

                updateBadgeForHostname(hostname, validCount);

                // 初始化脚本注册
                registerScripts(hostname, data[hostname]);
            }
        });
    });
});

// 监听存储变化并同步
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    for (let [key, {newValue}] of Object.entries(changes)) {
        if (namespace === 'local' && Array.isArray(newValue)) {
            // 更新脚本注册
            await registerScripts(key, newValue);

            // 同步到所有标签页的localStorage
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(tab => {
                    if (tab.url) {
                        try {
                            const tabHostname = new URL(tab.url).hostname;
                            if (tabHostname === key) {
                                chrome.scripting.executeScript({
                                    target: {tabId: tab.id},
                                    func: (hostname, scripts) => {
                                        try {
                                            const storageData = localStorage.getItem('AntiDebug_Breaker') || '{}';
                                            const parsed = JSON.parse(storageData);
                                            parsed[hostname] = scripts;
                                            localStorage.setItem('AntiDebug_Breaker', JSON.stringify(parsed));
                                        } catch (e) {
                                            console.warn('[AntiDebug] Failed to update localStorage', e);
                                        }
                                    },
                                    args: [key, newValue]
                                });
                            }
                        } catch (e) {
                            // 忽略URL解析错误
                        }
                    }
                });
            });
        }
    }
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 处理脚本注册更新请求
    if (message.type === 'update_scripts_registration') {
        registerScripts(message.hostname, message.enabledScripts);
        sendResponse({success: true});
        return true;
    }
    
    // 处理 Vue Router 数据
    if (message.type === 'VUE_ROUTER_DATA' && sender.tab) {
        try {
            const hostname = new URL(sender.tab.url).hostname;
            const storageKey = `${hostname}_vue_data`;
            
            // 存储 Vue Router 数据
            chrome.storage.local.set({
                [storageKey]: {
                    ...message.data,
                    timestamp: Date.now()
                }
            });
            
            // 转发给所有打开的popup（如果有的话）
            chrome.runtime.sendMessage({
                type: 'VUE_ROUTER_DATA_UPDATE',
                hostname: hostname,
                data: message.data
            }).catch(() => {
                // popup未打开，忽略错误
            });
        } catch (e) {
            console.error('[AntiDebug] Failed to store Vue Router data:', e);
        }
        
        sendResponse({success: true});
        return true;
    }
    
    return true;
});

// 监听标签切换事件
chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (tab.url) {
            updateBadgeForTab(tab);
        }
    });
});

// 监听标签URL变化 - 关键修改：只在页面加载完成后更新徽章
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 只在页面加载完成后更新徽章
    if (changeInfo.status === 'complete') {
        updateBadgeForTab(tab);
    }
    
    // 当页面开始加载时，清除旧的 Vue Router 数据
    if (changeInfo.status === 'loading' && tab.url) {
        try {
            const hostname = new URL(tab.url).hostname;
            const storageKey = `${hostname}_vue_data`;
            chrome.storage.local.remove(storageKey);
        } catch (e) {
            // 忽略错误
        }
    }
});

// 处理消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'tab_updated') {
        updateBadgeForTab(message.tab);
    }
});

// 更新标签页徽章
function updateBadgeForTab(tab) {
    if (!tab.url) return;

    try {
        const hostname = new URL(tab.url).hostname;

        // 获取存储中的启用状态
        chrome.storage.local.get([hostname], (result) => {
            const enabledScripts = result[hostname] || [];

            // 过滤掉无效的脚本ID
            const validCount = enabledScripts.filter(
                id => typeof id === 'string' && id.trim() !== ''
            ).length;

            // 更新徽章
            updateBadge(tab.id, validCount);
        });
    } catch (error) {
        console.error('Error updating badge for tab:', tab, error);
    }
}

// 更新特定域名的徽章
function updateBadgeForHostname(hostname, count) {
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            if (tab.url) {
                try {
                    const tabHostname = new URL(tab.url).hostname;
                    if (tabHostname === hostname) {
                        updateBadge(tab.id, count);
                    }
                } catch (e) {
                    // 忽略URL解析错误
                }
            }
        });
    });
}

// 设置徽章文本
function updateBadge(tabId, count) {
    if (count > 0) {
        chrome.action.setBadgeText({text: count.toString(), tabId});
        chrome.action.setBadgeBackgroundColor({color: '#4688F1', tabId});
    } else {
        chrome.action.setBadgeText({text: '', tabId});
    }
}