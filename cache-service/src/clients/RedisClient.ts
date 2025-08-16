import Redis from 'ioredis';
import config from '../config';

export class RedisClient {
    private client: Redis;

    constructor() {
        this.client = new Redis({
            host: config.redisHost,
            port: config.redisPort,
            retryStrategy: (times: number): number => {
                return Math.min(times * 50, 2000);
            }
        });

        this.client.on('error', (err) => {
            console.error('Redis error:', err);
        });

        this.client.on('connect', () => {
            console.info('Connected to Redis');
        });
    }

    async get(key: string): Promise<string | null> {
        return this.client.get(key);
    }

    async set(key: string, value: string): Promise<string> {
        return this.client.set(key, value);
    }

    async exists(key: string): Promise<number> {
        return this.client.exists(key);
    }

    async expire(key: string, seconds: number): Promise<number> {
        return this.client.expire(key, seconds);
    }

    async zadd(key: string, score: number, member: string): Promise<number> {
        return this.client.zadd(key, score, member);
    }

    async setBuffer(key: string, value: Buffer): Promise<string> {
        return this.client.set(key, value);
    }

    async getBuffer(key: string): Promise<Buffer | null> {
        return this.client.getBuffer(key);
    }

    async keys(pattern: string): Promise<string[]> {
        return this.client.keys(pattern);
    }
}