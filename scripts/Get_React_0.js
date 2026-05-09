// ==UserScript==
// @name         Get_React
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      v0.1
// @description  获取 React Router 路由
// @author       0xsdeo
// @run-at       document-start
// @match        *://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ===== 全局执行锁，防止脚本重复运行 =====
    const LOCK_KEY = '__REACT_GETTER_RUNNING__';
    if (window[LOCK_KEY]) {
        console.warn('[AntiDebug] React 路由获取脚本已在运行，跳过本次执行');
        return;
    }
    try {
        Object.defineProperty(window, LOCK_KEY, {
            value: true,
            writable: false,
            configurable: false
        });
    } catch (e) {
        console.warn('[AntiDebug] 无法设置执行锁，脚本可能已在运行');
        return;
    }

    let observer = null;
    let allTimeoutIds = [];
    let hasOutputResult = false;
    let scanFinalized = false;
    let firstResultAt = 0;
    let stableScanCount = 0;
    let lastResultSignature = '';
    let scanRound = 0;
    let nextRootId = 1;
    const rootObjectIds = new WeakMap();
    const rootPrimitiveIds = new Map();
    const knownReactContainerKeys = [];
    const knownReactHostFiberKeys = [];
    let printedReactInstances = new WeakSet();
    let printedReactInstanceKeys = new Set();
    let cachedResult = null; // 缓存找到的路由数据，供 REQUEST 时复用

    // ===== 站点特定标志 =====
    const IS_GITHUB = window.location.hostname === 'github.com';
    const REACT_CONTEXT_TYPE = Symbol.for('react.context');
    const REACT_CONSUMER_TYPE = Symbol.for('react.consumer');
    const REACT_PROVIDER_TYPE = Symbol.for('react.provider');
    const REACT_MEMO_TYPE = Symbol.for('react.memo');
    const REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref');
    const ROUTER_FIBER_SCAN_MAX_NODES = 15000;
    const ROUTER_NESTED_SEARCH_DEPTH = 10;
    const CREATE_HREF_SEARCH_DEPTH = ROUTER_NESTED_SEARCH_DEPTH;
    const RESULT_COMPLETION_WINDOW_MS = 3500;
    const STABLE_SCAN_LIMIT = 3;
    const HOST_FIBER_FALLBACK_DELAY_MS = 900;
    const VERBOSE_REACT_ROUTER_LOGS = Boolean(window.__ANTIDEBUG_REACT_ROUTER_DEBUG__);

    function debugLog() {
        if (!VERBOSE_REACT_ROUTER_LOGS) return;
        console.log.apply(console, arguments);
    }

    function debugWarn() {
        if (!VERBOSE_REACT_ROUTER_LOGS) return;
        console.warn.apply(console, arguments);
    }

    function debugTable(rows) {
        if (!VERBOSE_REACT_ROUTER_LOGS) return;
        if (typeof console.table === 'function') {
            console.table(rows);
        } else {
            console.log(rows);
        }
    }

    function hasOwn(obj, key) {
        return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
    }

    function rememberReactDomKey(cache, key) {
        if (key && cache.indexOf(key) === -1) {
            cache.push(key);
        }
    }

    function findReactDomKey(node, knownKeys, matcher, fixedKeys) {
        if (!node || node.nodeType !== 1) return '';

        for (let i = 0; i < knownKeys.length; i++) {
            const key = knownKeys[i];
            if (hasOwn(node, key) && node[key]) return key;
        }

        if (Array.isArray(fixedKeys)) {
            for (let i = 0; i < fixedKeys.length; i++) {
                const key = fixedKeys[i];
                if (hasOwn(node, key) && node[key]) {
                    rememberReactDomKey(knownKeys, key);
                    return key;
                }
            }
        }

        const keys = Object.keys(node);
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (matcher(key) && node[key]) {
                rememberReactDomKey(knownKeys, key);
                return key;
            }
        }

        return '';
    }

    // ===== 发送数据到插件 =====
    function sendToExtension(data) {
        try {
            window.postMessage({
                type: 'REACT_ROUTER_DATA',
                source: 'get-react-script',
                data: data
            }, '*');
        } catch (error) {
            if (error.name === 'DataCloneError' || error.message.includes('could not be cloned')) {
                console.error('[AntiDebug] 路由数据包含不可序列化的对象，无法传递给插件');
                try {
                    window.postMessage({
                        type: 'REACT_ROUTER_DATA',
                        source: 'get-react-script',
                        data: {
                            serializationError: true,
                            errorType: 'DataCloneError',
                            errorMessage: '路由数据包含不可序列化的对象，请查看控制台输出'
                        }
                    }, '*');
                } catch (e) {}
            } else {
                console.error('[AntiDebug] postMessage 发送失败:', error);
            }
        }
    }

    // ===== 重新扫描 =====
    function restartScanning() {
        console.log('[AntiDebug] 开始重新扫描 React Router...');
        allTimeoutIds.forEach(id => clearTimeout(id));
        allTimeoutIds = [];
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        hasOutputResult = false;
        scanFinalized = false;
        firstResultAt = 0;
        stableScanCount = 0;
        lastResultSignature = '';
        scanRound = 0;
        cachedResult = null;
        printedReactInstances = new WeakSet();
        printedReactInstanceKeys = new Set();
        startDOMObserver();
        startPollingRetry();
    }

    // ===== 监听插件请求：popup 打开时拉取缓存数据或触发重扫描 =====
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'antidebug-extension') return;

        if (event.data.type === 'MANUAL_RESCAN_REACT') {
            restartScanning();
            return;
        }

        if (event.data.type === 'REQUEST_REACT_ROUTER_DATA') {
            if (cachedResult) {
                sendToExtension(cachedResult);
            } else {
                sendToExtension({
                    notFound: true
                });
            }
        }
    });

    // ===== 工具函数：路径拼接 =====
    function joinPath(base, path) {
        if (path === undefined || path === null || path === '') return base || '/';
        if (typeof path !== 'string') return base || '/';
        if (path.startsWith('/')) return path;
        if (!base || base === '/') return '/' + path;
        const cleanBase = base.endsWith('/') ? base.slice(0, -1) : base;
        return cleanBase + '/' + path;
    }

    // ===== Phase 1: DOM BFS 扫描，寻找 React 挂载节点 =====
    // React 调用 createRoot(domNode) 或 ReactDOM.render() 后，
    // 会在挂载 DOM 节点上注入带随机后缀的内部属性。
    function findReactContainers() {
        if (!document.body) return [];

        const results = [];
        const queue = [document.body];
        const visited = new Set();

        while (queue.length > 0) {
            const node = queue.shift();
            if (!node || visited.has(node)) continue;
            visited.add(node);
            if (node.nodeType !== 1) continue; // 只处理元素节点

            // 使用自身属性检测 React 内部挂载 key，避免枚举 DOM 原型链。
            // React 18 createRoot: __reactContainer$<randomKey>
            // 某些版本:            __reactContainere$<randomKey>（多一个 e）
            // React 17 render:     _reactRootContainer
            const prop = findReactDomKey(
                node,
                knownReactContainerKeys,
                key => key.startsWith('__reactContainer$') || key.startsWith('__reactContainere$'),
                ['_reactRootContainer']
            );
            if (prop) {
                results.push({
                    node,
                    prop,
                    value: node[prop]
                });
            }

            for (let i = 0; i < node.childNodes.length; i++) {
                queue.push(node.childNodes[i]);
            }
        }

        if (results.length > 0) {
            results.forEach(r => debugLog(`[AntiDebug] 检测到 React 挂载节点：${r.prop} on`, r.node));
        }
        return results;
    }

    // ===== 从容器信息中取得 Fiber 树的起始节点 =====
    // 注意：__reactContainer$xxx 返回的是 HostRoot Fiber 本身，不是 FiberRoot。
    // React 源码中 markContainerAsRoot(root.current, container) 传入的是 root.current。
    //
    // 因此直接取 .child 可得到第一个真实组件 Fiber。
    // 不能取 .current.child；.current 是 FiberRoot 的属性，不是 Fiber 节点的属性。
    function getStartFiber(containerInfo) {
        try {
            if (containerInfo.prop === '_reactRootContainer') {
                // React 版本差异会导致结构不同，需要两种路径都尝试。
                //
                // 方式 A：React 17 常见结构。
                //   _reactRootContainer = { _internalRoot: FiberRoot }
                //   FiberRoot.current = HostRoot Fiber
                //   HostRoot Fiber.child = 第一个组件 Fiber
                const fiberA = containerInfo.value ?._internalRoot ?.current ?.child;
                if (fiberA) {
                    debugLog('[AntiDebug] _reactRootContainer（方式 A: _internalRoot）startFiber:', fiberA);
                    return fiberA;
                }

                // 方式 B：旧版 React / 某些构建中直接带 .current。
                //   _reactRootContainer = FiberRoot（直接带 .current）
                //   FiberRoot.current = HostRoot Fiber
                //   HostRoot Fiber.child = 第一个组件 Fiber
                const fiberB = containerInfo.value ?.current ?.child;
                if (fiberB) {
                    debugLog('[AntiDebug] _reactRootContainer（方式 B: direct current）startFiber:', fiberB);
                    return fiberB;
                }

                debugWarn('[AntiDebug] _reactRootContainer 结构未识别:', containerInfo.value);
                return null;
            }

            // React 18: __reactContainer$xxx = HostRoot Fiber，不是 FiberRoot。
            //
            // 关键：__reactContainer$xxx 只在 createRoot 时赋值一次。
            // render 提交后 React 会交换双缓冲区，FiberRoot.current 始终指向最新提交树。
            // 而 __reactContainer$xxx 原本指向的 fiber 可能已经变成 alternate，.child 可能为 null。
            //
            // 正确路径：stateNode -> FiberRoot -> current -> HostRoot -> child。
            const fiberRoot = containerInfo.value ?.stateNode;
            const fiberA = fiberRoot ?.current ?.child;
            if (fiberA) {
                debugLog('[AntiDebug] React 18 startFiber（via stateNode.current）:', fiberA);
                return fiberA;
            }
            // 兜底：直接取 .child，少数情况下 alternate 上也有数据。
            const fiberB = containerInfo.value ?.child || null;
            debugLog('[AntiDebug] React 18 startFiber（via direct child）:', fiberB);
            return fiberB;
        } catch (e) {
            debugWarn('[AntiDebug] getStartFiber 出错:', e);
            return null;
        }
    }

    // ===== RouterProvider 模式检测（v6 data router）=====
    // 对应 React Router v6 的 createBrowserRouter + <RouterProvider router={router} />。
    // v6 data router 有专属的 navigate / subscribe 方法，v3/v4 router 没有。
    // 不依赖 React DevTools hook，只扫描 DOM 节点上的 __reactFiber$ / __reactInternalInstance$ 作为兜底入口。
    function findReactHostFibers() {
        if (!document.body && !document.documentElement) return [];

        const results = [];
        const seenFibers = new WeakSet();
        const queue = [];
        const visited = new Set();
        if (document.body) queue.push(document.body);
        if (document.documentElement && document.documentElement !== document.body) {
            queue.push(document.documentElement);
        }

        while (queue.length > 0) {
            const node = queue.shift();
            if (!node || visited.has(node)) continue;
            visited.add(node);

            if (node.nodeType === 1) {
                const prop = findReactDomKey(
                    node,
                    knownReactHostFiberKeys,
                    key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')
                );
                if (prop) {
                    const fiber = node[prop];
                    if (fiber && typeof fiber === 'object' && !seenFibers.has(fiber)) {
                        seenFibers.add(fiber);
                        results.push({
                            node,
                            prop,
                            fiber
                        });
                    }
                }
            }

            if (node.shadowRoot) queue.push(node.shadowRoot);
            if (node.childNodes) {
                for (let i = 0; i < node.childNodes.length; i++) {
                    queue.push(node.childNodes[i]);
                }
            }
        }

        if (results.length > 0) {
            debugLog(`[AntiDebug] 检测到 ${results.length} 个 React Host Fiber 节点`);
        }
        return results;
    }

    function getStartFiberFromHostFiber(fiber) {
        if (!fiber || typeof fiber !== 'object') return null;

        try {
            if (fiber._currentElement || fiber._renderedChildren || fiber._renderedComponent) {
                let current = fiber;
                let highest = fiber;
                let depth = 0;
                while (current && current._hostParent && depth < 10000) {
                    current = current._hostParent;
                    highest = current;
                    depth++;
                }
                return highest || fiber;
            }

            const fiberRoot = fiber.stateNode && fiber.stateNode.current ? fiber.stateNode : null;
            if (fiberRoot && fiberRoot.current && fiberRoot.current.child) {
                return fiberRoot.current.child;
            }

            let current = fiber;
            let highest = fiber;
            let depth = 0;
            while (current && current.return && depth < 10000) {
                current = current.return;
                highest = current;
                if (current.tag === 3) break; // HostRoot
                depth++;
            }

            if (current && current.tag === 3) {
                const latestHostRoot = current.stateNode && current.stateNode.current ? current.stateNode.current : current;
                if (latestHostRoot && latestHostRoot.child) return latestHostRoot.child;
                if (current.child) return current.child;
            }

            return highest || fiber;
        } catch (e) {
            debugWarn('[AntiDebug] getStartFiberFromHostFiber 出错:', e);
            return null;
        }
    }

    function getLegacyReactInstanceChildren(instance) {
        const children = [];
        if (!instance || typeof instance !== 'object') return children;

        const pushChild = (child) => {
            if (child && typeof child === 'object') children.push(child);
        };

        pushChild(instance._renderedComponent);
        pushChild(instance._renderedNode);

        const renderedChildren = instance._renderedChildren;
        if (renderedChildren && typeof renderedChildren === 'object') {
            if (Array.isArray(renderedChildren)) {
                renderedChildren.forEach(pushChild);
            } else {
                Object.keys(renderedChildren).forEach(key => pushChild(renderedChildren[key]));
            }
        }

        const renderedChildrenArray = instance._renderedChildrenArray;
        if (Array.isArray(renderedChildrenArray)) {
            renderedChildrenArray.forEach(pushChild);
        }

        return children;
    }

    function getDomPath(node) {
        if (!node || node.nodeType !== 1) return '';

        try {
            if (node.id) {
                return `document.getElementById(${JSON.stringify(String(node.id))})`;
            }
        } catch (e) {}

        const parts = [];
        let current = node;
        while (current && current.nodeType === 1 && current !== document.documentElement) {
            let tag = current.tagName ? current.tagName.toLowerCase() : 'element';
            let index = 1;
            let sibling = current.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === current.tagName) index++;
                sibling = sibling.previousElementSibling;
            }
            parts.unshift(`${tag}:nth-of-type(${index})`);
            current = current.parentElement;
        }

        if (!parts.length) return 'document.documentElement';
        return `document.querySelector(${JSON.stringify(parts.join(' > '))})`;
    }

    function getReactRootIdentity(fiber) {
        if (!fiber || typeof fiber !== 'object') return null;

        try {
            if (fiber.stateNode && fiber.stateNode.current) {
                return fiber.stateNode;
            }

            if (fiber.tag === 3) {
                return fiber.stateNode || fiber;
            }

            let current = fiber;
            let depth = 0;
            while (current && current.return && depth < 10000) {
                current = current.return;
                if (current.tag === 3) {
                    return current.stateNode || current;
                }
                depth++;
            }

            current = fiber;
            depth = 0;
            while (current && current._hostParent && depth < 10000) {
                current = current._hostParent;
                depth++;
            }
            if (current && current !== fiber) return current;

        } catch (e) {}

        return null;
    }

    function printReactInstances(records) {
        if (!VERBOSE_REACT_ROUTER_LOGS) return;
        const newRecords = records.filter(record => {
            if (!record.startFiber) return false;
            const identity = record.rootIdentity || getReactRootIdentity(record.startFiber);
            if (identity && typeof identity === 'object') {
                if (printedReactInstances.has(identity)) return false;
                printedReactInstances.add(identity);
            } else {
                const key = `${record.containerPath || ''}:${record.source || ''}`;
                if (printedReactInstanceKeys.has(key)) return false;
                printedReactInstanceKeys.add(key);
            }
            return true;
        });
        if (newRecords.length === 0) return;

        const title = `[AntiDebug] React 实例列表（${newRecords.length} 个）`;
        if (typeof console.groupCollapsed === 'function') {
            console.groupCollapsed(title);
        } else {
            console.log(title);
        }

        newRecords.forEach((record, index) => {
            const displayName = getFiberDisplayName(record.startFiber) || '(unknown)';
            console.log(
                `[AntiDebug] React 实例 #${index + 1} 来源=${record.source} 入口组件=${displayName}`,
                record.startFiber
            );
            if (record.rawFiber && record.rawFiber !== record.startFiber) {
                console.log(`[AntiDebug] React 实例 #${index + 1} 原始 Host Fiber:`, record.rawFiber);
            }
        });

        if (typeof console.groupEnd === 'function') {
            console.groupEnd();
        }
    }

    function getReactStartFibers(options) {
        options = options || {};
        const includeHostFibers = options.includeHostFibers !== false;
        const startFibers = [];
        const records = [];
        const seen = new WeakSet();

        const addStartFiber = (startFiber, source, rawFiber, containerPath) => {
            if (!startFiber || typeof startFiber !== 'object' || seen.has(startFiber)) return;
            seen.add(startFiber);
            startFibers.push(startFiber);
            records.push({
                source,
                containerPath: containerPath || '',
                rawFiber,
                startFiber,
                rootIdentity: getReactRootIdentity(startFiber)
            });
        };

        const getContainerRootFibers = containerInfo => {
            const roots = [];
            const addRoot = fiber => {
                if (fiber && typeof fiber === 'object' && !roots.includes(fiber)) {
                    roots.push(fiber);
                }
            };

            try {
                if (!containerInfo || !containerInfo.value) return roots;

                if (containerInfo.prop === '_reactRootContainer') {
                    addRoot(containerInfo.value ?._internalRoot ?.current);
                    addRoot(containerInfo.value ?.current);
                    return roots;
                }

                addRoot(containerInfo.value ?.stateNode ?.current);
                addRoot(containerInfo.value);
            } catch (e) {}

            return roots;
        };

        const containers = findReactContainers();
        for (const container of containers) {
            const containerPath = getDomPath(container.node);
            addStartFiber(getStartFiber(container), container.prop, container.value, containerPath);
            getContainerRootFibers(container).forEach(rootFiber => {
                addStartFiber(rootFiber, `${container.prop}.root`, container.value, containerPath);
            });
        }

        if (includeHostFibers) {
            const hostFibers = findReactHostFibers();
            for (const item of hostFibers) {
                const hostPath = getDomPath(item.node);
                addStartFiber(getStartFiberFromHostFiber(item.fiber), item.prop, item.fiber, hostPath);
                if (hasLikelyRouteDataNearFiber(item.fiber)) {
                    addStartFiber(item.fiber, `${item.prop}.local`, item.fiber, hostPath);
                }
                if (item.fiber && item.fiber.alternate) {
                    addStartFiber(getStartFiberFromHostFiber(item.fiber.alternate), `${item.prop}.alternate`, item.fiber.alternate, hostPath);
                    if (hasLikelyRouteDataNearFiber(item.fiber.alternate)) {
                        addStartFiber(item.fiber.alternate, `${item.prop}.alternate.local`, item.fiber.alternate, hostPath);
                    }
                }
            }
        }

        printReactInstances(records);
        startFibers._records = records;
        return startFibers;
    }

    function isRouterProvider(props) {
        if (!props || typeof props !== 'object') return false;
        const router = props.router;
        if (!router || typeof router !== 'object') return false;
        if (!Array.isArray(router.routes)) return false;
        // v6 data router 必有 navigate 方法；v3/v4 router 通常使用 push/transitionTo。
        // 这是区分两类 router 的可靠特征。
        if (typeof router.navigate !== 'function') return false;
        if (router.routes.length === 0) return true;
        return router.routes.some(r =>
            r && typeof r === 'object' && ('path' in r || 'children' in r || 'id' in r)
        );
    }

    // ===== 判断一个 router 对象是否为 v3/v4 style（history-like）=====
    function isLegacyRouterObject(router) {
        if (!router || typeof router !== 'object') return false;
        if (!Array.isArray(router.routes) || router.routes.length === 0) return false;
        // v3/v4 router 的专属方法。
        if (typeof router.getCurrentLocation === 'function' ||
            typeof router.transitionTo === 'function' ||
            typeof router.listenBefore === 'function') {
            return true;
        }
        // 或 routes 数组中包含 v3/v4 专有字段。
        return router.routes.some(r =>
            r && typeof r === 'object' && ('childRoutes' in r || 'getComponent' in r || 'indexRoute' in r)
        );
    }

    // ===== React Router v3/v4 Legacy 模式检测 =====
    // 两种常见存放位置：
    //   1. props.routes（直接是路由数组）
    //   2. props.router.routes（routes 挂在 history-like router 对象上）
    function isLegacyRouterRoutes(props) {
        if (!props || typeof props !== 'object') return false;

        // Case 1: props.routes 直接是路由数组。
        if (Array.isArray(props.routes) && props.routes.length > 0) {
            if (props.routes.some(r =>
                    r && typeof r === 'object' && 'path' in r &&
                    ('component' in r || 'getComponent' in r || 'childRoutes' in r || 'indexRoute' in r)
                )) return true;
        }

        // Case 2: props.router 是 v3/v4 history-like router，routes 在其中。
        if (isLegacyRouterObject(props.router)) return true;

        return false;
    }

    // ===== 从检测到的 props 中提取 v3/v4 routes 数组 =====
    function getLegacyRoutes(props) {
        if (Array.isArray(props.routes) && props.routes.length > 0) return props.routes;
        if (isLegacyRouterObject(props.router)) return props.router.routes;
        return [];
    }

    function isRouteConfigArray(routes) {
        if (!Array.isArray(routes) || routes.length === 0) return false;

        let checked = 0;
        let routeLike = 0;
        for (const route of routes) {
            if (!route || typeof route !== 'object') continue;
            checked++;
            if (
                typeof route.path === 'string' &&
                (
                    route.element !== undefined ||
                    route.component !== undefined ||
                    route.Component !== undefined ||
                    route.render !== undefined ||
                    route.lazy !== undefined ||
                    Array.isArray(route.children) ||
                    route.meta !== undefined ||
                    route.index === true
                )
            ) {
                routeLike++;
            }
            if (checked >= 20) break;
        }

        return routeLike > 0 && routeLike >= Math.ceil(checked * 0.5);
    }

    function getRouteConfigArrayFromObject(value) {
        if (!value || typeof value !== 'object') return null;
        try {
            if (isRouteConfigArray(value.routeConfig)) return value.routeConfig;
        } catch (e) {}
        try {
            if (value.routeRelatedConfig && isRouteConfigArray(value.routeRelatedConfig.routeConfig)) {
                return value.routeRelatedConfig.routeConfig;
            }
        } catch (e) {}
        return null;
    }

    function isRouteConfigRoutes(props) {
        return !!getRouteConfigArrayFromObject(props);
    }

    // ===== GitHub 专属路由检测 =====
    // GitHub 使用自研路由层，路由对象中常见 Component（大写）和 GitHub 专属字段，
    // 而不是标准 React Router 的 component / getComponent / childRoutes。
    function isGitHubRoutes(props) {
        if (!IS_GITHUB) return false;
        if (!props || typeof props !== 'object') return false;
        if (!Array.isArray(props.routes) || props.routes.length === 0) return false;
        return props.routes.some(r =>
            r && typeof r === 'object' &&
            typeof r.path === 'string' &&
            ('Component' in r || 'coreLoader' in r || 'loadFromEmbeddedData' in r)
        );
    }

    function extractGitHubRoutes(rawRoutes) {
        return rawRoutes
            .filter(r => r && typeof r === 'object' && typeof r.path === 'string')
            .map(r => ({
                name: typeof r.id === 'string' ? r.id : '',
                path: r.path
            }));
    }

    function getContextDisplayName(context) {
        if (!context || typeof context !== 'object') return 'Context';
        return context.displayName || 'Context';
    }

    function getComponentDisplayName(type) {
        if (!type) return '';
        if (typeof type === 'string') return type;
        if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
        if (typeof type === 'symbol') return String(type).replace(/^Symbol\((.*)\)$/, '$1');
        if (typeof type !== 'object') return '';
        if (typeof type.displayName === 'string' && type.displayName) return type.displayName;

        const reactType = type.$$typeof;
        if (reactType === REACT_MEMO_TYPE) return getComponentDisplayName(type.type) || 'Anonymous Memo';
        if (reactType === REACT_FORWARD_REF_TYPE) return `${getComponentDisplayName(type.render) || 'Anonymous'} ForwardRef`;
        if (reactType === REACT_CONTEXT_TYPE) return `${getContextDisplayName(type)}.Provider`;
        if (reactType === REACT_PROVIDER_TYPE) return `${getContextDisplayName(type._context || type)}.Provider`;
        if (reactType === REACT_CONSUMER_TYPE) return `${getContextDisplayName(type._context || type)}.Consumer`;
        return '';
    }

    function getFiberDisplayName(fiber) {
        if (!fiber || typeof fiber !== 'object') return '';
        return getComponentDisplayName(fiber.elementType) ||
            getComponentDisplayName(fiber.type) ||
            getComponentDisplayName(fiber._debugOwner && fiber._debugOwner.type);
    }

    function isRouterRelatedName(name) {
        return typeof name === 'string' && /router|route/i.test(name);
    }

    function detectRouterFromContextValue(value, allowLooseRoutes) {
        if (!value || typeof value !== 'object') return null;

        if (isRouterProvider({ router: value })) {
            return {
                type: 'RouterProvider',
                router: value
            };
        }
        if (isRouterProvider({ router: value.router })) {
            return {
                type: 'RouterProvider',
                router: value.router
            };
        }
        if (isLegacyRouterObject(value)) {
            return {
                type: 'LegacyRoutes',
                routes: value.routes
            };
        }
        if (isLegacyRouterObject(value.router)) {
            return {
                type: 'LegacyRoutes',
                routes: value.router.routes
            };
        }
        if (isGitHubRoutes(value)) {
            return {
                type: 'GitHubRoutes',
                routes: value.routes
            };
        }
        if (allowLooseRoutes && Array.isArray(value.routes) && value.routes.length > 0) {
            const hasRouteShape = value.routes.some(route =>
                route && typeof route === 'object' && ('path' in route || 'children' in route || 'id' in route)
            );
            if (hasRouteShape) {
                return {
                    type: 'ContextRoutes',
                    routes: value.routes
                };
            }
        }
        if (isRouteConfigRoutes(value)) {
            return {
                type: 'ContextRoutes',
                routes: getRouteConfigArrayFromObject(value)
            };
        }
        if (value.value && value.value !== value && typeof value.value === 'object') {
            return detectRouterFromContextValue(value.value, allowLooseRoutes);
        }
        return null;
    }

    function searchRouterInFiberContext(fiber) {
        const displayName = getFiberDisplayName(fiber);
        const allowLooseRoutes = isRouterRelatedName(displayName);
        const fibersToCheck = [fiber];
        if (fiber && fiber.alternate && fiber.alternate !== fiber) fibersToCheck.push(fiber.alternate);

        for (const currentFiber of fibersToCheck) {
            if (!currentFiber || typeof currentFiber !== 'object') continue;

            const dependencySources = [
                currentFiber.dependencies,
                currentFiber.dependencies_old,
                currentFiber.dependencies_new,
                currentFiber.contextDependencies
            ];

            for (const deps of dependencySources) {
                if (!deps) continue;
                let ctx = deps.firstContext || deps.first || null;
                while (ctx) {
                    const result = detectRouterFromContextValue(ctx.memoizedValue, allowLooseRoutes);
                    if (result) {
                        result.contextDisplayName = displayName;
                        return result;
                    }
                    ctx = ctx.next;
                }
            }
        }

        return null;
    }

    // ===== 提取 React Router 基础路径（basename）=====
    // RouterProvider 模式：优先读取 result.router.basename。
    // JSX / Legacy 模式：遍历 Fiber 依赖上下文链，寻找带 basename 的 React Context 值。
    function extractReactRouterBasename(startFiber, result) {
        // RouterProvider 或嵌套搜索命中的 RouterProvider：直接访问 router.basename。
        if (result.router) {
            try {
                const bn = result.router.basename;
                if (typeof bn === 'string' && bn !== '/' && bn.trim() !== '') return bn;
            } catch (e) {}
        }

        function readBasenameFromObject(value) {
            if (!value || typeof value !== 'object') return '';
            try {
                const bn = value.basename;
                if (typeof bn === 'string' && bn !== '/' && bn.trim() !== '') return bn;
            } catch (e) {}
            return '';
        }

        // JSX Routes / Legacy：走 Fiber 依赖上下文链。
        // 路径示例：fiber.dependencies.firstContext.next.memoizedValue.basename。
        if (!startFiber) return '';
        const queue = [startFiber];
        const visited = new WeakSet();
        let count = 0;
        while (queue.length > 0 && count < 200) {
            const fiber = queue.shift();
            count++;
            if (!fiber || typeof fiber !== 'object' || visited.has(fiber)) continue;
            visited.add(fiber);

            try {
                const basenameSources = [
                    fiber.memoizedProps,
                    fiber.pendingProps,
                    fiber.props,
                    fiber.memoizedState && fiber.memoizedState.element && fiber.memoizedState.element.props,
                    fiber.stateNode && fiber.stateNode.props,
                    fiber.stateNode
                ];

                const alt = fiber.alternate;
                if (alt && alt !== fiber) {
                    basenameSources.push(
                        alt.memoizedProps,
                        alt.pendingProps,
                        alt.props,
                        alt.memoizedState && alt.memoizedState.element && alt.memoizedState.element.props,
                        alt.stateNode && alt.stateNode.props,
                        alt.stateNode
                    );
                }

                for (const source of basenameSources) {
                    const bn = readBasenameFromObject(source);
                    if (bn) return bn;
                }

                if (fiber.dependencies) {
                    let ctx = fiber.dependencies.firstContext;
                    while (ctx) {
                        const val = ctx.memoizedValue;
                        const bn = readBasenameFromObject(val);
                        if (bn) return bn;
                        ctx = ctx.next;
                    }
                }
            } catch (e) {}
            if (fiber.child) queue.push(fiber.child);
        }
        return '';
    }

    // ===== JSX <Routes>/<Route> 模式检测 =====
    // 对应 React Router v5/v6 的 JSX 写法：<Routes><Route path="/" element={...} /></Routes>。
    // 路由信息分散在各个 React Element 的 props 中。
    //
    // 注意：这里使用较宽松的 OR 逻辑，而不是严格的 AND 逻辑。
    // 原因：v6 支持多种合法 Route 写法：
    //   1. path-only：<Route path="/about" />
    //   2. lazy：<Route path="/home" lazy={() => import('./Home')} />
    //   3. layout route：<Route element={<Layout/>}>，无 path，包裹子路由
    //   4. index route：<Route index element={<Home/>} />，无 path
    // 严格要求 path + element/component 会误杀这些合法情况。
    // 潜在假阳性由两阶段策略兜底：JSX Routes 仅保存为候选，
    // LegacyRoutes / RouterProvider 命中时优先立即返回。
    function isRouteElement(el) {
        if (!el || typeof el !== 'object') return false;
        const p = el.props;
        if (!p || typeof p !== 'object') return false;
        return (
            typeof p.path === 'string' ||
            // React Router v5 支持 path 为数组：<Route path={['/login', '/signup']} />
            (Array.isArray(p.path) && p.path.length > 0) ||
            p.index === true ||
            p.element !== undefined ||
            typeof p.component === 'function' ||
            typeof p.render === 'function' ||
            typeof p.lazy === 'function' ||
            // React Router v5 Redirect：<Redirect to="/login" from="/old" />
            // 没有 path，但有 to（目标）或 from（来源）。
            typeof p.to === 'string' ||
            typeof p.from === 'string'
        );
    }

    function getReactElementProps(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.props && typeof value.props === 'object') return value.props;
        if (value.pendingProps && typeof value.pendingProps === 'object') return value.pendingProps;
        if (value.memoizedProps && typeof value.memoizedProps === 'object') return value.memoizedProps;
        return null;
    }

    function isRoutesComponent(props) {
        if (!props || typeof props !== 'object') return false;
        const children = props.children;
        if (!children) return false;
        const subs = Array.isArray(children) ? children : [children];
        const nonNull = subs.filter(s => s !== null && s !== undefined);
        if (nonNull.length === 0) return false;
        return nonNull.every(sub =>
            isRouteElement(sub) ||
            (Array.isArray(sub) && sub.length > 0 && sub.every(isRouteElement))
        );
    }

    // ===== 辅助：递归搜索 React Element 嵌套链中的 Router =====
    // 处理 router 不直接放在 fiber.memoizedProps 顶层，
    // 而是藏在 props.children.props.children.props.router 这类 React Element 嵌套中的情况。
    //
    // 规则：
    //   - 每层只检测 RouterProvider / LegacyRoutes / GitHubRoutes，不检测 JSX Routes（太宽泛）。
    //   - 沿 .children（单元素或数组）向下递归，maxDepth 控制最大深度。
    //   - 默认 maxDepth=4，覆盖最多 3 层嵌套，足够 GitHub 2 层和常见 1 层场景。
    function getJSXRoutesCandidate(props, fiber) {
        if (!props || typeof props !== 'object' || !props.children) return null;

        if (isRoutesComponent(props)) {
            return {
                type: 'Routes',
                props
            };
        }

        const stateNode = fiber && fiber.stateNode;
        const isLikelyRouterWrapper =
            typeof props.basename === 'string' ||
            props.history ||
            props.location ||
            (stateNode && (stateNode.history || stateNode.props === props)) ||
            isRouterRelatedName(getFiberDisplayName(fiber));

        if (!isLikelyRouterWrapper) return null;

        const routes = extractJSXRoutes(props);
        if (routes.length >= 2 || routes.some(route => route.path === '/' || route.path === '*')) {
            return {
                type: 'Routes',
                props
            };
        }
        return null;
    }

    function findNestedJSXRoutesCandidate(value, maxDepth) {
        if (!value || typeof value !== 'object' || maxDepth < 0) return null;

        const queue = [{
            value,
            depth: 0
        }];
        const visited = new WeakSet();
        let count = 0;

        const enqueueChild = (child, depth) => {
            if (!child) return;
            if (Array.isArray(child)) {
                child.forEach(item => enqueueChild(item, depth));
                return;
            }
            if (child && typeof child === 'object') {
                queue.push({
                    value: child,
                    depth
                });
            }
        };

        while (queue.length > 0 && count < 300) {
            const item = queue.shift();
            const currentValue = item.value;
            count++;

            if (!currentValue || typeof currentValue !== 'object') continue;
            if (visited.has(currentValue)) continue;
            visited.add(currentValue);

            const routes = extractJSXRoutes(currentValue);
            if (
                routes.length >= 2 ||
                routes.some(route => route.path === '/' || route.path === '*')
            ) {
                return {
                    type: 'Routes',
                    props: currentValue
                };
            }

            if (item.depth >= maxDepth) continue;
            const currentProps = getReactElementProps(currentValue) || currentValue;
            if (!currentProps || typeof currentProps !== 'object') continue;
            const children = currentProps.children;
            if (!children) continue;
            enqueueChild(children, item.depth + 1);
        }

        return null;
    }

    function isMenuRoutePath(value) {
        return typeof value === 'string' &&
            value.length > 1 &&
            value.charAt(0) === '/' &&
            !/^\/\//.test(value) &&
            !/\s/.test(value);
    }

    function extractTextFromReactChildren(children) {
        if (typeof children === 'string') return children;
        if (!children || typeof children !== 'object') return '';
        const list = Array.isArray(children) ? children : [children];
        for (const child of list) {
            if (typeof child === 'string' && child.trim()) return child.trim();
            const props = getReactElementProps(child);
            if (props) {
                const nestedText = extractTextFromReactChildren(props.children || props.label || props.title);
                if (nestedText) return nestedText;
            }
        }
        return '';
    }

    function extractMenuRoutes(value, maxDepth) {
        const routes = [];
        const seen = new Set();
        const visited = new WeakSet();
        const queue = [{
            value,
            depth: 0
        }];
        let count = 0;

        const pushRoute = (path, name) => {
            if (!isMenuRoutePath(path) || seen.has(path)) return;
            seen.add(path);
            routes.push({
                name: name || '',
                path
            });
        };

        const enqueue = (child, depth) => {
            if (!child || depth > maxDepth) return;
            if (Array.isArray(child)) {
                child.forEach(item => enqueue(item, depth));
                return;
            }
            if (child && typeof child === 'object') {
                queue.push({
                    value: child,
                    depth
                });
            }
        };

        while (queue.length > 0 && count < 500) {
            const item = queue.shift();
            const current = item.value;
            count++;
            if (!current || typeof current !== 'object') continue;
            if (visited.has(current)) continue;
            visited.add(current);

            const props = getReactElementProps(current) || current;
            if (!props || typeof props !== 'object') continue;

            const path =
                props.rule ||
                props.eventKey ||
                props.path ||
                props.to ||
                current.key ||
                props.key;

            const hasMenuSignals =
                props.eventKey !== undefined ||
                props.rule !== undefined ||
                props.selectedKeys !== undefined ||
                props.openKeys !== undefined ||
                props.mode !== undefined ||
                props.icon !== undefined ||
                props.itemIcon !== undefined;

            if (hasMenuSignals && isMenuRoutePath(path)) {
                const name =
                    (typeof props.title === 'string' && props.title) ||
                    (typeof props.label === 'string' && props.label) ||
                    extractTextFromReactChildren(props.children);
                pushRoute(path, name);
            }

            if (item.depth >= maxDepth) continue;
            enqueue(props.children, item.depth + 1);
            enqueue(props.items, item.depth + 1);
        }

        return routes;
    }

    function findNestedMenuRoutesCandidate(value, maxDepth) {
        const routes = extractMenuRoutes(value, maxDepth);
        if (routes.length >= 2) {
            return {
                type: 'MenuRoutes',
                routes
            };
        }
        return null;
    }

    function hasLikelyRouteDataNearFiber(fiber) {
        if (!fiber || typeof fiber !== 'object') return false;

        const queue = [fiber];
        const visited = new WeakSet();
        let count = 0;

        while (queue.length > 0 && count < 80) {
            const current = queue.shift();
            count++;
            if (!current || typeof current !== 'object') continue;
            if (visited.has(current)) continue;
            visited.add(current);

            const propsSources = [
                current.memoizedProps,
                current.pendingProps,
                current.props,
                current.stateNode && current.stateNode.props
            ];

            for (const props of propsSources) {
                if (!props || typeof props !== 'object') continue;
                if (findNestedJSXRoutesCandidate(props, 4)) return true;
                if (findNestedMenuRoutesCandidate(props, 4)) return true;
                if (props.children && typeof props.children === 'object') {
                    if (findNestedJSXRoutesCandidate(props.children, 4)) return true;
                    if (findNestedMenuRoutesCandidate(props.children, 4)) return true;
                }
            }

            if (current.child && typeof current.child === 'object') queue.push(current.child);
            if (current.sibling && typeof current.sibling === 'object') queue.push(current.sibling);
        }

        return false;
    }

    function searchNestedReactElements(props, maxDepth) {
        if (maxDepth <= 0 || !props || typeof props !== 'object') return null;

        if (isRouterProvider(props)) return {
            type: 'RouterProvider',
            router: props.router
        };
        if (isLegacyRouterRoutes(props)) return {
            type: 'LegacyRoutes',
            routes: getLegacyRoutes(props)
        };
        if (isGitHubRoutes(props)) return {
            type: 'GitHubRoutes',
            routes: props.routes
        };
        if (isRouteConfigRoutes(props)) return {
            type: 'ContextRoutes',
            routes: getRouteConfigArrayFromObject(props)
        };

        const children = props.children;
        if (!children) return null;

        const childList = Array.isArray(children) ? children : [children];
        for (const child of childList) {
            if (child && typeof child === 'object' && child.props) {
                const result = searchNestedReactElements(child.props, maxDepth - 1);
                if (result) return result;
            }
        }
        return null;
    }

    function getRouteConfigResultFromFiberLike(fiber) {
        if (!fiber || typeof fiber !== 'object') return null;

        const propsSources = [
            fiber.pendingProps,
            fiber.memoizedProps,
            fiber.stateNode && fiber.stateNode.props
        ];
        const alt = fiber.alternate;
        if (alt && alt !== fiber) {
            propsSources.push(alt.pendingProps, alt.memoizedProps, alt.stateNode && alt.stateNode.props);
        }

        for (const props of propsSources) {
            if (isRouteConfigRoutes(props)) {
                return {
                    type: 'ContextRoutes',
                    routes: getRouteConfigArrayFromObject(props)
                };
            }
        }

        return null;
    }

    function findRouteConfigInObject(root, maxDepth) {
        if (!root || typeof root !== 'object') return null;

        const queue = [{
            value: root,
            depth: 0
        }];
        const visited = new WeakSet();
        const fields = [
            'routeConfig', 'routeRelatedConfig', 'memoizedState', 'baseState',
            'next', 'value', 'current', 'deps', 'queue', 'props', 'children'
        ];
        let count = 0;

        while (queue.length > 0 && count < 300) {
            const item = queue.shift();
            const value = item.value;
            count++;

            if (!value || typeof value !== 'object') continue;
            if (visited.has(value)) continue;
            visited.add(value);

            if (isRouteConfigArray(value)) {
                return {
                    type: 'ContextRoutes',
                    routes: value
                };
            }

            const routes = getRouteConfigArrayFromObject(value);
            if (routes) {
                return {
                    type: 'ContextRoutes',
                    routes
                };
            }

            if (item.depth >= maxDepth) continue;

            if (Array.isArray(value)) {
                value.forEach(child => {
                    if (child && typeof child === 'object') {
                        queue.push({
                            value: child,
                            depth: item.depth + 1
                        });
                    }
                });
                continue;
            }

            for (const field of fields) {
                try {
                    if (value[field] && typeof value[field] === 'object') {
                        queue.push({
                            value: value[field],
                            depth: item.depth + 1
                        });
                    }
                } catch (e) {}
            }
        }

        return null;
    }

    function findRouteConfigInEffectFibers(fiber) {
        if (!fiber || typeof fiber !== 'object') return null;

        const roots = [
            fiber.updateQueue && fiber.updateQueue.lastEffect,
            fiber.updateQueue && fiber.updateQueue.firstEffect,
            fiber.lastEffect,
            fiber.firstEffect
        ];

        const queue = [];
        roots.forEach(root => {
            if (root && typeof root === 'object') queue.push(root);
        });

        const visited = new WeakSet();
        let count = 0;
        while (queue.length > 0 && count < 120) {
            const current = queue.shift();
            count++;
            if (!current || typeof current !== 'object') continue;
            if (visited.has(current)) continue;
            visited.add(current);

            const result = getRouteConfigResultFromFiberLike(current);
            if (result) return result;

            const nestedResult = findRouteConfigInObject(current, 80);
            if (nestedResult) return nestedResult;

            try {
                if (current.next && typeof current.next === 'object') queue.push(current.next);
                if (current.nextEffect && typeof current.nextEffect === 'object') queue.push(current.nextEffect);
                if (current.child && typeof current.child === 'object') queue.push(current.child);
                if (current.sibling && typeof current.sibling === 'object') queue.push(current.sibling);
                if (current.alternate && current.alternate !== current && typeof current.alternate === 'object') {
                    queue.push(current.alternate);
                }
            } catch (e) {}
        }

        return null;
    }

    // ===== Phase 2: Fiber 树 BFS 扫描，寻找 Router 实例 =====
    // 导航策略：只沿 child 和 sibling 前进，不把 alternate 加入队列。
    // 额外读取 fiber.alternate 的 props，但不遍历其子树，
    // 用于处理路由数据只存在于 alternate fiber 上的情况。
    //
    // 返回优先级策略（从高到低）：
    //   RouterProvider：立即返回，特征最明确。
    //   LegacyRoutes：立即返回，routes 数组带框架特有字段。
    //   GitHubRoutes：立即返回，仅 github.com 生效。
    //   JSX Routes：仅作为候选，扫完整棵树后若无更好结果才返回。
    //   以上均未命中时，通过 searchNestedReactElements 向 React Element 嵌套链补充搜索。
    function routerResultHasRoutes(result) {
        if (!result || typeof result !== 'object') return false;
        try {
            if (result.type === 'RouterProvider') {
                return extractRouterProviderRoutes(result.router && result.router.routes).length > 0;
            }
            if (result.type === 'GitHubRoutes') {
                return extractGitHubRoutes(result.routes).length > 0;
            }
            if (result.type === 'ContextRoutes') {
                return extractRouterProviderRoutes(result.routes).length > 0;
            }
            if (result.type === 'LegacyRoutes') {
                return extractLegacyRoutes(result.routes).length > 0;
            }
            if (result.type === 'Routes') {
                return extractJSXRoutes(result.props).length > 0;
            }
            if (result.type === 'MenuRoutes') {
                return Array.isArray(result.routes) && result.routes.length > 0;
            }
        } catch (e) {}
        return false;
    }

    function findRouterInFiber(startFiber) {
        if (!startFiber) return null;

        const queue = [startFiber];
        const visited = new WeakSet();
        // 企业级 React 应用组件数量庞大，Routes 可能藏在某个 sibling 子树深处。
        // BFS 必须先遍历完 sibling 之前的子树才能到达目标。
        // 3000 对复杂应用通常不够，提升到 15000 覆盖更多场景。
        let count = 0;
        let jsxRoutesCandidate = null; // JSX Routes 命中时不立即返回，先保存为候选

        let menuRoutesCandidate = null;
        while (queue.length > 0 && count < ROUTER_FIBER_SCAN_MAX_NODES) {
            const fiber = queue.shift();
            count++;

            if (!fiber || typeof fiber !== 'object') continue;
            if (visited.has(fiber)) continue;
            visited.add(fiber);

            // 收集需要检测的 props 来源：
            // 1. 当前 fiber 的 memoizedProps / pendingProps。
            // 2. alternate fiber 的 memoizedProps / pendingProps。
            //    路由数据有时只存在于 alternate；这里只读 props，不把 alternate 加入队列。
            const propsSources = [fiber.memoizedProps, fiber.pendingProps, fiber.props];
            if (fiber._currentElement && fiber._currentElement.props) {
                propsSources.push(fiber._currentElement.props);
            }
            if (fiber.stateNode && fiber.stateNode.props) {
                propsSources.push(fiber.stateNode.props);
            }
            const contextRouter = searchRouterInFiberContext(fiber);
            if (contextRouter && routerResultHasRoutes(contextRouter)) return contextRouter;

            const effectRouteConfig = findRouteConfigInEffectFibers(fiber);
            if (effectRouteConfig && routerResultHasRoutes(effectRouteConfig)) return effectRouteConfig;

            const hookRouteConfig = findRouteConfigInObject(fiber.memoizedState, 80);
            if (hookRouteConfig && routerResultHasRoutes(hookRouteConfig)) return hookRouteConfig;

            const alt = fiber.alternate;
            if (alt && alt !== fiber && !visited.has(alt)) {
                const altHookRouteConfig = findRouteConfigInObject(alt.memoizedState, 80);
                if (altHookRouteConfig && routerResultHasRoutes(altHookRouteConfig)) return altHookRouteConfig;

                propsSources.push(alt.memoizedProps, alt.pendingProps, alt.props);
                if (alt.stateNode && alt.stateNode.props) {
                    propsSources.push(alt.stateNode.props);
                }
                if (hasLikelyRouteDataNearFiber(alt)) {
                    queue.push(alt);
                }
            }

            for (const props of propsSources) {
                if (!props || typeof props !== 'object') continue;
                const jsxSources = [props];
                if (props.children && typeof props.children === 'object') {
                    jsxSources.push(props.children);
                }

                // RouterProvider：立即返回，特征最明确。
                if (isRouterProvider(props)) {
                    const result = {
                        type: 'RouterProvider',
                        router: props.router
                    };
                    if (routerResultHasRoutes(result)) return result;
                }
                // LegacyRoutes：立即返回，v3/v4 特有结构。
                if (isLegacyRouterRoutes(props)) {
                    const result = {
                        type: 'LegacyRoutes',
                        routes: getLegacyRoutes(props)
                    };
                    if (routerResultHasRoutes(result)) return result;
                }
                // GitHub 专属路由：立即返回，仅 github.com 生效。
                if (isGitHubRoutes(props)) {
                    const result = {
                        type: 'GitHubRoutes',
                        routes: props.routes
                    };
                    if (routerResultHasRoutes(result)) return result;
                }
                if (isRouteConfigRoutes(props)) {
                    const result = {
                        type: 'ContextRoutes',
                        routes: getRouteConfigArrayFromObject(props)
                    };
                    if (routerResultHasRoutes(result)) return result;
                }
                // JSX Routes：只保存第一个命中，继续扫描不立即返回。
                // 避免浅层误判导致提前退出，错过更深处的真实路由。
                if (!jsxRoutesCandidate) {
                    let jsxCandidate = getJSXRoutesCandidate(props, fiber);
                    if (!jsxCandidate) {
                        for (const jsxSource of jsxSources) {
                            jsxCandidate = findNestedJSXRoutesCandidate(jsxSource, ROUTER_NESTED_SEARCH_DEPTH);
                            if (jsxCandidate) break;
                        }
                    }
                    if (jsxCandidate) {
                        jsxRoutesCandidate = jsxCandidate;
                    }
                }
                // 以上均未命中：向 React Element 嵌套链补充搜索。
                // 处理 router 藏在 props.children.props.children.props.router 等场景。
                const nested = searchNestedReactElements(props, ROUTER_NESTED_SEARCH_DEPTH);
                if (!menuRoutesCandidate) {
                    for (const jsxSource of jsxSources) {
                        const menuCandidate = findNestedMenuRoutesCandidate(jsxSource, ROUTER_NESTED_SEARCH_DEPTH);
                        if (menuCandidate) {
                            menuRoutesCandidate = menuCandidate;
                            break;
                        }
                    }
                }
                if (nested && routerResultHasRoutes(nested)) return nested;
            }

            // 严格只走 Fiber 树导航链路。
            if (fiber.child) queue.push(fiber.child);
            if (fiber.sibling) queue.push(fiber.sibling);
            getLegacyReactInstanceChildren(fiber).forEach(child => queue.push(child));
        }

        if (count >= ROUTER_FIBER_SCAN_MAX_NODES) {
            debugWarn(`[AntiDebug] Fiber tree scan reached ${ROUTER_FIBER_SCAN_MAX_NODES} nodes; result may be incomplete`);
        } else if (!jsxRoutesCandidate) {
            debugLog(`[AntiDebug] Fiber tree scan finished, visited ${count} nodes, no Router found`);
        }

        // RouterProvider / LegacyRoutes 未找到时，用 JSX Routes 候选兜底。
        return jsxRoutesCandidate || menuRoutesCandidate || null;
    }

    function findRouterInFiberClean(startFiber) {
        if (!startFiber) return null;

        const queue = [startFiber];
        const visited = new WeakSet();
        let count = 0;
        let jsxRoutesCandidate = null;
        let menuRoutesCandidate = null;

        const pushFiber = fiber => {
            if (fiber && typeof fiber === 'object') queue.push(fiber);
        };

        while (queue.length > 0 && count < ROUTER_FIBER_SCAN_MAX_NODES) {
            const fiber = queue.shift();
            count++;

            if (!fiber || typeof fiber !== 'object') continue;
            if (visited.has(fiber)) continue;
            visited.add(fiber);

            const propsSources = [
                fiber.memoizedProps,
                fiber.pendingProps,
                fiber.props,
                fiber._currentElement && fiber._currentElement.props,
                fiber.stateNode && fiber.stateNode.props
            ];

            const contextRouter = searchRouterInFiberContext(fiber);
            if (contextRouter && routerResultHasRoutes(contextRouter)) return contextRouter;

            const effectRouteConfig = findRouteConfigInEffectFibers(fiber);
            if (effectRouteConfig && routerResultHasRoutes(effectRouteConfig)) return effectRouteConfig;

            const hookRouteConfig = findRouteConfigInObject(fiber.memoizedState, 80);
            if (hookRouteConfig && routerResultHasRoutes(hookRouteConfig)) return hookRouteConfig;

            const alt = fiber.alternate;
            if (alt && alt !== fiber && !visited.has(alt)) {
                const altHookRouteConfig = findRouteConfigInObject(alt.memoizedState, 80);
                if (altHookRouteConfig && routerResultHasRoutes(altHookRouteConfig)) return altHookRouteConfig;

                propsSources.push(
                    alt.memoizedProps,
                    alt.pendingProps,
                    alt.props,
                    alt._currentElement && alt._currentElement.props,
                    alt.stateNode && alt.stateNode.props
                );

                if (hasLikelyRouteDataNearFiber(alt)) pushFiber(alt);
            }

            for (const props of propsSources) {
                if (!props || typeof props !== 'object') continue;

                const jsxSources = [props];
                if (props.children && typeof props.children === 'object') jsxSources.push(props.children);

                if (isRouterProvider(props)) {
                    const result = { type: 'RouterProvider', router: props.router };
                    if (routerResultHasRoutes(result)) return result;
                }

                if (isLegacyRouterRoutes(props)) {
                    const result = { type: 'LegacyRoutes', routes: getLegacyRoutes(props) };
                    if (routerResultHasRoutes(result)) return result;
                }

                if (isGitHubRoutes(props)) {
                    const result = { type: 'GitHubRoutes', routes: props.routes };
                    if (routerResultHasRoutes(result)) return result;
                }

                if (isRouteConfigRoutes(props)) {
                    const result = { type: 'ContextRoutes', routes: getRouteConfigArrayFromObject(props) };
                    if (routerResultHasRoutes(result)) return result;
                }

                if (!jsxRoutesCandidate) {
                    let jsxCandidate = getJSXRoutesCandidate(props, fiber);
                    if (!jsxCandidate) {
                        for (const jsxSource of jsxSources) {
                            jsxCandidate = findNestedJSXRoutesCandidate(jsxSource, ROUTER_NESTED_SEARCH_DEPTH);
                            if (jsxCandidate) break;
                        }
                    }
                    if (jsxCandidate) jsxRoutesCandidate = jsxCandidate;
                }

                if (!menuRoutesCandidate) {
                    for (const jsxSource of jsxSources) {
                        const menuCandidate = findNestedMenuRoutesCandidate(jsxSource, ROUTER_NESTED_SEARCH_DEPTH);
                        if (menuCandidate) {
                            menuRoutesCandidate = menuCandidate;
                            break;
                        }
                    }
                }

                const nested = searchNestedReactElements(props, ROUTER_NESTED_SEARCH_DEPTH);
                if (nested && routerResultHasRoutes(nested)) return nested;
            }

            pushFiber(fiber.child);
            pushFiber(fiber.sibling);
            getLegacyReactInstanceChildren(fiber).forEach(pushFiber);
        }

        if (count >= ROUTER_FIBER_SCAN_MAX_NODES) {
            debugWarn(`[AntiDebug] Fiber tree scan reached ${ROUTER_FIBER_SCAN_MAX_NODES} nodes; result may be incomplete`);
        } else if (!jsxRoutesCandidate && !menuRoutesCandidate) {
            debugLog(`[AntiDebug] Fiber tree scan finished, visited ${count} nodes, no Router found`);
        }

        return jsxRoutesCandidate || menuRoutesCandidate || null;
    }

    findRouterInFiber = findRouterInFiberClean;

    // ===== 路由提取：React Router v3/v4 Legacy 模式 =====
    // 路由结构：{ path, name, component/getComponent, childRoutes, indexRoute }
    // 子路由字段是 childRoutes，不是 children。
    function extractLegacyRoutes(routes, prefix) {
        prefix = prefix || '';
        const list = [];
        if (!Array.isArray(routes)) return list;

        for (const route of routes) {
            if (!route || typeof route !== 'object') continue;
            if (typeof route.path !== 'string') continue;

            const fullPath = joinPath(prefix, route.path);
            list.push({
                name: route.name || '(unnamed)',
                path: fullPath
            });

            // 递归处理 childRoutes（v3/v4 的嵌套路由字段）。
            if (Array.isArray(route.childRoutes) && route.childRoutes.length > 0) {
                list.push(...extractLegacyRoutes(route.childRoutes, fullPath));
            }
            if (Array.isArray(route.routes) && route.routes.length > 0) {
                list.push(...extractLegacyRoutes(route.routes, fullPath));
            }
        }
        return list;
    }

    // ===== 路由提取：RouterProvider 模式 =====
    // routes 数组结构：{ path, id, children, element, hasErrorBoundary }
    function extractRouterProviderRoutes(routes, prefix) {
        prefix = prefix || '';
        const list = [];
        if (!Array.isArray(routes)) return list;

        for (const route of routes) {
            if (!route || typeof route !== 'object') continue;
            const fullPath = joinPath(prefix, route.path);
            list.push({
                name: route.id !== undefined ? String(route.id) : '(unnamed)',
                path: fullPath
            });
            // 递归处理子路由。
            if (Array.isArray(route.children) && route.children.length > 0) {
                list.push(...extractRouterProviderRoutes(route.children, fullPath));
            }
        }
        return list;
    }

    // ===== 路由提取：JSX Routes 模式 =====
    // 从 React Element 树的 props.children 中递归提取 path。
    function extractJSXRoutes(props, prefix) {
        prefix = prefix || '';
        const list = [];
        if (!props) return list;

        if (Array.isArray(props)) {
            for (const item of props) {
                list.push(...extractJSXRoutes(item, prefix));
            }
            return list;
        }

        if (typeof props !== 'object') return list;
        const elementProps = getReactElementProps(props);

        if (elementProps && (typeof elementProps.path === 'string' || Array.isArray(elementProps.path) || elementProps.index === true || typeof elementProps.to === 'string' || typeof elementProps.from === 'string')) {
            let routePrefix = prefix;
            if (typeof elementProps.path === 'string') {
                const fullPath = joinPath(prefix, elementProps.path);
                list.push({
                    name: '',
                    path: fullPath
                });
                routePrefix = fullPath;
            } else if (Array.isArray(elementProps.path) && elementProps.path.length > 0) {
                for (const singlePath of elementProps.path) {
                    if (typeof singlePath === 'string') {
                        list.push({
                            name: '',
                            path: joinPath(prefix, singlePath)
                        });
                    }
                }
                if (typeof elementProps.path[0] === 'string') {
                    routePrefix = joinPath(prefix, elementProps.path[0]);
                }
            } else if (elementProps.index === true) {
                list.push({
                    name: '',
                    path: prefix || '/'
                });
            } else {
                if (typeof elementProps.from === 'string') {
                    list.push({
                        name: '(redirect)',
                        path: joinPath(prefix, elementProps.from)
                    });
                }
                if (typeof elementProps.to === 'string') {
                    list.push({
                        name: '(redirect閳?',
                        path: joinPath(prefix, elementProps.to)
                    });
                }
            }

            if (elementProps.children) {
                list.push(...extractJSXRoutes(elementProps.children, routePrefix));
            }
            return list;
        }

        if (elementProps && elementProps !== props) {
            props = elementProps;
        }

        if (!props.children) return list;

        const subs = Array.isArray(props.children) ? props.children : [props.children];
        for (const sub of subs) {
            if (!sub || typeof sub !== 'object') continue;
            const p = sub.props;
            if (!p) continue;

            let routePrefix = prefix; // 子路由递归时使用的 base path

            if (typeof p.path === 'string') {
                // 常规字符串 path。
                const fullPath = joinPath(prefix, p.path);
                list.push({
                    name: '',
                    path: fullPath
                });
                routePrefix = fullPath;
            } else if (Array.isArray(p.path) && p.path.length > 0) {
                // React Router v5: path 可为数组，如 <Route path={['/login', '/signup']} />。
                // 每个路径单独展开为一条路由。
                for (const singlePath of p.path) {
                    if (typeof singlePath === 'string') {
                        list.push({
                            name: '',
                            path: joinPath(prefix, singlePath)
                        });
                    }
                }
                // 子路由以数组第一个 path 作为 base。
                if (typeof p.path[0] === 'string') {
                    routePrefix = joinPath(prefix, p.path[0]);
                }
            } else {
                // React Router v5 Redirect：没有 path，但有 from / to。
                // from 是来源路径（用户可访问的路径）。
                // to 是目标路径（catch-all 时用于表示默认落地页）。
                if (typeof p.from === 'string') {
                    list.push({
                        name: '(redirect)',
                        path: joinPath(prefix, p.from)
                    });
                }
                if (typeof p.to === 'string') {
                    list.push({
                        name: '(redirect鈫?',
                        path: joinPath(prefix, p.to)
                    });
                }
            }

            // 递归处理嵌套 Route（带布局路由的情况）。
            if (p.children) {
                list.push(...extractJSXRoutes(p, routePrefix));
            }
        }
        return list;
    }

    // ===== 检测路由模式（history / hash / null）=====
    function detectRouterModeByCreateHref(createHref) {
        if (typeof createHref !== 'function') return null;
        const testLocation = {
            pathname: '/__antidebug_mode_test__',
            search: '',
            hash: ''
        };
        const candidates = [testLocation, testLocation.pathname];
        for (const candidate of candidates) {
            try {
                const href = createHref(candidate);
                if (typeof href !== 'string') continue;
                if (href.includes('#')) return 'hash';
                return 'history';
            } catch (e) {}
        }
        return null;
    }

    function findCreateHrefInObject(root, maxDepth) {
        if (!root || typeof root !== 'object' || maxDepth <= 0) return null;
        const queue = [{
            value: root,
            depth: 0
        }];
        const visited = new WeakSet();
        const fields = [
            'router', 'history', 'navigator', 'current', 'memoizedState', 'baseState',
            'next', 'queue', 'updateQueue', 'lastEffect', 'firstEffect', 'nextEffect', 'deps',
            'dependencies', 'firstContext', 'first', 'memoizedValue',
            'pendingProps', 'memoizedProps', 'props', 'children', 'stateNode', 'context', 'value',
            'child', 'sibling', 'alternate', '_currentElement', '_renderedComponent',
            '_renderedChildren', '_renderedChildrenArray', '_context', '_instance',
            'mergedProps', 'renderedElement', '_hostContainerInfo', '_topLevelWrapper',
            'store', 'Plugins', 'elementType', 'type', 'config'
        ];

        while (queue.length > 0) {
            const item = queue.shift();
            const value = item.value;
            if (!value || (typeof value !== 'object' && typeof value !== 'function')) continue;
            if (typeof value === 'object') {
                if (visited.has(value)) continue;
                visited.add(value);
            }

            try {
                if (typeof value.createHref === 'function') return value.createHref.bind(value);
            } catch (e) {}

            if (item.depth >= maxDepth || typeof value !== 'object') continue;
            if (typeof Window !== 'undefined' && value instanceof Window) continue;
            if (typeof Node !== 'undefined' && value instanceof Node) continue;

            if (Array.isArray(value)) {
                value.forEach(child => queue.push({
                    value: child,
                    depth: item.depth + 1
                }));
                continue;
            }

            for (const field of fields) {
                try {
                    if (value[field]) {
                        queue.push({
                            value: value[field],
                            depth: item.depth + 1
                        });
                    }
                } catch (e) {}
            }
        }
        return null;
    }

    function getCreateHrefFromObject(value) {
        if (!value || typeof value !== 'object') return null;

        function readCreateHrefFromContainer(container) {
            if (!container || typeof container !== 'object') return null;
            try {
                if (typeof container.createHref === 'function') {
                    return container.createHref.bind(container);
                }
            } catch (e) {}
            try {
                if (container.history && typeof container.history.createHref === 'function') {
                    return container.history.createHref.bind(container.history);
                }
            } catch (e) {}
            try {
                if (container.navigator && typeof container.navigator.createHref === 'function') {
                    return container.navigator.createHref.bind(container.navigator);
                }
            } catch (e) {}
            try {
                if (container.router && typeof container.router.createHref === 'function') {
                    return container.router.createHref.bind(container.router);
                }
            } catch (e) {}
            try {
                if (container.router && container.router.history && typeof container.router.history.createHref === 'function') {
                    return container.router.history.createHref.bind(container.router.history);
                }
            } catch (e) {}
            return null;
        }

        const directCreateHref = readCreateHrefFromContainer(value);
        if (directCreateHref) return directCreateHref;

        try {
            const currentCreateHref = readCreateHrefFromContainer(value.current);
            if (currentCreateHref) return currentCreateHref;
        } catch (e) {}

        try {
            const valueCreateHref = readCreateHrefFromContainer(value.value);
            if (valueCreateHref) return valueCreateHref;
        } catch (e) {}

        try {
            const contextCreateHref = readCreateHrefFromContainer(value._context);
            if (contextCreateHref) return contextCreateHref;
        } catch (e) {}

        try {
            const contextCreateHref = readCreateHrefFromContainer(value.context);
            if (contextCreateHref) return contextCreateHref;
        } catch (e) {}

        try {
            const pluginsCreateHref = readCreateHrefFromContainer(value.Plugins);
            if (pluginsCreateHref) return pluginsCreateHref;
        } catch (e) {}

        try {
            const contextPluginsCreateHref = readCreateHrefFromContainer(value.context && value.context.Plugins);
            if (contextPluginsCreateHref) return contextPluginsCreateHref;
        } catch (e) {}

        try {
            const storeContextPluginsCreateHref = readCreateHrefFromContainer(
                value.context && value.context.store && value.context.store._context && value.context.store._context.Plugins
            );
            if (storeContextPluginsCreateHref) return storeContextPluginsCreateHref;
        } catch (e) {}

        try {
            const storePluginsCreateHref = readCreateHrefFromContainer(
                value.store && value.store._context && value.store._context.Plugins
            );
            if (storePluginsCreateHref) return storePluginsCreateHref;
        } catch (e) {}

        try {
            const elementConfigCreateHref = readCreateHrefFromContainer(value.elementType && value.elementType.config);
            if (elementConfigCreateHref) return elementConfigCreateHref;
        } catch (e) {}

        try {
            const typeConfigCreateHref = readCreateHrefFromContainer(value.type && value.type.config);
            if (typeConfigCreateHref) return typeConfigCreateHref;
        } catch (e) {}

        try {
            const mergedPropsCreateHref = readCreateHrefFromContainer(value.mergedProps);
            if (mergedPropsCreateHref) return mergedPropsCreateHref;
        } catch (e) {}

        try {
            if (value.renderedElement && value.renderedElement.props) {
                const renderedPropsCreateHref = readCreateHrefFromContainer(value.renderedElement.props);
                if (renderedPropsCreateHref) return renderedPropsCreateHref;
            }
        } catch (e) {}

        try {
            if (value._currentElement && value._currentElement.props) {
                const currentElementCreateHref = readCreateHrefFromContainer(value._currentElement.props);
                if (currentElementCreateHref) return currentElementCreateHref;
            }
        } catch (e) {}

        return null;
    }

    function findCreateHrefInReactElementTree(rootProps, maxDepth) {
        if (!rootProps || typeof rootProps !== 'object' || maxDepth <= 0) return null;

        const queue = [{
            props: rootProps,
            depth: 0
        }];
        const visited = new WeakSet();
        let count = 0;

        while (queue.length > 0 && count < 300) {
            const item = queue.shift();
            const props = item.props;
            count++;

            if (!props || typeof props !== 'object') continue;
            if (visited.has(props)) continue;
            visited.add(props);

            const createHref = getCreateHrefFromObject(props);
            if (createHref) return createHref;

            if (item.depth >= maxDepth) continue;

            const children = props.children;
            if (!children) continue;

            const childQueue = Array.isArray(children) ? children.slice() : [children];
            while (childQueue.length > 0) {
                const child = childQueue.shift();
                if (!child || typeof child !== 'object') continue;

                if (Array.isArray(child)) {
                    child.forEach(nested => childQueue.push(nested));
                    continue;
                }

                if (child.props && typeof child.props === 'object') {
                    queue.push({
                        props: child.props,
                        depth: item.depth + 1
                    });
                }
            }
        }

        return null;
    }

    function findCreateHrefInContextChain(fiber) {
        if (!fiber || typeof fiber !== 'object') return null;

        const dependencySources = [
            fiber.dependencies,
            fiber.dependencies_old,
            fiber.dependencies_new
        ];

        for (const dependencies of dependencySources) {
            if (!dependencies || typeof dependencies !== 'object') continue;

            let ctx = dependencies.firstContext;
            let count = 0;
            while (ctx && count < 80) {
                count++;
                try {
                    const createHref = getCreateHrefFromObject(ctx.memoizedValue);
                    if (createHref) return createHref;
                } catch (e) {}
                ctx = ctx.next;
            }
        }

        return null;
    }

    function findCreateHrefInEffectDeps(effect) {
        let current = effect;
        let count = 0;
        const visited = new WeakSet();

        while (current && typeof current === 'object' && count < 80) {
            count++;
            if (visited.has(current)) break;
            visited.add(current);

            const createHref = getCreateHrefFromObject(current);
            if (createHref) return createHref;

            try {
                if (Array.isArray(current.deps)) {
                    for (const dep of current.deps) {
                        const depCreateHref = findCreateHrefInObject(dep, 4);
                        if (depCreateHref) return depCreateHref;
                    }
                }
            } catch (e) {}

            current = current.next;
        }

        return null;
    }

    function findCreateHrefInHookState(fiber) {
        if (!fiber || typeof fiber !== 'object') return null;

        const roots = [
            fiber.memoizedState,
            fiber.updateQueue && fiber.updateQueue.lastEffect,
            fiber.updateQueue && fiber.updateQueue.firstEffect,
            fiber.lastEffect,
            fiber.firstEffect
        ];

        const queue = [];
        roots.forEach(root => {
            if (root && typeof root === 'object') {
                queue.push({
                    value: root,
                    depth: 0
                });
            }
        });

        const visited = new WeakSet();
        let count = 0;

        while (queue.length > 0 && count < 200) {
            const item = queue.shift();
            const value = item.value;
            count++;

            if (!value || typeof value !== 'object') continue;
            if (visited.has(value)) continue;
            visited.add(value);

            const createHref = getCreateHrefFromObject(value);
            if (createHref) return createHref;

            const shallowCreateHref = findCreateHrefInObject(value, 2);
            if (shallowCreateHref) return shallowCreateHref;

            if (item.depth >= 40) continue;

            try {
                if (value.next && typeof value.next === 'object') {
                    queue.push({
                        value: value.next,
                        depth: item.depth + 1
                    });
                }
                if (value.memoizedState && typeof value.memoizedState === 'object') {
                    queue.push({
                        value: value.memoizedState,
                        depth: item.depth + 1
                    });
                }
                if (Array.isArray(value.deps)) {
                    value.deps.forEach(dep => {
                        if (dep && typeof dep === 'object') {
                            queue.push({
                                value: dep,
                                depth: item.depth + 1
                            });
                        }
                    });
                }
                if (Array.isArray(value)) {
                    value.forEach(child => {
                        if (child && typeof child === 'object') {
                            queue.push({
                                value: child,
                                depth: item.depth + 1
                            });
                        }
                    });
                }
            } catch (e) {}
        }

        return null;
    }

    function findCreateHrefInFiberTree(startFiber) {
        if (!startFiber) return null;

        const queue = [startFiber];
        const visited = new WeakSet();
        let count = 0;

        while (queue.length > 0 && count < ROUTER_FIBER_SCAN_MAX_NODES) {
            const fiber = queue.shift();
            count++;

            if (!fiber || typeof fiber !== 'object') continue;
            if (visited.has(fiber)) continue;
            visited.add(fiber);

            const contextCreateHref = findCreateHrefInContextChain(fiber);
            if (contextCreateHref) return contextCreateHref;

            const effectCreateHref = findCreateHrefInEffectDeps(
                fiber.updateQueue && fiber.updateQueue.lastEffect || fiber.lastEffect
            );
            if (effectCreateHref) return effectCreateHref;

            const hookCreateHref = findCreateHrefInHookState(fiber);
            if (hookCreateHref) return hookCreateHref;

            const candidates = [
                fiber,
                fiber.stateNode,
                fiber.memoizedProps,
                fiber.pendingProps
            ];

            if (fiber._currentElement && fiber._currentElement.props) {
                candidates.push(fiber._currentElement.props);
            }
            if (fiber.stateNode && fiber.stateNode.props) {
                candidates.push(fiber.stateNode.props);
            }

            const alt = fiber.alternate;
            if (alt && alt !== fiber) {
                const altContextCreateHref = findCreateHrefInContextChain(alt);
                if (altContextCreateHref) return altContextCreateHref;

                const altEffectCreateHref = findCreateHrefInEffectDeps(
                    alt.updateQueue && alt.updateQueue.lastEffect || alt.lastEffect
                );
                if (altEffectCreateHref) return altEffectCreateHref;

                const altHookCreateHref = findCreateHrefInHookState(alt);
                if (altHookCreateHref) return altHookCreateHref;

                candidates.push(alt, alt.stateNode, alt.memoizedProps, alt.pendingProps);
                if (alt._currentElement && alt._currentElement.props) {
                    candidates.push(alt._currentElement.props);
                }
                if (alt.stateNode && alt.stateNode.props) {
                    candidates.push(alt.stateNode.props);
                }
            }

            for (const candidate of candidates) {
                const directCreateHref = getCreateHrefFromObject(candidate);
                if (directCreateHref) return directCreateHref;

                const elementTreeCreateHref = findCreateHrefInReactElementTree(candidate, ROUTER_NESTED_SEARCH_DEPTH);
                if (elementTreeCreateHref) return elementTreeCreateHref;

                const nestedCreateHref = findCreateHrefInObject(candidate, 3);
                if (nestedCreateHref) return nestedCreateHref;
            }

            if (fiber.child) queue.push(fiber.child);
            if (fiber.sibling) queue.push(fiber.sibling);
            if (fiber.alternate && fiber.alternate !== fiber && fiber.alternate.child) {
                queue.push(fiber.alternate.child);
            }
            getLegacyReactInstanceChildren(fiber).forEach(child => queue.push(child));
        }

        return null;
    }

    function findCreateHrefInFiber(startFiber) {
        const fiberTreeCreateHref = findCreateHrefInFiberTree(startFiber);
        if (fiberTreeCreateHref) return fiberTreeCreateHref;

        const createHref = findCreateHrefInObject(startFiber, CREATE_HREF_SEARCH_DEPTH);
        if (createHref) return createHref;
        if (startFiber && startFiber.alternate) {
            return findCreateHrefInObject(startFiber.alternate, CREATE_HREF_SEARCH_DEPTH);
        }
        return null;
    }

    function detectRouterMode(router, startFiber) {
        const directMode = detectRouterModeByCreateHref(router && router.createHref && router.createHref.bind(router));
        if (directMode) return directMode;

        const historyMode = detectRouterModeByCreateHref(router && router.history && router.history.createHref && router.history.createHref.bind(router.history));
        if (historyMode) return historyMode;

        const createHref = findCreateHrefInFiber(startFiber);
        const fiberMode = detectRouterModeByCreateHref(createHref);
        if (fiberMode) return fiberMode;

        return null;
    }

    // ===== 主尝试函数：串联两阶段扫描并输出结果 =====
    // 类型优先级：RouterProvider > GitHubRoutes > LegacyRoutes > Routes。
    const TYPE_PRIORITY = {
        RouterProvider: 4,
        GitHubRoutes: 3,
        ContextRoutes: 3,
        LegacyRoutes: 2,
        Routes: 1,
        MenuRoutes: 0
    };

    function getRecordRootKey(record) {
        const identity = record.rootIdentity || getReactRootIdentity(record.startFiber);
        return identity || `fallback:${record.containerPath || ''}:${record.source || ''}`;
    }

    function getRootId(rootKey) {
        if (rootKey && typeof rootKey === 'object') {
            if (!rootObjectIds.has(rootKey)) {
                rootObjectIds.set(rootKey, `react-root-${nextRootId++}`);
            }
            return rootObjectIds.get(rootKey);
        }

        const primitiveKey = String(rootKey || `fallback-${nextRootId}`);
        if (!rootPrimitiveIds.has(primitiveKey)) {
            rootPrimitiveIds.set(primitiveKey, `react-root-${nextRootId++}`);
        }
        return rootPrimitiveIds.get(primitiveKey);
    }

    function getInstanceScore(candidate) {
        return ((TYPE_PRIORITY[candidate.routerType] || 0) * 100000) + (candidate.routes ? candidate.routes.length : 0);
    }

    function getRouteKey(route) {
        return `${route && route.name || ''}::${route && route.path || ''}`;
    }

    function getInstanceRoutesSignature(instance) {
        if (!instance || !Array.isArray(instance.routes)) return '';
        return instance.routes.map(getRouteKey).sort().join('|');
    }

    function dedupeGitHubRouteInstances(instances) {
        if (!IS_GITHUB || !Array.isArray(instances) || instances.length <= 1) return instances;

        const result = [];
        const seen = new Set();
        for (const instance of instances) {
            if (!instance) continue;
            const isGitHubRouteInstance = instance.routerType === 'GitHubRoutes';
            const routesSignature = getInstanceRoutesSignature(instance);
            const key = isGitHubRouteInstance && routesSignature ?
                `${instance.routerType}:${instance.routerMode || ''}:${instance.routerBase || ''}:${routesSignature}` :
                '';

            if (key) {
                if (seen.has(key)) continue;
                seen.add(key);
            }
            result.push(instance);
        }
        return result;
    }

    function getResultSignature(result) {
        if (!result || !Array.isArray(result.instances)) return '';
        const instanceParts = result.instances.map(instance => {
            const routeKeys = getInstanceRoutesSignature(instance);
            return `${instance.rootId || ''}:${instance.routerType || ''}:${instance.routerMode || ''}:${instance.routerBase || ''}:${routeKeys}`;
        }).sort();
        return instanceParts.join('||');
    }

    function shouldUseHostFiberFallback() {
        if (!firstResultAt) return scanRound > 1;
        return Date.now() - firstResultAt >= HOST_FIBER_FALLBACK_DELAY_MS;
    }

    function isScanStableEnough() {
        if (!firstResultAt) return false;
        return stableScanCount >= STABLE_SCAN_LIMIT ||
            Date.now() - firstResultAt >= RESULT_COMPLETION_WINDOW_MS;
    }

    function tryGetRouter() {
        if (scanFinalized) return true;

        scanRound++;
        const startFibers = getReactStartFibers({
            includeHostFibers: shouldUseHostFiberFallback()
        });
        if (startFibers.length === 0) return false;
        const startRecords = Array.isArray(startFibers._records) && startFibers._records.length > 0 ?
            startFibers._records :
            startFibers.map((startFiber, index) => ({
                source: `startFiber#${index + 1}`,
                containerPath: '',
                rawFiber: startFiber,
                startFiber
            }));

        const collectedRoutes = []; // 汇总所有容器的路由
        const seenKeys = new Set(); // 去重用：name::path
        const recordsByRoot = new Map();
        for (const record of startRecords) {
            if (!record || !record.startFiber) continue;
            const rootKey = getRecordRootKey(record);
            const existing = recordsByRoot.get(rootKey);
            const source = record.source || '';
            const existingSource = existing && existing.source || '';
            const preferRecord = !existing ||
                (!source.includes('.root') && existingSource.includes('.root')) ||
                (!source.includes('.local') && existingSource.includes('.local'));
            if (preferRecord) recordsByRoot.set(rootKey, record);
        }
        const recordsToScan = Array.from(recordsByRoot.values());

        const instanceByRoot = new Map();
        let primaryType = null;
        let primaryMode = null;
        let primaryBase = '';
        let found = false;

        for (const record of recordsToScan) {
            const startFiber = record.startFiber;
            if (!startFiber) continue;

            const result = findRouterInFiber(startFiber);
            if (!result) continue;

            found = true;

            let routes = [];
            let mode = null;

            if (result.type === 'RouterProvider') {
                mode = detectRouterMode(result.router, startFiber);
                routes = extractRouterProviderRoutes(result.router.routes);
                debugLog(`\n[AntiDebug] React Router routes [RouterProvider - ${mode}]`);
                debugTable(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
                debugLog('\n[AntiDebug] Router instance:', result.router);
            } else if (result.type === 'GitHubRoutes') {
                routes = extractGitHubRoutes(result.routes);
                mode = detectRouterMode(null, startFiber);
                debugLog('\n[AntiDebug] React Router routes [GitHubRoutes]');
                debugTable(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
            } else if (result.type === 'ContextRoutes') {
                routes = extractRouterProviderRoutes(result.routes);
                mode = detectRouterMode(null, startFiber);
                debugLog('\n[AntiDebug] React Router routes [ContextRoutes]');
                debugTable(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
            } else if (result.type === 'LegacyRoutes') {
                routes = extractLegacyRoutes(result.routes);
                mode = detectRouterMode(null, startFiber);
                debugLog('\n[AntiDebug] React Router routes [LegacyRoutes]');
                debugTable(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
                debugLog('\n[AntiDebug] Raw routes:', result.routes);
            } else if (result.type === 'MenuRoutes') {
                routes = result.routes || [];
                mode = detectRouterMode(null, startFiber);
                debugLog('\n[AntiDebug] React Router routes [MenuRoutes fallback]');
                debugTable(routes.map(r => ({
                    Name: r.name || '(unnamed)',
                    Path: r.path
                })));
            } else {
                routes = extractJSXRoutes(result.props);
                debugLog('\n[AntiDebug] React Router routes [JSX Routes]');
                debugTable(routes.map(r => ({
                    Name: r.name || '(unnamed)',
                    Path: r.path
                })));
                mode = detectRouterMode(null, startFiber);
            }

            if (routes.length === 0) continue;

            const instanceBase = extractReactRouterBasename(startFiber, result);
            const instanceSeenKeys = new Set();
            const instanceRoutes = [];
            for (const route of routes) {
                const key = `${route.name || ''}::${route.path}`;
                if (!instanceSeenKeys.has(key)) {
                    instanceSeenKeys.add(key);
                    instanceRoutes.push(route);
                }
            }

            const rootKey = getRecordRootKey(record);
            const instanceCandidate = {
                rootId: getRootId(rootKey),
                source: record.source || '',
                containerPath: record.containerPath || '',
                routerType: result.type || 'Routes',
                routerMode: mode,
                routerBase: instanceBase,
                routes: instanceRoutes
            };

            const existing = instanceByRoot.get(rootKey);
            if (!existing || getInstanceScore(instanceCandidate) > getInstanceScore(existing)) {
                instanceByRoot.set(rootKey, instanceCandidate);
            }

            // 按优先级保留最重要的 type/mode/base。
            if (!primaryType ||
                (TYPE_PRIORITY[result.type] || 0) > (TYPE_PRIORITY[primaryType] || 0) ||
                ((TYPE_PRIORITY[result.type] || 0) === (TYPE_PRIORITY[primaryType] || 0) && !primaryMode && mode)
            ) {
                primaryType = result.type;
                primaryMode = mode;
                primaryBase = instanceBase;
            }

            // 按 name::path 去重后汇入总列表。
            for (const route of routes) {
                const key = `${route.name || ''}::${route.path}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    collectedRoutes.push(route);
                }
            }
        }

        const instances = dedupeGitHubRouteInstances(Array.from(instanceByRoot.values()));

        if (found && collectedRoutes.length > 0 && instances.length > 0) {
            hasOutputResult = true;
            const nextResult = {
                routerType: primaryType || 'Routes',
                routerMode: primaryMode,
                routerBase: primaryBase,
                routes: collectedRoutes,
                instances
            };
            const nextSignature = getResultSignature(nextResult);

            if (!firstResultAt) firstResultAt = Date.now();

            if (nextSignature !== lastResultSignature) {
                cachedResult = nextResult;
                lastResultSignature = nextSignature;
                stableScanCount = 0;
                console.log(`[AntiDebug] React Router scan updated: ${instances.length} instance(s), ${collectedRoutes.length} route(s)`);
                sendToExtension(cachedResult);
            } else {
                stableScanCount++;
            }

            if (isScanStableEnough()) {
                scanFinalized = true;
                return true;
            }

            return false;
        }

        return false;
    }

    // ===== DOM 变化监控（MutationObserver）=====
    // 用于应对 React 懒加载场景，在 DOM 发生变化时补扫。
    function startDOMObserver() {
        // 立即尝试一次。
        if (tryGetRouter()) {
            cleanupResources();
            return;
        }

        observer = new MutationObserver(() => {
            if (scanFinalized) return;
            if (tryGetRouter()) {
                cleanupResources();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    // ===== 清理资源 =====
    function cleanupResources() {
        hasOutputResult = true;
        scanFinalized = true;
        allTimeoutIds.forEach(id => clearTimeout(id));
        allTimeoutIds = [];
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    // ===== 指数退避轮询（兜底机制）=====
    // React 挂载时机不固定，用轮询减少遗漏。
    // 共尝试 6 次，间隔：200ms -> 400ms -> 800ms -> 1600ms -> 3200ms -> 6400ms。
    function startPollingRetry() {
        let delay = 200;
        let remainingTries = 6;

        function poll() {
            if (scanFinalized) return;

            if (tryGetRouter()) {
                cleanupResources();
                return;
            }

            if (remainingTries > 0) {
                remainingTries--;
                const id = setTimeout(poll, delay);
                allTimeoutIds.push(id);
                delay *= 2;
            } else if (hasOutputResult) {
                cleanupResources();
            } else {
                console.log('[AntiDebug] React Router instance not found after retries');
                cleanupResources();
            }
        }

        const id = setTimeout(poll, 200);
        allTimeoutIds.push(id);
    }

    // ===== 入口函数 =====
    function init() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                startDOMObserver();
                startPollingRetry();
            });
        } else {
            // DOM 已就绪，立即开始。
            startDOMObserver();
            startPollingRetry();
        }
    }

    init();

})();
