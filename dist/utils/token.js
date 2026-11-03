"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const createToken = (userId) => jsonwebtoken_1.default.sign({ userId }, env_1.config.jwtSecret, { expiresIn: '7d' });
exports.createToken = createToken;
