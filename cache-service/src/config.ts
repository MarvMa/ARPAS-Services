import dotenv from 'dotenv';

dotenv.config();

export interface Config {
    port: number;
    redisHost: string;
    redisPort: number;
    objectTTL: number; // seconds
    storageUrl: string;
}

export const config: Config = {
    port: parseInt(process.env.CACHE_PORT || '3000', 10),
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
    objectTTL: parseInt(process.env.OBJECT_TTL || '3600', 10), // Default to 1 hour
    storageUrl: process.env.STORAGE_URL || 'http://localhost',
};

export default config;