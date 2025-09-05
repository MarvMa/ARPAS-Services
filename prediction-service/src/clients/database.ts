import { Pool } from 'pg';
import {config} from "../config";
import {Predictor} from "../predictor";

export interface Object3D {
    id: string;
    original_filename: string;
    latitude?: number;
    longitude?: number;
    altitude?: number;
    storage_key: string;
}

class Database {
    private pool: Pool;
    private predictor: Predictor = new Predictor();
    constructor() {
        
        this.pool = new Pool({
            host: config.dbHost,
            port: config.dbPort,
            database: config.dbName ,
            user: config.dbUser,
            password: config.dbPassword,
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 2000,
        });
    }

    async getObjectsInRadius(lat: number, lon: number, radiusMeters: number): Promise<Object3D[]> {
        const latDegreePerMeter = 1.0 / 111320.0;
        const lngDegreePerMeter = 1.0 / (111320.0 * Math.cos(lat * Math.PI / 180.0));

        const deltaLat = radiusMeters * latDegreePerMeter;
        const deltaLng = radiusMeters * lngDegreePerMeter;

        const minLat = lat - deltaLat;
        const maxLat = lat + deltaLat;
        const minLng = lon - deltaLng;
        const maxLng = lon + deltaLng;

        const query = `
            SELECT 
                id, 
                original_filename, 
                latitude, 
                longitude, 
                altitude,
                storage_key
            FROM objects 
            WHERE latitude IS NOT NULL 
                AND longitude IS NOT NULL
                AND latitude BETWEEN $1 AND $2 
                AND longitude BETWEEN $3 AND $4
        `;

        try {
            const result = await this.pool.query(query, [minLat, maxLat, minLng, maxLng]);

            return result.rows.filter(obj => {
                const distance = this.predictor.calculateDistance(lat, lon, obj.latitude, obj.longitude);
                return distance <= radiusMeters;
            });
        } catch (error) {
            console.error('Database query error:', error);
            return [];
        }
    }
}

export const db = new Database();