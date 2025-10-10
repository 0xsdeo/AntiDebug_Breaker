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

    let currentTab = 'antidebug'; // 当前选中的标签
    let allScripts = []; // 所有脚本数据
    let enabledScripts = []; // 启用的脚本
    let hostname = '';
    let currentTab_obj = null;
    let cachedVueDataList = []; // 在popup中缓存所有Vue实例数据（改为数组）
    let currentInstanceIndex = 0; // 当前选中的实例索引

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

        // 加载脚本元数据
        fetch(chrome.runtime.getURL('scripts.json'))
            .then(response => response.json())
            .then(scripts => {
                allScripts = scripts;

                // 获取该域名下的启用状态
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
            if (description.length > 120) {
                description = description.substring(0, 120) + '...';
            }

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

        // 默认隐藏搜索框和底部按钮
        const routeBaseSwitch = document.querySelector('.route-base-switch');
        if (vueRouteSearchContainer) {
            vueRouteSearchContainer.style.display = 'none';
        }
        if (routesActionsFooter) {
            routesActionsFooter.style.display = 'none';
        }
        if (routeBaseSwitch) {
            routeBaseSwitch.style.display = 'none';
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
        let routerBase = vueRouterInfo.routerBase || '';
        const allRoutes = vueRouterInfo.routes;

        // ✅ 从当前标签页URL提取真实的baseUrl（包含子路径）
        if (currentTab_obj && currentTab_obj.url) {
            try {
                const currentUrl = currentTab_obj.url;
                if (routerMode === 'hash' && (currentUrl.includes('#/') || currentUrl.includes('#'))) {
                    const hashIndex = currentUrl.indexOf('#');
                    if (hashIndex > 0) {
                        // 提取 # 之前的完整路径作为baseUrl
                        baseUrl = currentUrl.substring(0, hashIndex);
                        // ✅ 清理尾部斜杠，避免双斜杠
                        if (baseUrl.endsWith('/')) {
                            baseUrl = baseUrl.slice(0, -1);
                        }
                    }
                }
            } catch (e) {
                console.warn('[AntiDebug] 提取baseUrl时出错:', e);
            }
        }

        // ✅ 清理和验证 routerBase
        let hasValidBase = false;
        let baseContainsHash = false; // 标记原始base是否包含#
        
        if (routerBase && routerBase.trim() !== '') {
            // 1. 如果是完整URL，忽略
            if (routerBase.startsWith('http://') || routerBase.startsWith('https://')) {
                console.warn('[AntiDebug] routerBase是完整URL，已忽略:', routerBase);
                routerBase = '';
            }
            // 2. 如果包含 #，记录并清理
            else if (routerBase.includes('#')) {
                console.warn('[AntiDebug] routerBase包含#符号:', routerBase);
                baseContainsHash = true;
                // 去掉 # 及其后面的内容，保留路径部分
                routerBase = routerBase.split('#')[0];
                // 清理尾部斜杠
                if (routerBase.endsWith('/')) {
                    routerBase = routerBase.slice(0, -1);
                }
            }
            // 3. 普通路径：清理尾部斜杠
            else {
                if (routerBase.endsWith('/')) {
                    routerBase = routerBase.slice(0, -1);
                }
            }
            
            // 4. 判断是否有效
            if (routerBase && routerBase !== '/') {
                hasValidBase = true;
            } else {
                routerBase = '';
                hasValidBase = false;
            }
        }

        // 检测到有效的 routerBase 时显示切换按钮
        // ✅ 从 localStorage 读取用户偏好（全局）
        let currentBaseMode = getBaseModePreference();
        
        if (hasValidBase) {
            routeBaseSwitch.style.display = 'flex';
            
            // 显示检测到的 base 路径（显示原始值，包含#）
            const baseValue = routeBaseSwitch.querySelector('.base-value');
            baseValue.textContent = baseContainsHash ? (routerBase + '#') : routerBase;
            
            // ✅ 恢复按钮激活状态
            const baseTabs = routeBaseSwitch.querySelectorAll('.route-base-tab');
            baseTabs.forEach(tab => {
                if (tab.dataset.mode === currentBaseMode) {
                    tab.classList.add('active');
                } else {
                    tab.classList.remove('active');
                }
            });
            
            // 绑定切换按钮事件
            baseTabs.forEach(tab => {
                tab.onclick = () => {
                    // 更新激活状态
                    baseTabs.forEach(t => t.classList.remove('active'));
                    tab.classList.add('active');
                    
                    // 更新当前模式
                    currentBaseMode = tab.dataset.mode;
                    
                    // ✅ 保存到 localStorage（全局）
                    setBaseModePreference(currentBaseMode);
                    
                    // 重新渲染路由列表（考虑搜索框内容）
                    const searchTerm = vueRouteSearchInput.value.toLowerCase().trim();
                    if (searchTerm) {
                        // 如果搜索框有内容，过滤后再渲染
                        const filteredRoutes = allRoutes.filter(route => {
                            const path = route.path.toLowerCase();
                            const name = (route.name || '').toLowerCase();
                            return path.includes(searchTerm) || name.includes(searchTerm);
                        });
                        renderRoutes(filteredRoutes);
                    } else {
                        // 搜索框为空，显示全部
                        renderRoutes(allRoutes);
                    }
                };
            });
        }
    
        // 渲染路由列表的函数
        const renderRoutes = (routesToShow) => {
            routesListContainer.innerHTML = '';

            routesToShow.forEach(route => {
                // 规范化路径
                const normalizedPath = normalizePath(route.path);
                
                // 根据路由模式拼接URL
                let fullUrl;
                
                if (hasValidBase && currentBaseMode === 'with-base') {
                    // 带基础路径模式
                    if (baseContainsHash) {
                        // base包含#：baseUrl + routerBase + # + normalizedPath
                        fullUrl = baseUrl + routerBase + '#' + normalizedPath;
                    } else {
                        // base不包含#：根据routerMode拼接
                        if (routerMode === 'hash') {
                            fullUrl = baseUrl + '/#' + routerBase + normalizedPath;
                        } else {
                            fullUrl = baseUrl + routerBase + normalizedPath;
                        }
                    }
                } else {
                    // 标准路径模式（不带base）
                    if (routerMode === 'hash') {
                        fullUrl = baseUrl + '/#' + normalizedPath;
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

        // 初始渲染所有路由
        renderRoutes(allRoutes);

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

        // 批量复制功能 - 根据当前模式复制
        copyAllPathsBtn.onclick = () => {
            const allPaths = allRoutes.map(route => {
                const normalizedPath = normalizePath(route.path);
                
                if (hasValidBase && currentBaseMode === 'with-base') {
                    if (baseContainsHash) {
                        return routerBase + '#' + normalizedPath;
                    } else {
                        return routerBase + normalizedPath;
                    }
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
                
                if (hasValidBase && currentBaseMode === 'with-base') {
                    // 带基础路径模式
                    if (baseContainsHash) {
                        // base包含#：baseUrl + routerBase + # + normalizedPath
                        fullUrl = baseUrl + routerBase + '#' + normalizedPath;
                    } else {
                        // base不包含#：根据routerMode拼接
                        if (routerMode === 'hash') {
                            fullUrl = baseUrl + '/#' + routerBase + normalizedPath;
                        } else {
                            fullUrl = baseUrl + routerBase + normalizedPath;
                        }
                    }
                } else {
                    // 标准路径模式（不带base）
                    if (routerMode === 'hash') {
                        fullUrl = baseUrl + '/#' + normalizedPath;
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

    // 处理反调试脚本开关切换
    function handleScriptToggle(scriptId, isChecked, scriptItem) {
        if (typeof scriptId !== 'string' || !scriptId.trim()) {
            console.error('Invalid script ID in change event:', scriptId);
            return;
        }

        chrome.storage.local.get([hostname], (result) => {
            let enabled = result[hostname] || [];

            if (isChecked) {
                if (!enabled.includes(scriptId)) {
                    enabled.push(scriptId);
                    scriptItem.classList.add('active');
                }
            } else {
                enabled = enabled.filter(id => id !== scriptId);
                scriptItem.classList.remove('active');
            }

            updateStorage(enabled);
        });
    }

    // 处理Vue脚本开关切换（含父子逻辑）
    function handleVueScriptToggle(script, isChecked) {
        chrome.storage.local.get([hostname], (result) => {
            let enabled = result[hostname] || [];

            // 如果是父脚本
            if (!script.parentScript) {
                if (isChecked) {
                    // 开启父脚本：添加父脚本ID
                    if (!enabled.includes(script.id)) {
                        enabled.push(script.id);
                    }
                } else {
                    // 关闭父脚本：同时移除父脚本和所有子脚本
                    const childScripts = allScripts.filter(s => s.parentScript === script.id);
                    enabled = enabled.filter(id => {
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
                    enabled = enabled.filter(id => id !== script.parentScript);
                    if (!enabled.includes(script.id)) {
                        enabled.push(script.id);
                    }
                } else {
                    // 关闭子脚本：移除子脚本，恢复父脚本
                    enabled = enabled.filter(id => id !== script.id);
                    if (!enabled.includes(script.parentScript)) {
                        enabled.push(script.parentScript);
                    }
                }
            }

            updateStorage(enabled);
        });
    }

    // 统一的存储更新函数
    function updateStorage(enabled) {
        chrome.storage.local.set({
            [hostname]: enabled
        }, () => {
            // 通知后台更新脚本注册
            chrome.runtime.sendMessage({
                type: 'update_scripts_registration',
                hostname: hostname,
                enabledScripts: enabled
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
});