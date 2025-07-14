import {Request, Response, NextFunction} from 'express';
import {logger} from './logger';
import {ApiResponse} from '@/types';

export interface AppError extends Error {
    statusCode?: number;
    isOperational?: boolean;
}

export const errorHandler = (
    error: AppError,
    req: Request,
    res: Response<ApiResponse>,
    next: NextFunction
): void => {
    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal Server Error';

    logger.error({
        error: error.message,
        stack: error.stack,
        url: req.url,
        method: req.method,
        statusCode
    });

    res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === 'development' && {stack: error.stack})
    });
};

export const notFoundHandler = (req: Request, res: Response<ApiResponse>): void => {
    res.status(404).json({
        success: false,
        error: `Route ${req.originalUrl} not found`
    });
};