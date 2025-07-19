import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import {sequelize} from './models/index';
import {simulationRouter} from './routes/simulationRoutes';

dotenv.config();

const PORT = process.env.PORT || process.env.SIMULATION_PORT || 8003;
const app = express();

app.use(helmet());
app.use(compression());
app.use(express.json());  
app.use(rateLimit({windowMs: 15 * 60 * 1000, max: 100}));  // basic rate limiting

app.use('/api', simulationRouter);
app.use('/simulation', simulationRouter);

app.get('/health', (_, res) => res.send('OK'));

// Initialize database
sequelize.sync().then(() => {
    console.log('Database synchronized');
}).catch(err => {
    console.error('Database sync error:', err);
});

app.listen(PORT, () => {
    console.log(`Simulation Service is running on port ${PORT}`);
});
