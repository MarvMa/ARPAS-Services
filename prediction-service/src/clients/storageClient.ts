import {config} from "../config";
import axios from "axios";

export interface PredictionQuery {
    position: {
        latitude: number;
        longitude: number;
        altitude: number;
    };
    viewingDirection: {
        heading: number;  // degrees from north
        pitch: number;    // degrees from horizontal
    };
    frustum: {
        fovHorizontal: number;  // field of view in degrees
        fovVertical: number;    // field of view in degrees
        viewDistance: number;    // in meters
    };
}

export class StorageClient {
    private readonly baseUrl: String;

    constructor() {
        this.baseUrl = config.storageUrl;
    }

    async getPredictedModels(query: PredictionQuery): Promise<number[]> {
        try {
            const response = await axios.post(
                `${this.baseUrl}/api/storage/predict`,
                query);
            return response.data as number[];
        } catch (error) {
            console.error('Error fetching prediction:', error);
            return [];
        }
    }
}
    
