// ==UserScript==
// @name         Hook_smcrypto
// @namespace    https://github.com/0xsdeo/AntiDebug_Breaker
// @version      2026-02-01
// @description  try to take over the world!
// @author       LoveCode && 0xsdeo
// @match        https://*/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function sm3_encrypt_test(func) {
        try {
            return func("123456");

        } catch (err) {
            return false;
        }
    }

    function has_SM2_Prop(obj) {
        const requiredProps = [
            'comparePublicKeyHex',
            'compressPublicKeyHex',
            'doDecrypt',
            'doEncrypt',
            'doSignature',
            'doVerifySignature',
            'generateKeyPairHex',
            'getPoint',
            'verifyPublicKey'
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

    function sm4_encrypt_test(func) {
        try {
            let sm4Key = "0123456789abcdeffedcba9876543210"; // 32位hex = 16字节
            let sm4Iv  = "000102030405060708090a0b0c0d0e0f";

            let sm4EncryptData = func("123456", sm4Key, {
                mode: 'cbc',
                iv: sm4Iv,
                cipherType: 'hex'
            });

            return sm4EncryptData;

        } catch (err) {
            return false;
        }
    }

    function sm4_decrypt_test(func) {
        try {
            let sm4Key = "0123456789abcdeffedcba9876543210"; // 32位hex = 16字节
            let sm4Iv  = "000102030405060708090a0b0c0d0e0f";

            let sm4DecryptData = func("1b96f27b7f523118539b416810c91d4d", sm4Key, {
                mode: 'cbc',
                iv: sm4Iv,
                cipherType: 'hex'
            });

            return sm4DecryptData;

        } catch (err) {
            return false;
        }
    }


// 记录 SM2 doEncrypt
    let raw_doEncrypt;

// 替换 SM2 doEncrypt 的方法
    function my_doEncrypt() {
        let result = Reflect.apply(raw_doEncrypt, this, arguments);
        console.log("SM2 加密明文:", arguments[0]);
        console.log("SM2 加密公钥:", arguments[1]);
        console.log("SM2 加密密文:", result);
        return result;
    }

    // 记录 SM2 doDecrypt
    let raw_doDecrypt;

// 替换 SM2 doDecrypt 的方法
    function my_doDecrypt() {
        let result = Reflect.apply(raw_doDecrypt, this, arguments);
        console.log("SM2 解密密文:", arguments[0]);
        console.log("SM2 解密私钥:", arguments[1]);
        console.log("SM2 解密明文:", result);
        return result;
    }

    // 记录 SM4 doDecrypt
    let raw_sm4_encrypt;

// 替换 SM4 doDecrypt 的方法
    function my_sm4_encrypt() {
        let result = Reflect.apply(raw_sm4_encrypt, this, arguments);
        console.log("SM4 加密明文:", arguments[0]);
        console.log("SM4 加密key:", arguments[1]);
        if (arguments[2] && typeof arguments[2] === "object") {
            if (arguments[2].cipherType) {
                console.log("SM4 加密数据格式:", arguments[2].cipherType);
            }
            if (arguments[2].iv) {
                console.log("SM4 加密iv:", arguments[2].iv);
            }
            if (arguments[2].mode) {
                console.log("SM4 加密模式:", arguments[2].mode);
            }
        }
        console.log("SM4 加密密文：",result);
        return result;
    }

    // 记录 SM4 doDecrypt
    let raw_sm4_decrypt;

// 替换 SM4 doDecrypt 的方法
    function my_sm4_decrypt() {
        let result = Reflect.apply(raw_sm4_decrypt, this, arguments);
        console.log("SM4 解密密文:", arguments[0]);
        console.log("SM4 解密key:", arguments[1]);
        if (arguments[2] && typeof arguments[2] === "object") {
            if (arguments[2].cipherType) {
                console.log("SM4 解密数据格式:", arguments[2].cipherType);
            }
            if (arguments[2].iv) {
                console.log("SM4 解密iv:", arguments[2].iv);
            }
            if (arguments[2].mode) {
                console.log("SM4 解密模式:", arguments[2].mode);
            }
        }
        console.log("SM4 解密明文：",result);
        return result;
    }

    // 记录 SM3 encrypt
    let raw_sm3;

// 替换 SM3 encrypt 的方法
    function my_SM3() {
        let result = Reflect.apply(raw_sm3, this, arguments);
        console.log("SM3 加密明文：:", arguments[0]);
        console.log("SM3 加密密文：:", result);
        return result;
    }


    const raw_call = Function.prototype.call;

    function my_call() {
        const result = Reflect.apply(raw_call, this, arguments);

        // 判断参数是否满足 webpack 的加载条件
        if (arguments.length === 4 && arguments[1]?.exports) {
            const exports = arguments[1].exports;

            if (exports.doEncrypt && has_SM2_Prop(exports)) {
                raw_doEncrypt = exports.doEncrypt;
                exports.doEncrypt = my_doEncrypt;
            }
            if (exports.doEncrypt && has_SM2_Prop(exports)) {
                raw_doDecrypt = exports.doDecrypt;
                exports.doDecrypt = my_doDecrypt;
            }
            if (exports.encrypt) {
                if (sm4_encrypt_test(exports.encrypt) === "1b96f27b7f523118539b416810c91d4d"){
                    raw_sm4_encrypt = exports.encrypt;
                    exports.encrypt = my_sm4_encrypt;
                }
            }
            if (exports.decrypt) {
                if (sm4_decrypt_test(exports.decrypt) === "123456"){
                    raw_sm4_decrypt = exports.decrypt;
                    exports.decrypt = my_sm4_decrypt;
                }
            }
            if (typeof exports === "function" && exports.toString().includes('invalid mode') && sm3_encrypt_test(exports) === "207cf410532f92a47dee245ce9b11ff71f578ebd763eb3bbea44ebd043d018fb") {
                raw_sm3 = exports;
                arguments[1].exports = my_SM3;
            }
        }

        return result;
    }

    Function.prototype.call = my_call;
})();