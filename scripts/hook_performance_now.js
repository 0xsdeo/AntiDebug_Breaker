// ==UserScript==
// @name         hook_performance_now
// @namespace    http://tampermonkey.net/
// @version      2026-02-20
// @description  try to take over the world!
// @author       0xsdeo
// @match        https://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let SCRIPT_ID = 'hook_performance_now'; //脚本文件名

    function clear_Antidebug(id) {
        localStorage.removeItem("Antidebug_breaker_" + id + "_value")
        localStorage.removeItem("Antidebug_breaker_" + id + "_debugger");
        localStorage.removeItem("Antidebug_breaker_" + id + "_stack");
    }

    function initHook() {
        let value = Number(localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_value"));
        let is_debugger = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_debugger");
        let is_stack = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_stack");

        performance.now = function () {
            if (is_debugger === "1") {
                debugger;
            }
            if (is_stack === "1") {
                console.log(new Error().stack);
            }
            return value;
        };

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