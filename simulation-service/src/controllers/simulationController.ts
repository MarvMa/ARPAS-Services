import {Request, Response} from 'express';
import multer from 'multer';
import Joi from 'joi';
import {Profile} from '../models/index';
import {startSimulation, stopSimulation, resetSimulation, getSimulationStatus, getRoutePoints} from '../services/simulationService';

// Multer setup for parsing JSON file uploads into memory
const upload = multer({storage: multer.memoryStorage()});

// Schema to validate that uploaded JSON is an array of points with required fields
const routeSchema = Joi.array().items(
    Joi.object({
        latitude: Joi.any().required(),
        longitude: Joi.any().required(),
        altitude: Joi.any().required(),
        // At least one of seconds_elapsed or timestamp should exist for time reference
        seconds_elapsed: Joi.any(),
        timestamp: Joi.any(),
        speed: Joi.any()
    }).unknown(true)
);

// Controller for uploading a movement profile JSON file
export const uploadProfile = [
    upload.single('file'),
    async (req: Request, res: Response) => {
        try {
            console.log('UPLOAD DEBUG:', {
                body: req.body,
                file: req.file,
                headers: req.headers
            });
            if (!req.file) {
                return res.status(400).json({error: 'No file uploaded.'});
            }
            const fileBuffer = req.file.buffer;
            const jsonStr = fileBuffer.toString('utf-8');
            let data;
            try {
                data = JSON.parse(jsonStr);
            } catch (parseErr) {
                const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
                console.error('JSON parse error:', parseErr, 'Content:', jsonStr.slice(0, 200));
                return res.status(400).json({error: 'Invalid JSON file format.', details: errMsg});
            }
            // Filter out objects without all required fields before validation
            const filteredData = Array.isArray(data)
                ? data.filter((p: any) => p.latitude !== undefined && p.longitude !== undefined && p.altitude !== undefined)
                : [];
            // Validate JSON structure (must be an array of coordinate points)
            const {error} = routeSchema.validate(filteredData);
            if (error) {
                return res.status(400).json({error: 'Invalid data format.', details: error.details});
            }
            if (filteredData.length === 0) {
                return res.status(400).json({error: 'No valid coordinate points found in the uploaded file.'});
            }
            // Extract color and duration from request body
            const color = req.body.color || '#ff0000';
            const duration = parseFloat(req.body.duration) || 60;
            // Create new profile record
            const newProfile = await Profile.create({
                color,
                duration,
                startLat: parseFloat(filteredData[0].latitude),
                startLon: parseFloat(filteredData[0].longitude),
                endLat: parseFloat(filteredData[filteredData.length - 1].latitude),
                endLon: parseFloat(filteredData[filteredData.length - 1].longitude),
                routeData: JSON.stringify(filteredData)
            });
            console.log('Profile created:', newProfile.id);
            res.json({
                message: 'Profile uploaded successfully',
                profileId: newProfile.id,
                pointCount: filteredData.length
            });
        } catch (error) {
            console.error('Upload error:', error);
            const errMsg = error instanceof Error ? error.message : String(error);
            res.status(500).json({error: 'Internal server error', details: errMsg});
        }
    }
];

// Controller for retrieving all profiles
export const getProfiles = async (req: Request, res: Response) => {
    try {
        const profiles = await Profile.findAll();
        const profilesWithRoute = profiles.map(profile => ({
            id: profile.id,
            color: profile.color,
            duration: profile.duration,
            startLat: profile.startLat,
            startLon: profile.startLon,
            endLat: profile.endLat,
            endLon: profile.endLon,
            route: JSON.parse(profile.routeData || '[]')
        }));
        res.json(profilesWithRoute);
    } catch (error) {
        console.error('Get profiles error:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({error: 'Internal server error', details: errMsg});
    }
};

// Controller for starting a simulation
export const startSimulationController = async (req: Request, res: Response) => {
    try {
        const {profileId} = req.params;
        const profile = await Profile.findByPk(profileId);
        if (!profile) {
            return res.status(404).json({error: 'Profile not found'});
        }
        
        await startSimulation(profile);
        res.json({message: 'Simulation started successfully'});
    } catch (error) {
        console.error('Start simulation error:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({error: 'Failed to start simulation', details: errMsg});
    }
};

// Controller for stopping a simulation
export const stopSimulationController = async (req: Request, res: Response) => {
    try {
        const {profileId} = req.params;
        stopSimulation(profileId);
        res.json({message: 'Simulation stopped successfully'});
    } catch (error) {
        console.error('Stop simulation error:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({error: 'Failed to stop simulation', details: errMsg});
    }
};

// Controller for resetting a simulation
export const resetSimulationController = async (req: Request, res: Response) => {
    try {
        const {profileId} = req.params;
        resetSimulation(profileId);
        res.json({message: 'Simulation reset successfully'});
    } catch (error) {
        console.error('Reset simulation error:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({error: 'Failed to reset simulation', details: errMsg});
    }
};

// Controller for getting simulation status
export const getSimulationStatusController = async (req: Request, res: Response) => {
    try {
        const {profileId} = req.params;
        const status = getSimulationStatus(profileId);
        res.json(status);
    } catch (error) {
        console.error('Get simulation status error:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({error: 'Failed to get simulation status', details: errMsg});
    }
};

// Controller for getting route points
export const getRoutePointsController = async (req: Request, res: Response) => {
    try {
        const {profileId} = req.params;
        const routePoints = getRoutePoints(profileId);
        res.json(routePoints);
    } catch (error) {
        console.error('Get route points error:', error);
        const errMsg = error instanceof Error ? error.message : String(error);
        res.status(500).json({error: 'Failed to get route points', details: errMsg});
    }
};
