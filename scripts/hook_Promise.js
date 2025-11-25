// ==UserScript==
// @name         Hook Promise
// @namespace    http://tampermonkey.net/
// @version      2025-06-12
// @description  try to take over the world!
// @author       yousan
// @match        *://*/*
// @icon
// @grant        none
// ==/UserScript==

(function() {

    const SCRIPT_ID = 'hook_Promise'; //文件名

    function clear_Antidebug(id) {
        localStorage.removeItem("Antidebug_breaker_" + id + "_flag");
        localStorage.removeItem("Antidebug_breaker_" + id + "_debugger");
        localStorage.removeItem("Antidebug_breaker_" + id + "_stack");
    }

    function initHook() {
        let flag = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_flag");
        let is_debugger = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_debugger");
        let is_stack = localStorage.getItem("Antidebug_breaker_" + SCRIPT_ID + "_stack");

        const __Promise = Promise;
        Promise = function Promise(callback){
            if(!callback){
                return new __Promise(callback);
            }
            const originCallback = callback;
            callback = function(resolve,reject){
                const originResolve = resolve;
                resolve = function(result){
                    if(result && !(result instanceof Promise)){
                        if (flag === "0"){
                            console.groupCollapsed(result);
                            console.trace(); // hidden in collapsed group
                            console.groupEnd();
                            if (is_debugger === "1") {
                                debugger;
                            }
                            if (is_stack === "1") {
                                console.log(new Error().stack);
                            }
                        }
                    }
                    return originResolve.apply(this,arguments);
                }
                return originCallback(resolve,reject);
            };
            return new __Promise(callback);
        };
        Promise.prototype = __Promise.prototype;
        Object.defineProperties(Promise,Object.getOwnPropertyDescriptors(__Promise));

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