import axios from 'axios';
import {config} from '../config';

export class CacheClient {
    private readonly baseUrl: string;

    constructor() {
        this.baseUrl = config.storageUrl;
    }

    async preload(ids: number[]): Promise<Boolean> {
        try {
            console.log(`PATH ${this.baseUrl}/cache/preload`)
            const response = await axios.post(`${this.baseUrl}/cache/preload`, {ids});
            return response.status === 200;
        } catch (error) {
            console.error('Error preloading cache:', error);
            return false;
        }
    }
}
