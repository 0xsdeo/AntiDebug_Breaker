// ==UserScript==
// @name         AntiAnti_Hook
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      v0.1
// @description  反反Hook检测
// @author       0xsdeo
// @match        http://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function clear_Antidebug() {
        localStorage.removeItem("Antidebug_breaker_Hooks");
    }

    function initHook() {
        const hooksData = localStorage.getItem('Antidebug_breaker_Hooks');
        if (!hooksData) return;

        try {
            const hooks = JSON.parse(hooksData);
            if (!hooks || typeof hooks !== 'object') return;

            // 只取 Function 中的路径
            const methods = Array.isArray(hooks.Function) ? hooks.Function : [];
            if (methods.length === 0) return;

            // 初始化时一次性收集所有被hook的函数引用 Map<函数引用, 函数名>
            const hookedFunctions = new Map();
            for (let methodPath of methods) {
                let ref = window;
                let parts = methodPath.split('.');
                try {
                    for (let i = 0; i < parts.length - 1; i++) {
                        ref = ref[parts[i]];
                        if (!ref) break;
                    }
                    if (ref) {
                        const fn = ref[parts[parts.length - 1]];
                        if (typeof fn === 'function') {
                            hookedFunctions.set(fn, parts[parts.length - 1]);
                        }
                    }
                } catch (e) {
                    // 属性访问失败，跳过
                }
            }

            if (hookedFunctions.size === 0) return;

            let temp_toString = Function.prototype.toString;

            Function.prototype.toString = function () {
                if (this === Function.prototype.toString) {
                    return 'function toString() { [native code] }';
                } else if (this === Function.prototype.constructor &&
                           hookedFunctions.has(Function.prototype.constructor)) {
                    return 'function Function() { [native code] }';
                }
                // 直接查Map，判断当前函数是否是被hook的方法之一
                else if (hookedFunctions.has(this)) {
                    const funcName = hookedFunctions.get(this);
                    return `function ${funcName}() { [native code] }`;
                }
                return temp_toString.apply(this, arguments);
            };

            // 构建完整路径 → fn 的 Map，例如 "console.table" → fn
            const hookedMethodNames = new Map(); // Map<fullPath, fn>
            methods.forEach(path => {
                let ref = window;
                let parts = path.split('.');
                try {
                    for (let i = 0; i < parts.length - 1; i++) {
                        ref = ref[parts[i]];
                        if (!ref) break;
                    }
                    if (ref) {
                        const fn = ref[parts[parts.length - 1]];
                        if (typeof fn === 'function') {
                            hookedMethodNames.set(path, fn);
                        }
                    }
                } catch (e) {
                    // 访问失败，跳过
                }
            });

            // 构建对象级 hook Map：rootObjectName → [{remaining, fn}]
            // 用于处理 property 是对象名（如 "console"）的场景
            // 以 "window" 开头的路径去掉前缀后处理，单段路径由直接属性逻辑覆盖，跳过
            const objectHooksMap = new Map();
            methods.forEach(path => {
                const parts = path.split('.');
                const rootParts = parts[0] === 'window' ? parts.slice(1) : parts;
                if (rootParts.length < 2) return;
                const rootName = rootParts[0];
                const remaining = rootParts.slice(1);
                const fn = hookedMethodNames.get(path);
                if (!fn) return;
                if (!objectHooksMap.has(rootName)) objectHooksMap.set(rootName, []);
                objectHooksMap.get(rootName).push({ remaining, fn });
            });

            // 默认注入：无论 methods 中是否包含，始终覆写 iframe 的 Function.prototype.toString
            if (!objectHooksMap.has('Function')) objectHooksMap.set('Function', []);
            const existsToString = objectHooksMap.get('Function')
                .some(({ remaining }) => remaining.join('.') === 'prototype.toString');
            if (!existsToString) {
                objectHooksMap.get('Function').push({
                    remaining: ['prototype', 'toString'],
                    fn: Function.prototype.toString
                });
            }

            // 防止iframe反hook
            let property_accessor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
            let get_accessor = property_accessor.get;

            Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
                get: function () {
                    let iframe_window = get_accessor.apply(this);

                    iframe_window = new Proxy(iframe_window, {
                        get: function (target, property, receiver) {
                            if (typeof property === 'string') {
                                // 方案一：property 是完整路径或末段方法名，直接返回主window已hook的函数
                                for (const [fullPath, fn] of hookedMethodNames.entries()) {
                                    if (fullPath.endsWith('.' + property) ||
                                        fullPath === property) {
                                        return fn;
                                    }
                                }
                                // 方案二：property 是某个对象名（如 "console"、"Function"）
                                // 取出 iframe 的真实对象，覆写其中被 hook 的方法后返回
                                if (objectHooksMap.has(property)) {
                                    const obj = Reflect.get(target, property, target);
                                    if (obj !== null && (typeof obj === 'object' || typeof obj === 'function')) {
                                        objectHooksMap.get(property).forEach(({ remaining, fn }) => {
                                            let ref = obj;
                                            try {
                                                for (let i = 0; i < remaining.length - 1; i++) {
                                                    ref = ref[remaining[i]];
                                                    if (!ref) return;
                                                }
                                                ref[remaining[remaining.length - 1]] = fn;
                                            } catch (e) {}
                                        });
                                    }
                                    return obj;
                                }
                            }
                            // 用 target 替代 receiver，避免原生 getter 因 this 是 Proxy 而报 Illegal invocation
                            const value = Reflect.get(target, property, target);
                            if (typeof value === 'function') {
                                return value.bind(target);
                            }
                            return value;
                        },
                    });

                    return iframe_window;
                }
            });

        } catch (e) {
            console.error('AntiAnti_Hook: 解析Hooks列表失败', e);
        }

        clear_Antidebug();
    }

    const SCRIPT_ID = 'AntiAnti_Hook';

    function setupConfigListener() {
        window.addEventListener('message', function (event) {
            // 只接受来自扩展的消息
            if (event.source !== window ||
                !event.data ||
                event.data.source !== 'antidebug-extension' ||
                event.data.type !== 'HOOK_CONFIG_READY') {
                return;
            }

            // 检查是否包含当前脚本ID
            const scriptIds = event.data.scriptIds || [];
            if (scriptIds.includes(SCRIPT_ID)) {
                // 配置已就绪，初始化Hook
                initHook();
            }
        });
    }

    // 立即设置监听器
    setupConfigListener();

})();