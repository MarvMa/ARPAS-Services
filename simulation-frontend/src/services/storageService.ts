import axios from 'axios';
import {Object3D} from '../types/simulation';

const STORAGE_API_BASE = 'http://localhost/api/storage';

export class StorageService {
    /**
     * Fetches all 3D objects from the storage service
     */
    async getAllObjects(): Promise<Object3D[]> {
        try {
            const response = await axios.get(`${STORAGE_API_BASE}/objects`);
            return response.data;
        } catch (error) {
            console.error('Failed to fetch 3D objects:', error);
            throw new Error('Failed to fetch 3D objects from storage service');
        }
    }

    /**
     * Gets a specific 3D object by ID
     */
    async getObject(id: string): Promise<Object3D> {
        try {
            const response = await axios.get(`${STORAGE_API_BASE}/objects/${id}`);
            return response.data;
        } catch (error) {
            console.error(`Failed to fetch 3D object ${id}:`, error);
            throw new Error(`Failed to fetch 3D object: ${id}`);
        }
    }

    /**
     * Uploads a new 3D object with optional location data
     */
    async uploadObject(
        file: File,
        latitude?: number,
        longitude?: number,
        altitude?: number
    ): Promise<Object3D> {
        try {
            if (!file.name.toLowerCase().endsWith('.glb')) {
                throw new Error('Only GLB files are supported');
            }

            const formData = new FormData();
            formData.append('file', file);

            if (latitude !== undefined) {
                formData.append('latitude', latitude.toString());
            }
            if (longitude !== undefined) {
                formData.append('longitude', longitude.toString());
            }
            if (altitude !== undefined) {
                formData.append('altitude', altitude.toString());
            }

            const response = await axios.post(
                `${STORAGE_API_BASE}/objects/upload`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 120000 // 2 minutes timeout for large files
                }
            );

            return response.data;
        } catch (error) {
            console.error('Failed to upload 3D object:', error);
            if (axios.isAxiosError(error)) {
                const message = error.response?.data?.message || error.message;
                throw new Error(`Upload failed: ${message}`);
            }
            throw new Error('Failed to upload 3D object');
        }
    }

    /**
     * Deletes a 3D object by ID
     */
    async deleteObject(id: string): Promise<void> {
        try {
            await axios.delete(`${STORAGE_API_BASE}/objects/${id}`);
        } catch (error) {
            console.error(`Failed to delete 3D object ${id}:`, error);
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    throw new Error('3D object not found');
                }
                const message = error.response?.data?.message || error.message;
                throw new Error(`Delete failed: ${message}`);
            }
            throw new Error(`Failed to delete 3D object: ${id}`);
        }
    }

    /**
     * Downloads a 3D object file
     */
    async downloadObject(id: string): Promise<Blob> {
        try {
            const response = await axios.get(
                `${STORAGE_API_BASE}/objects/${id}/download`,
                {
                    responseType: 'blob',
                    timeout: 60000 // 1 minute timeout
                }
            );
            return response.data;
        } catch (error) {
            console.error(`Failed to download 3D object ${id}:`, error);
            throw new Error(`Failed to download 3D object: ${id}`);
        }
    }

    /**
     * Gets the download URL for a 3D object
     */
    getDownloadUrl(id: string): string {
        return `${STORAGE_API_BASE}/objects/${id}/download`;
    }

    /**
     * Checks if the storage service is available
     */
    async healthCheck(): Promise<boolean> {
        try {
            const healthUrl = (import.meta as any).env?.DEV ? '/health' : 'http://localhost/api/storage/health';
            await axios.get(healthUrl, {
                timeout: 5000
            });
            return true;
        } catch (error) {
            console.warn('Storage service health check failed:', error);
            return false;
        }
    }
}