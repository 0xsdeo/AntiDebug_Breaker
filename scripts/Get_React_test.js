// ==UserScript==
// @name         Get_React_test
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      v0.1
// @description  Aggressive React Router path detector for research/debugging
// @author       0xsdeo
// @run-at       document-start
// @match        *://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const OUTPUT_BASE_URL_ONLY = true;
    const LOCK_KEY = '__ANTIDEBUG_REACT_TEST_RUNNING__';
    if (window[LOCK_KEY]) {
        if (!OUTPUT_BASE_URL_ONLY) console.warn('[AntiDebug][React Test] script already running, skipped');
        return;
    }
    try {
        Object.defineProperty(window, LOCK_KEY, {
            value: true,
            writable: false,
            configurable: false
        });
    } catch (e) {
        if (!OUTPUT_BASE_URL_ONLY) console.warn('[AntiDebug][React Test] failed to create lock:', e);
        return;
    }

    const CONFIG = {
        maxDomNodes: 30000,
        maxDepth: 48,
        maxVisitedObjects: 80000,
        maxQueueSize: 120000,
        maxResultsPerType: 120,
        maxRoutesPreview: 80,
        retryDelays: [200, 800, 1600, 3200, 6400]
    };

    const REACT_ENTRY_PREFIXES = [
        '__reactContainer$',
        '__reactContainere$',
        '__reactFiber$',
        '__reactInternalInstance$',
        '__reactProps$'
    ];

    const REACT_ENTRY_EXACT = new Set([
        '_reactRootContainer',
        '_reactInternalInstance',
        '_reactInternals'
    ]);

    const SKIP_PROPS = new Set([
        '__proto__',
        'prototype',
        'constructor',
        'caller',
        'callee',
        'arguments',
        'parent',
        'window',
        'top',
        'self',
        'opener',
        'frames',
        'globalThis',
        'document',
        'ownerDocument',
        'parentNode',
        'parentElement',
        'offsetParent',
        'previousSibling',
        'previousElementSibling',
        'return',
        '_owner',
        '_debugOwner',
        '_debugSource',
        '_debugHookTypes',
        'containerInfo',
        'baseURI',
        'innerHTML',
        'outerHTML',
        'textContent',
        'innerText',
        'style',
        'sheet',
        'cssRules',
        'rules',
        'adoptedStyleSheets'
    ]);

    const DOM_EDGE_PROPS = [
        'firstElementChild',
        'lastElementChild',
        'nextElementSibling',
        'firstChild',
        'lastChild'
    ];

    const seenResultKeys = new Set();
    const printedRootObjects = new WeakSet();
    let scanAttempt = 0;
    let scanFinished = false;
    let retryTimers = [];

    function isObjectLike(value) {
        return value !== null && (typeof value === 'object' || typeof value === 'function');
    }

    function isWindowObject(value) {
        try {
            return typeof Window !== 'undefined' && value instanceof Window;
        } catch (e) {
            return false;
        }
    }

    function isDomNode(value) {
        try {
            return typeof Node !== 'undefined' && value instanceof Node;
        } catch (e) {
            return false;
        }
    }

    function isValidIdentifier(prop) {
        return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(prop);
    }

    function quoteString(value) {
        return JSON.stringify(String(value));
    }

    function pathJoinProp(path, prop) {
        if (/^(0|[1-9]\d*)$/.test(prop)) return `${path}[${prop}]`;
        if (isValidIdentifier(prop)) return `${path}.${prop}`;
        return `${path}[${quoteString(prop)}]`;
    }

    function safeRead(obj, prop) {
        try {
            return {
                ok: true,
                value: obj[prop]
            };
        } catch (error) {
            return {
                ok: false,
                error
            };
        }
    }

    function getAllPropertyNames(obj) {
        const names = new Set();
        try {
            for (const prop in obj) {
                names.add(prop);
            }
        } catch (e) {}

        if (!isDomNode(obj) && typeof obj !== 'function') {
            try {
                Object.getOwnPropertyNames(obj).forEach(prop => names.add(prop));
            } catch (e) {}
        }

        return Array.from(names);
    }

    function getDomPath(node) {
        if (!node || node.nodeType !== 1) return 'document';

        try {
            if (node.id) {
                return `document.getElementById(${quoteString(node.id)})`;
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
        return `document.querySelector(${quoteString(parts.join(' > '))})`;
    }

    function isReactEntryProp(prop) {
        return REACT_ENTRY_EXACT.has(prop) || REACT_ENTRY_PREFIXES.some(prefix => prop.startsWith(prefix));
    }

    function findReactEntries() {
        const entries = [];
        const queue = [];
        const visited = new Set();
        let count = 0;

        if (document.documentElement) queue.push(document.documentElement);
        if (document.body && document.body !== document.documentElement) queue.push(document.body);

        while (queue.length > 0 && count < CONFIG.maxDomNodes) {
            const node = queue.shift();
            if (!node || visited.has(node)) continue;
            visited.add(node);
            count++;

            if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) continue;

            for (const prop in node) {
                if (!isReactEntryProp(prop)) continue;
                const read = safeRead(node, prop);
                if (!read.ok || !isObjectLike(read.value)) continue;

                entries.push({
                    node,
                    prop,
                    value: read.value,
                    path: pathJoinProp(getDomPath(node), prop)
                });
            }

            const childNodes = node.childNodes || [];
            for (let i = 0; i < childNodes.length; i++) {
                queue.push(childNodes[i]);
            }
        }

        return entries;
    }

    function describeComponent(value) {
        try {
            const type = value && (value.type || value.elementType);
            if (typeof type === 'string') return type;
            if (typeof type === 'function') return type.displayName || type.name || '(anonymous function)';
            if (typeof type === 'symbol') return String(type);
            if (type && typeof type === 'object') {
                return type.displayName || type.name || type.$$typeof && String(type.$$typeof) || '(object type)';
            }
        } catch (e) {}
        return '(unknown)';
    }

    function isRouteObject(value) {
        if (!value || typeof value !== 'object') return false;
        if (typeof value.path === 'string') return true;
        if (typeof value.to === 'string') return true;
        if (typeof value.from === 'string') return true;
        if (typeof value.redirect === 'string') return true;
        if (typeof value.redirectTo === 'string') return true;
        if (Array.isArray(value.children) || Array.isArray(value.childRoutes)) return true;
        if (value.index === true) return true;
        if ('component' in value || 'Component' in value || 'element' in value || 'getComponent' in value || 'render' in value || 'loader' in value || 'lazy' in value || 'action' in value || 'meta' in value || 'auth' in value) return true;
        if ((typeof value.name === 'string' || typeof value.title === 'string' || typeof value.id === 'string') &&
            (Array.isArray(value.children) || Array.isArray(value.routes) || Array.isArray(value.routeConfig))) return true;
        return false;
    }

    function isRoutesArray(value) {
        if (!Array.isArray(value) || value.length === 0) return false;

        let routeLikeCount = 0;
        let checkedCount = 0;
        let pathCount = 0;
        for (const item of value) {
            if (!item) continue;
            checkedCount++;
            if (isRouteObject(item)) routeLikeCount++;
            if (item && typeof item === 'object' && (typeof item.path === 'string' || typeof item.to === 'string' || item.index === true)) {
                pathCount++;
            }
            if (checkedCount >= 20) break;
        }

        if (checkedCount === 0) return false;
        if (pathCount > 0 && routeLikeCount > 0) return true;
        return routeLikeCount >= Math.ceil(checkedCount * 0.5);
    }

    function getNamedRouteArrays(value) {
        if (!value || typeof value !== 'object') return [];
        const candidates = [
            'routes',
            'routeConfig',
            'routeConfigs',
            'routesConfig',
            'routerConfig',
            'menus',
            'menuRoutes',
            'asyncRoutes',
            'constantRoutes',
            'children',
            'childRoutes'
        ];
        const out = [];
        for (const prop of candidates) {
            try {
                if (isRoutesArray(value[prop])) {
                    out.push({
                        prop,
                        value: value[prop]
                    });
                }
            } catch (e) {}
        }
        return out;
    }

    function isReactElement(value) {
        if (!value || typeof value !== 'object') return false;
        if (!value.props || typeof value.props !== 'object') return false;
        try {
            return value.$$typeof && String(value.$$typeof).includes('react');
        } catch (e) {
            return true;
        }
    }

    function isRouteElement(value) {
        if (!isReactElement(value)) return false;
        const props = value.props || {};
        if (typeof props.path === 'string' || typeof props.to === 'string') return true;
        if ('component' in props || 'Component' in props || 'element' in props || 'render' in props) return true;

        const children = props.children;
        if (!children || typeof children !== 'object') return false;
        const list = Array.isArray(children) ? children : [children];
        let routeChildren = 0;
        let checked = 0;
        for (const child of list) {
            if (!child) continue;
            checked++;
            if (Array.isArray(child)) {
                if (child.some(isRouteElement)) routeChildren++;
            } else if (isRouteElement(child)) {
                routeChildren++;
            }
        }
        return checked > 0 && routeChildren > 0;
    }

    function getPropsObject(value) {
        if (!value || typeof value !== 'object') return null;
        if (value.props && typeof value.props === 'object') return value.props;
        if (value.pendingProps && typeof value.pendingProps === 'object') return value.pendingProps;
        if (value.memoizedProps && typeof value.memoizedProps === 'object') return value.memoizedProps;
        return null;
    }

    function isRoutesComponent(value) {
        const props = getPropsObject(value);
        if (!props || !props.children) return false;
        const children = Array.isArray(props.children) ? props.children : [props.children];

        let checked = 0;
        let routeLike = 0;
        for (const child of children) {
            if (!child) continue;
            checked++;
            if (Array.isArray(child)) {
                if (child.some(isRouteElement)) routeLike++;
            } else if (isRouteElement(child)) {
                routeLike++;
            }
        }
        return checked > 0 && routeLike > 0;
    }

    function isRouterProviderObject(value) {
        if (!value || typeof value !== 'object') return false;
        const router = value.router || value;
        if (!router || typeof router !== 'object') return false;
        if (!Array.isArray(router.routes)) return false;
        if (typeof router.navigate === 'function') return true;
        if (typeof router.subscribe === 'function') return true;
        if (typeof router.createHref === 'function') return true;
        return isRoutesArray(router.routes);
    }

    function normalizePath(path) {
        if (path === undefined || path === null || path === '') return '/';
        if (typeof path !== 'string') return '/';
        return path;
    }

    function joinRoutePath(base, path) {
        path = normalizePath(path);
        if (path === '*') return base ? `${base.replace(/\/$/, '')}/*` : '/*';
        if (path.startsWith('/')) return path;
        if (!base || base === '/') return `/${path}`;
        return `${base.replace(/\/$/, '')}/${path}`;
    }

    function extractRoutesFromRouteArray(routes, prefix, out, limit) {
        if (!Array.isArray(routes) || out.length >= limit) return;

        for (const route of routes) {
            if (!route || typeof route !== 'object' || out.length >= limit) continue;
            const hasPath = typeof route.path === 'string' || typeof route.to === 'string';
            const path = hasPath ? joinRoutePath(prefix || '', route.path || route.to) : (prefix || '/');

            if (hasPath || route.index === true) {
                out.push({
                    name: route.id || route.name || '(unnamed)',
                    path: route.index === true ? (prefix || '/') : path
                });
            }

            if (Array.isArray(route.children)) {
                extractRoutesFromRouteArray(route.children, path, out, limit);
            }
            if (Array.isArray(route.childRoutes)) {
                extractRoutesFromRouteArray(route.childRoutes, path, out, limit);
            }
        }
    }

    function extractJSXRoutesFromElement(element, prefix, out, limit) {
        if (!element || typeof element !== 'object' || out.length >= limit) return;
        if (Array.isArray(element)) {
            element.forEach(item => extractJSXRoutesFromElement(item, prefix, out, limit));
            return;
        }

        const props = element.props || element.pendingProps || element.memoizedProps;
        if (!props || typeof props !== 'object') return;

        let currentPrefix = prefix || '';
        if (typeof props.path === 'string' || typeof props.to === 'string') {
            const fullPath = joinRoutePath(prefix || '', props.path || props.to);
            out.push({
                name: element.key || props.name || '(unnamed)',
                path: fullPath
            });
            currentPrefix = fullPath;
        }

        const children = props.children;
        if (children && typeof children === 'object') {
            const list = Array.isArray(children) ? children : [children];
            list.forEach(child => extractJSXRoutesFromElement(child, currentPrefix, out, limit));
        }
    }

    function previewRoutes(value) {
        const routes = [];
        if (Array.isArray(value)) {
            extractRoutesFromRouteArray(value, '', routes, CONFIG.maxRoutesPreview);
        } else if (isRouterProviderObject(value)) {
            const router = value.router || value;
            extractRoutesFromRouteArray(router.routes, '', routes, CONFIG.maxRoutesPreview);
        } else if (isRoutesComponent(value) || isRouteElement(value)) {
            const props = getPropsObject(value);
            const children = props && props.children ? props.children : value;
            extractJSXRoutesFromElement(children, '', routes, CONFIG.maxRoutesPreview);
        }

        const seen = new Set();
        return routes.filter(route => {
            const key = `${route.name}|${route.path}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    function detectCreateHrefInfo(fn, thisArg) {
        const testPath = '/__antidebug_react_test__';
        const testMarker = '__antidebug_react_test__';
        if (typeof fn !== 'function') return null;
        const candidates = [
            {
                pathname: testPath,
                search: '',
                hash: ''
            },
            testPath
        ];

        for (const candidate of candidates) {
            try {
                const href = fn.call(thisArg, candidate);
                if (typeof href !== 'string') continue;
                if (!href.includes(testMarker)) continue;
                return {
                    mode: href.includes('#') ? 'hash' : 'history',
                    href,
                    validCreateHref: true
                };
            } catch (e) {}
        }
        return null;
    }

    function detectModeByCreateHref(fn, thisArg) {
        const info = detectCreateHrefInfo(fn, thisArg);
        return info ? info.mode : null;
    }

    function getEdges(value, path) {
        const edges = [];
        if (!isObjectLike(value) || isWindowObject(value)) return edges;

        if (isDomNode(value)) {
            for (const prop in value) {
                if (isReactEntryProp(prop)) {
                    const read = safeRead(value, prop);
                    if (read.ok && isObjectLike(read.value)) {
                        edges.push({
                            prop,
                            value: read.value,
                            path: pathJoinProp(path, prop)
                        });
                    }
                }
            }

            for (const prop of DOM_EDGE_PROPS) {
                const read = safeRead(value, prop);
                if (read.ok && read.value) {
                    edges.push({
                        prop,
                        value: read.value,
                        path: pathJoinProp(path, prop)
                    });
                }
            }
            return edges;
        }

        const props = getAllPropertyNames(value);
        for (const prop of props) {
            if (SKIP_PROPS.has(prop)) continue;
            if (prop.startsWith('on') && prop.length > 2) continue;

            const read = safeRead(value, prop);
            if (!read.ok) continue;
            edges.push({
                prop,
                value: read.value,
                path: pathJoinProp(path, prop)
            });
        }

        return edges;
    }

    function addResult(results, type, path, value, meta) {
        const key = `${type}|${path}`;
        if (seenResultKeys.has(key)) return false;
        seenResultKeys.add(key);

        const sameTypeCount = results.filter(item => item.type === type).length;
        if (sameTypeCount >= CONFIG.maxResultsPerType) return false;

        const result = {
            type,
            path,
            value,
            meta: meta || {}
        };
        results.push(result);

        const routePreview = result.meta.routes || [];
        const header = `[AntiDebug][React Test] found ${type}: ${path}`;
        if (OUTPUT_BASE_URL_ONLY) return true;
        if (routePreview.length) {
            console.groupCollapsed(`${header} (${routePreview.length} routes preview)`);
            console.log('object:', value);
            console.log('meta:', result.meta);
            console.table(routePreview);
            console.groupEnd();
        } else {
            console.log(header, result.meta, value);
        }
        return true;
    }

    function inspectValue(results, value, path, parent, prop) {
        if (!isObjectLike(value)) {
            if ((prop === 'basename' || prop === 'base') && typeof value === 'string') {
                addResult(results, 'basename', path, value, {
                    value
                });
            }
            return;
        }

        if (prop === 'createHref' && typeof value === 'function') {
            const createHrefInfo = detectCreateHrefInfo(value, parent);
            addResult(results, 'createHref', path, value, createHrefInfo || {});
            return;
        }

        try {
            if (typeof value.createHref === 'function') {
                const createHrefInfo = detectCreateHrefInfo(value.createHref, value);
                addResult(results, 'createHrefOwner', path, value, {
                    createHrefPath: pathJoinProp(path, 'createHref'),
                    ...(createHrefInfo || {})
                });
            }
        } catch (e) {}

        try {
            if (typeof value.basename === 'string') {
                addResult(results, 'basenameOwner', path, value, {
                    basenamePath: pathJoinProp(path, 'basename'),
                    value: value.basename
                });
            }
        } catch (e) {}

        if (isRouterProviderObject(value)) {
            addResult(results, 'RouterProvider/router', path, value, {
                component: describeComponent(value),
                routes: previewRoutes(value)
            });
        }

        if (isRoutesArray(value)) {
            addResult(results, 'routesArray', path, value, {
                routes: previewRoutes(value)
            });
        }

        const namedRouteArrays = getNamedRouteArrays(value);
        for (const item of namedRouteArrays) {
            addResult(results, 'routesArray', pathJoinProp(path, item.prop), item.value, {
                ownerPath: path,
                ownerComponent: describeComponent(value),
                field: item.prop,
                routes: previewRoutes(item.value)
            });
        }

        if (isRoutesComponent(value)) {
            addResult(results, 'JSXRoutesComponent', path, value, {
                component: describeComponent(value),
                routes: previewRoutes(value)
            });
        } else if (isRouteElement(value)) {
            addResult(results, 'JSXRouteElement', path, value, {
                component: describeComponent(value),
                routes: previewRoutes(value)
            });
        }
    }

    function deepScan(root, rootPath) {
        const results = [];
        const queue = [{
            value: root,
            path: rootPath,
            depth: 0
        }];
        const visited = new WeakSet();
        let visitedCount = 0;

        while (queue.length > 0) {
            if (visitedCount >= CONFIG.maxVisitedObjects) {
                if (!OUTPUT_BASE_URL_ONLY) console.warn(`[AntiDebug][React Test] object scan reached limit (${CONFIG.maxVisitedObjects})`);
                break;
            }

            const item = queue.shift();
            const value = item.value;
            if (!isObjectLike(value) || isWindowObject(value)) continue;

            if (typeof value === 'object') {
                if (visited.has(value)) continue;
                visited.add(value);
            }
            visitedCount++;

            inspectValue(results, value, item.path, null, null);

            if (item.depth >= CONFIG.maxDepth || typeof value === 'function') continue;

            const edges = getEdges(value, item.path);
            for (const edge of edges) {
                inspectValue(results, edge.value, edge.path, value, edge.prop);

                if (!isObjectLike(edge.value) || isWindowObject(edge.value)) continue;
                if (typeof edge.value === 'function') continue;
                if (queue.length >= CONFIG.maxQueueSize) {
                    if (!OUTPUT_BASE_URL_ONLY) console.warn(`[AntiDebug][React Test] queue reached limit (${CONFIG.maxQueueSize})`);
                    break;
                }
                queue.push({
                    value: edge.value,
                    path: edge.path,
                    depth: item.depth + 1
                });
            }
        }

        return {
            results,
            visitedCount
        };
    }

    function printReactEntries(entries) {
        if (OUTPUT_BASE_URL_ONLY) return;
        console.groupCollapsed(`[AntiDebug][React Test] React entries (${entries.length})`);
        console.table(entries.map((entry, index) => ({
            index: index + 1,
            prop: entry.prop,
            path: entry.path,
            tag: entry.node && entry.node.tagName,
            id: entry.node && entry.node.id || '',
            className: entry.node && typeof entry.node.className === 'string' ? entry.node.className.slice(0, 80) : ''
        })));

        entries.forEach((entry, index) => {
            if (entry.value && typeof entry.value === 'object' && !printedRootObjects.has(entry.value)) {
                printedRootObjects.add(entry.value);
                console.log(`[AntiDebug][React Test] React entry #${index + 1}: ${entry.path}`, entry.value);
            }
        });
        console.groupEnd();
    }

    function summarizeResults(results, visitedCount) {
        if (OUTPUT_BASE_URL_ONLY) {
            printBaseUrlHitsOnly(results);
            return;
        }
        const summary = results.map((item, index) => ({
            index: index + 1,
            type: item.type,
            path: item.path,
            mode: item.meta && item.meta.mode || '',
            basename: item.meta && item.meta.value || '',
            routeCount: item.meta && item.meta.routes ? item.meta.routes.length : 0
        }));

        console.group(`[AntiDebug][React Test] scan summary: ${results.length} hits, ${visitedCount} objects visited`);
        if (summary.length) {
            console.table(summary);
        } else {
            console.warn('[AntiDebug][React Test] no router/routes/base/createHref candidates found');
        }
        console.log('[AntiDebug][React Test] full results saved to window.__ANTIDEBUG_REACT_TEST_RESULTS__');
        console.groupEnd();

        const baseUrlHits = [];
        const seenBaseUrlPaths = new Set();
        const getBaseUrlFromHref = href => {
            if (typeof href !== 'string') return '';
            const testPath = '/__antidebug_react_test__';
            const marker = '__antidebug_react_test__';
            const pathIndex = href.indexOf(testPath);
            if (pathIndex >= 0) return href.slice(0, pathIndex) || '/';
            const markerIndex = href.indexOf(marker);
            if (markerIndex < 0) return '';
            return href.slice(0, markerIndex).replace(/\/$/, '') || '/';
        };

        results.forEach(item => {
            let basePath = '';
            let baseValue = '';
            let mode = '';

            if (item.type === 'basename') {
                basePath = item.path;
                baseValue = item.value;
            } else if (item.type === 'basenameOwner') {
                basePath = item.meta && item.meta.basenamePath || pathJoinProp(item.path, 'basename');
                baseValue = item.meta && item.meta.value;
            } else if (item.type === 'createHref' || item.type === 'createHrefOwner') {
                basePath = item.meta && item.meta.createHrefPath || item.path;
                baseValue = getBaseUrlFromHref(item.meta && item.meta.href);
                mode = item.meta && item.meta.mode || '';
            }

            if (!basePath || seenBaseUrlPaths.has(basePath)) return;
            seenBaseUrlPaths.add(basePath);
            baseUrlHits.push({
                path: basePath,
                value: baseValue,
                mode
            });
        });

        baseUrlHits.forEach(hit => {
            console.log(hit.path);
            console.log({
                baseUrl: hit.value || '',
                mode: hit.mode || ''
            });
        });

        const routeArrayHits = [];
        const seenRouteArrayPaths = new Set();
        results.forEach(item => {
            let routeArrayPath = '';
            let routeArrayValue = null;

            if (item.type === 'routesArray') {
                routeArrayPath = item.path;
                routeArrayValue = item.value;
            } else if (item.type === 'RouterProvider/router') {
                if (item.value && Array.isArray(item.value.routes)) {
                    routeArrayPath = pathJoinProp(item.path, 'routes');
                    routeArrayValue = item.value.routes;
                } else if (item.value && item.value.router && Array.isArray(item.value.router.routes)) {
                    routeArrayPath = pathJoinProp(pathJoinProp(item.path, 'router'), 'routes');
                    routeArrayValue = item.value.router.routes;
                }
            } else if (item.type === 'JSXRoutesComponent' || item.type === 'JSXRouteElement') {
                const props = getPropsObject(item.value);
                if (props && props.children) {
                    routeArrayPath = pathJoinProp(pathJoinProp(item.path, 'props'), 'children');
                    routeArrayValue = props.children;
                } else {
                    routeArrayPath = item.path;
                    routeArrayValue = item.value;
                }
            }

            if (!routeArrayPath || seenRouteArrayPaths.has(routeArrayPath)) return;
            seenRouteArrayPaths.add(routeArrayPath);
            routeArrayHits.push({
                path: routeArrayPath,
                value: routeArrayValue
            });
        });

        routeArrayHits.forEach(hit => {
            console.log(hit.path);
            console.log(hit.value);
        });
    }

    function printBaseUrlHitsOnly(results) {
        const baseUrlHits = [];
        const seenBaseUrlPaths = new Set();
        const getBaseUrlFromHref = href => {
            if (typeof href !== 'string') return '';
            const testPath = '/__antidebug_react_test__';
            const marker = '__antidebug_react_test__';
            const pathIndex = href.indexOf(testPath);
            if (pathIndex >= 0) return href.slice(0, pathIndex) || '/';
            const markerIndex = href.indexOf(marker);
            if (markerIndex < 0) return '';
            return href.slice(0, markerIndex).replace(/\/$/, '') || '/';
        };

        results.forEach(item => {
            let basePath = '';
            let baseValue = '';

            if (item.type === 'basename') {
                basePath = item.path;
                baseValue = item.value;
            } else if (item.type === 'basenameOwner') {
                basePath = item.meta && item.meta.basenamePath || pathJoinProp(item.path, 'basename');
                baseValue = item.meta && item.meta.value;
            } else if (item.type === 'createHref' || item.type === 'createHrefOwner') {
                basePath = item.meta && item.meta.createHrefPath || item.path;
                baseValue = getBaseUrlFromHref(item.meta && item.meta.href);
            }

            if (!basePath || seenBaseUrlPaths.has(basePath)) return;
            seenBaseUrlPaths.add(basePath);
            baseUrlHits.push({
                path: basePath,
                value: baseValue || ''
            });
        });

        baseUrlHits.forEach(hit => {
            console.log(hit.path);
            console.log(hit.value);
        });
    }

    function runScan() {
        scanAttempt++;
        seenResultKeys.clear();

        const entries = findReactEntries();
        if (!entries.length) {
            if (!OUTPUT_BASE_URL_ONLY) console.warn(`[AntiDebug][React Test] attempt #${scanAttempt}: no React entry found`);
            return false;
        }

        printReactEntries(entries);

        const allResults = [];
        let totalVisited = 0;

        entries.forEach((entry, index) => {
            if (!OUTPUT_BASE_URL_ONLY) console.groupCollapsed(`[AntiDebug][React Test] scanning entry #${index + 1}: ${entry.path}`);
            const scan = deepScan(entry.value, entry.path);
            totalVisited += scan.visitedCount;
            allResults.push(...scan.results);
            if (!OUTPUT_BASE_URL_ONLY) console.groupEnd();
        });

        window.__ANTIDEBUG_REACT_TEST_RESULTS__ = allResults;
        summarizeResults(allResults, totalVisited);
        return allResults.length > 0;
    }

    function clearRetryTimers() {
        retryTimers.forEach(id => clearTimeout(id));
        retryTimers = [];
    }

    function start() {
        clearRetryTimers();
        const found = runScan();
        if (found) {
            scanFinished = true;
            return;
        }

        CONFIG.retryDelays.forEach(delay => {
            const timer = setTimeout(() => {
                if (scanFinished) return;
                if (runScan()) {
                    scanFinished = true;
                    clearRetryTimers();
                }
            }, delay);
            retryTimers.push(timer);
        });
    }

    window.addEventListener('message', event => {
        if (event.source !== window) return;
        if (!event.data || event.data.source !== 'antidebug-extension') return;
        if (event.data.type === 'MANUAL_RESCAN_REACT' || event.data.type === 'MANUAL_RESCAN_REACT_TEST') {
            if (!OUTPUT_BASE_URL_ONLY) console.log('[AntiDebug][React Test] manual rescan requested');
            scanFinished = false;
            start();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, {
            once: true
        });
    } else {
        start();
    }
})();
