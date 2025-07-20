import axios from 'axios';
import {Object3D, StorageObjectResponse, isValidStorageObject} from '../types/simulation';

/**
 * Service for managing 3D object storage operations
 * Handles upload, download, delete, and retrieval of GLB files
 */
export class StorageService {
    private readonly API_BASE = 'http://localhost/api/storage';
    private readonly HEALTH_ENDPOINT = 'http://localhost/api/storage/health';

    /**
     * Fetches all 3D objects from the storage service
     */
    async getAllObjects(): Promise<Object3D[]> {
        try {
            console.log('Fetching all 3D objects from storage service...');
            const response = await axios.get(`${this.API_BASE}/objects`, {
                timeout: 10000 // 10 second timeout
            });

            // Validate that response is an array
            if (!Array.isArray(response.data)) {
                throw new Error('Expected array response from storage service');
            }

            // Parse and validate each object in the response
            const objects: Object3D[] = [];
            const errors: string[] = [];

            response.data.forEach((item: any, index: number) => {
                if (isValidStorageObject(item)) {
                    objects.push(item);
                } else {
                    errors.push(`Invalid object at index ${index}`);
                    console.warn(`Invalid storage object at index ${index}:`, item);
                }
            });

            if (errors.length > 0) {
                console.warn(`Found ${errors.length} invalid objects out of ${response.data.length} total`);
            }

            console.log(`Successfully loaded ${objects.length} valid 3D objects`);
            return objects;

        } catch (error) {
            console.error('Failed to fetch 3D objects:', error);
            if (axios.isAxiosError(error)) {
                const message = error.response?.data?.message || error.message;
                throw new Error(`Failed to fetch 3D objects: ${message}`);
            }
            throw new Error('Failed to fetch 3D objects from storage service');
        }
    }

    /**
     * Gets a specific 3D object by ID
     */
    async getObject(id: string): Promise<Object3D> {
        try {
            console.log(`Fetching 3D object: ${id}`);
            const response = await axios.get(`${this.API_BASE}/objects/${id}`, {
                timeout: 10000
            });

            // Validate the response object
            if (!isValidStorageObject(response.data)) {
                throw new Error(`Invalid object response format for ID: ${id}`);
            }

            return response.data;

        } catch (error) {
            console.error(`Failed to fetch 3D object ${id}:`, error);
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    throw new Error(`3D object not found: ${id}`);
                }
                const message = error.response?.data?.message || error.message;
                throw new Error(`Failed to fetch 3D object: ${message}`);
            }
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
            // Validate file type
            if (!file.name.toLowerCase().endsWith('.glb')) {
                throw new Error('Only GLB files are supported');
            }

            // Validate file size (limit to 50MB)
            const maxSize = 50 * 1024 * 1024; // 50MB
            if (file.size > maxSize) {
                throw new Error('File size exceeds 50MB limit');
            }

            console.log(`Uploading 3D object: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

            const formData = new FormData();
            formData.append('file', file);

            // Add location data if provided
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
                `${this.API_BASE}/objects/upload`,
                formData,
                {
                    headers: {
                        'Content-Type': 'multipart/form-data',
                    },
                    timeout: 120000, // 2 minutes timeout for large files
                    onUploadProgress: (progressEvent) => {
                        if (progressEvent.total) {
                            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                            console.log(`Upload progress: ${progress}%`);
                        }
                    }
                }
            );

            // Validate the upload response
            if (!isValidStorageObject(response.data)) {
                throw new Error(`Invalid upload response format for: ${file.name}`);
            }

            console.log(`Successfully uploaded: ${file.name} with ID: ${response.data.ID}`);
            return response.data;

        } catch (error) {
            console.error(`Failed to upload 3D object ${file.name}:`, error);
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNABORTED') {
                    throw new Error('Upload timeout - file too large or connection too slow');
                }
                const message = error.response?.data?.message || error.message;
                throw new Error(`Upload failed: ${message}`);
            }
            throw new Error(`Failed to upload 3D object: ${file.name}`);
        }
    }

    /**
     * Deletes a 3D object by ID
     */
    async deleteObject(id: string): Promise<void> {
        try {
            console.log(`Deleting 3D object: ${id}`);
            await axios.delete(`${this.API_BASE}/objects/${id}`, {
                timeout: 30000 // 30 second timeout
            });
            console.log(`Successfully deleted object: ${id}`);

        } catch (error) {
            console.error(`Failed to delete 3D object ${id}:`, error);
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    throw new Error('3D object not found - may have already been deleted');
                }
                const message = error.response?.data?.message || error.message;
                throw new Error(`Delete failed: ${message}`);
            }
            throw new Error(`Failed to delete 3D object: ${id}`);
        }
    }

    /**
     * Downloads a 3D object file as blob
     */
    async downloadObject(id: string): Promise<Blob> {
        try {
            console.log(`Downloading 3D object: ${id}`);
            const response = await axios.get(
                `${this.API_BASE}/objects/${id}/download`,
                {
                    responseType: 'blob',
                    timeout: 60000, // 1 minute timeout
                    onDownloadProgress: (progressEvent) => {
                        if (progressEvent.total) {
                            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                            console.log(`Download progress for ${id}: ${progress}%`);
                        }
                    }
                }
            );

            console.log(`Successfully downloaded object: ${id} (${(response.data.size / 1024).toFixed(2)}KB)`);
            return response.data;

        } catch (error) {
            console.error(`Failed to download 3D object ${id}:`, error);
            if (axios.isAxiosError(error)) {
                if (error.response?.status === 404) {
                    throw new Error('3D object file not found');
                }
                if (error.code === 'ECONNABORTED') {
                    throw new Error('Download timeout - file too large or connection too slow');
                }
                const message = error.response?.data?.message || error.message;
                throw new Error(`Download failed: ${message}`);
            }
            throw new Error(`Failed to download 3D object: ${id}`);
        }
    }

    /**
     * Gets the download URL for a 3D object (for direct linking)
     */
    getDownloadUrl(id: string): string {
        return `${this.API_BASE}/objects/${id}/download`;
    }

    /**
     * Checks if the storage service is available and responsive
     */
    async healthCheck(): Promise<boolean> {
        try {
            console.log('Performing storage service health check...');
            await axios.get(this.HEALTH_ENDPOINT, {
                timeout: 5000 // 5 second timeout for health check
            });
            console.log('Storage service is healthy and available');
            return true;

        } catch (error) {
            console.warn('Storage service health check failed:', error);
            if (axios.isAxiosError(error)) {
                if (error.code === 'ECONNREFUSED') {
                    console.warn('Storage service appears to be offline');
                } else if (error.code === 'ECONNABORTED') {
                    console.warn('Storage service health check timed out');
                } else {
                    console.warn(`Storage service returned error: ${error.response?.status || 'unknown'}`);
                }
            }
            return false;
        }
    }

    /**
     * Gets storage service statistics (if available)
     */
    async getStorageStats(): Promise<{
        totalObjects: number;
        totalSize: number;
        availableSpace?: number;
    } | null> {
        try {
            const response = await axios.get(`${this.API_BASE}/stats`, {
                timeout: 10000
            });
            return response.data;
        } catch (error) {
            console.warn('Failed to fetch storage statistics:', error);
            return null;
        }
    }

    /**
     * Bulk delete objects by IDs
     */
    async bulkDeleteObjects(ids: string[]): Promise<{
        successful: string[];
        failed: { id: string; error: string }[];
    }> {
        const successful: string[] = [];
        const failed: { id: string; error: string }[] = [];

        console.log(`Starting bulk deletion of ${ids.length} objects...`);

        const deletePromises = ids.map(async (id) => {
            try {
                await this.deleteObject(id);
                successful.push(id);
            } catch (error) {
                failed.push({
                    id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });

        await Promise.all(deletePromises);

        console.log(`Bulk deletion completed: ${successful.length} successful, ${failed.length} failed`);

        return { successful, failed };
    }
}