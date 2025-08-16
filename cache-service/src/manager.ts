import { RedisClient } from "./clients/redisClient";
import { StorageClient } from "./clients/storageClient";
import config from "./config";
import { cacheHits, cacheMisses, cacheSize, cacheObjectCount, downloadLatency, cacheLatency } from "./metrics";

export class CacheManager {
    private redisClient: RedisClient;
    private storageClient: StorageClient;
    private cacheStats: Map<string, { size: number; hits: number; lastAccess: number }> = new Map();

    constructor() {
        this.redisClient = new RedisClient();
        this.storageClient = new StorageClient();
        this.startMetricsCollection();
    }

    private startMetricsCollection() {
        // Update metrics every 10 seconds
        setInterval(async () => {
            try {
                const keys = await this.redisClient.keys('object:*:data');
                let totalSize = 0;
                let objectCount = 0;

                for (const key of keys) {
                    const size = await this.redisClient.get(key.replace(':data', ':size'));
                    if (size) {
                        totalSize += parseInt(size);
                        objectCount++;
                    }
                }

                cacheSize.set(totalSize);
                cacheObjectCount.set(objectCount);
            } catch (error) {
                console.error('Error collecting metrics:', error);
            }
        }, 10000);
    }

    async preloadObjects(ids: number[]): Promise<boolean> {
        try {
            console.info(`Preloading ${ids.length} objects to Redis memory`);
            const startTime = Date.now();

            const preloadPromises = ids.map(async (id) => {
                const isCached = await this.isObjectCached(id);
                if (isCached) {
                    console.debug(`Object ${id} already in Redis cache`);
                    return true;
                }

                const downloadStart = performance.now();
                const objectData = await this.storageClient.downloadModel(id);
                const downloadEnd = performance.now();

                if (!objectData) {
                    console.error(`Failed to download object ${id}`);
                    return false;
                }

                downloadLatency.observe(downloadEnd - downloadStart);

                await this.cacheObject(id, objectData);
                console.debug(`Object ${id} cached successfully in Redis`);
                return true;
            });

            const results = await Promise.all(preloadPromises);
            const success = results.every(Boolean);

            const totalTime = Date.now() - startTime;
            console.info(`Preload completed in ${totalTime}ms with ${success ? 'success' : 'some failures'}`);
            return success;
        } catch (error) {
            console.error('Error preloading objects:', error);
            return false;
        }
    }

    async getObject(id: number): Promise<Buffer | null> {
        const retrievalStart = performance.now();

        try {
            const objectData = await this.redisClient.getBuffer(`object:${id}:data`);

            if (!objectData) {
                console.debug(`Object ${id} not found in Redis cache`);
                cacheMisses.inc({ object_id: id.toString() });
                return null;
            }

            // Update cache hit metrics
            cacheHits.inc({ object_id: id.toString() });

            // Update access timestamp and statistics
            await this.redisClient.zadd('object:access', Date.now(), id.toString());

            const stats = this.cacheStats.get(id.toString()) || { size: objectData.length, hits: 0, lastAccess: 0 };
            stats.hits++;
            stats.lastAccess = Date.now();
            this.cacheStats.set(id.toString(), stats);

            const retrievalEnd = performance.now();
            cacheLatency.observe(retrievalEnd - retrievalStart);

            return Buffer.from(objectData);
        } catch (error) {
            console.error(`Error retrieving object ${id}:`, error);
            const retrievalEnd = performance.now();
            cacheLatency.observe(retrievalEnd - retrievalStart);
            return null;
        }
    }

    async getCacheStatistics(): Promise<any> {
        const keys = await this.redisClient.keys('object:*:data');
        const statistics = {
            totalObjects: keys.length,
            totalSize: 0,
            objects: [] as any[],
            hitRate: 0,
            avgLatency: 0
        };

        for (const key of keys) {
            const id = key.split(':')[1];
            const size = await this.redisClient.get(`object:${id}:size`);
            const updated = await this.redisClient.get(`object:${id}:updated`);
            const stats = this.cacheStats.get(id);

            if (size) {
                statistics.totalSize += parseInt(size);
                statistics.objects.push({
                    id,
                    size: parseInt(size),
                    updated: updated ? new Date(parseInt(updated)) : null,
                    hits: stats?.hits || 0,
                    lastAccess: stats?.lastAccess ? new Date(stats.lastAccess) : null
                });
            }
        }

        // Calculate hit rate
        let totalHits = 0;
        let totalRequests = 0;
        for (const stats of this.cacheStats.values()) {
            totalHits += stats.hits;
            totalRequests += stats.hits + 1; // Assuming at least one miss per object
        }
        statistics.hitRate = totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;

        return statistics;
    }

    private async isObjectCached(id: number): Promise<boolean> {
        const exists = await this.redisClient.exists(`object:${id}:data`);
        return exists === 1;
    }

    private async cacheObject(id: number, data: Buffer): Promise<void> {
        await this.redisClient.setBuffer(`object:${id}:data`, data);
        await this.redisClient.set(`object:${id}:size`, data.length.toString());
        await this.redisClient.set(`object:${id}:updated`, Date.now().toString());
        await this.redisClient.zadd('object:access', Date.now(), id.toString());

        if (config.objectTTL > 0) {
            await this.redisClient.expire(`object:${id}:data`, config.objectTTL);
            await this.redisClient.expire(`object:${id}:size`, config.objectTTL);
            await this.redisClient.expire(`object:${id}:updated`, config.objectTTL);
        }
    }

    async keys(pattern: string): Promise<string[]> {
        return this.redisClient.keys(pattern);
    }
}
