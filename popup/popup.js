document.addEventListener('DOMContentLoaded', () => {
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
    const vueContent = document.querySelector('.vue-content');
    const vueScriptsList = document.querySelector('.vue-scripts-list');
    const vueRouterData = document.querySelector('.vue-router-data');
    const vueVersionDisplay = document.querySelector('.vue-version-display');
    const versionValue = document.querySelector('.version-value');
    const routesListContainer = document.querySelector('.routes-list-container');
    const noResults = document.querySelector('.no-results');
    const searchContainer = document.querySelector('.search-container');
    const searchInput = document.getElementById('search-input');
    const tabBtns = document.querySelectorAll('.tab-btn');
    const vueRouteSearchContainer = document.querySelector('.vue-route-search-container');
    const vueRouteSearchInput = document.getElementById('vue-route-search-input');
    const routesActionsFooter = document.querySelector('.routes-actions-footer');
    const copyAllPathsBtn = document.querySelector('.copy-all-paths-btn');
    const copyAllUrlsBtn = document.querySelector('.copy-all-urls-btn');

    // 🆕 全局模式相关DOM元素
    const globalModeToggle = document.getElementById('global-mode-toggle');
    const modeText = document.querySelector('.mode-text');

    let currentTab = 'antidebug'; // 当前选中的标签
    let allScripts = []; // 所有脚本数据
    let enabledScripts = []; // 启用的脚本
    let hostname = '';
    let currentTab_obj = null;
    let cachedVueDataList = []; // 在popup中缓存所有Vue实例数据（改为数组）
    let currentInstanceIndex = 0; // 当前选中的实例索引

    // 🆕 全局模式状态管理
    let isGlobalMode = false; // 当前是否为全局模式
    let globalEnabledScripts = []; // 全局模式下启用的脚本

    // 🆕 全局模式存储键名
    const GLOBAL_MODE_KEY = 'antidebug_mode';
    const GLOBAL_SCRIPTS_KEY = 'global_scripts';

    // 🆕 初始化全局模式状态
    function initializeGlobalMode() {
        chrome.storage.local.get([GLOBAL_MODE_KEY, GLOBAL_SCRIPTS_KEY], (result) => {
            // 获取模式状态，默认为标准模式
            const mode = result[GLOBAL_MODE_KEY] || 'standard';
            isGlobalMode = (mode === 'global');
            
            // 获取全局脚本列表，默认为空数组
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
            
            // 如果是全局模式，使用全局脚本列表
            if (isGlobalMode) {
                enabledScripts = [...globalEnabledScripts];
            }
        });
    }

    // 🆕 更新模式UI显示
    function updateModeUI() {
        globalModeToggle.checked = isGlobalMode;
        modeText.textContent = isGlobalMode ? '全局模式' : '标准模式';
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
            // 切换到全局模式
            enabledScripts = [...globalEnabledScripts];
        } else {
            // 切换到标准模式
            // 检查当前URL是否为web网站
            if (currentTab_obj && currentTab_obj.url && 
                (currentTab_obj.url.startsWith('http://') || currentTab_obj.url.startsWith('https://'))) {
                
                // 读取当前域名的脚本配置
                chrome.storage.local.get([hostname], (result) => {
                    if (result[hostname]) {
                        // 存在配置，使用该配置
                        enabledScripts = result[hostname] || [];
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
        chrome.runtime.sendMessage({
            type: 'update_scripts_registration',
            hostname: isGlobalMode ? '*' : hostname,
            enabledScripts: enabledScripts,
            isGlobalMode: isGlobalMode
        });
    }

    // 监听来自 background 的 Vue Router 数据更新
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
                        chrome.storage.local.get([hostname, 'last_active_tab'], (result) => {
                            enabledScripts = result[hostname] || [];

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

                            renderCurrentTab();

                            // 检查是否启用了 Get_Vue_0 或 Get_Vue_1 脚本
                            const hasVueScript = enabledScripts.includes('Get_Vue_0') ||
                                enabledScripts.includes('Get_Vue_1');

                            // 如果启用了Vue脚本，立即请求数据
                            if (hasVueScript) {
                                requestVueRouterData();
                            }
                        });
                        return [];
                    }
                };

                // 延迟获取脚本，确保模式状态已初始化
                setTimeout(() => {
                    if (isGlobalMode) {
                        // 🔧 修复：全局模式下也需要恢复上次打开的板块
                        chrome.storage.local.get(['last_active_tab'], (result) => {
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
                            
                            enabledScripts = [...globalEnabledScripts];
                            renderCurrentTab();
                            
                            // 检查Vue脚本
                            const hasVueScript = enabledScripts.includes('Get_Vue_0') ||
                                enabledScripts.includes('Get_Vue_1');
                            if (hasVueScript) {
                                requestVueRouterData();
                            }
                        });
                    } else {
                        getInitialScripts();
                    }
                }, 100);

                // 搜索功能
                searchInput.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    const filteredScripts = getScriptsForCurrentTab().filter(script =>
                        script.name.toLowerCase().includes(searchTerm) ||
                        script.description.toLowerCase().includes(searchTerm)
                    );

                    if (currentTab === 'antidebug') {
                        renderAntiDebugScripts(filteredScripts);
                    }
                });
            });
    });

    // 🆕 全局模式开关事件监听
    globalModeToggle.addEventListener('change', (e) => {
        handleModeToggle(e.target.checked);
    });

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

    // 根据当前标签获取要显示的脚本
    function getScriptsForCurrentTab() {
        return allScripts.filter(script => script.category === currentTab);
    }

    // 渲染当前标签的内容
    function renderCurrentTab() {
        const scriptsToShow = getScriptsForCurrentTab();

        if (currentTab === 'antidebug') {
            // 显示反调试板块
            searchContainer.style.display = 'flex';
            scriptsGrid.style.display = 'grid';
            vueContent.style.display = 'none';
            renderAntiDebugScripts(scriptsToShow);
        } else if (currentTab === 'vue') {
            // 显示Vue板块
            searchContainer.style.display = 'none';
            scriptsGrid.style.display = 'none';
            vueContent.style.display = 'flex';
            renderVueScripts(scriptsToShow);
            // 使用缓存的数据显示（改为多实例显示）
            displayMultipleInstances();
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
                    <div class="script-description">${description}</div>
                </div>
            `;

            scriptsGrid.appendChild(scriptItem);

            const checkbox = scriptItem.querySelector('input[type="checkbox"]');
            checkbox.addEventListener('change', (e) => {
                handleScriptToggle(script.id, e.target.checked, scriptItem);
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

            // ✅ 从storage读取该域名的自定义base
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
                    chrome.tabs.update(currentTab_obj.id, {
                        url: fullUrl
                    });
                });
            });
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

    // 🆕 统一的存储更新函数（支持全局模式）
    function updateStorage(enabled) {
        if (isGlobalMode) {
            // 全局模式：更新全局脚本列表
            globalEnabledScripts = [...enabled];
            chrome.storage.local.set({
                [GLOBAL_SCRIPTS_KEY]: globalEnabledScripts
            }, () => {
                // 通知后台更新脚本注册（全局模式）
                chrome.runtime.sendMessage({
                    type: 'update_scripts_registration',
                    hostname: '*',
                    enabledScripts: enabled,
                    isGlobalMode: true
                });

                // 通知标签页更新状态
                chrome.tabs.sendMessage(currentTab_obj.id, {
                    type: 'scripts_updated',
                    hostname: hostname,
                    enabledScripts: enabled
                });

                // 更新本地状态并重新渲染
                enabledScripts = enabled;
                renderCurrentTab();
            });
        } else {
            // 标准模式：更新当前域名配置
            chrome.storage.local.set({
                [hostname]: enabled
            }, () => {
                // 通知后台更新脚本注册（标准模式）
                chrome.runtime.sendMessage({
                    type: 'update_scripts_registration',
                    hostname: hostname,
                    enabledScripts: enabled,
                    isGlobalMode: false
                });

                // 通知标签页更新状态
                chrome.tabs.sendMessage(currentTab_obj.id, {
                    type: 'scripts_updated',
                    hostname: hostname,
                    enabledScripts: enabled
                });

                // 更新本地状态并重新渲染
                enabledScripts = enabled;
                renderCurrentTab();
            });
        }
    }
});
