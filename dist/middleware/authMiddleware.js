"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const store_1 = require("../data/store");
const user_model_1 = require("../models/user.model");
const env_1 = require("../config/env");
const normalizeUser = (user) => ({
    id: String(user._id ?? user.id),
    name: user.name,
    email: user.email,
    password: user.password ?? '',
});
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
        return res.status(401).json({ message: 'Authentication required.' });
    }
    try {
        const jwt = await Promise.resolve().then(() => __importStar(require('jsonwebtoken')));
        const decoded = jwt.default.verify(token, env_1.config.jwtSecret);
        let user;
        if (mongoose_1.default.connection.readyState === 1) {
            const dbUser = await user_model_1.UserModel.findById(decoded.userId).lean();
            if (dbUser) {
                user = normalizeUser(dbUser);
            }
        }
        else {
            user = store_1.users.find((entry) => entry.id === decoded.userId);
        }
        if (!user) {
            return res.status(401).json({ message: 'User not found.' });
        }
        req.user = user;
        return next();
    }
    catch {
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};
exports.authMiddleware = authMiddleware;
