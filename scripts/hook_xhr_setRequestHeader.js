// ==UserScript==
// @name         hook_xhr_setRequestHeader
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2024-11-30
// @description  set RequestHeader -> log stack and RequestHeader info
// @attention    当打印的request内容为[object Blob]时，则表示请求内容为二进制流。
// @author       0xsdeo
// @match        http://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_ID = 'hook_xhr_setRequestHeader';

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

        let hook_setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

        XMLHttpRequest.prototype.setRequestHeader = function () {
            if (flag === "0") {
                console.log(
                    "请求头设置：\n" +
                    arguments[0] + ": " + arguments[1]
                )
                if (is_debugger === "1") {
                    debugger;
                }
                if (is_stack === "1") {
                    console.log(new Error().stack);
                }
            } else {
                if (arguments[0] && param.some(item => arguments[0].includes(item))) {
                    console.log(
                        "捕获到设置请求头 ---> " + arguments[0] + "\n" + arguments[0] + ": " + arguments[1]
                    )
                    if (is_debugger === "1") {
                        debugger;
                    }
                    if (is_stack === "1") {
                        console.log(new Error().stack);
                    }
                }
            }
            return hook_setRequestHeader.call(this, ...arguments);
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