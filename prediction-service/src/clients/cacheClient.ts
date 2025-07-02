import axios from 'axios';
import {config} from '../config';

export class CacheClient {
    private readonly baseUrl: string;

    constructor() {
        this.baseUrl = config.cacheUrl;
    }

    async preload(ids: number[]): Promise<Boolean> {
        return true;
        try {
            const response = await axios.post(`${this.baseUrl}/preload`, {ids});
            return response.status === 200;
        } catch (error) {
            console.error('Error preloading cache:', error);
            return false;
        }
    }
}
