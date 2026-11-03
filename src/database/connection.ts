import mongoose from 'mongoose';
import { config } from '../config/env';

export const connectDatabase = async () => {
  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (!config.mongodbUri || config.mongodbUri.includes('localhost') === false && config.mongodbUri.includes('mongodb+srv') === false) {
    console.warn('MongoDB URI not configured; continuing with in-memory app data layer.');
    return false;
  }

  try {
    await mongoose.connect(config.mongodbUri, {
      dbName: config.mongodbDbName,
    });
    console.log(`MongoDB connected: ${config.mongodbDbName}`);
    return true;
  } catch (error) {
    console.error('MongoDB connection failed. Continuing in demo-memory mode.', error);
    return false;
  }
};
