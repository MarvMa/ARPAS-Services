import dotenv from 'dotenv'

dotenv.config()

export interface EnvConfig {
    port: number;
    storageUrl: string;
    cacheUrl: string;
    dbHost: string;
    dbPort: number;
    dbName: string;
    dbUser: string;
    dbPassword: string;
    predictionRadius: number;
}

export const config: EnvConfig = {
    port: parseInt(process.env.PREDICTION_PORT || '3000', 10),
    storageUrl: process.env.STORAGE_URL || 'http://localhost',
    cacheUrl: process.env.STORAGE_URL || 'http://localhost',
    dbHost: process.env.DB_HOST || 'postgres',
    dbPort: parseInt(process.env.DB_PORT || '5432', 10),
    dbName: process.env.DB_NAME || 'storage_db',
    dbUser: process.env.DB_USER || 'postgres',
    dbPassword: process.env.DB_PASSWORD || '',
    predictionRadius: parseInt(process.env.PREDICTION_RADIUS || '20', 10),
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
if (!config.dbHost) {
    throw new Error('Database host must be defined in configuration');
}
if (isNaN(config.dbPort) || config.dbPort <= 0) {
    throw new Error('Invalid database port number in configuration');
}
if (!config.dbName) {
    throw new Error('Database name must be defined in configuration');
}
if (!config.dbUser) {
    throw new Error('Database user must be defined in configuration');
}
if (!config.predictionRadius) {
    throw new Error('Prediction radius must be defined in configuration');
}


