import {Router} from 'express';
import {
    uploadProfile,
    getProfiles,
    startSimulationController,
    stopSimulationController,
    resetSimulationController,
    getSimulationStatusController,
    getRoutePointsController
} from '../controllers/simulationController';

export const simulationRouter = Router();

// Route for uploading a movement profile JSON file
simulationRouter.post('/profiles/upload', uploadProfile);

// Route for retrieving all profiles
simulationRouter.get('/profiles', getProfiles);

// Route for starting a simulation
simulationRouter.post('/:profileId/start', startSimulationController);

// Route for stopping a simulation
simulationRouter.post('/:profileId/stop', stopSimulationController);

// Route for resetting a simulation
simulationRouter.post('/:profileId/reset', resetSimulationController);

// Route for getting simulation status
simulationRouter.get('/:profileId/status', getSimulationStatusController);

// Route for getting route points
simulationRouter.get('/:profileId/route', getRoutePointsController);
