import mongoose from 'mongoose';
import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { users } from '../data/store';
import { createToken } from '../utils/token';
import { hashPassword, verifyPassword } from '../utils/password';
import { UserModel } from '../models/user.model';
import type { AuthenticatedRequest } from '../types';

const normalizeUser = (user: any) => ({
  id: String(user._id ?? user.id),
  name: user.name,
  email: user.email,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const router = Router();

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
  const passwordHash = await hashPassword(password);

  if (mongoose.connection.readyState === 1) {
    const existingUser = await UserModel.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ message: 'An account already exists with this email.' });
    }

    const newUser = await UserModel.create({
      name: normalizedName,
      email: normalizedEmail,
      password: passwordHash,
    });

    return res.status(201).json({
      token: createToken(String(newUser._id)),
      user: normalizeUser(newUser),
    });
  }

  const existingUser = users.find((user) => user.email.toLowerCase() === normalizedEmail);
  if (existingUser) {
    return res.status(409).json({ message: 'An account already exists with this email.' });
  }

  const newUser = {
    id: `user-${Date.now()}`,
    name: normalizedName,
    email: normalizedEmail,
    password: passwordHash,
  };

  users.push(newUser);

  return res.status(201).json({
    token: createToken(newUser.id),
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

  if (mongoose.connection.readyState === 1) {
    const user = await UserModel.findOne({ email: normalizedEmail });
    if (!user || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    if (!user.password.startsWith('scrypt$')) {
      user.password = await hashPassword(password);
      await user.save();
    }

    return res.json({
      token: createToken(String(user._id)),
      user: normalizeUser(user),
    });
  }

  const user = users.find((entry) => entry.email.toLowerCase() === normalizedEmail);

  if (!user || !(await verifyPassword(password, user.password))) {
    return res.status(401).json({ message: 'Invalid email or password.' });
  }
  if (!user.password.startsWith('scrypt$')) user.password = await hashPassword(password);

  return res.json({
    token: createToken(user.id),
    user: normalizeUser(user),
  });
});

router.get('/profile', authMiddleware, (req: AuthenticatedRequest, res) => {
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

export default router;
