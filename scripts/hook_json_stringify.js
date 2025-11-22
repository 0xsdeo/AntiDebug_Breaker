// ==UserScript==
// @name         hook_JSON
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2024-10-29
// @description  重写parse和stringify方法，以此来获取调用这个方法所传入的内容以及堆栈信息。
// @author       0xsdeo
// @match        http://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_ID = 'hook_json_stringify';

    function clear_Antidebug(id) {
        localStorage.removeItem("Antidebug_breaker_" + id + "_flag");
        localStorage.removeItem("Antidebug_breaker_" + id + "_debugger");
        localStorage.removeItem("Antidebug_breaker_" + id + "_stack");
    }

    function initHook() {
        let flag = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_flag");
        let is_debugger = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_debugger");
        let is_stack = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_stack");

        let json_s = JSON.stringify;
        JSON.stringify = function () {
            if (flag === "0") {
                console.log("调用JSON.stringify，参数：\n", ...arguments);
                if (is_debugger === "1") {
                    debugger;
                }
                if (is_stack === "1") {
                    console.log(new Error().stack);
                }
            }
            return json_s(...arguments);
        }
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