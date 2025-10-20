// ==UserScript==
// @name         Hook_CryptoJS_对称加密
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2025-10-17
// @description  Hook CryptoJS所有对称加密
// @author       0xsdeo
// @run-at       document-start
// @match        *
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let time = 0;

    function hasEncryptProp(obj) {
        const requiredProps = [
            'ciphertext',
            'key',
            'iv',
            'algorithm',
            'mode',
            'padding',
            'blockSize',
            'formatter'
        ];

        // 检查对象是否存在且为对象类型
        if (!obj || typeof obj !== 'object') {
            return false;
        }

        // 检查所有必需属性是否存在
        for (const prop of requiredProps) {
            if (!(prop in obj)) {
                return false;
            }
        }

        return true;
    }

    function hasDecryptProp(obj) {
        const requiredProps = [
            'sigBytes',
            'words'
        ];

        // 检查对象是否存在且为对象类型
        if (!obj || typeof obj !== 'object') {
            return false;
        }

        // 检查所有必需属性是否存在
        for (const prop of requiredProps) {
            if (!(prop in obj)) {
                return false;
            }
        }

        return true;
    }

    function get_sigBytes(size) {
        switch (size) {
            case 8:
                return "64bits";
            case 16:
                return "128bits";
            case 22:
                return "192bits";
            case 32:
                return "256bits";
            default:
                return "未获取到";
        }
    }

    let temp_apply = Function.prototype.apply;

    Function.prototype.apply = function () {
        if (arguments.length === 2 && arguments[0] && arguments[1] && typeof arguments[1] === 'object' && arguments[1].length === 1 && hasEncryptProp(arguments[1][0])) {
            if (Object.hasOwn(arguments[0], "$super") && Object.hasOwn(arguments[0], "init")) {
                if (this.toString().indexOf('function()') !== -1 || /^\s*function(?:\s*\*)?\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/.test(this.toString())) {
                    console.log(...arguments);

                    let encrypt_text = arguments[0].$super.toString.call(arguments[1][0]);
                    if (encrypt_text !== "[object Object]") {
                        console.log("加密后的密文：", encrypt_text);
                    } else {
                        console.log("加密后的密文：由于toString方法并未获取到，请自行使用上方打印的对象进行toString调用输出密文。");
                    }

                    let key = arguments[1][0]["key"].toString();
                    if (key !== "[object Object]") {
                        console.log("加密Hex key：", key);
                    } else {
                        console.log("加密Hex key：由于toString方法并未获取到，请自行使用上方打印的对象进行toString调用输出key。");
                    }

                    let iv = arguments[1][0]["iv"];

                    if (iv) {
                        if (iv.toString() !== "[object Object]") {
                            console.log("加密Hex iv：", iv.toString());
                        } else {
                            console.log("加密Hex iv：由于toString方法并未获取到，请自行使用上方打印的对象进行toString调用输出iv。");
                        }
                    } else {
                        console.log("加密时未用到iv")
                    }
                    if (arguments[1][0]["padding"]) {
                        console.log("加密时的填充模式：", arguments[1][0]["padding"]);
                    }
                    if (arguments[1][0]["mode"] && Object.hasOwn(arguments[1][0]["mode"], "Encryptor")) {
                        console.log("加密时的运算模式：", arguments[1][0]["mode"]["Encryptor"]["processBlock"]);
                    }
                    if (arguments[1][0]["key"] && Object.hasOwn(arguments[1][0]["key"], "sigBytes")) {
                        console.log("加密时的密钥长度：", get_sigBytes(arguments[1][0]["key"]["sigBytes"]));
                    }
                    console.log("%c---------------------------------------------------------------------", "color: green;");
                }
            }
        } else if (arguments.length === 2 && arguments[0] && arguments[1] && typeof arguments[1] === 'object' && arguments[1].length === 3 && hasDecryptProp(arguments[1][1])) {
            if (Object.hasOwn(arguments[0], "$super") && Object.hasOwn(arguments[0], "init")) {
                if (this.toString().indexOf('function()') === -1 && arguments[1][0] === 2) {
                    console.log(...arguments);

                    let key = arguments[1][1].toString();
                    if (key !== "[object Object]") {
                        console.log("解密Hex key：", key);
                    } else {
                        console.log("解密Hex key：由于toString方法并未获取到，请自行使用上方打印的对象进行toString调用输出key。");
                    }

                    if (Object.hasOwn(arguments[1][2], "iv") && arguments[1][2]["iv"]) {
                        let iv = arguments[1][2]["iv"].toString();
                        if (iv !== "[object Object]") {
                            console.log("解密Hex iv：", iv);
                        } else {
                            console.log("解密Hex iv：由于toString方法并未获取到，请自行使用上方打印的对象进行toString调用输出iv。");
                        }
                    } else {
                        console.log("解密时未用到iv")
                    }

                    if (Object.hasOwn(arguments[1][2], "padding") && arguments[1][2]["padding"]) {
                        console.log("解密时的填充模式：", arguments[1][2]["padding"]);
                    }
                    if (Object.hasOwn(arguments[1][2], "mode") && arguments[1][2]["mode"]) {
                        console.log("解密时的运算模式：", arguments[1][2]["mode"]["Encryptor"]["processBlock"]);
                    }
                    if (time === 0) {
                        console.log("可使用我的脚本进行fuzz加解密参数（算法、模式、填充方式等）：https://github.com/0xsdeo/Fuzz_Crypto_Algorithms");
                        time += 1;
                    }
                    console.log("%c---------------------------------------------------------------------", "color: green;");
                }
            }
        }
        return temp_apply.call(this, ...arguments);
    }
})();