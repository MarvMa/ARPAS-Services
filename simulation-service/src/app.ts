import 'tsconfig-paths/register';
import express from 'express';
import compression from 'compression';
import {requestLogger} from '@/middleware/logger';
import {errorHandler, notFoundHandler} from '@/middleware/errorHandler';
import recordingRoutes from '@/routes/recordingRoutes';
import {ensureDirectoryExists} from '@/utils/fileUtils';

const app = express();

app.use('/api/');

// General middleware
app.use(compression());
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended: true, limit: '10mb'}));
app.use(requestLogger);

// Ensure upload directory exists
ensureDirectoryExists(process.env.UPLOAD_DIR || 'uploads/');

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API routes
app.use('/api/recordings', recordingRoutes);

// Error handling
app.use(notFoundHandler);
app.use(errorHandler);

export default app;