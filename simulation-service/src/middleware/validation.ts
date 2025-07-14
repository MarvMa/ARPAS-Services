import {Request, Response, NextFunction} from 'express';
import Joi from 'joi';
import {ApiResponse} from '@/types';

export const validateRecordingUpload = (req: Request, res: Response<ApiResponse>, next: NextFunction): void => {
    const schema = Joi.object({
        color: Joi.string().pattern(/^[0-9A-Fa-f]{6}$/).required().messages({
            'string.pattern.base': 'Color must be a valid hex color without #'
        })
    });

    const {error} = schema.validate(req.body);

    if (error) {
        res.status(400).json({
            success: false,
            error: error.details[0].message
        });
        return;
    }

    next();
};

export const validateFileUpload = (req: Request, res: Response<ApiResponse>, next: NextFunction): void => {
    if (!req.file) {
        res.status(400).json({
            success: false,
            error: 'No file uploaded'
        });
        return;
    }

    const allowedExtensions = ['.json'];
    const fileExtension = req.file.originalname.toLowerCase().substring(req.file.originalname.lastIndexOf('.'));

    if (!allowedExtensions.includes(fileExtension)) {
        res.status(400).json({
            success: false,
            error: 'Only JSON files are allowed'
        });
        return;
    }

    next();
};