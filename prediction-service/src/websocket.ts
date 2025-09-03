import fp from "fastify-plugin";
import {FastifyInstance, FastifyRequest} from "fastify";
import {Predictor} from "./predictor";
import fastifyWebsocket, {type WebSocket} from '@fastify/websocket'
import {CacheClient} from "./clients/cacheClient";
import {CacheTracker} from "./cache_tracker";
import {db} from "./clients/database";
import {config} from "./config";

export default fp(async (app: FastifyInstance) => {
    const predictor: Predictor = new Predictor();
    const cacheClient: CacheClient = new CacheClient();
    const cacheTracker: CacheTracker = CacheTracker.getInstance();
    await app.register(fastifyWebsocket);

    app.get('/ws/predict', {websocket: true}, (socket: WebSocket, _request: FastifyRequest) => {
            console.log("WebSocket connection established!");

            socket.on('message', async (message: string) => {
                try {
                    const sensorData = JSON.parse(message.toString());
                    const predictionResult = predictor.predict(sensorData);

                    if (predictionResult == null) {
                        throw new Error('Prediction result is null');
                    }

                    console.log("Prediction result:", predictionResult);
                    const predictedLat = predictionResult?.position.latitude;
                    const predictedLon = predictionResult?.position.longitude;
                    console.log(`Predicted Location: lat=${predictedLat}, lon=${predictedLon}`);
                    let uncachedIds: string[] = [];
                    let foundObjectIds: string[] = [];
                    if (predictedLat != null && predictedLon != null) {
                        const nearbyObjects = await db.getObjectsInRadius(predictedLat, predictedLon, config.predictionRadius)
                        foundObjectIds = nearbyObjects.map(obj => obj.id);
                        uncachedIds = cacheTracker.getUncachedObjects(foundObjectIds);
                    } else {
                        throw new Error('Invalid prediction result');
                    }


                    if (predictionResult) {
                        const cachedIds = await cacheClient.preload(uncachedIds).catch(console.error);
                        if (Array.isArray(cachedIds) && cachedIds.length > 0) {
                            cacheTracker.updateCachedObjects(cachedIds);

                        }
                    }
                    socket.send(JSON.stringify({
                        status: 'success',
                        message: 'Prediction processed',
                        objectIds: foundObjectIds || []
                    }));


                } catch (error) {
                    console.error('Error processing message:', error);
                    socket.send(JSON.stringify({
                        status: 'error',
                        message: 'Error processing prediction',
                        objectIds: []
                    }));
                }
            });
            socket.on('error', (err: Error) => {
                console.error("WebSocket error:", err);
            });
            socket.on('close', () => {
                console.error("WebSocket connection closed");
            });

        }
    )
    ;
});
            
        
            