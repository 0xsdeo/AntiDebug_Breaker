// ==UserScript==
// @name         Clear_vue_Navigation_Guards
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      v1.0
// @description  清除vue的全局前置守卫和全局解析守卫
// @author       0xsdeo
// @run-at       document-start
// @match        *
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
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

    let temp_push = Array.prototype.push; // 将xxx修改为要hook的方法，temp_xxx变量名可以根据需要进行修改命名

    Array.prototype.push = function () { // 将xxx修改为要hook的方法
        if (arguments.length === 0) {
            return temp_push.call(this, ...arguments);
        }

        // 检查第一个参数是否是函数
        if (typeof arguments[0] !== 'function') {
            return temp_push.call(this, ...arguments);
        }

        let stack = new Error().stack;
        if (stack.includes('beforeEach') || stack.includes('beforeResolve')) {
            // console.log(stack)
            let temp_array = stack.split('\n');
            if (temp_array < 4) {
                return temp_push.call(this, ...arguments);
            }
            else if (temp_array[3].includes('beforeEach') || temp_array[2].includes('beforeEach')) {
                console.log(...arguments);
                console.log("%c存在全局前置路由守卫并已清除", "color: green;");
                return temp_push.call(this); // 将网站js调用目标方法时所传入的内容传给原方法执行并返回结果
            }
            else if (temp_array[3].includes('beforeResolve') || temp_array[2].includes('beforeResolve')) {
                console.log(...arguments);
                console.log("%c存在全局解析守卫并已清除", "color: green;");
                return temp_push.call(this); // 将网站js调用目标方法时所传入的内容传给原方法执行并返回结果
            }
        }
        return temp_push.call(this, ...arguments); // 将网站js调用目标方法时所传入的内容传给原方法执行并返回结果
    }
})();