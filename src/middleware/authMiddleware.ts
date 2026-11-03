import mongoose from 'mongoose';
import { users } from '../data/store';
import { UserModel } from '../models/user.model';
import { config } from '../config/env';
import type { AuthenticatedRequest, User } from '../types';

const normalizeUser = (user: any): User => ({
  id: String(user._id ?? user.id),
  name: user.name,
  email: user.email,
  password: user.password ?? '',
});

export const authMiddleware = async (req: AuthenticatedRequest, res: any, next: any) => {
  const authHeader = req.headers.authorization ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Authentication required.' });
  }

  try {
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.verify(token, config.jwtSecret) as { userId: string };

    let user: User | undefined;

    if (mongoose.connection.readyState === 1) {
      const dbUser = await UserModel.findById(decoded.userId).lean();
      if (dbUser) {
        user = normalizeUser(dbUser);
      }
    } else {
      user = users.find((entry) => entry.id === decoded.userId) as User | undefined;
    }

    if (!user) {
      return res.status(401).json({ message: 'User not found.' });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};
