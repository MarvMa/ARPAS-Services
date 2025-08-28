import fp from "fastify-plugin";
import {FastifyInstance, FastifyRequest} from "fastify";
import {Predictor} from "./predictor";
import fastifyWebsocket, {type WebSocket} from '@fastify/websocket'
import {CacheClient} from "./clients/cacheClient";

export default fp(async (app: FastifyInstance) => {
    const predictor: Predictor = new Predictor();
    const cacheClient: CacheClient = new CacheClient();

    await app.register(fastifyWebsocket);

    app.get('/ws/predict', {websocket: true}, (socket: WebSocket, _request: FastifyRequest) => {
            console.log("WebSocket connection established!");

            socket.on('message', async (message: string) => {
                try {
                    const sensorData = JSON.parse(message.toString());
                    const predictionResult = predictor.predict(sensorData);

                    let objectIds: number[] = [];
                    // Only call cache if we have IDs
                    if (predictionResult) {
                        const ids = await cacheClient.preload(predictionResult).catch(console.error);
                        if (Array.isArray(ids)) {
                            objectIds = ids;
                        }
                    }


                    socket.send(JSON.stringify({
                        status: 'success',
                        message: 'Prediction processed',
                        objectIds: objectIds || []  // Ensure we always send an array
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
            
        
            