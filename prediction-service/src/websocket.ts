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

                    const cachePreloaded = cacheClient.preload(ids).catch(console.error);

                    let status: string;
                    let messageToSend: string;
                    
                    if (!cachePreloaded) {
                        status = 'success';
                        messageToSend = 'Cache preloaded successfully';

                    } else {
                        status = 'error';
                        messageToSend = 'Cache preloading failed';
                        console.error('Cache preloading failed');
                    }
                    socket.send(JSON.stringify({
                        status: status,
                        message: messageToSend,
                        objectIds: ids

                    }));
                } catch (error) {
                    console.error('Error processing message:', error);
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
            
        
            