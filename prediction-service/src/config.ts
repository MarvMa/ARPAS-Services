import dotenv from 'dotenv'

dotenv.config()

export interface EnvConfig {
    port: number;
    storageUrl: string;
    cacheUrl: string;
}

export const config: EnvConfig = {
    port: parseInt(process.env.PREDICTION_PORT || '3000', 10),
    storageUrl: process.env.STORAGE_URL || 'http://localhost',
    cacheUrl: process.env.STORAGE_URL || 'http://localhost',
};
console.log('Configuration loaded:', config);

// Validate configuration
if (isNaN(config.port) || config.port <= 0) {
    throw new Error('Invalid port number in configuration');
}

if (!config.storageUrl) {
    throw new Error('Storage URL must be defined in configuration');
}

if (!config.cacheUrl) {
    throw new Error('Cache URL must be defined in configuration');
}

