// ====== 脚本注册管理 ====== //
const scriptRegistry = new Map(); // 存储: [hostname|scriptId] => 注册ID
let isInitialized = false;

// 🆕 全局模式存储键名
const GLOBAL_MODE_KEY = 'antidebug_mode';
const GLOBAL_SCRIPTS_KEY = 'global_scripts';

// 生成全局唯一ID
function generateUniqueId() {
    return `ad_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// 🔧 新增：清理指定模式的所有脚本注册
async function clearModeScripts(isGlobalMode) {
    const keysToRemove = [];
    const keyPrefix = isGlobalMode ? 'global' : '';
    
    for (const [key, regId] of scriptRegistry) {
        if (isGlobalMode) {
            // 清理全局模式：移除所有以"global|"开头的键
            if (key.startsWith('global|')) {
                keysToRemove.push(key);
            }
        } else {
            // 清理标准模式：移除所有不以"global|"开头的键（即域名键）
            if (!key.startsWith('global|') && key.includes('|')) {
                keysToRemove.push(key);
            }
        }
    }

    if (keysToRemove.length > 0) {
        const removeIds = keysToRemove.map(key => scriptRegistry.get(key));

        try {
            await chrome.scripting.unregisterContentScripts({
                ids: removeIds
            });
            console.log(`[AntiDebug] Cleared ${isGlobalMode ? 'global' : 'standard'} mode scripts:`, keysToRemove);

            // 清理注册表
            keysToRemove.forEach(key => scriptRegistry.delete(key));
        } catch (error) {
            if (!error.message.includes('Nonexistent')) {
                console.error('[AntiDebug] Failed to clear mode scripts:', error);
            }
        }
    }
}

// 🆕 注册脚本到主世界（支持全局模式）
async function registerScripts(hostname, scriptIds, isGlobalMode = false) {
    // 🆕 全局模式允许特殊的hostname值
    if (!isGlobalMode) {
        // 标准模式：检查hostname是否有效
        if (!hostname || typeof hostname !== 'string' || hostname.trim() === '' || !hostname.includes('.')) {
            // console.warn('[AntiDebug] Skip script registration: Invalid hostname');
            return;
        }
    }

    // 过滤有效脚本ID
    const validScriptIds = scriptIds.filter(
        id => typeof id === 'string' && id.trim() !== ''
    );

    // 🆕 创建当前应存在的键集合（支持全局模式）
    const currentKeys = new Set();
    const keyPrefix = isGlobalMode ? 'global' : hostname;
    validScriptIds.forEach(id => {
        currentKeys.add(`${keyPrefix}|${id}`);
    });

    // === 1. 注销不再需要的脚本 ===
    const keysToRemove = [];
    for (const [key, regId] of scriptRegistry) {
        if (key.startsWith(`${keyPrefix}|`) && !currentKeys.has(key)) {
            keysToRemove.push(key);
        }
    }

    if (keysToRemove.length > 0) {
        const removeIds = keysToRemove.map(key => scriptRegistry.get(key));

        try {
            await chrome.scripting.unregisterContentScripts({
                ids: removeIds
            });
            // console.log(`[AntiDebug] Unregistered scripts for ${keyPrefix}:`, keysToRemove);

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
        const key = `${keyPrefix}|${id}`;

        // 如果尚未注册，则创建新注册项
        if (!scriptRegistry.has(key)) {
            const regId = generateUniqueId();
            scriptRegistry.set(key, regId);

            // 🆕 根据模式设置matches
            const matches = isGlobalMode ? ['<all_urls>'] : [`*://${hostname}/*`];

            scriptsToRegister.push({
                id: regId,
                js: [`scripts/${id}.js`],
                matches: matches,
                runAt: 'document_start',
                world: 'MAIN'
            });
        }
    });

    if (scriptsToRegister.length > 0) {
        try {
            await chrome.scripting.registerContentScripts(scriptsToRegister);
            // console.log(`[AntiDebug] Registered new scripts for ${keyPrefix}:`,
            //     scriptsToRegister.map(s => s.id));
        } catch (error) {
            console.error(`[AntiDebug] Failed to register scripts for ${keyPrefix}:`, error);
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
        // 🆕 检查全局模式并初始化全局脚本
        const mode = data[GLOBAL_MODE_KEY] || 'standard';
        const globalScripts = data[GLOBAL_SCRIPTS_KEY] || [];
        
        if (mode === 'global' && globalScripts.length > 0) {
            // 全局模式：注册全局脚本
            registerScripts('*', globalScripts, true);
        }
        
        // 初始化存储结构
        Object.keys(data).forEach(hostname => {
            if (Array.isArray(data[hostname]) && hostname.includes('.')) {
                // 确保计数基于有效的脚本ID
                const validCount = data[hostname].filter(
                    id => typeof id === 'string' && id.trim() !== ''
                ).length;

                updateBadgeForHostname(hostname, validCount);

                // 🆕 只在标准模式下初始化脚本注册
                if (mode === 'standard') {
                    registerScripts(hostname, data[hostname], false);
                }
            }
        });
    });
});

// 监听存储变化并同步
chrome.storage.onChanged.addListener(async (changes, namespace) => {
    for (let [key, {newValue}] of Object.entries(changes)) {
        if (namespace === 'local') {
            // 🆕 处理全局模式变化
            if (key === GLOBAL_MODE_KEY) {
                // 模式切换时重新初始化所有脚本
                // 这里可以根据需要添加更多逻辑
                continue;
            }
            
            // 🆕 处理全局脚本变化
            if (key === GLOBAL_SCRIPTS_KEY && Array.isArray(newValue)) {
                // 更新全局脚本注册
                await registerScripts('*', newValue, true);
                continue;
            }
            
            if (Array.isArray(newValue) && key.includes('.')) {
                // 更新标准模式脚本注册
                await registerScripts(key, newValue, false);

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
    }
});

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 🔧 新增：处理清理旧模式脚本的请求
    if (message.type === 'clear_mode_scripts') {
        clearModeScripts(message.clearGlobalMode);
        sendResponse({success: true});
        return true;
    }
    
    // 🆕 处理脚本注册更新请求（支持全局模式）
    if (message.type === 'update_scripts_registration') {
        const isGlobalMode = message.isGlobalMode || false;
        const hostname = message.hostname;
        const enabledScripts = message.enabledScripts;
        
        registerScripts(hostname, enabledScripts, isGlobalMode);
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

    // 处理 React Router 数据
    if (message.type === 'REACT_ROUTER_DATA' && sender.tab) {
        try {
            const hostname = new URL(sender.tab.url).hostname;
            const storageKey = `${hostname}_react_data`;

            // 存储 React Router 数据
            chrome.storage.local.set({
                [storageKey]: {
                    ...message.data,
                    timestamp: Date.now()
                }
            });

            // 转发给已打开的 popup
            chrome.runtime.sendMessage({
                type: 'REACT_ROUTER_DATA_UPDATE',
                hostname: hostname,
                data: message.data
            }).catch(() => {});
        } catch (e) {
            console.error('[AntiDebug] Failed to store React Router data:', e);
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
    
    // 当页面开始加载时，清除旧的路由数据
    if (changeInfo.status === 'loading' && tab.url) {
        try {
            const hostname = new URL(tab.url).hostname;
            chrome.storage.local.remove([
                `${hostname}_vue_data`,
                `${hostname}_react_data`
            ]);
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

// 🆕 更新标签页徽章（支持全局模式）
function updateBadgeForTab(tab) {
    if (!tab.url) return;

    try {
        // 🆕 获取全局模式状态
        chrome.storage.local.get([GLOBAL_MODE_KEY, GLOBAL_SCRIPTS_KEY], (result) => {
            const mode = result[GLOBAL_MODE_KEY] || 'standard';
            
            if (mode === 'global') {
                // 全局模式：显示全局脚本数量
                const globalScripts = result[GLOBAL_SCRIPTS_KEY] || [];
                const validCount = globalScripts.filter(
                    id => typeof id === 'string' && id.trim() !== ''
                ).length;
                updateBadge(tab.id, validCount);
            } else {
                // 标准模式：显示当前域名脚本数量
                const hostname = new URL(tab.url).hostname;
                chrome.storage.local.get([hostname], (domainResult) => {
                    const enabledScripts = domainResult[hostname] || [];
                    const validCount = enabledScripts.filter(
                        id => typeof id === 'string' && id.trim() !== ''
                    ).length;
                    updateBadge(tab.id, validCount);
                });
            }
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
