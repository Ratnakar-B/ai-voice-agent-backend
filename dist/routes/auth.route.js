"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const express_1 = require("express");
const authMiddleware_1 = require("../middleware/authMiddleware");
const store_1 = require("../data/store");
const token_1 = require("../utils/token");
const password_1 = require("../utils/password");
const user_model_1 = require("../models/user.model");
const normalizeUser = (user) => ({
    id: String(user._id ?? user.id),
    name: user.name,
    email: user.email,
});
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const router = (0, express_1.Router)();
router.post('/register', async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const { name, email, password } = body;
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ message: 'Name, email, and password are required.' });
    }
    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedName) {
        return res.status(400).json({ message: 'Name is required.' });
    }
    if (normalizedName.length > 100) {
        return res.status(400).json({ message: 'Name must be 100 characters or fewer.' });
    }
    if (normalizedEmail.length > 254) {
        return res.status(400).json({ message: 'Email must be 254 characters or fewer.' });
    }
    if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (password.length < 8 || password.length > 256) {
        return res.status(400).json({ message: 'Password must be between 8 and 256 characters.' });
    }
    const passwordHash = await (0, password_1.hashPassword)(password);
    if (mongoose_1.default.connection.readyState === 1) {
        const existingUser = await user_model_1.UserModel.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({ message: 'An account already exists with this email.' });
        }
        const newUser = await user_model_1.UserModel.create({
            name: normalizedName,
            email: normalizedEmail,
            password: passwordHash,
        });
        return res.status(201).json({
            token: (0, token_1.createToken)(String(newUser._id)),
            user: normalizeUser(newUser),
        });
    }
    const existingUser = store_1.users.find((user) => user.email.toLowerCase() === normalizedEmail);
    if (existingUser) {
        return res.status(409).json({ message: 'An account already exists with this email.' });
    }
    const newUser = {
        id: `user-${Date.now()}`,
        name: normalizedName,
        email: normalizedEmail,
        password: passwordHash,
    };
    store_1.users.push(newUser);
    return res.status(201).json({
        token: (0, token_1.createToken)(newUser.id),
        user: normalizeUser(newUser),
    });
});
router.post('/login', async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const { email, password } = body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length > 254) {
        return res.status(400).json({ message: 'Email must be 254 characters or fewer.' });
    }
    if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (password.length > 256) {
        return res.status(400).json({ message: 'Password must be 256 characters or fewer.' });
    }
    if (mongoose_1.default.connection.readyState === 1) {
        const user = await user_model_1.UserModel.findOne({ email: normalizedEmail });
        if (!user || !(await (0, password_1.verifyPassword)(password, user.password))) {
            return res.status(401).json({ message: 'Invalid email or password.' });
        }
        if (!user.password.startsWith('scrypt$')) {
            user.password = await (0, password_1.hashPassword)(password);
            await user.save();
        }
        return res.json({
            token: (0, token_1.createToken)(String(user._id)),
            user: normalizeUser(user),
        });
    }
    const user = store_1.users.find((entry) => entry.email.toLowerCase() === normalizedEmail);
    if (!user || !(await (0, password_1.verifyPassword)(password, user.password))) {
        return res.status(401).json({ message: 'Invalid email or password.' });
    }
    if (!user.password.startsWith('scrypt$'))
        user.password = await (0, password_1.hashPassword)(password);
    return res.json({
        token: (0, token_1.createToken)(user.id),
        user: normalizeUser(user),
    });
});
router.get('/profile', authMiddleware_1.authMiddleware, (req, res) => {
    const currentUser = req.user;
    if (!currentUser) {
        return res.status(401).json({ message: 'Current user unavailable.' });
    }
    return res.json({
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
    });
});
exports.default = router;
