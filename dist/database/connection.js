"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectDatabase = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("../config/env");
const connectDatabase = async () => {
    if (mongoose_1.default.connection.readyState === 1) {
        return true;
    }
    if (!env_1.config.mongodbUri || env_1.config.mongodbUri.includes('localhost') === false && env_1.config.mongodbUri.includes('mongodb+srv') === false) {
        console.warn('MongoDB URI not configured; continuing with in-memory app data layer.');
        return false;
    }
    try {
        await mongoose_1.default.connect(env_1.config.mongodbUri, {
            dbName: env_1.config.mongodbDbName,
        });
        console.log(`MongoDB connected: ${env_1.config.mongodbDbName}`);
        return true;
    }
    catch (error) {
        console.error('MongoDB connection failed. Continuing in demo-memory mode.', error);
        return false;
    }
};
exports.connectDatabase = connectDatabase;
