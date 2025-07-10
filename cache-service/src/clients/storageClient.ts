import config from "../config";
import axios from "axios";


export class StorageClient {
    private readonly baseUrl: String;

    constructor() {
        this.baseUrl = config.storageUrl;
    }

    async downloadModel(id: number): Promise<Buffer | null> {
        try {
            const response = await axios.get(`${this.baseUrl}/api/storage/objects/${id}/download`, {
                responseType: 'arraybuffer'
            });

            return Buffer.from(response.data);
        } catch (error) {
            console.error(`Error downloading object ${id} from storage:`, error);
            return null;
        }
    }
}
    
