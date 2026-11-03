"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
const node_crypto_1 = require("node:crypto");
const KEY_LENGTH = 64;
const deriveKey = (password, salt) => new Promise((resolve, reject) => {
    (0, node_crypto_1.scrypt)(password, salt, KEY_LENGTH, (error, key) => {
        if (error)
            reject(error);
        else
            resolve(key);
    });
});
async function hashPassword(password) {
    const salt = (0, node_crypto_1.randomBytes)(16).toString('hex');
    const derivedKey = await deriveKey(password, salt);
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}
async function verifyPassword(password, stored) {
    const [scheme, salt, expectedHex] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !expectedHex) {
        const supplied = Buffer.from(password);
        const expected = Buffer.from(stored);
        return supplied.length === expected.length && (0, node_crypto_1.timingSafeEqual)(supplied, expected);
    }
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await deriveKey(password, salt);
    return expected.length === actual.length && (0, node_crypto_1.timingSafeEqual)(actual, expected);
}
