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
                    console.groupCollapsed(result);
                    console.trace(); // hidden in collapsed group
                    console.groupEnd();
                    // debugger;
                }
                return originResolve.apply(this,arguments);
            }
            return originCallback(resolve,reject);
        };
        return new __Promise(callback);
    };
    Promise.prototype = __Promise.prototype;
    Object.defineProperties(Promise,Object.getOwnPropertyDescriptors(__Promise));
})();