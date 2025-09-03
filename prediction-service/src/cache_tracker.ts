export class CacheTracker {
    private cachedObjects: Set<string> = new Set();
    private lastUpdate: number = Date.now();
    private static instance: CacheTracker;

    static getInstance(): CacheTracker {
        if (!CacheTracker.instance) {
            CacheTracker.instance = new CacheTracker();
        }
        return CacheTracker.instance;
    }

    updateCachedObjects(objectIds: string[]): void {
        objectIds.forEach(id => this.cachedObjects.add(id));
        this.lastUpdate = Date.now();
        console.log(`Cache tracker updated: ${this.cachedObjects.size} objects cached`);
    }


    getUncachedObjects(objectIds: string[]): string[] {
        return objectIds.filter(id => !this.cachedObjects.has(id));
    }


    isCached(objectId: string): boolean {
        return this.cachedObjects.has(objectId);
    }


    clear(): void {
        this.cachedObjects.clear();
        this.lastUpdate = Date.now();
    }
}