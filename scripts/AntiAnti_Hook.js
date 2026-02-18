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
                }
                // 直接查Map，判断当前函数是否是被hook的方法之一
                else if (hookedFunctions.has(this)) {
                    const funcName = hookedFunctions.get(this);
                    return `function ${funcName}() { [native code] }`;
                }
                return temp_toString.apply(this, arguments);
            };

            // 构建完整路径 → fn 的 Map，例如 "window.history.go" → fn
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

            // 防止iframe反hook
            let property_accessor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
            let get_accessor = property_accessor.get;

            Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
                get: function () {
                    let iframe_window = get_accessor.apply(this);

                    iframe_window = new Proxy(iframe_window, {
                        get: function (target, property, receiver) {
                            // property 可能是完整路径（如 "console.log"）也可能只是属性名（如 "log"）
                            // 因此同时用两种方式比对：完整路径结尾匹配 或 最后一段匹配
                            if (typeof property === 'string') {
                                for (const [fullPath, fn] of hookedMethodNames.entries()) {
                                    if (fullPath.endsWith('.' + property) ||
                                        fullPath === property) {
                                        return fn;
                                    }
                                }
                                if (property === 'console') {
                                    return window.console;
                                }
                            }
                            return Reflect.get(target, property, receiver);
                        },
                    });

                    console.log(new Error().stack);

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