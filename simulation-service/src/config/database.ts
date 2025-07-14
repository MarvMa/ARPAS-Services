import {DataSource} from 'typeorm';
import {Recording} from '@/models/Recording';
import {Simulation} from '@/models/Simulation';

export const AppDataSource = new DataSource({
    type: 'sqlite',
    database: process.env.DB_NAME || 'simulation.db',
    synchronize: process.env.NODE_ENV === 'development',
    logging: process.env.NODE_ENV === 'development',
    entities: [Recording, Simulation],
    migrations: [],
    subscribers: [],
});

export const initializeDatabase = async (): Promise<void> => {
    try {
        await AppDataSource.initialize();
        console.log('Database connection initialized');
    } catch (error) {
        console.error('Error during database initialization:', error);
        throw error;
    }
};