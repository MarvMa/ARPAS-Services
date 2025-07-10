import { Request, Response, NextFunction } from "express";
import { CacheManager } from "./manager";

const cacheManager = new CacheManager();

export const preloadObjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const { ids } = req.body;

        if (!Array.isArray(ids)) {
            res.status(400).json({
                success: false,
                message: 'Invalid request: ids must be an array'
            });
            return;
        }

        console.info(`Received preload request for ${ids.length} objects`);
        const success = await cacheManager.preloadObjects(ids);

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
        const id = parseInt(req.params.id, 10);

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
        res.send(data);
    } catch (error) {
        console.error(`Error getting object:`, error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};