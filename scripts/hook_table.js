// ==UserScript==
// @name         hook_table
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2025-03-14
// @description  Bypass console.table -> TimeDiff -> anti-debug
// @author       Dexter,0xsdeo
// @match        http://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // let temp_toString = Function.prototype.toString;
    //
    // Function.prototype.toString = function () {
    //     if (this === Function.prototype.toString) {
    //         return 'function toString() { [native code] }';
    //     } else if (this === xxx) { // 将xxx修改为要hook的方法
    //         return ''; // 在控制台执行xxx.toString()，将输出的内容替换掉空字符串
    //     }
    //     return temp_toString.apply(this, arguments);
    // }

    console.table = function () {
        // 在这里写你想让hook后的方法执行的代码
    }
})();