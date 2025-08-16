import {Registry, Counter, Gauge, Histogram} from 'prom-client';

export const register = new Registry();

// Metrics
export const cacheHits = new Counter({
    name: 'cache_hits_total',
    help: 'Total number of cache hits',
    labelNames: ['object_id'],
    registers: [register]
});

export const cacheMisses = new Counter({
    name: 'cache_misses_total',
    help: 'Total number of cache misses',
    labelNames: ['object_id'],
    registers: [register]
});

export const cacheSize = new Gauge({
    name: 'cache_size_bytes',
    help: 'Current cache size in bytes',
    registers: [register]
});

export const cacheObjectCount = new Gauge({
    name: 'cache_object_count',
    help: 'Number of objects in cache',
    registers: [register]
});

export const downloadLatency = new Histogram({
    name: 'cache_download_latency_ms',
    help: 'Latency of downloads from storage service',
    buckets: [10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    registers: [register]
});

export const cacheLatency = new Histogram({
    name: 'cache_retrieval_latency_ms',
    help: 'Latency of cache retrievals',
    buckets: [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100],
    registers: [register]
});