import express, { Express } from 'express';
import { config } from './config';
import * as handlers from './handlers';

const app: Express = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_, res) => {
    res.status(200).send('OK');
});

app.post('/preload', handlers.preloadObjects);
app.get('/object/:id', handlers.getObject);

app.listen(config.port, () => {
    console.info(`Cache service is running on port ${config.port}`);
});