"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = void 0;
const errorMiddleware = (error, _req, res, _next) => {
    console.error(error);
    const statusCode = error.statusCode ?? (error.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
    const message = error.statusCode
        ? error.message
        : error.code === 'LIMIT_FILE_SIZE'
            ? 'Document exceeds the 10 MB upload limit.'
            : 'Something went wrong on the server.';
    return res.status(statusCode).json({ message });
};
exports.errorMiddleware = errorMiddleware;
