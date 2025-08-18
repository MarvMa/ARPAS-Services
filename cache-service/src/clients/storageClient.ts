import config from "../config";
import axios from "axios";

export interface ObjectMeta {
    id: string; // UUID
    originalFilename?: string;
    contentType?: string;
}

export class StorageClient {
    private readonly baseUrl: String;


    constructor() {
        this.baseUrl = config.storageUrl;
    }

    // async downloadModel(id: number): Promise<Buffer | null> {
    //     try {
    //         const response = await axios.get(`${this.baseUrl}/api/storage/objects/${id}/download`, {
    //             responseType: 'arraybuffer'
    //         });
    //
    //         return Buffer.from(response.data);
    //     } catch (error) {
    //         console.error(`Error downloading object ${id} from storage:`, error);
    //         return null;
    //     }
    // }

    async downloadModel(id: string): Promise<Buffer | null> {
        try {
            let objectId: string;


            objectId = id;

            const url = `${this.baseUrl}/api/storage/objects/${encodeURIComponent(objectId)}/download`;

            const response = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 120_000,
            });

            return Buffer.from(response.data);
        } catch (error) {
            console.error(`Error downloading object ${id} from storage:`, error);
            return null;
        }
    }

}
    
