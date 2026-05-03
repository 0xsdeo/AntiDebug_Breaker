// ==UserScript==
// @name         Get_React
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      v0.1
// @description  获取React router路由
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
        console.warn('⚠️ React路由获取脚本已在运行中，跳过本次执行');
        return;
    }
    try {
        Object.defineProperty(window, LOCK_KEY, {
            value: true,
            writable: false,
            configurable: false
        });
    } catch (e) {
        console.warn('⚠️ 无法设置执行锁，脚本可能已在运行');
        return;
    }

    let observer = null;
    let allTimeoutIds = [];
    let hasOutputResult = false;
    let printedReactInstances = new WeakSet();
    let cachedResult = null; // 缓存找到的路由数据，供 REQUEST 时复用

    // ===== 站点特定标志 =====
    const IS_GITHUB = window.location.hostname === 'github.com';
    const REACT_CONTEXT_TYPE = Symbol.for('react.context');
    const REACT_CONSUMER_TYPE = Symbol.for('react.consumer');
    const REACT_PROVIDER_TYPE = Symbol.for('react.provider');
    const REACT_MEMO_TYPE = Symbol.for('react.memo');
    const REACT_FORWARD_REF_TYPE = Symbol.for('react.forward_ref');

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
                console.error('[AntiDebug] postMessage发送失败:', error);
            }
        }
    }

    // ===== 重新扫描 =====
    function restartScanning() {
        console.log('🔄 开始重新扫描React Router...');
        allTimeoutIds.forEach(id => clearTimeout(id));
        allTimeoutIds = [];
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        hasOutputResult = false;
        cachedResult = null;
        printedReactInstances = new WeakSet();
        startDOMObserver();
        startPollingRetry();
    }

    // ===== 监听插件请求（popup 打开时拉取缓存数据 / 触发重扫描）=====
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

    // ===== Phase 1: DOM层BFS扫描，寻找React挂载节点 =====
    // React在调用 createRoot(domNode) 或 ReactDOM.render() 后，
    // 会在挂载的DOM节点上注入一个带随机后缀的内部属性
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

            // 用 for...in 检测React内部挂载属性
            // React 18 createRoot: __reactContainer$<randomKey>
            // 某些版本:            __reactContainere$<randomKey>（多一个e）
            // React 17 render:     _reactRootContainer
            for (let prop in node) {
                if (
                    prop.startsWith('__reactContainer$') ||
                    prop.startsWith('__reactContainere$') ||
                    prop === '_reactRootContainer'
                ) {
                    results.push({
                        node,
                        prop,
                        value: node[prop]
                    });
                    break; // 一个节点只需找到一个挂载属性
                }
            }

            for (let i = 0; i < node.childNodes.length; i++) {
                queue.push(node.childNodes[i]);
            }
        }

        if (results.length > 0) {
            results.forEach(r => console.log(`[AntiDebug] 检测到React挂载节点：${r.prop} on`, r.node));
        }
        return results;
    }

    // ===== 从容器信息中取得Fiber树的起始节点 =====
    // 注意：__reactContainer$xxx 返回的是 HostRoot Fiber 本身（不是 FiberRoot！）
    // 因为 React 源码中 markContainerAsRoot(root.current, container)
    // 传入的是 root.current（HostRoot Fiber），而非 root（FiberRoot）
    //
    // 因此直接取 .child 即可得到第一个真实组件 Fiber，
    // 不能取 .current.child（Fiber 节点没有 .current 属性，那是 FiberRoot 的属性）
    function getStartFiber(containerInfo) {
        try {
            if (containerInfo.prop === '_reactRootContainer') {
                // React 版本差异导致结构不同，需两种都尝试：
                //
                // 方式A（React 17 常见结构）：
                //   _reactRootContainer = { _internalRoot: FiberRoot }
                //   FiberRoot.current = HostRoot Fiber
                //   HostRoot Fiber.child = 第一个组件 Fiber
                const fiberA = containerInfo.value ?._internalRoot ?.current ?.child;
                if (fiberA) {
                    console.log('[AntiDebug] _reactRootContainer（方式A _internalRoot）startFiber:', fiberA);
                    return fiberA;
                }

                // 方式B（旧版React / 某些构建）：
                //   _reactRootContainer = FiberRoot（直接带 .current）
                //   FiberRoot.current = HostRoot Fiber
                //   HostRoot Fiber.child = 第一个组件 Fiber
                const fiberB = containerInfo.value ?.current ?.child;
                if (fiberB) {
                    console.log('[AntiDebug] _reactRootContainer（方式B 直接current）startFiber:', fiberB);
                    return fiberB;
                }

                console.warn('[AntiDebug] _reactRootContainer 结构未识别:', containerInfo.value);
                return null;
            }

            // React 18: __reactContainer$xxx = HostRoot Fiber（不是FiberRoot！）
            //
            // 关键：__reactContainer$xxx 只在 createRoot 时被赋值一次。
            // 每次 render 提交后，React 会交换双缓冲区，FiberRoot.current 始终
            // 指向最新提交的树，而 __reactContainer$xxx 原来指向的 fiber 可能
            // 已变成 alternate（备用），其 .child 可能为 null。
            //
            // 正确路径：.stateNode（→FiberRoot）.current（→已提交的HostRoot）.child
            const fiberRoot = containerInfo.value ?.stateNode;
            const fiberA = fiberRoot ?.current ?.child;
            if (fiberA) {
                console.log('[AntiDebug] React 18 startFiber（via stateNode.current）:', fiberA);
                return fiberA;
            }
            // 兜底：直接取 .child（极少数情况下 alternate 上也有数据）
            const fiberB = containerInfo.value ?.child || null;
            console.log('[AntiDebug] React 18 startFiber（via direct child）:', fiberB);
            return fiberB;
        } catch (e) {
            console.warn('[AntiDebug] getStartFiber 出错:', e);
            return null;
        }
    }

    // ===== RouterProvider模式检测（v6 data router）=====
    // 对应 React Router v6 的 createBrowserRouter + <RouterProvider router={router} />
    // v6 data router 有专属方法 navigate / subscribe，v3/v4 router 没有
    // React DevTools 在没有容器入口时，也可以从宿主 DOM 节点反查 Fiber。
    // 这里不使用 DevTools hook，只参考这个方向：扫描 DOM 节点上的 __reactFiber$ / __reactInternalInstance$。
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
                for (let prop in node) {
                    if (
                        prop.startsWith('__reactFiber$') ||
                        prop.startsWith('__reactInternalInstance$')
                    ) {
                        const fiber = node[prop];
                        if (fiber && typeof fiber === 'object' && !seenFibers.has(fiber)) {
                            seenFibers.add(fiber);
                            results.push({
                                node,
                                prop,
                                fiber
                            });
                        }
                        break;
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
            console.log(`[AntiDebug] 检测到 ${results.length} 个 React Host Fiber 节点`);
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
            console.warn('[AntiDebug] getStartFiberFromHostFiber 出错:', e);
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

    function printReactInstances(records) {
        const newRecords = records.filter(record => {
            if (!record.startFiber || printedReactInstances.has(record.startFiber)) return false;
            printedReactInstances.add(record.startFiber);
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
                `[AntiDebug] React实例 #${index + 1} 来源=${record.source} 入口组件=${displayName}`,
                record.startFiber
            );
            if (record.rawFiber && record.rawFiber !== record.startFiber) {
                console.log(`[AntiDebug] React实例 #${index + 1} 原始Host Fiber:`, record.rawFiber);
            }
        });

        if (typeof console.groupEnd === 'function') {
            console.groupEnd();
        }
    }

    function getReactStartFibers() {
        const startFibers = [];
        const records = [];
        const seen = new WeakSet();

        const addStartFiber = (startFiber, source, rawFiber) => {
            if (!startFiber || typeof startFiber !== 'object' || seen.has(startFiber)) return;
            seen.add(startFiber);
            startFibers.push(startFiber);
            records.push({
                source,
                rawFiber,
                startFiber
            });
        };

        const containers = findReactContainers();
        for (const container of containers) {
            addStartFiber(getStartFiber(container), container.prop, container.value);
        }

        const hostFibers = findReactHostFibers();
        for (const item of hostFibers) {
            addStartFiber(getStartFiberFromHostFiber(item.fiber), item.prop, item.fiber);
            if (item.fiber && item.fiber.alternate) {
                addStartFiber(getStartFiberFromHostFiber(item.fiber.alternate), `${item.prop}.alternate`, item.fiber.alternate);
            }
        }

        printReactInstances(records);
        return startFibers;
    }

    function isRouterProvider(props) {
        if (!props || typeof props !== 'object') return false;
        const router = props.router;
        if (!router || typeof router !== 'object') return false;
        if (!Array.isArray(router.routes)) return false;
        // v6 data router 必有 navigate 方法；v3/v4 router 没有（用 push/transitionTo）
        // 这是区分两者最可靠的特征
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
        // v3/v4 router 的专属方法
        if (typeof router.getCurrentLocation === 'function' ||
            typeof router.transitionTo === 'function' ||
            typeof router.listenBefore === 'function') {
            return true;
        }
        // 或者 routes 数组中含有 v3/v4 专有字段
        return router.routes.some(r =>
            r && typeof r === 'object' && ('childRoutes' in r || 'getComponent' in r || 'indexRoute' in r)
        );
    }

    // ===== React Router v3/v4 Legacy 模式检测 =====
    // 两种存放位置：
    //   1. props.routes（直接是路由数组）
    //   2. props.router.routes（routes 挂在 history-like 的 router 对象上）
    function isLegacyRouterRoutes(props) {
        if (!props || typeof props !== 'object') return false;

        // Case 1: props.routes 直接是路由数组
        if (Array.isArray(props.routes) && props.routes.length > 0) {
            if (props.routes.some(r =>
                    r && typeof r === 'object' && 'path' in r &&
                    ('component' in r || 'getComponent' in r || 'childRoutes' in r || 'indexRoute' in r)
                )) return true;
        }

        // Case 2: props.router 是 v3/v4 history-like router，routes 在其上
        if (isLegacyRouterObject(props.router)) return true;

        return false;
    }

    // ===== 从检测到的 props 中提取 v3/v4 routes 数组 =====
    function getLegacyRoutes(props) {
        if (Array.isArray(props.routes) && props.routes.length > 0) return props.routes;
        if (isLegacyRouterObject(props.router)) return props.router.routes;
        return [];
    }

    // ===== GitHub 专属路由检测 =====
    // GitHub 使用自研路由层，路由对象中用 Component（大写）+ GitHub 专属字段，
    // 而非标准 React Router 的 component（小写）/ getComponent / childRoutes
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
    // RouterProvider 模式：直接读 result.router.basename（getter）
    // JSX / Legacy 模式：遍历 Fiber 依赖上下文链，找携带 basename 的 React Context 值
    function extractReactRouterBasename(startFiber, result) {
        // RouterProvider / 嵌套搜索命中的 RouterProvider：直接访问 router.basename
        if (result.router) {
            try {
                const bn = result.router.basename;
                if (typeof bn === 'string' && bn !== '/' && bn.trim() !== '') return bn;
            } catch (e) {}
        }

        // JSX Routes / Legacy：走 Fiber 依赖上下文链
        // 路径示例：fiber.dependencies.firstContext.next.memoizedValue.basename
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
                if (fiber.dependencies) {
                    let ctx = fiber.dependencies.firstContext;
                    while (ctx) {
                        const val = ctx.memoizedValue;
                        if (val && typeof val === 'object') {
                            const bn = val.basename;
                            if (typeof bn === 'string' && bn !== '/' && bn.trim() !== '') return bn;
                        }
                        ctx = ctx.next;
                    }
                }
            } catch (e) {}
            if (fiber.child) queue.push(fiber.child);
        }
        return '';
    }

    // ===== JSX <Routes>/<Route> 模式检测 =====
    // 对应 React Router v5/v6 的 JSX 写法：<Routes><Route path="/" element={...} /></Routes>
    // 路由信息分散在各个 React Element 的 props 里
    //
    // 注意：这里使用宽松的 OR 逻辑，而非严格的 AND 逻辑。
    // 原因：v6 支持多种合法 Route 写法——
    //   ① path-only：<Route path="/about" />（无 element，渲染 null）
    //   ② lazy：<Route path="/home" lazy={() => import('./Home')} />（无 element）
    //   ③ layout route：<Route element={<Layout/>}>（无 path，包裹子路由）
    //   ④ index route：<Route index element={<Home/>} />（无 path）
    // 严格要求 path + element/component 会误杀这些合法情况。
    // 潜在假阳性（如普通组件带 path prop）由两阶段策略兜底：
    // JSX Routes 仅保存为候选，LegacyRoutes / RouterProvider 优先立刻返回。
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
            // React Router v5 的 Redirect：<Redirect to="/login" from="/old" />
            // 没有 path，但有 to（目标）或 from（来源）
            typeof p.to === 'string' ||
            typeof p.from === 'string'
        );
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
    // 针对 router 不直接放在 fiber.memoizedProps 顶层，
    // 而是藏在 props.children.props.children.props.router 这类 React Element 嵌套中的情况。
    //
    // 规则：
    //   - 每层只检测 RouterProvider / LegacyRoutes / GitHubRoutes（不含 JSX Routes，太宽泛）
    //   - 沿 .children（单元素或数组）向下递归，maxDepth 控制最大深度
    //   - 默认 maxDepth=4，覆盖最多 3 层嵌套（已足够 GitHub 2层、其他常见 1层场景）
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

    // ===== Phase 2: Fiber树BFS扫描，寻找Router实例 =====
    // 导航策略：只沿 child 和 sibling 前进，绝不将 alternate 加入队列。
    // 额外读取 fiber.alternate 的 props（不遍历其子树），
    // 应对路由数据仅存在于 alternate fiber 上的情况。
    //
    // 返回优先级策略（从高到低）：
    //   RouterProvider → 立即返回（最可靠，特征极明确）
    //   LegacyRoutes   → 立即返回（可靠，有 routes 数组且带框架特有字段）
    //   GitHubRoutes   → 立即返回（GitHub 专属，仅 github.com 生效）
    //   JSX Routes     → 仅作候选，继续扫完整棵树后若无更好结果才返回
    //                   （最易误判，普通组件的 children 也可能满足条件）
    //   以上均未命中时，searchNestedReactElements 向 React Element 嵌套链中补充搜索
    function findRouterInFiber(startFiber) {
        if (!startFiber) return null;

        const queue = [startFiber];
        const visited = new WeakSet();
        // 企业级 React 应用组件数量庞大，且 Routes 可能藏在某个 sibling 子树深处。
        // BFS 必须先遍历完 sibling 之前所有子树才能到达目标，
        // 3000 对复杂应用往往不够用，提升到 15000 覆盖更多场景。
        const MAX_NODES = 15000;
        let count = 0;
        let jsxRoutesCandidate = null; // JSX Routes 命中时不立刻返回，保存为候选

        while (queue.length > 0 && count < MAX_NODES) {
            const fiber = queue.shift();
            count++;

            if (!fiber || typeof fiber !== 'object') continue;
            if (visited.has(fiber)) continue;
            visited.add(fiber);

            // 收集需要检测的 props 来源：
            // 1. 当前 fiber 的 memoizedProps / pendingProps
            // 2. alternate fiber 的 memoizedProps / pendingProps
            //    （路由数据有时仅存于 alternate，不加入队列只读其 props）
            const propsSources = [fiber.memoizedProps, fiber.pendingProps];
            if (fiber._currentElement && fiber._currentElement.props) {
                propsSources.push(fiber._currentElement.props);
            }
            if (fiber.stateNode && fiber.stateNode.props) {
                propsSources.push(fiber.stateNode.props);
            }
            const contextRouter = searchRouterInFiberContext(fiber);
            if (contextRouter) return contextRouter;

            const alt = fiber.alternate;
            if (alt && alt !== fiber && !visited.has(alt)) {
                propsSources.push(alt.memoizedProps, alt.pendingProps);
                if (alt.stateNode && alt.stateNode.props) {
                    propsSources.push(alt.stateNode.props);
                }
            }

            for (const props of propsSources) {
                if (!props || typeof props !== 'object') continue;

                // RouterProvider：立即返回，特征最明确
                if (isRouterProvider(props)) {
                    return {
                        type: 'RouterProvider',
                        router: props.router
                    };
                }
                // LegacyRoutes：立即返回，v3/v4 特有结构
                if (isLegacyRouterRoutes(props)) {
                    return {
                        type: 'LegacyRoutes',
                        routes: getLegacyRoutes(props)
                    };
                }
                // GitHub 专属路由：立即返回（仅在 github.com 生效）
                if (isGitHubRoutes(props)) {
                    return {
                        type: 'GitHubRoutes',
                        routes: props.routes
                    };
                }
                // JSX Routes：仅保存第一个命中，继续扫描不返回
                // 避免因浅层误判提前退出，错过更深处的真实路由
                if (!jsxRoutesCandidate) {
                    const jsxCandidate = getJSXRoutesCandidate(props, fiber);
                    if (jsxCandidate) {
                        jsxRoutesCandidate = jsxCandidate;
                    }
                }
                // 以上均未命中：向 React Element 嵌套链补充搜索（最多 3 层深）
                // 处理 router 藏在 props.children.props.children.props.router 等场景
                const nested = searchNestedReactElements(props, 4);
                if (nested) return nested;
            }

            // 严格只走Fiber树导航链路
            if (fiber.child) queue.push(fiber.child);
            if (fiber.sibling) queue.push(fiber.sibling);
            getLegacyReactInstanceChildren(fiber).forEach(child => queue.push(child));
        }

        if (count >= MAX_NODES) {
            console.warn('[AntiDebug] ⚠️ Fiber树遍历达到上限（3000节点），可能未完整扫描');
        } else if (!jsxRoutesCandidate) {
            console.log(`[AntiDebug] Fiber树遍历完毕，共访问 ${count} 个节点，未找到Router`);
        }

        // RouterProvider / LegacyRoutes 未找到，用 JSX Routes 候选兜底（可能为误判）
        return jsxRoutesCandidate || null;
    }

    // ===== 路由提取：React Router v3/v4 Legacy 模式 =====
    // 路由结构：{ path, name, component/getComponent, childRoutes, indexRoute }
    // 子路由字段是 childRoutes（不是 children）
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

            // 递归处理 childRoutes（v3/v4 的嵌套路由字段）
            if (Array.isArray(route.childRoutes) && route.childRoutes.length > 0) {
                list.push(...extractLegacyRoutes(route.childRoutes, fullPath));
            }
        }
        return list;
    }

    // ===== 路由提取：RouterProvider模式 =====
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
            // 递归处理子路由
            if (Array.isArray(route.children) && route.children.length > 0) {
                list.push(...extractRouterProviderRoutes(route.children, fullPath));
            }
        }
        return list;
    }

    // ===== 路由提取：JSX Routes模式 =====
    // 从 React Element 树的 props.children 中递归提取 path
    function extractJSXRoutes(props, prefix) {
        prefix = prefix || '';
        const list = [];
        if (!props || !props.children) return list;

        const subs = Array.isArray(props.children) ? props.children : [props.children];
        for (const sub of subs) {
            if (!sub || typeof sub !== 'object') continue;
            const p = sub.props;
            if (!p) continue;

            let routePrefix = prefix; // 子路由递归时使用的 base path

            if (typeof p.path === 'string') {
                // 常规字符串 path
                const fullPath = joinPath(prefix, p.path);
                list.push({
                    name: '',
                    path: fullPath
                });
                routePrefix = fullPath;
            } else if (Array.isArray(p.path) && p.path.length > 0) {
                // React Router v5：path 可为数组，如 <Route path={['/login', '/signup']} />
                // 每个路径单独展开为一条路由
                for (const singlePath of p.path) {
                    if (typeof singlePath === 'string') {
                        list.push({
                            name: '',
                            path: joinPath(prefix, singlePath)
                        });
                    }
                }
                // 子路由以数组第一个 path 为 base
                if (typeof p.path[0] === 'string') {
                    routePrefix = joinPath(prefix, p.path[0]);
                }
            } else {
                // React Router v5 Redirect：没有 path，但有 from / to
                // from 是来源路径（用户可访问的路径）
                // to  是目标路径（catch-all 时用于表示默认落地页）
                if (typeof p.from === 'string') {
                    list.push({
                        name: '(redirect)',
                        path: joinPath(prefix, p.from)
                    });
                }
                if (typeof p.to === 'string') {
                    list.push({
                        name: '(redirect→)',
                        path: joinPath(prefix, p.to)
                    });
                }
            }

            // 递归处理嵌套 Route（带布局路由的情况）
            if (p.children) {
                list.push(...extractJSXRoutes(p, routePrefix));
            }
        }
        return list;
    }

    // ===== 检测路由模式（browser / hash / memory） =====
    function detectRouterMode(router) {
        try {
            const ctorName = router.history ?.constructor ?.name || '';
            if (ctorName.toLowerCase().includes('hash')) return 'hash';
            if (ctorName.toLowerCase().includes('memory')) return 'memory';
        } catch (e) {}
        if (typeof window.location.hash === 'string' && window.location.hash.startsWith('#/')) {
            return 'hash';
        }
        return 'browser';
    }

    // ===== 主尝试函数：串联两阶段扫描并输出结果 =====
    // 类型优先级：RouterProvider > GitHubRoutes > LegacyRoutes > Routes
    const TYPE_PRIORITY = {
        RouterProvider: 4,
        GitHubRoutes: 3,
        ContextRoutes: 3,
        LegacyRoutes: 2,
        Routes: 1
    };

    function tryGetRouter() {
        if (hasOutputResult) return true;

        const startFibers = getReactStartFibers();
        if (startFibers.length === 0) return false;

        const collectedRoutes = []; // 汇总所有容器的路由
        const seenKeys = new Set(); // 去重用：name::path
        let primaryType = null;
        let primaryMode = 'browser';
        let primaryBase = '';
        let found = false;

        for (const startFiber of startFibers) {
            if (!startFiber) continue;

            const result = findRouterInFiber(startFiber);
            if (!result) continue;

            found = true;

            let routes = [];
            let mode = 'browser';

            if (result.type === 'RouterProvider') {
                mode = detectRouterMode(result.router);
                routes = extractRouterProviderRoutes(result.router.routes);
                console.log(`\n📋 React Router 路由列表 [RouterProvider - ${mode} 模式]：`);
                console.table(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
                console.log('\n🔗 Router 实例：', result.router);
            } else if (result.type === 'GitHubRoutes') {
                routes = extractGitHubRoutes(result.routes);
                mode = 'browser';
                console.log('\n📋 React Router 路由列表 [GitHub 自研路由]：');
                console.table(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
            } else if (result.type === 'ContextRoutes') {
                routes = extractRouterProviderRoutes(result.routes);
                mode = detectRouterMode({});
                console.log('\n[AntiDebug] React Router 路由列表 [Context routes 模式]:');
                console.table(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
            } else if (result.type === 'LegacyRoutes') {
                routes = extractLegacyRoutes(result.routes);
                console.log('\n📋 React Router 路由列表 [v3/v4 Legacy 模式]：');
                console.table(routes.map(r => ({
                    Name: r.name,
                    Path: r.path
                })));
                console.log('\n🔗 原始 routes：', result.routes);
            } else {
                routes = extractJSXRoutes(result.props);
                console.log('\n📋 React Router 路由列表 [JSX <Routes> 模式]：');
                console.table(routes.map(r => ({
                    Name: r.name || '(unnamed)',
                    Path: r.path
                })));
                mode = detectRouterMode({});
            }

            // 按优先级保留最重要的 type/mode/base
            if (!primaryType || (TYPE_PRIORITY[result.type] || 0) > (TYPE_PRIORITY[primaryType] || 0)) {
                primaryType = result.type;
                primaryMode = mode;
                primaryBase = extractReactRouterBasename(startFiber, result);
            }

            // 按 name::path 去重后汇入总列表
            for (const route of routes) {
                const key = `${route.name || ''}::${route.path}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    collectedRoutes.push(route);
                }
            }
        }

        if (found) {
            hasOutputResult = true;
            if (collectedRoutes.length > 0) {
                cachedResult = {
                    routerType: primaryType || 'Routes',
                    routerMode: primaryMode,
                    routerBase: primaryBase,
                    routes: collectedRoutes
                };
                sendToExtension(cachedResult);
            }
        }

        return found;
    }

    // ===== DOM变化监控（MutationObserver） =====
    // 用于应对 React 懒加载场景，在DOM发生变化时补扫
    function startDOMObserver() {
        // 立即尝试一次
        if (tryGetRouter()) {
            cleanupResources();
            return;
        }

        observer = new MutationObserver(() => {
            if (hasOutputResult) return;
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
        allTimeoutIds.forEach(id => clearTimeout(id));
        allTimeoutIds = [];
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    // ===== 指数退避轮询（兜底机制） =====
    // React 挂载时机不固定，用轮询保证不遗漏
    // 共尝试6次，间隔：200ms → 400ms → 800ms → 1600ms → 3200ms → 6400ms
    function startPollingRetry() {
        let delay = 200;
        let remainingTries = 6;

        function poll() {
            if (hasOutputResult) return;

            if (tryGetRouter()) {
                cleanupResources();
                return;
            }

            if (remainingTries > 0) {
                remainingTries--;
                const id = setTimeout(poll, delay);
                allTimeoutIds.push(id);
                delay *= 2;
            } else {
                console.log('❌ 未找到React Router实例（已重试多次，请确认站点是否使用React Router）');
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
            // DOM 已就绪，立即开始
            startDOMObserver();
            startPollingRetry();
        }
    }

    init();

})();
