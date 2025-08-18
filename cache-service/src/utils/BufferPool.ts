import {promisify} from 'util';
import {gzip, gunzip, constants} from 'zlib';
import {performance} from 'perf_hooks';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * High-performance buffer pool for memory optimization
 */
export class BufferPool {
    private pools: Map<number, Buffer[]> = new Map();
    private maxPoolSize: Map<number, number> = new Map();
    private allocated: Map<number, number> = new Map();
    private hits: number = 0;
    private misses: number = 0;

    constructor(configs: Array<{ size: number; count: number }>) {
        configs.forEach(({size, count}) => {
            this.pools.set(size, []);
            this.maxPoolSize.set(size, count);
            this.allocated.set(size, 0);

            // Pre-allocate buffers
            for (let i = 0; i < count; i++) {
                this.pools.get(size)!.push(Buffer.allocUnsafe(size));
            }
        });

        console.log(`BufferPool initialized with ${this.getTotalBuffers()} buffers`);
    }

    /**
     * Get a buffer from the pool
     */
    getBuffer(size: number): Buffer {
        // Find the smallest buffer that fits the requested size
        const availableSizes = Array.from(this.pools.keys()).filter(s => s >= size).sort((a, b) => a - b);

        for (const bufferSize of availableSizes) {
            const pool = this.pools.get(bufferSize)!;
            if (pool.length > 0) {
                this.hits++;
                const buffer = pool.pop()!;
                this.allocated.set(bufferSize, this.allocated.get(bufferSize)! + 1);
                return buffer.subarray(0, size); // Return only the needed size
            }
        }

        // Pool miss - allocate new buffer
        this.misses++;
        console.warn(`Buffer pool miss for size ${size}, allocating new buffer`);
        return Buffer.allocUnsafe(size);
    }

    /**
     * Return a buffer to the pool
     */
    returnBuffer(buffer: Buffer, originalSize: number): void {
        const pool = this.pools.get(originalSize);
        const maxSize = this.maxPoolSize.get(originalSize);

        if (pool && maxSize && pool.length < maxSize) {
            // Clear the buffer before returning to pool
            buffer.fill(0);
            pool.push(buffer);
            this.allocated.set(originalSize, Math.max(0, this.allocated.get(originalSize)! - 1));
        }
    }

    /**
     * Get pool statistics
     */
    getStats(): any {
        const stats: any = {
            hits: this.hits,
            misses: this.misses,
            hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)) * 100 : 0,
            pools: {}
        };

        this.pools.forEach((pool, size) => {
            stats.pools[size] = {
                available: pool.length,
                allocated: this.allocated.get(size),
                maxSize: this.maxPoolSize.get(size)
            };
        });

        return stats;
    }

    /**
     * Get total number of buffers across all pools
     */
    getTotalBuffers(): number {
        let total = 0;
        this.pools.forEach(pool => {
            total += pool.length;
        });
        this.allocated.forEach(count => {
            total += count;
        });
        return total;
    }

    /**
     * Cleanup all pools
     */
    cleanup(): void {
        this.pools.clear();
        this.maxPoolSize.clear();
        this.allocated.clear();
        console.log('BufferPool cleaned up');
    }
}

/**
 * High-performance compression utilities
 */
export class CompressionStream {
    private static readonly COMPRESSION_LEVEL = constants.Z_BEST_SPEED; // Optimized for speed over ratio
    private static readonly CHUNK_SIZE = 16 * 1024; // 16KB chunks

    /**
     * Compress data with optimal settings for binary data
     */
    static async compress(data: Buffer): Promise<Buffer> {
        const startTime = performance.now();

        try {
            const compressed = await gzipAsync(data, {
                level: this.COMPRESSION_LEVEL,
                chunkSize: this.CHUNK_SIZE,
                windowBits: 15,
                memLevel: 8,
                strategy: constants.Z_DEFAULT_STRATEGY
            });

            const compressionTime = performance.now() - startTime;
            const ratio = (1 - compressed.length / data.length) * 100;

            console.log(`Compressed ${data.length} -> ${compressed.length} bytes (${ratio.toFixed(1)}% reduction) in ${compressionTime.toFixed(2)}ms`);

            return compressed;
        } catch (error) {
            console.error('Compression failed:', error);
            throw error;
        }
    }

    /**
     * Decompress data
     */
    static async decompress(data: Buffer): Promise<Buffer> {
        const startTime = performance.now();

        try {
            const decompressed = await gunzipAsync(data, {
                chunkSize: this.CHUNK_SIZE
            });

            const decompressionTime = performance.now() - startTime;
            console.log(`Decompressed ${data.length} -> ${decompressed.length} bytes in ${decompressionTime.toFixed(2)}ms`);

            return decompressed;
        } catch (error) {
            console.error('Decompression failed:', error);
            throw error;
        }
    }

    /**
     * Check if compression would be beneficial
     */
    static shouldCompress(data: Buffer, threshold: number = 100 * 1024): boolean {
        // Don't compress small files or already compressed data
        if (data.length < threshold) {
            return false;
        }

        // Quick entropy check - if data has low entropy, compression likely beneficial
        const entropy = this.calculateEntropy(data.subarray(0, Math.min(1024, data.length)));
        return entropy > 4.0; // Threshold for text-like data
    }

    /**
     * Calculate Shannon entropy for compression estimation
     */
    private static calculateEntropy(data: Buffer): number {
        const frequencies = new Map<number, number>();

        for (const byte of data) {
            frequencies.set(byte, (frequencies.get(byte) || 0) + 1);
        }

        let entropy = 0;
        const length = data.length;

        frequencies.forEach(freq => {
            const probability = freq / length;
            entropy -= probability * Math.log2(probability);
        });

        return entropy;
    }
}

/**
 * Advanced metrics collector for scientific analysis
 */
export class MetricsCollector {
    private httpRequests: Array<{
        method: string;
        path: string;
        statusCode: number;
        duration: number;
        timestamp: number;
    }> = [];

    private cacheHits: Array<{
        objectId: string;
        latency: number;
        size: number;
        timestamp: number;
    }> = [];

    private cacheMisses: Array<{
        objectId: string;
        latency: number;
        timestamp: number;
    }> = [];

    private storageDownloads: Array<{
        objectId: string;
        latency: number;
        size: number;
        timestamp: number;
    }> = [];

    private preloadOperations: Array<{
        requested: number;
        successful: number;
        duration: number;
        timestamp: number;
    }> = [];

    private cacheStats: any = {};

    /**
     * Record HTTP request metrics
     */
    recordHttpRequest(method: string, path: string, statusCode: number, duration: number): void {
        this.httpRequests.push({
            method,
            path,
            statusCode,
            duration,
            timestamp: Date.now()
        });

        // Keep only last 10000 requests to prevent memory bloat
        if (this.httpRequests.length > 10000) {
            this.httpRequests = this.httpRequests.slice(-5000);
        }
    }

    /**
     * Record cache hit
     */
    recordCacheHit(objectId: string, latency: number, size: number): void {
        this.cacheHits.push({
            objectId,
            latency,
            size,
            timestamp: Date.now()
        });

        if (this.cacheHits.length > 10000) {
            this.cacheHits = this.cacheHits.slice(-5000);
        }
    }

    /**
     * Record cache miss
     */
    recordCacheMiss(objectId: string, latency: number): void {
        this.cacheMisses.push({
            objectId,
            latency,
            timestamp: Date.now()
        });

        if (this.cacheMisses.length > 10000) {
            this.cacheMisses = this.cacheMisses.slice(-5000);
        }
    }

    /**
     * Record storage download
     */
    recordStorageDownload(objectId: string, latency: number, size: number): void {
        this.storageDownloads.push({
            objectId,
            latency,
            size,
            timestamp: Date.now()
        });

        if (this.storageDownloads.length > 10000) {
            this.storageDownloads = this.storageDownloads.slice(-5000);
        }
    }

    /**
     * Record preload operation
     */
    recordPreloadOperation(requested: number, successful: number, duration: number): void {
        this.preloadOperations.push({
            requested,
            successful,
            duration,
            timestamp: Date.now()
        });
    }

    /**
     * Record preload success for individual object
     */
    recordPreloadSuccess(objectId: string, latency: number, size: number): void {
        // This could be expanded to track individual preload successes
        console.log(`Preloaded object ${objectId}: ${size} bytes in ${latency.toFixed(2)}ms`);
    }

    /**
     * Update cache statistics
     */
    updateCacheStats(stats: any): void {
        this.cacheStats = {
            ...stats,
            lastUpdated: Date.now()
        };
    }

    /**
     * Get comprehensive metrics for analysis
     */
    getMetrics(): any {
        const now = Date.now();
        const last5Min = now - 5 * 60 * 1000;
        const last1Hour = now - 60 * 60 * 1000;

        // Filter recent data
        const recentHits = this.cacheHits.filter(h => h.timestamp >= last5Min);
        const recentMisses = this.cacheMisses.filter(m => m.timestamp >= last5Min);
        const recentDownloads = this.storageDownloads.filter(d => d.timestamp >= last5Min);
        const recentRequests = this.httpRequests.filter(r => r.timestamp >= last5Min);

        // Calculate statistics
        const totalRequests = recentHits.length + recentMisses.length;
        const cacheHitRate = totalRequests > 0 ? (recentHits.length / totalRequests) * 100 : 0;

        const avgCacheLatency = recentHits.length > 0
            ? recentHits.reduce((sum, h) => sum + h.latency, 0) / recentHits.length
            : 0;

        const avgStorageLatency = recentDownloads.length > 0
            ? recentDownloads.reduce((sum, d) => sum + d.latency, 0) / recentDownloads.length
            : 0;

        const avgHttpLatency = recentRequests.length > 0
            ? recentRequests.reduce((sum, r) => sum + r.duration, 0) / recentRequests.length
            : 0;

        return {
            timestamp: now,
            period: '5min',
            cache: {
                hitRate: cacheHitRate,
                hits: recentHits.length,
                misses: recentMisses.length,
                avgLatency: avgCacheLatency,
                totalDataServed: recentHits.reduce((sum, h) => sum + h.size, 0)
            },
            storage: {
                downloads: recentDownloads.length,
                avgLatency: avgStorageLatency,
                totalDataDownloaded: recentDownloads.reduce((sum, d) => sum + d.size, 0)
            },
            http: {
                requests: recentRequests.length,
                avgLatency: avgHttpLatency,
                statusCodes: this.groupBy(recentRequests, 'statusCode')
            },
            preload: {
                operations: this.preloadOperations.filter(p => p.timestamp >= last1Hour),
                totalRequested: this.preloadOperations
                    .filter(p => p.timestamp >= last1Hour)
                    .reduce((sum, p) => sum + p.requested, 0),
                totalSuccessful: this.preloadOperations
                    .filter(p => p.timestamp >= last1Hour)
                    .reduce((sum, p) => sum + p.successful, 0)
            },
            cacheStats: this.cacheStats
        };
    }

    /**
     * Get Prometheus-formatted metrics
     */
    getPrometheusMetrics(): string {
        const metrics = this.getMetrics();
        const lines: string[] = [];

        lines.push(`# HELP cache_hit_rate_percent Cache hit rate percentage`);
        lines.push(`# TYPE cache_hit_rate_percent gauge`);
        lines.push(`cache_hit_rate_percent ${metrics.cache.hitRate}`);

        lines.push(`# HELP cache_avg_latency_ms Average cache latency in milliseconds`);
        lines.push(`# TYPE cache_avg_latency_ms gauge`);
        lines.push(`cache_avg_latency_ms ${metrics.cache.avgLatency}`);

        lines.push(`# HELP storage_avg_latency_ms Average storage latency in milliseconds`);
        lines.push(`# TYPE storage_avg_latency_ms gauge`);
        lines.push(`storage_avg_latency_ms ${metrics.storage.avgLatency}`);

        lines.push(`# HELP http_avg_latency_ms Average HTTP latency in milliseconds`);
        lines.push(`# TYPE http_avg_latency_ms gauge`);
        lines.push(`http_avg_latency_ms ${metrics.http.avgLatency}`);

        lines.push(`# HELP cache_data_served_bytes Total data served from cache in bytes`);
        lines.push(`# TYPE cache_data_served_bytes counter`);
        lines.push(`cache_data_served_bytes ${metrics.cache.totalDataServed}`);

        lines.push(`# HELP storage_data_downloaded_bytes Total data downloaded from storage in bytes`);
        lines.push(`# TYPE storage_data_downloaded_bytes counter`);
        lines.push(`storage_data_downloaded_bytes ${metrics.storage.totalDataDownloaded}`);

        return lines.join('\n');
    }

    /**
     * Export detailed data for scientific analysis
     */
    exportDetailedMetrics(): any {
        return {
            exportTimestamp: Date.now(),
            cacheHits: this.cacheHits,
            cacheMisses: this.cacheMisses,
            storageDownloads: this.storageDownloads,
            httpRequests: this.httpRequests,
            preloadOperations: this.preloadOperations,
            summary: this.getMetrics()
        };
    }

    /**
     * Utility function to group array by property
     */
    private groupBy(array: any[], property: string): { [key: string]: number } {
        return array.reduce((groups, item) => {
            const key = item[property];
            groups[key] = (groups[key] || 0) + 1;
            return groups;
        }, {});
    }

    /**
     * Clear all metrics (useful for testing)
     */
    clear(): void {
        this.httpRequests = [];
        this.cacheHits = [];
        this.cacheMisses = [];
        this.storageDownloads = [];
        this.preloadOperations = [];
        this.cacheStats = {};
    }
}