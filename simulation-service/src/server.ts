import 'tsconfig-paths/register';
import dotenv from 'dotenv';
import app from './app';
import {initializeDatabase} from '@/config/database';
import {logger} from '@/middleware/logger';


// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || 'localhost';

async function startServer(): Promise<void> {
    try {
        await initializeDatabase();

        // Start server
        app.listen(PORT, () => {
            logger.info(`Simulation service running on http://${HOST}:${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    process.exit(0);
});

startServer();