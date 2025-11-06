// ==UserScript==
// @name         Hook_JSEncrypt_RSA
// @namespace    https://github.com/0xsdeo/Hook_JS
// @version      2025-10-24
// @description  Hook JSEncrypt RSA
// @author       0xsdeo
// @run-at       document-start
// @match        *
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    let u, c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function f(t) {
        let e, i, r = "";
        for (e = 0; e + 3 <= t.length; e += 3)
            i = parseInt(t.substring(e, e + 3), 16),
                r += c.charAt(i >> 6) + c.charAt(63 & i);
        for (e + 1 == t.length ? (i = parseInt(t.substring(e, e + 1), 16),
            r += c.charAt(i << 2)) : e + 2 == t.length && (i = parseInt(t.substring(e, e + 2), 16),
            r += c.charAt(i >> 2) + c.charAt((3 & i) << 4)); (3 & r.length) > 0; )
            r += "=";
        return r
    }

    function hasRSAProp(obj) {
        const requiredProps = [
            'constructor',
            'getPrivateBaseKey',
            'getPrivateBaseKeyB64',
            'getPrivateKey',
            'getPublicBaseKey',
            'getPublicBaseKeyB64',
            'getPublicKey',
            'parseKey',
            'parsePropertiesFrom'
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

    let temp_call = Function.prototype.call;

    Function.prototype.call = function () {
        if (arguments.length === 1 && arguments[0] && arguments[0].__proto__ && typeof arguments[0].__proto__ === 'object' && hasRSAProp(arguments[0].__proto__)) {
            if ("__proto__" in arguments[0].__proto__ && arguments[0].__proto__.__proto__ && Object.hasOwn(arguments[0].__proto__.__proto__, "encrypt") && Object.hasOwn(arguments[0].__proto__.__proto__, "decrypt")) {
                if (arguments[0].__proto__.__proto__.encrypt.toString().indexOf('RSA加密') === -1) {

                    let temp_encrypt = arguments[0].__proto__.__proto__.encrypt;

                    arguments[0].__proto__.__proto__.encrypt = function () {
                        let encrypt_text = temp_encrypt.bind(this, ...arguments)();

                        console.log("RSA 公钥：\n", this.getPublicKey());
                        console.log("RSA加密 原始数据：", ...arguments);
                        console.log("RSA加密 Base64 密文：", f(encrypt_text));
                        console.log("%c---------------------------------------------------------------------", "color: green;");
                        return encrypt_text;
                    }
                }

                if (arguments[0].__proto__.__proto__.decrypt.toString().indexOf('RSA解密') === -1) {

                    let temp_decrypt = arguments[0].__proto__.__proto__.decrypt;

                    arguments[0].__proto__.__proto__.decrypt = function () {
                        let decrypt_text = temp_decrypt.bind(this, ...arguments)();

                        console.log("RSA 私钥：\n", this.getPrivateKey());
                        console.log("RSA解密 Base64 原始数据：", f(...arguments));
                        console.log("RSA解密 明文：", decrypt_text);
                        console.log("%c---------------------------------------------------------------------", "color: green;");
                        return decrypt_text;
                    }
                }
            }
        }
        return temp_call.bind(this, ...arguments)();
    }
})();