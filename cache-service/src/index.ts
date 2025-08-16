import express, { Express } from 'express';
import { config } from './config';
import * as handlers from './handlers';
import { register } from './metrics';
import { CacheManager } from './manager';

const app: Express = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_, res) => {
    res.status(200).send('OK');
});

// Metrics endpoint
app.get('/metrics', async (_, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

// Cache statistics endpoint
app.get('/stats', async (_, res) => {
    const cacheManager = new CacheManager();
    const stats = await cacheManager.getCacheStatistics();
    res.json(stats);
});

// API endpoints
app.post('/preload', handlers.preloadObjects);
app.get('/object/:id', handlers.getObject);

app.listen(config.port, () => {
    console.info(`Cache service is running on port ${config.port}`);
});