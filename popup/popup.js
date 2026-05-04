document.addEventListener('DOMContentLoaded', () => {
    // ========== Toast提示功能（仅用于固定值保存） ==========
    function showToast(message = '已保存') {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        const toastMessage = toast.querySelector('.toast-message');
        if (toastMessage) {
            toastMessage.textContent = message;
        }
        
        toast.classList.add('show');
        
        // 2秒后自动隐藏
        setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    }
    // ========================================================
    
    // 🆕 自动触发Vue重扫描
    function triggerVueRescan() {
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'TRIGGER_VUE_RESCAN',
                        source: 'antidebug-extension'
                    }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                }
            });
        } catch (error) {
            console.warn('触发Vue重扫描失败:', error);
        }
    }

    // 自动触发React重扫描
    function triggerReactRescan() {
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        type: 'TRIGGER_REACT_RESCAN',
                        source: 'antidebug-extension'
                    }, () => {
                        if (chrome.runtime.lastError) {}
                    });
                }
            });
        } catch (error) {
            console.warn('触发React重扫描失败:', error);
        }
    }

    // popup打开时自动触发重扫描
    triggerVueRescan();
    triggerReactRescan();

    // ========== Base模式偏好设置（全局持久化） ==========
    function getBaseModePreference() {
        try {
            return localStorage.getItem('antidebug_base_mode') || 'with-base';
        } catch (e) {
            return 'with-base';
        }
    }

    function setBaseModePreference(mode) {
        try {
            localStorage.setItem('antidebug_base_mode', mode);
        } catch (e) {
            console.warn('保存base模式偏好失败:', e);
        }
    }
    // ========================================================

    const scriptsGrid = document.querySelector('.scripts-grid');
    const hookContent = document.querySelector('.hook-content');
    const vueContent = document.querySelector('.vue-content');
    const vueScriptsList = document.querySelector('.vue-scripts-list');
    const vueRouterData = document.querySelector('.vue-router-data');
    const vueVersionDisplay = document.querySelector('.vue-version-display');
    const versionValue = document.querySelector('.version-value');
    const routesListContainer = document.querySelector('.routes-list-container');
    const noResults = document.querySelector('.no-results');
    const searchContainer = document.querySelector('.search-container');
    const searchInput = document.getElementById('search-input');
    const hookNoticeContainer = document.querySelector('.hook-notice-container');
    const hookFilterEnabledBtn = document.getElementById('hook-filter-enabled');
    const hookFilterDisabledBtn = document.getElementById('hook-filter-disabled');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const vueRouteSearchContainer = document.querySelector('.vue-route-search-container');
    const vueRouteSearchInput = document.getElementById('vue-route-search-input');
    const routesActionsFooter = document.querySelector('.routes-actions-footer');
    const copyAllPathsBtn = document.querySelector('.copy-all-paths-btn');
    const copyAllUrlsBtn = document.querySelector('.copy-all-urls-btn');

    // Vue/React 子Tab相关DOM元素
    const vueSubContent = document.querySelector('.vue-sub-content');
    const reactSubContent = document.querySelector('.react-sub-content');
    const reactScriptsList = document.querySelector('.react-scripts-list');
    const vueSubtabBtns = document.querySelectorAll('.vue-subtab-btn');

    // 🆕 全局模式相关DOM元素
    const globalModeToggle = document.getElementById('global-mode-toggle');
    const modeText = document.querySelector('.mode-text');

    // 反反Hook检测开关DOM元素
    const antiAntiHookToggle = document.getElementById('antiantiHook-toggle');

    // 辅助配置按钮 & 面板
    const auxConfigBtn = document.getElementById('aux-config-btn');
    const auxConfigPanel = document.getElementById('aux-config-panel');

    // 点击按钮切换面板显示
    if (auxConfigBtn && auxConfigPanel) {
        auxConfigBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = auxConfigPanel.classList.contains('open');
            if (isOpen) {
                auxConfigPanel.classList.remove('open');
                auxConfigBtn.classList.remove('active');
            } else {
                auxConfigPanel.classList.add('open');
                auxConfigBtn.classList.add('active');
            }
        });

        // 点击面板内部不关闭
        auxConfigPanel.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // 点击外部关闭面板
        document.addEventListener('click', () => {
            auxConfigPanel.classList.remove('open');
            auxConfigBtn.classList.remove('active');
        });
    }

    let currentTab = 'antidebug'; // 当前选中的标签
    let allScripts = []; // 所有脚本数据
    let enabledScripts = []; // 启用的脚本
    let hostname = '';
    let currentTab_obj = null;
    let cachedVueDataList = []; // 在popup中缓存所有Vue实例数据（改为数组）
    let currentInstanceIndex = 0; // 当前选中的实例索引
    let isFirstVueDataDisplay = true; // 🆕 标记是否是首次显示Vue路由数据
    let currentVueSubTab = 'vue'; // Vue/React子板块当前激活的子Tab
    let cachedReactData = null; // 缓存 React 路由数据

    // 🆕 全局模式状态管理
    let isGlobalMode = false; // 当前是否为全局模式
    let globalEnabledScripts = []; // 全局模式下启用的脚本

    // 🆕 Hook板块筛选状态（'enabled' | 'disabled' | null）
    let hookFilterState = null;

    // 🆕 全局模式存储键名
    const GLOBAL_MODE_KEY = 'antidebug_mode';
    const GLOBAL_SCRIPTS_KEY = 'global_scripts';
    const LAST_VUE_SUBTAB_KEY = 'last_active_vue_subtab';

    // 🆕 脚本组合转换函数：将合并脚本展开为独立脚本（移到前面以便其他函数使用）
    const expandCombinedScripts = (scriptIds) => {
        const expanded = [...scriptIds];
        
        // 检测 Hook_JSEncrypt_SMcrypto 并展开为两个独立脚本
        const combinedIndex = expanded.indexOf('Hook_JSEncrypt_SMcrypto');
        if (combinedIndex !== -1) {
            // 移除合并脚本
            expanded.splice(combinedIndex, 1);
            // 添加两个独立脚本（如果不存在）
            if (!expanded.includes('Hook_SMcrypto')) {
                expanded.push('Hook_SMcrypto');
            }
            if (!expanded.includes('Hook_JSEncrypt')) {
                expanded.push('Hook_JSEncrypt');
            }
        }
        
        return expanded;
    };

    // 🆕 初始化全局模式状态
    function initializeGlobalMode() {
        chrome.storage.local.get([GLOBAL_MODE_KEY, GLOBAL_SCRIPTS_KEY], (result) => {
            // 获取模式状态，默认为标准模式
            const mode = result[GLOBAL_MODE_KEY] || 'standard';
            isGlobalMode = (mode === 'global');
            
            // 🆕 获取全局脚本列表并展开合并脚本
            globalEnabledScripts = result[GLOBAL_SCRIPTS_KEY] || [];
            
            // 如果没有模式键值，创建默认配置
            if (!result[GLOBAL_MODE_KEY]) {
                chrome.storage.local.set({
                    [GLOBAL_MODE_KEY]: 'standard',
                    [GLOBAL_SCRIPTS_KEY]: []
                });
            }
            
            // 更新UI状态
            updateModeUI();
            
            // 如果是全局模式，使用全局脚本列表（不展开，因为这是用于存储的）
            if (isGlobalMode) {
                // 注意：这里不展开，因为 globalEnabledScripts 用于存储
                // UI 显示时会在 setTimeout 中展开
            }
        });
    }

    // 🆕 更新模式UI显示
    function updateModeUI() {
        globalModeToggle.checked = isGlobalMode;
        modeText.textContent = isGlobalMode ? '全局模式' : '标准模式';
    }

    // 更新反反Hook检测开关UI状态
    function updateAntiAntiHookToggle() {
        if (!antiAntiHookToggle) return;
        const isEnabled = enabledScripts.includes('AntiAnti_Hook');
        antiAntiHookToggle.checked = isEnabled;
    }

    // 计算所有已启用脚本的合并Hooks数据并存储
    function updateMergedHooks(currentEnabledScripts) {
        if (!allScripts || allScripts.length === 0) return;

        if (!currentEnabledScripts.includes('AntiAnti_Hook')) {
            chrome.storage.local.remove('antidebug_merged_hooks');
            return;
        }

        const merged = { Function: [], Property: [] };
        let hasHooks = false;

        currentEnabledScripts.forEach(scriptId => {
            const script = allScripts.find(s => s.id === scriptId);
            if (script && script.Hooks) {
                hasHooks = true;
                if (script.Hooks.Function) {
                    script.Hooks.Function.forEach(fn => {
                        if (!merged.Function.includes(fn)) {
                            merged.Function.push(fn);
                        }
                    });
                }
                if (script.Hooks.Property) {
                    script.Hooks.Property.forEach(prop => {
                        if (!merged.Property.includes(prop)) {
                            merged.Property.push(prop);
                        }
                    });
                }
            }
        });

        if (hasHooks) {
            chrome.storage.local.set({ antidebug_merged_hooks: merged });
        } else {
            chrome.storage.local.remove('antidebug_merged_hooks');
        }
    }

    // 🆕 模式切换处理（修复bug：添加旧模式脚本清理）
    function handleModeToggle(newGlobalMode) {
        const oldGlobalMode = isGlobalMode;
        isGlobalMode = newGlobalMode;
        
        // 保存模式状态
        const mode = isGlobalMode ? 'global' : 'standard';
        chrome.storage.local.set({ [GLOBAL_MODE_KEY]: mode });
        
        // 🔧 关键修复：先清理旧模式的脚本注册
        if (oldGlobalMode !== newGlobalMode) {
            clearOldModeScripts(oldGlobalMode);
        }
        
        if (isGlobalMode) {
            // 切换到全局模式（展开合并脚本）
            enabledScripts = expandCombinedScripts([...globalEnabledScripts]);
        } else {
            // 切换到标准模式
            // 检查当前URL是否为web网站
            if (currentTab_obj && currentTab_obj.url && 
                (currentTab_obj.url.startsWith('http://') || currentTab_obj.url.startsWith('https://'))) {
                
                // 读取当前域名的脚本配置
                chrome.storage.local.get([hostname], (result) => {
                    if (result[hostname]) {
                        // 存在配置，使用该配置（展开合并脚本）
                        enabledScripts = expandCombinedScripts(result[hostname] || []);
                    } else {
                        // 不存在配置，创建空配置
                        enabledScripts = [];
                        chrome.storage.local.set({ [hostname]: [] });
                    }
                    
                    // 更新UI显示和脚本注册
                    updateModeUI();
                    renderCurrentTab();
                    updateScriptRegistration();
                });
                return;
            } else {
                // 不是web网站，清空脚本
                enabledScripts = [];
            }
        }
        
        // 更新UI显示和脚本注册
        updateModeUI();
        renderCurrentTab();
        updateScriptRegistration();
    }

    // 🔧 新增：清理旧模式脚本的函数
    function clearOldModeScripts(wasGlobalMode) {
        chrome.runtime.sendMessage({
            type: 'clear_mode_scripts',
            clearGlobalMode: wasGlobalMode
        });
    }

    // 🆕 检查是否为有效的web网站
    function isValidWebsite(url) {
        return url && (url.startsWith('http://') || url.startsWith('https://'));
    }

    // 🆕 更新脚本注册（通知background）
    function updateScriptRegistration() {
        // 发送前先合并脚本组合，确保注册的是合并版而非独立版
        const scriptsToRegister = combineCombinableScripts(enabledScripts);
        chrome.runtime.sendMessage({
            type: 'update_scripts_registration',
            hostname: isGlobalMode ? '*' : hostname,
            enabledScripts: scriptsToRegister,
            isGlobalMode: isGlobalMode
        });
    }

    // 监听来自 background 的路由数据更新
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // React 路由数据更新
        if (message.type === 'REACT_ROUTER_DATA_UPDATE' && message.hostname === hostname) {
            cachedReactData = message.data;
            // 只有当前在 React 子 Tab 时才刷新显示
            if (currentTab === 'vue' && currentVueSubTab === 'react') {
                displayReactRouterData(cachedReactData);
            }
        }

        if (message.type === 'VUE_ROUTER_DATA_UPDATE' && message.hostname === hostname) {
            const data = message.data;
            
            // 处理多实例数据
            if (data.type === 'MULTIPLE_INSTANCES' && data.instances) {
                cachedVueDataList = data.instances;
                currentInstanceIndex = 0; // 默认选中第一个
                
                // 保存到 storage
                const storageKey = `${hostname}_vue_data`;
                chrome.storage.local.set({
                    [storageKey]: {
                        type: 'MULTIPLE_INSTANCES',
                        instances: data.instances,
                        totalCount: data.totalCount,
                        timestamp: Date.now()
                    }
                });
                
                // 显示多实例
                displayMultipleInstances();
            }
            // 兼容单实例或未找到的情况
            else {
                cachedVueDataList = [data];
                currentInstanceIndex = 0;
                
                // 保存到 storage
                const storageKey = `${hostname}_vue_data`;
                chrome.storage.local.set({
                    [storageKey]: data
                });
                
                // 显示单实例
                displayMultipleInstances();
            }
        }
    });

    // 请求页面的Vue Router数据
    function requestVueRouterData() {
        if (currentTab_obj && currentTab_obj.id) {
            chrome.tabs.sendMessage(currentTab_obj.id, {
                type: 'REQUEST_VUE_ROUTER_DATA'
            }).catch(err => {
                console.warn('请求Vue数据失败:', err);
            });
        }
    }

    // 请求页面的React Router数据
    function requestReactRouterData() {
        if (currentTab_obj && currentTab_obj.id) {
            chrome.tabs.sendMessage(currentTab_obj.id, {
                type: 'REQUEST_REACT_ROUTER_DATA'
            }).catch(err => {
                console.warn('请求React数据失败:', err);
            });
        }
    }

    // 获取当前标签页的域名
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url) return;

        hostname = new URL(tab.url).hostname;
        currentTab_obj = tab;

        // 🆕 初始化全局模式
        initializeGlobalMode();

        // 加载脚本元数据
        fetch(chrome.runtime.getURL('scripts.json'))
            .then(response => response.json())
            .then(scripts => {
                allScripts = scripts;

                // 🆕 根据模式获取启用状态
                const getInitialScripts = () => {
                    if (isGlobalMode) {
                        return globalEnabledScripts;
                    } else {
                        // 标准模式：获取该域名下的启用状态
                        chrome.storage.local.get([hostname, 'last_active_tab', LAST_VUE_SUBTAB_KEY], (result) => {
                            // 🆕 展开合并脚本
                            enabledScripts = expandCombinedScripts(result[hostname] || []);
                            // 初始化合并Hooks数据
                            updateMergedHooks(enabledScripts);

                            // 恢复上次打开的板块
                            if (result.last_active_tab) {
                                currentTab = result.last_active_tab;
                                // 更新UI中的按钮状态
                                tabBtns.forEach(b => {
                                    if (b.dataset.tab === currentTab) {
                                        b.classList.add('active');
                                    } else {
                                        b.classList.remove('active');
                                    }
                                });
                            }

                            // 恢复Vue子Tab状态
                            if (result[LAST_VUE_SUBTAB_KEY]) {
                                currentVueSubTab = result[LAST_VUE_SUBTAB_KEY];
                                vueSubtabBtns.forEach(b => {
                                    b.classList.toggle('active', b.dataset.subtab === currentVueSubTab);
                                });
                            }

                            renderCurrentTab();

                            // 检查是否启用了 Get_Vue_0 或 Get_Vue_1 脚本
                            const hasVueScript = enabledScripts.includes('Get_Vue_0') ||
                                enabledScripts.includes('Get_Vue_1');

                            // 如果启用了Vue脚本，立即请求数据
                            if (hasVueScript) {
                                requestVueRouterData();
                            }

                            // 如果启用了 Get_React_0，先从 storage 读取缓存，再请求实时数据
                            if (enabledScripts.includes('Get_React_0')) {
                                const reactStorageKey = `${hostname}_react_data`;
                                chrome.storage.local.get([reactStorageKey], (storageResult) => {
                                    if (storageResult[reactStorageKey]) {
                                        cachedReactData = storageResult[reactStorageKey];
                                        if (currentTab === 'vue' && currentVueSubTab === 'react') {
                                            displayReactRouterData(cachedReactData);
                                        }
                                    }
                                    requestReactRouterData();
                                });
                            }
                        });
                        return [];
                    }
                };

                // 延迟获取脚本，确保模式状态已初始化
                setTimeout(() => {
                    if (isGlobalMode) {
                        // 🔧 修复：全局模式下也需要恢复上次打开的板块
                            chrome.storage.local.get(['last_active_tab', LAST_VUE_SUBTAB_KEY], (result) => {
                                // 恢复上次打开的板块
                                if (result.last_active_tab) {
                                    currentTab = result.last_active_tab;
                                    // 更新UI中的按钮状态
                                    tabBtns.forEach(b => {
                                        if (b.dataset.tab === currentTab) {
                                            b.classList.add('active');
                                        } else {
                                            b.classList.remove('active');
                                        }
                                    });
                                }

                                // 恢复Vue子Tab状态
                                if (result[LAST_VUE_SUBTAB_KEY]) {
                                    currentVueSubTab = result[LAST_VUE_SUBTAB_KEY];
                                    vueSubtabBtns.forEach(b => {
                                        b.classList.toggle('active', b.dataset.subtab === currentVueSubTab);
                                    });
                                }
                            
                            // 🆕 展开合并脚本
                            enabledScripts = expandCombinedScripts([...globalEnabledScripts]);
                            // 初始化合并Hooks数据
                            updateMergedHooks(enabledScripts);
                            renderCurrentTab();
                            
                            // 检查Vue脚本
                            const hasVueScript = enabledScripts.includes('Get_Vue_0') ||
                                enabledScripts.includes('Get_Vue_1');
                            if (hasVueScript) {
                                requestVueRouterData();
                            }

                            // 检查React脚本，先从 storage 读取缓存，再请求实时数据
                            if (enabledScripts.includes('Get_React_0')) {
                                const reactStorageKey = `${hostname}_react_data`;
                                chrome.storage.local.get([reactStorageKey], (storageResult) => {
                                    if (storageResult[reactStorageKey]) {
                                        cachedReactData = storageResult[reactStorageKey];
                                        if (currentTab === 'vue' && currentVueSubTab === 'react') {
                                            displayReactRouterData(cachedReactData);
                                        }
                                    }
                                    requestReactRouterData();
                                });
                            }
                        });
                    } else {
                        getInitialScripts();
                    }
                }, 100);

                // 搜索功能
                searchInput.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    
                    if (currentTab === 'antidebug') {
                    const filteredScripts = getScriptsForCurrentTab().filter(script =>
                        script.name.toLowerCase().includes(searchTerm) ||
                        script.description.toLowerCase().includes(searchTerm)
                    );
                        renderAntiDebugScripts(filteredScripts);
                    } else if (currentTab === 'hook') {
                        // Hook板块：只检索脚本名
                        let filteredScripts = getScriptsForCurrentTab().filter(script =>
                            script.name.toLowerCase().includes(searchTerm)
                        );
                        // 🆕 应用筛选（已开启/未开启）
                        filteredScripts = applyHookFilter(filteredScripts);
                        renderHookScripts(filteredScripts);
                    }
                });
            });
    });

    // 🆕 全局模式开关事件监听
    globalModeToggle.addEventListener('change', (e) => {
        handleModeToggle(e.target.checked);
    });

    // 反反Hook检测开关事件监听
    if (antiAntiHookToggle) {
        antiAntiHookToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (!enabledScripts.includes('AntiAnti_Hook')) {
                    enabledScripts.push('AntiAnti_Hook');
                }
            } else {
                enabledScripts = enabledScripts.filter(id => id !== 'AntiAnti_Hook');
            }
            updateStorage(enabledScripts);
        });
    }

    // 标签切换事件
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // 更新按钮状态
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 更新当前标签
            currentTab = btn.dataset.tab;

            // 清空搜索
            searchInput.value = '';

            // 渲染对应内容
            renderCurrentTab();

            // 保存当前板块到storage
            chrome.storage.local.set({
                'last_active_tab': currentTab
            });
        });
    });

    // Vue/React 子Tab切换事件
    vueSubtabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            vueSubtabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentVueSubTab = btn.dataset.subtab;
            chrome.storage.local.set({ [LAST_VUE_SUBTAB_KEY]: currentVueSubTab });
            renderVueSubTab();
        });
    });

    // 🆕 Hook板块筛选按钮点击事件
    if (hookFilterEnabledBtn && hookFilterDisabledBtn) {
        hookFilterEnabledBtn.addEventListener('click', () => {
            if (hookFilterState === 'enabled') {
                // 如果已选中，则取消筛选
                saveHookFilterState(null);
                hookFilterEnabledBtn.classList.remove('active');
            } else {
                // 选中"已开启"
                saveHookFilterState('enabled');
                hookFilterEnabledBtn.classList.add('active');
                hookFilterDisabledBtn.classList.remove('active');
            }
            // 重新渲染Hook脚本
            if (currentTab === 'hook') {
                const scriptsToShow = getScriptsForCurrentTab();
                renderHookScripts(scriptsToShow);
            }
        });

        hookFilterDisabledBtn.addEventListener('click', () => {
            if (hookFilterState === 'disabled') {
                // 如果已选中，则取消筛选
                saveHookFilterState(null);
                hookFilterDisabledBtn.classList.remove('active');
            } else {
                // 选中"未开启"
                saveHookFilterState('disabled');
                hookFilterDisabledBtn.classList.add('active');
                hookFilterEnabledBtn.classList.remove('active');
            }
            // 重新渲染Hook脚本
            if (currentTab === 'hook') {
                const scriptsToShow = getScriptsForCurrentTab();
                renderHookScripts(scriptsToShow);
            }
        });
    }

    // 根据当前标签获取要显示的脚本
    function getScriptsForCurrentTab() {
        let category = currentTab;
        if (currentTab === 'vue') {
            category = currentVueSubTab; // 'vue' 或 'react'
        }
        return allScripts.filter(script => 
            script.category === category && 
            !script.hidden  // 🆕 过滤隐藏脚本
        );
    }

    // 渲染当前标签的内容
    function renderCurrentTab() {
        const scriptsToShow = getScriptsForCurrentTab();

        if (currentTab === 'antidebug') {
            // 显示反调试板块
            searchContainer.style.display = 'flex';
            searchContainer.classList.remove('hook-search-container');
            if (hookNoticeContainer) hookNoticeContainer.style.display = 'none';
            scriptsGrid.style.display = 'grid';
            hookContent.style.display = 'none';
            vueContent.style.display = 'none';
            renderAntiDebugScripts(scriptsToShow);
        } else if (currentTab === 'hook') {
            // 显示Hook板块
            searchContainer.style.display = 'flex';
            searchContainer.classList.add('hook-search-container');
            if (hookNoticeContainer) hookNoticeContainer.style.display = 'flex';
            scriptsGrid.style.display = 'none';
            hookContent.style.display = 'flex';
            vueContent.style.display = 'none';
            // 🆕 读取筛选状态并更新按钮
            loadHookFilterState().then(() => {
                updateHookFilterButtons();
                renderHookScripts(scriptsToShow);
            });
        } else if (currentTab === 'vue') {
            // 显示Vue/React板块
            searchContainer.style.display = 'none';
            searchContainer.classList.remove('hook-search-container');
            if (hookNoticeContainer) hookNoticeContainer.style.display = 'none';
            scriptsGrid.style.display = 'none';
            hookContent.style.display = 'none';
            vueContent.style.display = 'flex';
            // 同步子Tab按钮状态
            vueSubtabBtns.forEach(b => {
                b.classList.toggle('active', b.dataset.subtab === currentVueSubTab);
            });
            renderVueSubTab();
        }

        // 每次渲染后同步反反Hook开关状态
        updateAntiAntiHookToggle();
    }

    // 渲染Vue/React子板块内容
    function renderVueSubTab() {
        if (currentVueSubTab === 'vue') {
            if (vueSubContent) vueSubContent.style.display = 'flex';
            if (reactSubContent) reactSubContent.style.display = 'none';
            const scripts = allScripts.filter(s => s.category === 'vue' && !s.hidden);
            renderVueScripts(scripts);
            displayMultipleInstances();
        } else if (currentVueSubTab === 'react') {
            if (vueSubContent) vueSubContent.style.display = 'none';
            if (reactSubContent) reactSubContent.style.display = 'flex';
            const scripts = allScripts.filter(s => s.category === 'react' && !s.hidden);
            renderReactScripts(scripts);

            const hasReactScript = enabledScripts.includes('Get_React_0');

            // 优先用内存缓存，无缓存则从 storage 读取（background 已存储时可直接展示）
            if (cachedReactData) {
                displayReactRouterData(cachedReactData);
                if (hasReactScript) requestReactRouterData();
            } else {
                const reactStorageKey = `${hostname}_react_data`;
                chrome.storage.local.get([reactStorageKey], (storageResult) => {
                    if (storageResult[reactStorageKey]) {
                        cachedReactData = storageResult[reactStorageKey];
                    }
                    displayReactRouterData(cachedReactData);
                    if (hasReactScript) requestReactRouterData();
                });
            }
        }
    }

    // 渲染反调试脚本（3列网格）
    function renderAntiDebugScripts(scripts) {
        scriptsGrid.innerHTML = '';
        noResults.style.display = 'none';

        if (scripts.length === 0) {
            noResults.style.display = 'flex';
            return;
        }

        scripts.forEach(script => {
            if (typeof script.id !== 'string' || !script.id.trim()) {
                console.error('Invalid script ID:', script);
                return;
            }

            const isEnabled = enabledScripts.includes(script.id);
            const scriptItem = document.createElement('div');
            scriptItem.className = `script-item ${isEnabled ? 'active' : ''}`;

            let description = script.description;

            scriptItem.innerHTML = `
                <div class="script-content">
                    <div class="script-header">
                        <div class="script-name">${script.name}</div>
                        <label class="switch">
                            <input type="checkbox" ${isEnabled ? 'checked' : ''} data-id="${script.id}">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div class="script-description-wrapper">
                        <div class="script-description">${description}</div>
                        <button class="expand-description-btn" style="display: none;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
            `;

            scriptsGrid.appendChild(scriptItem);

            const checkbox = scriptItem.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', (e) => {
                handleScriptToggle(script.id, e.target.checked, scriptItem);
            });

            // 🆕 检查描述是否需要展开按钮
            const descriptionEl = scriptItem.querySelector('.script-description');
            const expandBtn = scriptItem.querySelector('.expand-description-btn');
            
            // 使用 setTimeout 确保 DOM 渲染完成后再检查
            setTimeout(() => {
                // 临时移除line-clamp限制来准确测量完整高度
                const originalDisplay = descriptionEl.style.display;
                const originalWebkitLineClamp = descriptionEl.style.webkitLineClamp;
                const originalOverflow = descriptionEl.style.overflow;
                
                // 临时设置为block以获取完整高度
                descriptionEl.style.display = 'block';
                descriptionEl.style.webkitLineClamp = 'unset';
                descriptionEl.style.overflow = 'visible';
                
                const fullHeight = descriptionEl.scrollHeight;
                
                // 恢复原始样式
                descriptionEl.style.display = originalDisplay || '';
                descriptionEl.style.webkitLineClamp = originalWebkitLineClamp || '';
                descriptionEl.style.overflow = originalOverflow || '';
                
                // 计算3行的高度（line-height * 3）
                const computedStyle = getComputedStyle(descriptionEl);
                const lineHeight = parseFloat(computedStyle.lineHeight) || 15.4; // 默认值：11px * 1.4
                const maxHeight = lineHeight * 3;
                
                // 如果完整高度超过3行高度，显示展开按钮
                if (fullHeight > maxHeight + 2) { // 加2px容差
                    expandBtn.style.display = 'flex';
                }
            }, 10);

            // 🆕 展开/收起按钮点击事件
            expandBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡
                const isExpanded = scriptItem.classList.contains('expanded');
                
                if (isExpanded) {
                    // 收起
                    scriptItem.classList.remove('expanded');
                    expandBtn.querySelector('svg').style.transform = 'rotate(0deg)';
                } else {
                    // 展开
                    scriptItem.classList.add('expanded');
                    expandBtn.querySelector('svg').style.transform = 'rotate(180deg)';
                }
            });
        });
    }

    // 渲染Vue脚本（横向列表，支持父子关系）
    function renderVueScripts(scripts) {
        vueScriptsList.innerHTML = '';

        // 过滤出父脚本（没有 parentScript 字段的）
        const parentScripts = scripts.filter(script => !script.parentScript);

        if (parentScripts.length === 0 && scripts.length === 0) {
            vueScriptsList.innerHTML = '<div class="empty-state">暂无 Vue 脚本</div>';
            return;
        }

        parentScripts.forEach(parentScript => {
            if (typeof parentScript.id !== 'string' || !parentScript.id.trim()) {
                console.error('Invalid script ID:', parentScript);
                return;
            }

            // 渲染父脚本
            const isParentEnabled = enabledScripts.includes(parentScript.id) ||
                scripts.some(s => s.parentScript === parentScript.id && enabledScripts.includes(s.id));
            const parentItem = createVueScriptItem(parentScript, isParentEnabled, false);
            vueScriptsList.appendChild(parentItem);

            // 查找子脚本
            const childScripts = scripts.filter(s => s.parentScript === parentScript.id);

            // 如果父脚本开启（或子脚本开启），显示子脚本
            if (isParentEnabled && childScripts.length > 0) {
                childScripts.forEach(childScript => {
                    const isChildEnabled = enabledScripts.includes(childScript.id);
                    const childItem = createVueScriptItem(childScript, isChildEnabled, true);
                    vueScriptsList.appendChild(childItem);
                });
            }
        });
    }

    // 渲染React脚本（横向列表，UI与Vue脚本相同）
    function renderReactScripts(scripts) {
        if (!reactScriptsList) return;
        reactScriptsList.innerHTML = '';

        const parentScripts = scripts.filter(script => !script.parentScript);

        if (parentScripts.length === 0 && scripts.length === 0) {
            reactScriptsList.innerHTML = '<div class="empty-state">暂无 React 脚本</div>';
            return;
        }

        parentScripts.forEach(parentScript => {
            if (typeof parentScript.id !== 'string' || !parentScript.id.trim()) return;

            const isParentEnabled = enabledScripts.includes(parentScript.id) ||
                scripts.some(s => s.parentScript === parentScript.id && enabledScripts.includes(s.id));
            const parentItem = createVueScriptItem(parentScript, isParentEnabled, false);
            reactScriptsList.appendChild(parentItem);

            const childScripts = scripts.filter(s => s.parentScript === parentScript.id);
            if (isParentEnabled && childScripts.length > 0) {
                childScripts.forEach(childScript => {
                    const isChildEnabled = enabledScripts.includes(childScript.id);
                    const childItem = createVueScriptItem(childScript, isChildEnabled, true);
                    reactScriptsList.appendChild(childItem);
                });
            }
        });
    }

    // 创建Vue脚本项
    function createVueScriptItem(script, isEnabled, isChild) {
        const scriptItem = document.createElement('div');
        scriptItem.className = `vue-script-item ${isEnabled ? 'active' : ''} ${isChild ? 'child-script' : ''}`;
        scriptItem.dataset.scriptId = script.id;

        scriptItem.innerHTML = `
            <div class="vue-script-name">${script.name}</div>
            <label class="vue-script-switch">
                <input type="checkbox" ${isEnabled ? 'checked' : ''} data-id="${script.id}">
                <span class="slider"></span>
            </label>
            <div class="vue-script-info">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
                <div class="tooltip">${script.description}</div>
            </div>
        `;

        const checkbox = scriptItem.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
            handleVueScriptToggle(script, e.target.checked);
        });

        return scriptItem;
    }

    // 🆕 读取Hook筛选状态
    function loadHookFilterState() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['hook_filter_state'], (result) => {
                hookFilterState = result.hook_filter_state || null;
                resolve(hookFilterState);
            });
        });
    }

    // 🆕 保存Hook筛选状态
    function saveHookFilterState(state) {
        hookFilterState = state;
        chrome.storage.local.set({ hook_filter_state: state });
    }

    // 🆕 更新筛选按钮状态
    function updateHookFilterButtons() {
        if (hookFilterEnabledBtn && hookFilterDisabledBtn) {
            hookFilterEnabledBtn.classList.toggle('active', hookFilterState === 'enabled');
            hookFilterDisabledBtn.classList.toggle('active', hookFilterState === 'disabled');
        }
    }

    // 🆕 应用Hook筛选
    function applyHookFilter(scripts) {
        if (!hookFilterState) {
            return scripts; // 无筛选，返回所有脚本
        }
        
        return scripts.filter(script => {
            const isEnabled = enabledScripts.includes(script.id);
            if (hookFilterState === 'enabled') {
                return isEnabled;
            } else if (hookFilterState === 'disabled') {
                return !isEnabled;
            }
            return true;
        });
    }

    // 渲染Hook脚本
    function renderHookScripts(scripts) {
        // 🔧 修复：如果当前在 Hook 板块且有搜索词，应用搜索过滤
        if (currentTab === 'hook' && searchInput && searchInput.value.trim()) {
            const searchTerm = searchInput.value.toLowerCase();
            scripts = scripts.filter(script =>
                script.name.toLowerCase().includes(searchTerm)
            );
        }
        
        // 🆕 应用筛选（已开启/未开启）
        scripts = applyHookFilter(scripts);
        
        // 🔧 修复：先批量加载所有配置，配置加载完成后再清空并渲染，避免闪烁
        if (scripts.length === 0) {
            hookContent.innerHTML = '<div class="empty-state">暂无 Hook 脚本</div>';
            return;
        }
        
        // 先批量加载所有配置（不清空容器，保持旧内容显示）
        const configPromises = scripts.map(script => {
            if (typeof script.id !== 'string' || !script.id.trim()) {
                console.error('Invalid script ID:', script);
                return null;
            }
            return loadHookConfig(script.id).then(config => ({
                script,
                config
            }));
        }).filter(p => p !== null);
        
        // 等待所有配置加载完成
        Promise.all(configPromises).then(results => {
            // 配置加载完成后，再清空容器并同步渲染所有脚本项
            hookContent.innerHTML = '';
            
            results.forEach(({ script, config }) => {
                const isEnabled = enabledScripts.includes(script.id);
                const isFixedVariate = script.fixed_variate === 1;
                const hasParam = script.has_Param === 1;
                
                // 如果脚本已启用，确保配置正确初始化
                if (isEnabled && !isFixedVariate) {
                    if (hasParam) {
                        // has_Param=1：必须创建param（即使为空数组）和flag
                        if (config.param === undefined) {
                            config.param = [];
                        }
                        // 🔧 新增：初始化关键字检索开关（默认为关闭，即 false）
                        if (config.keyword_filter_enabled === undefined) {
                            config.keyword_filter_enabled = false;
                        }
                        // 🔧 修改：如果开关关闭，强制 flag=0；如果开关开启，根据关键字数量设置 flag
                        if (config.flag === undefined) {
                            if (config.keyword_filter_enabled) {
                                config.flag = config.param.length > 0 ? 1 : 0;
                            } else {
                                config.flag = 0; // 开关关闭时，flag 必须为 0
                                // 🔧 修复：不清空关键字，保留存储的关键字
                            }
                        } else if (!config.keyword_filter_enabled) {
                            // 🔧 修复：如果开关关闭，只设置 flag=0，不清空存储的关键字
                            config.flag = 0;
                        }
                        if (Object.keys(config).length > 0) {
                            saveHookConfig(script.id, config);
                        }
                    } else {
                        // has_Param=0：必须创建flag=0
                        if (config.flag === undefined) {
                            config.flag = 0;
                            saveHookConfig(script.id, config);
                        }
                    }
                }
                
                const scriptItem = createHookScriptItem(script, isEnabled, isFixedVariate, hasParam, config);
                hookContent.appendChild(scriptItem);
            });
        });
    }
    
    // 创建Hook脚本项
    function createHookScriptItem(script, isEnabled, isFixedVariate, hasParam, config) {
        const scriptItem = document.createElement('div');
        scriptItem.className = `hook-script-item ${isEnabled ? 'enabled' : 'disabled'}`;
        scriptItem.dataset.scriptId = script.id;
        
        // 获取动态开关（debugger, stack等）
        const dynamicSwitches = [];
        Object.keys(script).forEach(key => {
            if (!['id', 'name', 'description', 'category', 'fixed_variate', 'has_Param', 'parentScript'].includes(key)) {
                if (script[key] === 1) {
                    dynamicSwitches.push(key);
                }
            }
        });
        
        // 构建输入区域
        let inputArea = '';
        if (isFixedVariate) {
            // 固定变量脚本：显示固定值输入
            // 优先使用配置中的值，如果没有则使用scripts.json中的默认值
            const value = config?.value || script.value || '';
            inputArea = `
                <div class="hook-input-group">
                    <label class="hook-input-label">固定值：</label>
                    <div class="hook-input-wrapper hook-value-input-wrapper">
                        <input type="text" class="hook-value-input" 
                               value="${value}" 
                               placeholder="输入固定值后按Enter保存" 
                               ${!isEnabled ? 'disabled' : ''}>
                        <div class="hook-value-tooltip">输入固定值后按Enter保存</div>
                    </div>
                </div>
            `;
        } else {
            // 非固定变量脚本
            if (hasParam) {
                // 支持关键字过滤
                // 🔧 新增：检查关键字检索开关状态（默认为关闭，即 false）
                const keywordFilterEnabled = config?.keyword_filter_enabled !== undefined ? config.keyword_filter_enabled : false;
                
                // 🔧 修改：如果开关关闭，只隐藏关键字显示（UI层面），不清空存储的关键字
                let keywords = config?.param || [];
                if (!keywordFilterEnabled) {
                    keywords = []; // 只用于UI显示，不修改 config.param
                    if (config && config.flag !== 0) {
                        config.flag = 0; // 确保 flag=0
                    }
                }
                
                const keywordList = keywords.map((kw, idx) => `
                    <div class="keyword-item">
                        <span>${kw}</span>
                        <button class="keyword-remove-btn" data-index="${idx}" ${!isEnabled || !keywordFilterEnabled ? 'disabled' : ''}>×</button>
                    </div>
                `).join('');
                
                inputArea = `
                    <div class="hook-input-group">
                        <div class="hook-input-label-row">
                            <label class="hook-input-label">关键字：</label>
                            <div class="hook-keyword-filter-switch">
                                <label class="hook-keyword-filter-switch-label">
                                    <input type="checkbox" class="hook-keyword-filter-checkbox" ${keywordFilterEnabled ? 'checked' : ''} ${!isEnabled ? 'disabled' : ''} data-script-id="${script.id}">
                                    <span class="hook-keyword-filter-slider"></span>
                                </label>
                                <span class="hook-keyword-filter-label-text">检索关键字</span>
                            </div>
                        </div>
                        <div class="hook-keywords-container ${!keywordFilterEnabled ? 'keyword-filter-disabled' : ''}">
                            ${keywordList}
                            <div class="hook-input-wrapper">
                                <input type="text" class="hook-keyword-input" 
                                       placeholder="输入关键字后按Enter添加" 
                                       ${!isEnabled || !keywordFilterEnabled ? 'disabled' : ''}>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // 不支持关键字过滤，不显示输入框
                inputArea = '';
            }
        }
        
        // 构建动态开关
        const switchesHtml = dynamicSwitches.map(switchKey => {
            const switchValue = config?.[switchKey] || 0;
            return `
                <button class="hook-switch-btn ${switchValue === 1 ? 'active' : ''}" 
                        data-switch="${switchKey}" 
                        ${!isEnabled ? 'disabled' : ''}>
                    ${switchKey}
                </button>
            `;
        }).join('');
        
        scriptItem.innerHTML = `
            <div class="hook-script-header">
                <div class="hook-script-name">${script.name}</div>
                <div class="vue-script-info">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <div class="tooltip">${script.description || '暂无描述'}</div>
                </div>
                <label class="hook-main-switch">
                    <input type="checkbox" ${isEnabled ? 'checked' : ''} data-id="${script.id}">
                    <span class="hook-slider"></span>
                </label>
            </div>
            ${inputArea}
            <div class="hook-script-actions">
                <span class="hook-action-label">开启</span>
                ${switchesHtml}
            </div>
        `;
        
        // 绑定事件
        const checkbox = scriptItem.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', (e) => {
            handleHookScriptToggle(script, e.target.checked, scriptItem);
        });
        
        // 固定值输入框事件（使用Enter键保存）
        if (isFixedVariate) {
            const valueInput = scriptItem.querySelector('.hook-value-input');
            const tooltip = scriptItem.querySelector('.hook-value-tooltip');
            const inputWrapper = scriptItem.querySelector('.hook-value-input-wrapper');
            
            // 获得焦点时显示提示框
            valueInput.addEventListener('focus', () => {
                inputWrapper.classList.add('show-tooltip');
            });
            
            // 失去焦点时隐藏提示框
            valueInput.addEventListener('blur', () => {
                inputWrapper.classList.remove('show-tooltip');
            });
            
            valueInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && isEnabled) {
                    const value = e.target.value.trim();
                    if (value) {
                        // 保存固定值
                        saveHookConfigValue(script.id, value);
                        showToast('已保存');
                    } else {
                        // 如果输入为空，清空固定值
                        saveHookConfigValue(script.id, '');
                        showToast('已清空');
                    }
                }
            });
        }
        
        // 关键字输入框事件（非固定变量且支持关键字）
        if (!isFixedVariate && hasParam) {
            const keywordInput = scriptItem.querySelector('.hook-keyword-input');
            const keywordsContainer = scriptItem.querySelector('.hook-keywords-container');
            const keywordFilterCheckbox = scriptItem.querySelector('.hook-keyword-filter-checkbox');
            
            // 🔧 新增：关键字检索开关切换事件
            if (keywordFilterCheckbox) {
                keywordFilterCheckbox.addEventListener('change', (e) => {
                    handleKeywordFilterToggle(script.id, e.target.checked, scriptItem, isEnabled);
                });
            }
            
            keywordInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                    // 🔧 修改：检查开关状态
                    loadHookConfig(script.id).then(config => {
                        if (config?.keyword_filter_enabled) {
                            addKeyword(script.id, e.target.value.trim(), keywordsContainer, isEnabled);
                            e.target.value = '';
                        }
                    });
                }
            });
            
            // 绑定删除关键字按钮
            scriptItem.querySelectorAll('.keyword-remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    // 🔧 修改：检查开关状态
                    loadHookConfig(script.id).then(config => {
                        if (config?.keyword_filter_enabled) {
                            const index = parseInt(e.target.dataset.index);
                            removeKeyword(script.id, index, keywordsContainer, isEnabled);
                        }
                    });
                });
            });
        }
        
        // 动态开关事件
        scriptItem.querySelectorAll('.hook-switch-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (isEnabled) {
                    const switchKey = e.target.dataset.switch;
                    // 🔧 修复：根据按钮的当前状态（active类）来判断当前值，而不是依赖闭包中的config
                    const isActive = e.target.classList.contains('active');
                    const newValue = isActive ? 0 : 1;
                    toggleHookSwitch(script.id, switchKey, newValue, e.target);
                }
            });
        });
        
        return scriptItem;
    }
    
    // 加载Hook脚本配置
    function loadHookConfig(scriptId) {
        return new Promise((resolve) => {
            const configKey = `${scriptId}_config`;
            chrome.storage.local.get([configKey], (result) => {
                resolve(result[configKey] || {});
            });
        });
    }
    
    // 保存Hook脚本配置
    function saveHookConfig(scriptId, config) {
        const configKey = `${scriptId}_config`;
        chrome.storage.local.set({
            [configKey]: config
        }, () => {
            // 🔧 修改：用户修改配置时只保存到chrome.storage.local，不发送消息
            // 等下次刷新页面后，content.js会在页面加载时自动同步并发送消息
        });
    }
    
    // 保存固定值
    function saveHookConfigValue(scriptId, value) {
        loadHookConfig(scriptId).then(config => {
            config.value = value;
            saveHookConfig(scriptId, config);
        });
    }
    
    // 🔧 新增：处理关键字检索开关切换
    function handleKeywordFilterToggle(scriptId, enabled, scriptItem, isEnabled) {
        loadHookConfig(scriptId).then(config => {
            config.keyword_filter_enabled = enabled;
            
            if (!enabled) {
                // 🔧 修改：关闭开关时，只设置 flag=0，不清空存储的关键字
                config.flag = 0;
            } else {
                // 开启开关：根据关键字数量设置 flag
                if (!config.param) {
                    config.param = [];
                }
                config.flag = config.param.length > 0 ? 1 : 0;
            }
            
            saveHookConfig(scriptId, config);
            
            // 更新UI状态
            const keywordsContainer = scriptItem.querySelector('.hook-keywords-container');
            const keywordInput = scriptItem.querySelector('.hook-keyword-input');
            const keywordRemoveBtns = scriptItem.querySelectorAll('.keyword-remove-btn');
            
            if (enabled) {
                // 开启：启用输入框和删除按钮，重新显示关键字
                keywordsContainer.classList.remove('keyword-filter-disabled');
                if (keywordInput) keywordInput.disabled = !isEnabled;
                keywordRemoveBtns.forEach(btn => {
                    btn.disabled = !isEnabled;
                });
                
                // 🔧 修改：重新渲染关键字列表（从存储中恢复）
                const existingKeywords = config.param || [];
                const inputWrapper = keywordsContainer.querySelector('.hook-input-wrapper');
                // 清空现有显示的关键字
                keywordsContainer.querySelectorAll('.keyword-item').forEach(item => item.remove());
                // 重新添加关键字
                existingKeywords.forEach((kw, idx) => {
                    const keywordItem = document.createElement('div');
                    keywordItem.className = 'keyword-item';
                    keywordItem.innerHTML = `
                        <span>${kw}</span>
                        <button class="keyword-remove-btn" data-index="${idx}" ${!isEnabled ? 'disabled' : ''}>×</button>
                    `;
                    inputWrapper.parentNode.insertBefore(keywordItem, inputWrapper);
                });
                
                // 重新绑定删除按钮事件
                keywordsContainer.querySelectorAll('.keyword-remove-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        if (isEnabled && config.keyword_filter_enabled) {
                            const index = parseInt(e.target.dataset.index);
                            removeKeyword(scriptId, index, keywordsContainer, isEnabled);
                        }
                    });
                });
            } else {
                // 🔧 修改：关闭：禁用输入框和删除按钮，隐藏关键字列表（不清空存储）
                keywordsContainer.classList.add('keyword-filter-disabled');
                if (keywordInput) keywordInput.disabled = true;
                keywordRemoveBtns.forEach(btn => {
                    btn.disabled = true;
                });
                
                // 🔧 修改：只隐藏关键字列表UI，不清空存储
                const keywordItems = keywordsContainer.querySelectorAll('.keyword-item');
                keywordItems.forEach(item => item.remove());
            }
        });
    }
    
    // 添加关键字
    function addKeyword(scriptId, keyword, container, isEnabled) {
        loadHookConfig(scriptId).then(config => {
            // 🔧 修改：检查开关状态
            if (!config.keyword_filter_enabled) {
                return; // 开关关闭时不允许添加关键字
            }
            
            if (!config.param) {
                config.param = [];
            }
            if (config.param.indexOf(keyword) === -1) {
                config.param.push(keyword);
                // 🔧 修改：根据关键字数量设置 flag
                config.flag = config.param.length > 0 ? 1 : 0;
                saveHookConfig(scriptId, config);
                
                // 更新UI
                const keywordItem = document.createElement('div');
                keywordItem.className = 'keyword-item';
                keywordItem.innerHTML = `
                    <span>${keyword}</span>
                    <button class="keyword-remove-btn" data-index="${config.param.length - 1}" ${!isEnabled ? 'disabled' : ''}>×</button>
                `;
                const inputWrapper = container.querySelector('.hook-input-wrapper');
                container.insertBefore(keywordItem, inputWrapper);
                
                // 绑定删除事件
                keywordItem.querySelector('.keyword-remove-btn').addEventListener('click', (e) => {
                    loadHookConfig(scriptId).then(cfg => {
                        if (cfg?.keyword_filter_enabled) {
                            const index = parseInt(e.target.dataset.index);
                            removeKeyword(scriptId, index, container, isEnabled);
                        }
                    });
                });
            }
        });
    }
    
    // 删除关键字
    function removeKeyword(scriptId, index, container, isEnabled) {
        loadHookConfig(scriptId).then(config => {
            // 🔧 修改：检查开关状态
            if (!config.keyword_filter_enabled) {
                return; // 开关关闭时不允许删除关键字
            }
            
            if (config.param && config.param.length > index) {
                config.param.splice(index, 1);
                // 🔧 修改：根据关键字数量设置 flag
                if (config.param.length === 0) {
                    config.flag = 0; // 没有关键字时设置flag为0
                    config.param = []; // 保持为空数组
                } else {
                    config.flag = 1; // 还有关键字时保持 flag=1
                }
                saveHookConfig(scriptId, config);
                
                // 重新渲染关键字列表
                const keywordItems = container.querySelectorAll('.keyword-item');
                keywordItems[index].remove();
                
                // 更新所有删除按钮的索引
                container.querySelectorAll('.keyword-remove-btn').forEach((btn, idx) => {
                    btn.dataset.index = idx;
                });
            }
        });
    }
    
    // 切换Hook动态开关
    function toggleHookSwitch(scriptId, switchKey, value, buttonElement) {
        loadHookConfig(scriptId).then(config => {
            config[switchKey] = value;
            saveHookConfig(scriptId, config);
            
            // 更新UI
            if (value === 1) {
                buttonElement.classList.add('active');
            } else {
                buttonElement.classList.remove('active');
            }
        });
    }
    
    // 处理Hook脚本开关切换
    function handleHookScriptToggle(script, isChecked, scriptItem) {
        if (isChecked) {
            if (!enabledScripts.includes(script.id)) {
                enabledScripts.push(script.id);
            }
            scriptItem.classList.add('enabled');
            scriptItem.classList.remove('disabled');
            
            // 初始化配置（如果不存在）
            loadHookConfig(script.id).then(config => {
                const isFixedVariate = script.fixed_variate === 1;
                const hasParam = script.has_Param === 1;
                
                // 固定变量脚本：如果配置中没有值，使用scripts.json中的默认值
                if (isFixedVariate) {
                    // 检查scripts.json中是否有默认值
                    if (script.value !== undefined && script.value !== null) {
                        // 如果配置中没有保存的值，使用默认值
                        if (config.value === undefined || config.value === '') {
                            config.value = script.value;
                            saveHookConfig(script.id, config);
                            
                            // 更新输入框显示
                            const valueInput = scriptItem.querySelector('.hook-value-input');
                            if (valueInput) {
                                valueInput.value = script.value;
                            }
                        }
                    }
                } else {
                    // 非固定变量脚本：确保flag和param存在
                    if (hasParam) {
                        // has_Param=1：必须创建param（即使为空数组）和flag
                        if (config.param === undefined) {
                            config.param = [];
                        }
                        // 🔧 新增：初始化关键字检索开关（默认为关闭，即 false）
                        if (config.keyword_filter_enabled === undefined) {
                            config.keyword_filter_enabled = false;
                        }
                        // 🔧 修改：如果开关关闭，强制 flag=0；如果开关开启，根据关键字数量设置 flag
                        if (config.flag === undefined) {
                            if (config.keyword_filter_enabled) {
                                config.flag = config.param.length > 0 ? 1 : 0;
                            } else {
                                config.flag = 0; // 开关关闭时，flag 必须为 0
                                // 🔧 修复：不清空关键字，保留存储的关键字
                            }
                        } else if (!config.keyword_filter_enabled) {
                            // 🔧 修复：如果开关关闭，只设置 flag=0，不清空存储的关键字
                            config.flag = 0;
                        }
                    } else {
                        // has_Param=0：必须创建flag=0，不创建param
                        if (config.flag === undefined) {
                            config.flag = 0;
                        }
                    }
                    saveHookConfig(script.id, config);
                }
                
                // 🔧 修改：根据关键字检索开关状态启用/禁用控件
                if (hasParam && !isFixedVariate) {
                    const keywordFilterEnabled = config?.keyword_filter_enabled !== undefined ? config.keyword_filter_enabled : false;
                    const keywordInput = scriptItem.querySelector('.hook-keyword-input');
                    const keywordRemoveBtns = scriptItem.querySelectorAll('.keyword-remove-btn');
                    const keywordsContainer = scriptItem.querySelector('.hook-keywords-container');
                    
                    if (keywordFilterEnabled) {
                        // 开启：启用关键字输入框和删除按钮
                        if (keywordInput) keywordInput.disabled = false;
                        keywordRemoveBtns.forEach(btn => {
                            btn.disabled = false;
                        });
                        if (keywordsContainer) keywordsContainer.classList.remove('keyword-filter-disabled');
                    } else {
                        // 关闭：禁用关键字输入框和删除按钮
                        if (keywordInput) keywordInput.disabled = true;
                        keywordRemoveBtns.forEach(btn => {
                            btn.disabled = true;
                        });
                        if (keywordsContainer) keywordsContainer.classList.add('keyword-filter-disabled');
                    }
                } else {
                    // 其他控件正常启用
                    scriptItem.querySelectorAll('input:not(.hook-keyword-input), button:not(.keyword-remove-btn)').forEach(el => {
                        el.disabled = false;
                    });
                }
                
                // 🔧 修改：用户修改配置时只保存到chrome.storage.local，不发送消息
                // 等下次刷新页面后，content.js会在页面加载时自动同步并发送消息
            });
        } else {
            enabledScripts = enabledScripts.filter(id => id !== script.id);
            scriptItem.classList.remove('enabled');
            scriptItem.classList.add('disabled');
            
            // 禁用所有控件（除了主开关）
            scriptItem.querySelectorAll('input:not([type="checkbox"]), button:not(.hook-main-switch input)').forEach(el => {
                el.disabled = true;
            });
        }
        
        updateStorage(enabledScripts);
        
        // 🆕 如果当前有筛选状态，重新渲染Hook脚本列表以应用筛选
        if (currentTab === 'hook' && hookFilterState) {
            const scriptsToShow = getScriptsForCurrentTab();
            renderHookScripts(scriptsToShow);
        }
    }
    
    // 同步Hook配置到页面localStorage
    function syncHookConfigToPage(scriptId, config) {
        if (!currentTab_obj || !currentTab_obj.id) return;
        
        // 获取脚本信息以判断类型
        const script = allScripts.find(s => s.id === scriptId);
        if (!script) return;
        
        const scriptName = scriptId; // 脚本文件名
        const baseKey = `Antidebug_breaker_${scriptName}`;
        
        // 构建要同步的localStorage数据
        const localStorageData = {};
        
        const isFixedVariate = script.fixed_variate === 1;
        const hasParam = script.has_Param === 1;
        
        // 固定变量脚本
        if (isFixedVariate) {
            if (config.value !== undefined) {
                localStorageData[`${baseKey}_value`] = config.value;
            }
        } else {
            // 非固定变量脚本
            // has_Param=0：必须创建flag=0
            // has_Param=1：必须创建flag和param（即使为空数组）
            if (hasParam) {
                // 必须创建param（即使为空数组）
                localStorageData[`${baseKey}_param`] = JSON.stringify(config.param || []);
                // 必须创建flag
                localStorageData[`${baseKey}_flag`] = (config.flag !== undefined ? config.flag : (config.param && config.param.length > 0 ? 1 : 0)).toString();
            } else {
                // has_Param=0：必须创建flag=0
                localStorageData[`${baseKey}_flag`] = '0';
            }
        }
        
        // 动态开关（debugger, stack等）
        Object.keys(config).forEach(key => {
            // 🔧 修改：排除 keyword_filter_enabled，它只是插件UI的控制开关，不需要同步到页面
            if (!['value', 'flag', 'param', 'keyword_filter_enabled'].includes(key)) {
                localStorageData[`${baseKey}_${key}`] = (config[key] || 0).toString();
            }
        });
        
        // 发送消息到content script同步
        chrome.tabs.sendMessage(currentTab_obj.id, {
            type: 'SYNC_HOOK_CONFIG',
            scriptId: scriptId,
            config: localStorageData
        }).catch(err => {
            console.warn('同步Hook配置失败:', err);
        });
    }

    // 显示多个Vue实例（新增函数）
    function displayMultipleInstances() {
        const instanceTabs = document.querySelector('.instance-tabs');
        const tabsHeader = document.querySelector('.instance-tabs-header');
        
        // 没有数据
        if (!cachedVueDataList || cachedVueDataList.length === 0) {
            instanceTabs.style.display = 'none';
            displayVueRouterData(null);
            return;
        }
        
        // 只有一个实例，隐藏标签页，保持原有UI
        if (cachedVueDataList.length === 1) {
            instanceTabs.style.display = 'none';
            displayVueRouterData(cachedVueDataList[0]);
            return;
        }
        
        // 多实例场景：显示标签页
        instanceTabs.style.display = 'block';
        
        // 生成标签按钮
        tabsHeader.innerHTML = '';
        cachedVueDataList.forEach((instance, index) => {
            const tabBtn = document.createElement('button');
            tabBtn.className = `instance-tab-btn ${index === currentInstanceIndex ? 'active' : ''}`;
            
            const routeCount = instance.routes?.length || 0;
            tabBtn.innerHTML = `
                <div class="instance-tab-title">实例 ${index + 1}</div>
                <div class="instance-tab-subtitle">Vue ${instance.vueVersion} · ${routeCount} 路由</div>
            `;
            
            tabBtn.onclick = () => {
                // 更新激活状态
                document.querySelectorAll('.instance-tab-btn').forEach(btn => {
                    btn.classList.remove('active');
                });
                tabBtn.classList.add('active');
                
                // 更新当前索引并显示
                currentInstanceIndex = index;
                displayVueRouterData(cachedVueDataList[index]);
            };
            
            tabsHeader.appendChild(tabBtn);
        });
        
        // 显示当前选中的实例
        displayVueRouterData(cachedVueDataList[currentInstanceIndex]);
    }

    // 显示 React Router 数据
    function displayReactRouterData(reactRouterInfo) {
        const reactRoutesInfoBar = document.querySelector('.react-routes-info-bar');
        const reactRouteSearchContainer = document.querySelector('.react-route-search-container');
        const reactRoutesListContainer = document.querySelector('.react-routes-list-container');
        const reactRoutesActionsFooter = document.querySelector('.react-routes-actions-footer');
        const reactRouteSearchInput = document.getElementById('react-route-search-input');
        const reactCopyAllPathsBtn = document.querySelector('.react-copy-all-paths-btn');
        const reactCopyAllUrlsBtn = document.querySelector('.react-copy-all-urls-btn');
        const reactBaseInputContainer = document.querySelector('.react-route-base-input-container');

        if (!reactRoutesListContainer) return;

        // URL 清理：去多余斜杠和尾部斜杠
        const cleanUrl = (url) => url.replace(/([^:]\/)\/+/g, '$1').replace(/\/$/, '');

        // 默认隐藏可选区域
        if (reactRoutesInfoBar) reactRoutesInfoBar.style.display = 'none';
        if (reactRouteSearchContainer) reactRouteSearchContainer.style.display = 'none';
        if (reactRoutesActionsFooter) reactRoutesActionsFooter.style.display = 'none';
        if (reactBaseInputContainer) reactBaseInputContainer.style.display = 'none';

        if (!reactRouterInfo) {
            reactRoutesListContainer.innerHTML = '<div class="empty-state">等待检测 React Router（如需检测请打开<strong>获取路由</strong>并刷新网站）</div>';
            return;
        }

        if (reactRouterInfo.notFound) {
            reactRoutesListContainer.innerHTML = '<div class="empty-state">❌ 未检测到 React Router（可尝试重新打开插件）</div>';
            return;
        }

        if (reactRouterInfo.serializationError) {
            reactRoutesListContainer.innerHTML = '<div class="empty-state">❌ 路由数据传输失败，请查看控制台（F12）输出的路由信息！</div>';
            return;
        }

        const allRoutes = reactRouterInfo.routes;
        if (!allRoutes || allRoutes.length === 0) {
            reactRoutesListContainer.innerHTML = '<div class="empty-state">⚠️ 路由表为空</div>';
            return;
        }

        if (reactRoutesInfoBar) reactRoutesInfoBar.style.display = 'flex';
        if (reactRouteSearchContainer) reactRouteSearchContainer.style.display = 'flex';
        if (reactRoutesActionsFooter) reactRoutesActionsFooter.style.display = 'flex';

        const routerMode = reactRouterInfo.routerMode ?? null;
        let baseUrl = window.location.origin;
        if (currentTab_obj && currentTab_obj.url) {
            try { baseUrl = new URL(currentTab_obj.url).origin; } catch (e) {}
        }

        // ===== Base URL 处理（参照 Vue 板块逻辑）=====
        const detectedBase = reactRouterInfo.routerBase || '';
        let shouldShowBaseInput = false;
        let cleanDetectedBase = '';

        if (detectedBase.trim() !== '') {
            if (detectedBase.startsWith('http://') || detectedBase.startsWith('https://') || detectedBase.includes('#')) {
                console.warn('[AntiDebug] React 检测到的 basename 无效，已忽略:', detectedBase);
            } else {
                cleanDetectedBase = detectedBase.endsWith('/') ? detectedBase.slice(0, -1) : detectedBase;
                if (cleanDetectedBase !== '/' && cleanDetectedBase !== '') {
                    shouldShowBaseInput = true;
                }
            }
        }

        let currentCustomBase = ''; // 当前用户输入/存储的 base

        // 构建完整 URL（含 base 处理）
        function buildFullUrl(normalizedPath) {
            const baseUrlWithoutTrailingSlash = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
            const cleanPath = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;

            if (currentCustomBase && currentCustomBase.trim() !== '') {
                const cleanBase = currentCustomBase.endsWith('/') ? currentCustomBase.slice(0, -1) : currentCustomBase;
                if (routerMode === 'hash') {
                    return `${baseUrlWithoutTrailingSlash}${cleanBase}/#/${cleanPath}`;
                } else {
                    return cleanUrl(baseUrl + cleanBase + normalizedPath);
                }
            } else {
                if (routerMode === 'hash') {
                    return `${baseUrlWithoutTrailingSlash}/#/${cleanPath}`;
                } else {
                    return baseUrl + normalizedPath;
                }
            }
        }

        // 渲染路由列表（按完整 URL 去重）
        function renderRoutes(routesToShow) {
            reactRoutesListContainer.innerHTML = '';
            const seenUrls = new Set();
            routesToShow.forEach(route => {
                const rawPath = route.path || '/';
                const normalizedPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
                const fullUrl = buildFullUrl(normalizedPath);
                if (seenUrls.has(fullUrl)) return;
                seenUrls.add(fullUrl);

                const routeItem = document.createElement('div');
                routeItem.className = 'route-item';
                routeItem.innerHTML = `
                    <div class="route-url" title="${fullUrl}">${fullUrl}</div>
                    <div class="route-actions">
                        <button class="route-btn copy-btn" data-url="${fullUrl}">复制</button>
                        <button class="route-btn open-btn" data-url="${fullUrl}">打开</button>
                    </div>
                `;

                routeItem.querySelector('.copy-btn').addEventListener('click', () => {
                    navigator.clipboard.writeText(fullUrl).then(() => {
                        const btn = routeItem.querySelector('.copy-btn');
                        btn.textContent = '✓ 已复制';
                        setTimeout(() => { btn.textContent = '复制'; }, 1500);
                    }).catch(err => console.error('复制失败:', err));
                });

                routeItem.querySelector('.open-btn').addEventListener('click', () => {
                    chrome.tabs.update(currentTab_obj.id, { url: fullUrl });
                });

                reactRoutesListContainer.appendChild(routeItem);
            });
        }

        // 渲染并更新信息头计数（去重后的真实数量）
        function renderRoutesAndUpdateCount(routesToShow) {
            renderRoutes(routesToShow);
            const reactRoutesInfo = document.querySelector('.react-routes-info');
            if (reactRoutesInfo) {
                const renderedCount = reactRoutesListContainer.querySelectorAll('.route-item').length;
                reactRoutesInfo.innerHTML = `完整路由列表 (<span class="highlight">${routerMode}</span> 模式) -- <span class="highlight">${renderedCount}</span> 条路由`;
            }
        }

        // 搜索时重渲染
        function renderRoutesWithSearch() {
            const term = (reactRouteSearchInput ? reactRouteSearchInput.value : '').toLowerCase().trim();
            if (term) {
                const filtered = allRoutes.filter(r =>
                    (r.path || '').toLowerCase().includes(term) || (r.name || '').toLowerCase().includes(term)
                );
                renderRoutesAndUpdateCount(filtered);
            } else {
                renderRoutesAndUpdateCount(allRoutes);
            }
        }

        // ===== Base URL 输入区 =====
        if (shouldShowBaseInput && reactBaseInputContainer) {
            reactBaseInputContainer.style.display = 'flex';
            const detectedBaseValue = reactBaseInputContainer.querySelector('.react-detected-base-value');
            const applyBtn = reactBaseInputContainer.querySelector('.react-apply-detected-base-btn');
            const customInput = document.getElementById('react-custom-base-input');
            const clearBtn = reactBaseInputContainer.querySelector('.react-clear-base-btn');

            if (detectedBaseValue) detectedBaseValue.textContent = cleanDetectedBase;

            // 从 storage 恢复自定义 base
            const storageKey = `${hostname}_react_custom_base`;
            chrome.storage.local.get([storageKey], (result) => {
                currentCustomBase = result[storageKey] || '';
                if (customInput) customInput.value = currentCustomBase;
                renderRoutesWithSearch();
            });

            if (applyBtn) {
                applyBtn.onclick = () => {
                    currentCustomBase = cleanDetectedBase;
                    if (customInput) customInput.value = currentCustomBase;
                    chrome.storage.local.set({ [storageKey]: currentCustomBase });
                    renderRoutesWithSearch();
                };
            }
            if (clearBtn) {
                clearBtn.onclick = () => {
                    currentCustomBase = '';
                    if (customInput) customInput.value = '';
                    chrome.storage.local.set({ [storageKey]: '' });
                    renderRoutesWithSearch();
                };
            }
            if (customInput) {
                customInput.oninput = (e) => {
                    currentCustomBase = e.target.value.trim();
                    chrome.storage.local.set({ [storageKey]: currentCustomBase });
                    renderRoutesWithSearch();
                };
            }
        } else {
            renderRoutesAndUpdateCount(allRoutes);
        }

        // 搜索框
        if (reactRouteSearchInput) {
            reactRouteSearchInput.value = '';
            reactRouteSearchInput.oninput = renderRoutesWithSearch;
        }

        // 批量复制路径
        if (reactCopyAllPathsBtn) {
            reactCopyAllPathsBtn.onclick = () => {
                const text = allRoutes.map(r => {
                    const p = r.path || '/';
                    const normalizedPath = p.startsWith('/') ? p : '/' + p;
                    if (currentCustomBase && currentCustomBase.trim() !== '') {
                        const cleanBase = currentCustomBase.endsWith('/') ? currentCustomBase.slice(0, -1) : currentCustomBase;
                        return cleanBase + normalizedPath;
                    }
                    return normalizedPath;
                }).join('\n');
                navigator.clipboard.writeText(text).then(() => {
                    reactCopyAllPathsBtn.textContent = '✓ 已复制';
                    setTimeout(() => { reactCopyAllPathsBtn.textContent = '复制所有路径'; }, 1500);
                }).catch(err => console.error('复制失败:', err));
            };
        }

        // 批量复制完整 URL
        if (reactCopyAllUrlsBtn) {
            reactCopyAllUrlsBtn.onclick = () => {
                const text = allRoutes.map(r => {
                    const p = r.path || '/';
                    const normalizedPath = p.startsWith('/') ? p : '/' + p;
                    return buildFullUrl(normalizedPath);
                }).join('\n');
                navigator.clipboard.writeText(text).then(() => {
                    reactCopyAllUrlsBtn.textContent = '✓ 已复制';
                    setTimeout(() => { reactCopyAllUrlsBtn.textContent = '复制所有URL'; }, 1500);
                }).catch(err => console.error('复制失败:', err));
            };
        }
    }

                // 显示 Vue Router 数据
            // 显示 Vue Router 数据
    function displayVueRouterData(vueRouterInfo) {
        // 路径规范化函数：确保路径以 / 开头
        const normalizePath = (path) => {
            // 如果路径为空或只有空格，返回根路径
            if (!path || path.trim() === '') {
                return '/';
            }
            // 如果路径不以 / 开头，加上 /
            if (!path.startsWith('/')) {
                return '/' + path;
            }
            return path;
        };

        // URL清理函数：清理多余斜杠和尾部斜杠
        const cleanUrl = (url) => {
            return url.replace(/([^:]\/)\/+/g, '$1').replace(/\/$/, '');
        };

        // 默认隐藏搜索框和底部按钮
        const routeBaseInputContainer = document.querySelector('.route-base-input-container');
        if (vueRouteSearchContainer) {
            vueRouteSearchContainer.style.display = 'none';
        }
        if (routesActionsFooter) {
            routesActionsFooter.style.display = 'none';
        }
        if (routeBaseInputContainer) {
            routeBaseInputContainer.style.display = 'none';
        }

        if (!vueRouterInfo) {
            routesListContainer.innerHTML = '<div class="empty-state">等待检测 Vue Router（如需检测请打开<strong>获取路由</strong>并刷新网站）</div>';
            vueVersionDisplay.style.display = 'none';
            return;
        }

        // 未找到Router
        if (vueRouterInfo.notFound) {
            routesListContainer.innerHTML = '<div class="empty-state">❌ 未检测到 Vue Router（可尝试重新打开插件）</div>';
            vueVersionDisplay.style.display = 'none';
            return;
        }

        // ✅ 新增：序列化错误处理
        if (vueRouterInfo.serializationError) {
            routesListContainer.innerHTML = '<div class="empty-state">❌ 路由数据传输失败，请查看控制台（F12）输出的路由信息！</div>';
            vueVersionDisplay.style.display = 'none';
            return;
        }

        // 显示Vue版本和路由信息
        if (vueRouterInfo.vueVersion) {
            vueVersionDisplay.style.display = 'flex';
            versionValue.textContent = vueRouterInfo.vueVersion;

            // 显示路由信息到左侧
            const routesInfo = vueVersionDisplay.querySelector('.routes-info');
            if (!vueRouterInfo.routes || vueRouterInfo.routes.length === 0) {
                routesInfo.textContent = '路由表为空';
            } else {
                const routerMode = vueRouterInfo.routerMode || 'history';
                const routeCount = vueRouterInfo.routes.length;
                routesInfo.innerHTML = `完整URL列表 (<span class="highlight">${routerMode}</span> 模式) -- <span class="highlight">${routeCount}</span> 条路由`;
            }
        }

        // 显示路由列表
        if (!vueRouterInfo.routes || vueRouterInfo.routes.length === 0) {
            routesListContainer.innerHTML = '<div class="empty-state">⚠️ 路由表为空</div>';
            return;
        }

        // 显示搜索框和底部按钮（有路由时才显示）
        vueRouteSearchContainer.style.display = 'flex';
        routesActionsFooter.style.display = 'flex';

        let baseUrl = vueRouterInfo.baseUrl || window.location.origin;
        const routerMode = vueRouterInfo.routerMode || 'history';
        const detectedBase = vueRouterInfo.routerBase || ''; // 检测到的base（只用于显示）
        const allRoutes = vueRouterInfo.routes;

        // ✅ 从当前标签页URL提取真实的baseUrl（包含子路径和#）
        if (currentTab_obj && currentTab_obj.url) {
            try {
                const currentUrl = currentTab_obj.url;
                if (routerMode === 'hash' && (currentUrl.includes('#/') || currentUrl.includes('#'))) {
                    const hashIndex = currentUrl.indexOf('#');
                    if (hashIndex > 0) {
                        baseUrl = currentUrl.substring(0, hashIndex + 1);
                    }
                }
            } catch (e) {
                console.warn('[AntiDebug] 提取baseUrl时出错:', e);
            }
        }

        // ✅ 过滤无效的检测结果（完整URL或包含#的base）
        let shouldShowBaseInput = false;
        let cleanDetectedBase = '';
        
        if (detectedBase && detectedBase.trim() !== '') {
            // 如果是完整URL或包含#，不显示输入框
            if (detectedBase.startsWith('http://') || detectedBase.startsWith('https://') || detectedBase.includes('#')) {
                console.warn('[AntiDebug] 检测到的base无效，已忽略:', detectedBase);
            } else {
                // 清理尾部斜杠
                cleanDetectedBase = detectedBase.endsWith('/') ? detectedBase.slice(0, -1) : detectedBase;
                if (cleanDetectedBase !== '/' && cleanDetectedBase !== '') {
                    shouldShowBaseInput = true;
                }
            }
        }

        // ✅ 自定义base逻辑
        const customBaseInput = document.getElementById('custom-base-input');
        const detectedBaseValue = document.querySelector('.detected-base-value');
        const applyDetectedBaseBtn = document.querySelector('.apply-detected-base-btn');
        const clearBaseBtn = document.querySelector('.clear-base-btn');

        let currentCustomBase = ''; // 当前用户输入的base

        if (shouldShowBaseInput && routeBaseInputContainer && customBaseInput) {
            routeBaseInputContainer.style.display = 'flex';
            
            // 显示检测到的base
            if (detectedBaseValue) {
                detectedBaseValue.textContent = cleanDetectedBase;
            }

            // ✅ 从 storage读取该域名的自定义base
            const storageKey = `${hostname}_custom_base`;
            chrome.storage.local.get([storageKey], (result) => {
                currentCustomBase = result[storageKey] || '';
                customBaseInput.value = currentCustomBase;
                
                // 初始渲染
                renderRoutes(allRoutes);
            });

            // 应用检测到的base按钮
            if (applyDetectedBaseBtn) {
                applyDetectedBaseBtn.onclick = () => {
                    customBaseInput.value = cleanDetectedBase;
                    currentCustomBase = cleanDetectedBase;
                    
                    // 保存到storage
                    chrome.storage.local.set({ [storageKey]: currentCustomBase });
                    
                    // 重新渲染
                    renderRoutesWithSearch();
                };
            }

            // 清空按钮
            if (clearBaseBtn) {
                clearBaseBtn.onclick = () => {
                    customBaseInput.value = '';
                    currentCustomBase = '';
                    
                    // 保存到storage
                    chrome.storage.local.set({ [storageKey]: '' });
                    
                    // 重新渲染
                    renderRoutesWithSearch();
                };
            }

            // 输入框实时监听
            customBaseInput.oninput = (e) => {
                currentCustomBase = e.target.value.trim();
                
                // 保存到storage
                chrome.storage.local.set({ [storageKey]: currentCustomBase });
                
                // 重新渲染（考虑搜索框内容）
                renderRoutesWithSearch();
            };
        } else {
            // 没有检测到base，直接渲染标准路径
            renderRoutes(allRoutes);
        }

        // ✅ 渲染路由列表（考虑搜索框）的辅助函数
        function renderRoutesWithSearch() {
            const searchTerm = vueRouteSearchInput.value.toLowerCase().trim();
            if (searchTerm) {
                const filteredRoutes = allRoutes.filter(route => {
                    const path = route.path.toLowerCase();
                    const name = (route.name || '').toLowerCase();
                    return path.includes(searchTerm) || name.includes(searchTerm);
                });
                renderRoutes(filteredRoutes);
            } else {
                renderRoutes(allRoutes);
            }
        };
    
        // 渲染路由列表的函数
        function renderRoutes(routesToShow) {
            routesListContainer.innerHTML = '';

            routesToShow.forEach(route => {
                // 规范化路径
                const normalizedPath = normalizePath(route.path);
                
                // 根据路由模式拼接URL
                let fullUrl;
                
                // ✅ 使用用户输入的base（如果有）
                if (currentCustomBase && currentCustomBase.trim() !== '') {
                    // 用户自定义了base
                    const cleanBase = currentCustomBase.endsWith('/') ? currentCustomBase.slice(0, -1) : currentCustomBase;
                    
                    if (routerMode === 'hash') {
                        const baseUrlWithoutHash = baseUrl.endsWith('#') ? baseUrl.slice(0, -1) : baseUrl;
                        fullUrl = cleanUrl(baseUrlWithoutHash + cleanBase + '/#' + normalizedPath);
                    } else {
                        fullUrl = cleanUrl(baseUrl + cleanBase + normalizedPath);
                    }
                } else {
                    // 标准路径（无base）
                    if (routerMode === 'hash') {
                        const cleanPath = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
                        
                        if (baseUrl.endsWith('#')) {
                            fullUrl = baseUrl + '/' + cleanPath;
                        } else if (baseUrl.endsWith('#/')) {
                            fullUrl = baseUrl + cleanPath;
                        } else {
                            fullUrl = baseUrl + '#/' + cleanPath;
                        }
                        
                        fullUrl = cleanUrl(fullUrl);
                    } else {
                        fullUrl = baseUrl + normalizedPath;
                    }
                }

                const routeItem = document.createElement('div');
                routeItem.className = 'route-item';

                routeItem.innerHTML = `
                    <div class="route-url" title="${fullUrl}">${fullUrl}</div>
                    <div class="route-actions">
                        <button class="route-btn copy-btn" data-url="${fullUrl}">复制</button>
                        <button class="route-btn open-btn" data-url="${fullUrl}">打开</button>
                    </div>
                `;

                routesListContainer.appendChild(routeItem);

                // 复制按钮
                const copyBtn = routeItem.querySelector('.copy-btn');
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(fullUrl).then(() => {
                        const originalText = copyBtn.textContent;
                        copyBtn.textContent = '✓ 已复制';
                        setTimeout(() => {
                            copyBtn.textContent = originalText;
                        }, 1500);
                    }).catch(err => {
                        console.error('复制失败:', err);
                    });
                });

                // 打开按钮
                const openBtn = routeItem.querySelector('.open-btn');
                openBtn.addEventListener('click', () => {
                    // 🆕 保存当前打开的路由URL到存储（仅当开启了Get_Vue_0或Get_Vue_1脚本时）
                    const hasVueScript = enabledScripts.includes('Get_Vue_0') || enabledScripts.includes('Get_Vue_1');
                    if (hasVueScript && vueRouterInfo && vueRouterInfo.routes && vueRouterInfo.routes.length > 0) {
                        const storageKey = `${hostname}_last_opened_route`;
                        chrome.storage.local.set({
                            [storageKey]: fullUrl
                        });
                    }
                    
                    chrome.tabs.update(currentTab_obj.id, {
                        url: fullUrl
                    });
                });
            });
            
            // 🆕 渲染完成后，检查是否有保存的路由并滚动到该位置
            // 仅当首次打开插件时执行跳转，切换脚本时不执行
            // 仅当开启了Get_Vue_0或Get_Vue_1脚本且成功获取到路由数据时才执行
            // 🔧 如果用户正在搜索，则不执行跳转
            const hasVueScript = enabledScripts.includes('Get_Vue_0') || enabledScripts.includes('Get_Vue_1');
            const isSearching = vueRouteSearchInput && vueRouteSearchInput.value.trim() !== '';
            
            // 🔧 仅在首次显示Vue路由数据时执行跳转
            if (isFirstVueDataDisplay && hasVueScript && vueRouterInfo && vueRouterInfo.routes && vueRouterInfo.routes.length > 0 && !isSearching) {
                chrome.storage.local.get([`${hostname}_last_opened_route`], (result) => {
                    const lastOpenedRoute = result[`${hostname}_last_opened_route`];
                    if (lastOpenedRoute) {
                        // 检查该路由是否在当前显示的路由列表中
                        const targetRouteItem = Array.from(routesListContainer.querySelectorAll('.route-item')).find(item => {
                            const openBtn = item.querySelector('.open-btn');
                            return openBtn && openBtn.dataset.url === lastOpenedRoute;
                        });
                        
                        if (targetRouteItem) {
                            // 路由存在，直接跳转到该位置并高亮闪烁
                            setTimeout(() => {
                                targetRouteItem.scrollIntoView({
                                    behavior: 'auto',
                                    block: 'center'
                                });
                                
                                // 🆕 添加闪烁动画类，闪烁两次
                                targetRouteItem.classList.add('highlight-last-opened');
                                
                                // 动画完成后移除类（1秒 * 2次 = 2秒）
                                setTimeout(() => {
                                    targetRouteItem.classList.remove('highlight-last-opened');
                                }, 2000);
                            }, 100);
                        }
                    }
                });
                // 标记已经执行过跳转，后续不再执行
                isFirstVueDataDisplay = false;
            }
        };

        // 搜索功能
        vueRouteSearchInput.value = ''; // 清空搜索框
        vueRouteSearchInput.oninput = (e) => {
            const searchTerm = e.target.value.toLowerCase();
            const filteredRoutes = allRoutes.filter(route => {
                const path = route.path.toLowerCase();
                const name = (route.name || '').toLowerCase();
                return path.includes(searchTerm) || name.includes(searchTerm);
            });
            renderRoutes(filteredRoutes);
        };

        // 批量复制功能 - 根据当前用户输入的base复制
        copyAllPathsBtn.onclick = () => {
            const allPaths = allRoutes.map(route => {
                const normalizedPath = normalizePath(route.path);
                
                if (currentCustomBase && currentCustomBase.trim() !== '') {
                    const cleanBase = currentCustomBase.endsWith('/') ? currentCustomBase.slice(0, -1) : currentCustomBase;
                    return cleanBase + normalizedPath;
                }
                return normalizedPath;
            }).join('\n');
            
            navigator.clipboard.writeText(allPaths).then(() => {
                const originalText = copyAllPathsBtn.textContent;
                copyAllPathsBtn.textContent = '✓ 已复制';
                setTimeout(() => {
                    copyAllPathsBtn.textContent = originalText;
                }, 1500);
            }).catch(err => {
                console.error('复制失败:', err);
            });
        };

        copyAllUrlsBtn.onclick = () => {
            const allUrls = allRoutes.map(route => {
                const normalizedPath = normalizePath(route.path);
                let fullUrl;
                
                if (currentCustomBase && currentCustomBase.trim() !== '') {
                    const cleanBase = currentCustomBase.endsWith('/') ? currentCustomBase.slice(0, -1) : currentCustomBase;
                    
                    if (routerMode === 'hash') {
                        const baseUrlWithoutHash = baseUrl.endsWith('#') ? baseUrl.slice(0, -1) : baseUrl;
                        fullUrl = cleanUrl(baseUrlWithoutHash + cleanBase + '/#' + normalizedPath);
                    } else {
                        fullUrl = cleanUrl(baseUrl + cleanBase + normalizedPath);
                    }
                } else {
                    if (routerMode === 'hash') {
                        const cleanPath = normalizedPath.startsWith('/') ? normalizedPath.substring(1) : normalizedPath;
                        
                        if (baseUrl.endsWith('#')) {
                            fullUrl = baseUrl + '/' + cleanPath;
                        } else if (baseUrl.endsWith('#/')) {
                            fullUrl = baseUrl + cleanPath;
                        } else {
                            fullUrl = baseUrl + '#/' + cleanPath;
                        }
                        
                        fullUrl = cleanUrl(fullUrl);
                    } else {
                        fullUrl = baseUrl + normalizedPath;
                    }
                }
                
                return fullUrl;
            }).join('\n');

            navigator.clipboard.writeText(allUrls).then(() => {
                const originalText = copyAllUrlsBtn.textContent;
                copyAllUrlsBtn.textContent = '✓ 已复制';
                setTimeout(() => {
                    copyAllUrlsBtn.textContent = originalText;
                }, 1500);
            }).catch(err => {
                console.error('复制失败:', err);
            });
        };
    }

    // 🆕 处理反调试脚本开关切换（支持全局模式）
    function handleScriptToggle(scriptId, isChecked, scriptItem) {
        if (typeof scriptId !== 'string' || !scriptId.trim()) {
            console.error('Invalid script ID in change event:', scriptId);
            return;
        }

        if (isChecked) {
            if (!enabledScripts.includes(scriptId)) {
                enabledScripts.push(scriptId);
                scriptItem.classList.add('active');
            }
        } else {
            enabledScripts = enabledScripts.filter(id => id !== scriptId);
            scriptItem.classList.remove('active');
        }

        updateStorage(enabledScripts);
    }

    // 🆕 处理Vue脚本开关切换（含父子逻辑，支持全局模式）
    function handleVueScriptToggle(script, isChecked) {
        // 如果是父脚本
        if (!script.parentScript) {
            if (isChecked) {
                // 开启父脚本：添加父脚本ID
                if (!enabledScripts.includes(script.id)) {
                    enabledScripts.push(script.id);
                }
            } else {
                // 关闭父脚本：同时移除父脚本和所有子脚本
                const childScripts = allScripts.filter(s => s.parentScript === script.id);
                enabledScripts = enabledScripts.filter(id => {
                    if (id === script.id) return false;
                    if (childScripts.some(child => child.id === id)) return false;
                    return true;
                });
            }
        }
        // 如果是子脚本
        else {
            if (isChecked) {
                // 开启子脚本：移除父脚本，只保留子脚本
                enabledScripts = enabledScripts.filter(id => id !== script.parentScript);
                if (!enabledScripts.includes(script.id)) {
                    enabledScripts.push(script.id);
                }
            } else {
                // 关闭子脚本：移除子脚本，恢复父脚本
                enabledScripts = enabledScripts.filter(id => id !== script.id);
                if (!enabledScripts.includes(script.parentScript)) {
                    enabledScripts.push(script.parentScript);
                }
            }
        }

        updateStorage(enabledScripts);
    }

    // 🆕 脚本组合检测函数：将独立脚本合并为组合脚本
    function combineCombinableScripts(scriptIds) {
        const combined = [...scriptIds];
        
        // 检测是否同时存在 Hook_SMcrypto 和 Hook_JSEncrypt
        const hasSM = combined.includes('Hook_SMcrypto');
        const hasJSE = combined.includes('Hook_JSEncrypt');
        const hasCombined = combined.includes('Hook_JSEncrypt_SMcrypto');
        
        if (hasSM && hasJSE && !hasCombined) {
            // 同时存在两个独立脚本，且不存在合并脚本
            // 移除两个独立脚本
            const smIndex = combined.indexOf('Hook_SMcrypto');
            const jseIndex = combined.indexOf('Hook_JSEncrypt');
            
            // 从后往前删除，避免索引变化
            if (smIndex > jseIndex) {
                combined.splice(smIndex, 1);
                combined.splice(jseIndex, 1);
            } else {
                combined.splice(jseIndex, 1);
                combined.splice(smIndex, 1);
            }
            
            // 添加合并脚本
            combined.push('Hook_JSEncrypt_SMcrypto');
        } else if (!hasSM && !hasJSE && hasCombined) {
            // 两个独立脚本都不存在了，移除合并脚本
            const combinedIndex = combined.indexOf('Hook_JSEncrypt_SMcrypto');
            combined.splice(combinedIndex, 1);
        } else if ((hasSM && !hasJSE) || (!hasSM && hasJSE)) {
            // 只有一个独立脚本存在，需要移除合并脚本（如果有）
            const combinedIndex = combined.indexOf('Hook_JSEncrypt_SMcrypto');
            if (combinedIndex !== -1) {
                combined.splice(combinedIndex, 1);
            }
        }
        
        return combined;
    }

    // 🆕 统一的存储更新函数（支持全局模式）
    function updateStorage(enabled) {
        // 🆕 检测并合并脚本组合
        const scriptsToStore = combineCombinableScripts(enabled);

        // 更新合并Hooks数据（传入展开后的完整列表）
        updateMergedHooks(enabled);
        
        if (isGlobalMode) {
            // 全局模式：更新全局脚本列表
            globalEnabledScripts = [...scriptsToStore];
            chrome.storage.local.set({
                [GLOBAL_SCRIPTS_KEY]: scriptsToStore
            }, () => {
                // 通知后台更新脚本注册（全局模式）
                chrome.runtime.sendMessage({
                    type: 'update_scripts_registration',
                    hostname: '*',
                    enabledScripts: scriptsToStore,
                    isGlobalMode: true
                });

                // 通知标签页更新状态
                chrome.tabs.sendMessage(currentTab_obj.id, {
                    type: 'scripts_updated',
                    hostname: hostname,
                    enabledScripts: scriptsToStore
                });

                // 更新本地状态并重新渲染
                enabledScripts = enabled; // 保持UI状态为展开的
                renderCurrentTab();
            });
        } else {
            // 标准模式：更新当前域名配置
            chrome.storage.local.set({
                [hostname]: scriptsToStore
            }, () => {
                // 通知后台更新脚本注册（标准模式）
                chrome.runtime.sendMessage({
                    type: 'update_scripts_registration',
                    hostname: hostname,
                    enabledScripts: scriptsToStore,
                    isGlobalMode: false
                });

                // 通知标签页更新状态
                chrome.tabs.sendMessage(currentTab_obj.id, {
                    type: 'scripts_updated',
                    hostname: hostname,
                    enabledScripts: scriptsToStore
                });

                // 更新本地状态并重新渲染
                enabledScripts = enabled; // 保持UI状态为展开的
                renderCurrentTab();
            });
        }
    }
});
