import axios from 'axios';
import {config} from '../config';
import {PredictionResult} from "../predictor";

export class CacheClient {
    private readonly baseUrl: string;

    constructor() {
        this.baseUrl = config.storageUrl;
    }

    /**
     * Send Predicted Location to Storage-Service to preload cache
     * @param predictionResult
     */
    async preload(predictionResult: PredictionResult): Promise<number[]> {
        try {
            console.log(`PATH ${this.baseUrl}/cache/preload`)
            const response = await axios.post(`${this.baseUrl}/cache/preload`, predictionResult);
            return response.data;
        } catch (error) {
            console.error('Error preloading cache:', error);
            return [];
        }
    }
}
