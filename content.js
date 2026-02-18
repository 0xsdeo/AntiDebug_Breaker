// 在document_start阶段执行
(() => {
    // 🆕 Hook板块：在脚本注入前设置localStorage（必须在最顶部）
    try {
        const hostname = window.location.hostname;
        chrome.storage.local.get([hostname, 'antidebug_mode', 'global_scripts'], (result) => {
            // 判断是全局模式还是标准模式
            const mode = result['antidebug_mode'] || 'standard';
            let enabledScripts = [];
            
            if (mode === 'global') {
                enabledScripts = result['global_scripts'] || [];
            } else {
                enabledScripts = result[hostname] || [];
            }
            
            // 遍历所有启用的脚本，检查是否有Hook配置（有配置的就是Hook脚本）
            if (enabledScripts.length > 0) {
                const configKeys = enabledScripts.map(id => `${id}_config`);
                // 同时读取合并Hooks数据
                chrome.storage.local.get([...configKeys, 'antidebug_merged_hooks'], (configResult) => {
                    const hookScriptsReady = [];
                    
                    enabledScripts.forEach(scriptId => {
                        const config = configResult[`${scriptId}_config`];
                        // 只同步有配置的脚本（Hook脚本才会有配置）
                        if (config) {
                            const baseKey = `Antidebug_breaker_${scriptId}`;
                            
                            try {
                                // 固定变量脚本
                                if (config.value !== undefined) {
                                    localStorage.setItem(`${baseKey}_value`, config.value);
                                }
                                
                                // 非固定变量脚本
                                if (config.flag !== undefined) {
                                    localStorage.setItem(`${baseKey}_flag`, config.flag.toString());
                                }
                                if (config.param !== undefined) {
                                    localStorage.setItem(`${baseKey}_param`, JSON.stringify(config.param));
                                }
                                
                                // 动态开关（debugger, stack等）
                                Object.keys(config).forEach(key => {
                                    // 🔧 修改：排除 keyword_filter_enabled，它只是插件UI的控制开关，不需要同步到页面
                                    if (!['value', 'flag', 'param', 'keyword_filter_enabled'].includes(key)) {
                                        localStorage.setItem(`${baseKey}_${key}`, (config[key] || 0).toString());
                                    }
                                });
                                
                                // 记录已就绪的Hook脚本
                                hookScriptsReady.push(scriptId);
                            } catch (e) {
                                console.warn(`[AntiDebug] Failed to set localStorage for ${scriptId}:`, e);
                            }
                        }
                    });
                    
                    // 同步合并Hooks数据到页面localStorage
                    const mergedHooks = configResult['antidebug_merged_hooks'];
                    try {
                        if (mergedHooks &&
                            ((mergedHooks.Function && mergedHooks.Function.length > 0) ||
                             (mergedHooks.Property && mergedHooks.Property.length > 0))) {
                            localStorage.setItem('Antidebug_breaker_Hooks', JSON.stringify(mergedHooks));
                        } else {
                            localStorage.removeItem('Antidebug_breaker_Hooks');
                        }
                    } catch (e) {
                        console.warn('[AntiDebug] Failed to sync Antidebug_breaker_Hooks:', e);
                    }
                    
                    // 如果AntiAnti_Hook已启用，将其加入hookScriptsReady以触发初始化
                    if (enabledScripts.includes('AntiAnti_Hook')) {
                        hookScriptsReady.push('AntiAnti_Hook');
                    }
                    
                    // 🔧 方案二：配置设置完成后，通知所有Hook脚本配置已就绪
                    if (hookScriptsReady.length > 0) {
                        // 发送通知到页面主世界，告知Hook脚本配置已就绪
                        window.postMessage({
                            type: 'HOOK_CONFIG_READY',
                            source: 'antidebug-extension',
                            scriptIds: hookScriptsReady
                        }, '*');
                    }
                });
            }
        });
    } catch (e) {
        console.warn('[AntiDebug] Failed to sync Hook config to localStorage', e);
    }
    
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
