import {RedisClient} from "./clients/redisClient";
import {StorageClient} from "./clients/storageClient";
import config from "./config";

export class CacheManager {
    private redisClient: RedisClient;
    private storageClient: StorageClient;

    constructor() {
        this.redisClient = new RedisClient();
        this.storageClient = new StorageClient();
    }


    async preloadObjects(ids: number[]): Promise<boolean> {
        try {
            console.info(`Preloading ${ids.length} objects to Redis memory`);

            const preloadPromises = ids.map(async (id) => {
                // Check if already in cache
                const isCached = await this.isObjectCached(id);
                if (isCached) {
                    console.debug(`Object ${id} already in Redis cache`);
                    return true;
                }

                // If not cached, fetch from storage
                const objectData = await this.storageClient.downloadModel(id);
                if (!objectData) {
                    console.error(`Failed to download object ${id}`);
                    return false;
                }

                // Save to Redis cache
                await this.cacheObject(id, objectData);
                console.debug(`Object ${id} cached successfully in Redis`);
                return true;
            });

            const results = await Promise.all(preloadPromises);
            const success = results.every(Boolean);

            console.info(`Preload completed with ${success ? 'success' : 'some failures'}`);
            return success;
        } catch (error) {
            console.error('Error preloading objects:', error);
            return false;
        }
    }

    async getObject(id: number): Promise<Buffer | null> {
        try {
            // Get object data directly from Redis
            const objectData = await this.redisClient.getBuffer(`object:${id}:data`);

            if (!objectData) {
                console.debug(`Object ${id} not found in Redis cache`);
                return null;
            }

            // Update access timestamp
            await this.redisClient.zadd('object:access', Date.now(), id.toString());

            return Buffer.from(objectData);
        } catch (error) {
            console.error(`Error retrieving object ${id}:`, error);
            return null;
        }
    }

    private async isObjectCached(id: number): Promise<boolean> {
        const exists = await this.redisClient.exists(`object:${id}:data`);
        return exists === 1;
    }

    private async cacheObject(id: number, data: Buffer): Promise<void> {
        // Store binary data directly in Redis
        await this.redisClient.setBuffer(`object:${id}:data`, data);

        // Store metadata
        await this.redisClient.set(`object:${id}:size`, data.length.toString());
        await this.redisClient.set(`object:${id}:updated`, Date.now().toString());

        // Add to access sorted set (for LRU)
        await this.redisClient.zadd('object:access', Date.now(), id.toString());

        // Set TTL if configured
        if (config.objectTTL > 0) {
            await this.redisClient.expire(`object:${id}:data`, config.objectTTL);
            await this.redisClient.expire(`object:${id}:size`, config.objectTTL);
            await this.redisClient.expire(`object:${id}:updated`, config.objectTTL);
        }
    }
}