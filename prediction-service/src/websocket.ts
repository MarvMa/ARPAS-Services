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
                    console.log("Received message:", message.toString());
                    const sensorData = JSON.parse(message.toString());
                    const ids = await predictor.predict(sensorData);

                    // Only call cache if we have IDs
                    if (ids && ids.length > 0) {
                        const cachePreloaded = await cacheClient.preload(ids).catch(console.error);
                    }
                    
                    socket.send(JSON.stringify({
                        status: 'success',
                        message: 'Prediction processed',
                        objectIds: ids || []  // Ensure we always send an array
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
            
        
            