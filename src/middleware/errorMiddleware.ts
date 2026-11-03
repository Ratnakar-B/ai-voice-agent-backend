import type { NextFunction, Request, Response } from 'express';

export const errorMiddleware = (
  error: Error & { statusCode?: number; code?: string },
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  console.error(error);
  const statusCode = error.statusCode ?? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const message = error.statusCode
    ? error.message
    : error.code === 'LIMIT_FILE_SIZE'
      ? 'Document exceeds the 10 MB upload limit.'
      : 'Something went wrong on the server.';
  return res.status(statusCode).json({ message });
};
