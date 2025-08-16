import {Request, Response, NextFunction} from "express";
import {CacheManager} from "./manager";

const cacheManager = new CacheManager();

export const preloadObjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const {ids} = req.body;

        if (!Array.isArray(ids)) {
            res.status(400).json({
                success: false,
                message: 'Invalid request: ids must be an array'
            });
            return;
        }

        // Convert UUIDs to numeric IDs for cache service
        const numericIds = ids.map(id => {
            // If it's already a number, use it
            if (typeof id === 'number') return id;

            // If it's a string that looks like a number, parse it
            const parsed = parseInt(id);
            if (!isNaN(parsed)) return parsed;

            // For UUIDs, use a hash function to generate a consistent numeric ID
            if (typeof id === 'string' && id.includes('-')) {
                // Simple hash function for UUID to number conversion
                let hash = 0;
                for (let i = 0; i < id.length; i++) {
                    const char = id.charCodeAt(i);
                    hash = ((hash << 5) - hash) + char;
                    hash = hash & hash; // Convert to 32bit integer
                }
                return Math.abs(hash);
            }

            return 0;
        }).filter(id => id > 0);

        console.info(`Received preload request for ${numericIds.length} objects`);
        const success = await cacheManager.preloadObjects(numericIds);

        res.status(success ? 200 : 207).json({
            success,
            message: success
                ? 'All objects preloaded successfully'
                : 'Some objects failed to preload'
        });
    } catch (error) {
        console.error('Error in preload handler:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

export const getObject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const idParam = req.params.id;
        let id: number;

        // Handle UUID to number conversion
        if (idParam.includes('-')) {
            // UUID format - convert to number
            let hash = 0;
            for (let i = 0; i < idParam.length; i++) {
                const char = idParam.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            id = Math.abs(hash);
        } else {
            id = parseInt(idParam, 10);
        }

        if (isNaN(id)) {
            res.status(400).json({
                success: false,
                message: 'Invalid object ID'
            });
            return;
        }

        const data = await cacheManager.getObject(id);

        if (!data) {
            res.status(404).json({
                success: false,
                message: 'Object not found in cache'
            });
            return;
        }

        res.set('Content-Type', 'model/gltf-binary');
        res.set('Content-Length', data.length.toString());
        res.set('X-Cache-Hit', 'true');
        res.send(data);
    } catch (error) {
        console.error(`Error getting object:`, error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};
