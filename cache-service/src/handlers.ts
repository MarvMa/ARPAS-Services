import {Request, Response, NextFunction} from "express";
import {CacheManager} from "./manager";

const cacheManager = new CacheManager();
const UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function extractUuid(input: string | undefined): string | null {
    if (!input) return null;
    const m = input.match(UUID_REGEX);
    return m ? m[0].toLowerCase() : null;
}

export const preloadObjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const {ids} = req.body;
        console.info(`Received preload request for ${ids.length} objects ${ids.join(', ')}`);
        if (!Array.isArray(ids)) {
            res.status(400).json({
                success: false,
                message: 'Invalid request: ids must be an array'
            });
            return;
        }

        const uuids = Array.from(
            new Set(
                ids
                    .map((raw) => (typeof raw === "string" ? extractUuid(raw) : null))
                    .filter((v): v is string => !!v)
            )
        );

        if (uuids.length === 0) {
            res.status(400).json({success: false, message: "No valid UUIDs provided"});
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
        const idParam: string = req.params.id;
        const uuid = extractUuid(idParam);
        if (!uuid) {
            res.status(400).json({success: false, message: "Invalid object ID (expected UUID)"});
            console.error(`Invalid object ID: ${idParam}`);
            return;
        }

        const data = await cacheManager.getObject(uuid);

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
