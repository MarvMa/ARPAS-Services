import axios from 'axios';
import {config} from '../config';

export class CacheClient {
    private readonly baseUrl: string;

    constructor() {
        this.baseUrl = config.storageUrl;
    }

    /**
     * Send Predicted Location to Storage-Service to preload cache
     * @param objectIDs
     */
    async preload(objectIDs: string[]): Promise<string[]> {
        if (objectIDs.length == 0) {
            return [];
        }
        try {
            console.log(`PATH ${this.baseUrl}/cache/preload`)
            const payload = {
                objectIds: objectIDs,
            };
            const response = await axios.post(`${this.baseUrl}/cache/preload`, payload);
            return response.data;
        } catch (error) {
            console.error('Error preloading cache:', error);
            return [];
        }
    }
}
