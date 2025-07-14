import fs from 'fs/promises';
import path from 'path';
import {logger} from '@/middleware/logger';

export const ensureDirectoryExists = async (dirPath: string): Promise<void> => {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, {recursive: true});
        logger.info(`Created directory: ${dirPath}`);
    }
};

export const deleteFile = async (filePath: string): Promise<void> => {
    try {
        await fs.unlink(filePath);
        logger.info(`Deleted file: ${filePath}`);
    } catch (error) {
        logger.error(`Failed to delete file ${filePath}:`, error);
    }
};

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        logger.error(`Failed to read JSON file ${filePath}:`, error);
        throw new Error(`Failed to read file: ${filePath}`);
    }
};