// ==UserScript==
// @name         Hook_cookie
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2024-12-19
// @description  set cookie -> log stack and cookie
// @author       0xsdeo
// @match        http://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let SCRIPT_ID = 'Hook_cookie';

    function clear_Antidebug(id) {
        localStorage.removeItem("Antidebug_breaker_" + id + "_flag");
        localStorage.removeItem("Antidebug_breaker_" + id + "_param");
        localStorage.removeItem("Antidebug_breaker_" + id + "_debugger");
        localStorage.removeItem("Antidebug_breaker_" + id + "_stack");
    }

    function initHook() {
        let flag = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_flag");
        let param = JSON.parse(localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_param"));
        let is_debugger = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_debugger");
        let is_stack = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_stack");

        function parseCookieNames(cookieStr) {
            if (!cookieStr || typeof cookieStr !== 'string') {
                return [];
            }

            // 定义常见的cookie属性名，这些不应该被当作cookie键名
            const cookieAttributes = [
                'expires', 'max-age', 'domain', 'path', 'secure', 'httponly',
                'samesite', 'partitioned', 'priority'
            ];

            return cookieStr
                .split(';')
                .map(part => part.trim())
                .filter(part => part.includes('='))
                .map(part => {
                    const [name, value] = part.split('=');
                    return decodeURIComponent(name.trim());
                })
                .filter(name => {
                    // 过滤掉cookie属性名（不区分大小写）
                    const lowerName = name.toLowerCase();
                    return !cookieAttributes.includes(lowerName);
                });
        }

        let cookie_accessor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");
        let get_cookie = cookie_accessor.get;
        let set_cookie = cookie_accessor.set;

        Object.defineProperty(document, "cookie", {
            get: function () {
                return get_cookie.call(document);
            },
            set: function (cookie) {
                if (flag === "0") {
                    console.log("设置cookie：\n", cookie);
                    if (is_debugger === "1") {
                        debugger;
                    }
                    if (is_stack === "1") {
                        console.log(new Error().stack);
                    }
                } else {
                    let cookie_key = parseCookieNames(cookie);
                    if (cookie_key && cookie_key.length !== 0 && param.some(item => cookie_key[0].includes(item))) {
                        console.log(`捕获到设置cookie ---> ${cookie_key[0]}\n值：${cookie}`);
                        if (is_debugger === "1") {
                            debugger;
                        }
                        if (is_stack === "1") {
                            console.log(new Error().stack);
                        }
                    }
                }
                set_cookie.call(document, cookie);
            }
        })
        clear_Antidebug(SCRIPT_ID);
    }

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