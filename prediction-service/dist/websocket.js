"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const predictor_1 = require("./predictor");
const websocket_1 = __importDefault(require("@fastify/websocket"));
const cacheClient_1 = require("./clients/cacheClient");
exports.default = (0, fastify_plugin_1.default)(async (app) => {
    const predictor = new predictor_1.Predictor();
    const cacheClient = new cacheClient_1.CacheClient();
    await app.register(websocket_1.default);
    app.get('/ws/predict', { websocket: true }, (socket, _request) => {
        console.log("WebSocket connection established!");
        socket.on('message', async (message) => {
            try {
                console.log("Received message:", message.toString());
                const sensorData = JSON.parse(message.toString());
                const ids = await predictor.predict(sensorData);
                const cachePreloaded = cacheClient.preload(ids).catch(console.error);
                let status;
                let messageToSend;
                if (!cachePreloaded) {
                    status = 'success';
                    messageToSend = 'Cache preloaded successfully';
                }
                else {
                    status = 'error';
                    messageToSend = 'Cache preloading failed';
                    console.error('Cache preloading failed');
                }
                socket.send(JSON.stringify({
                    status: status,
                    message: messageToSend,
                    objectIds: ids
                }));
            }
            catch (error) {
                console.error('Error processing message:', error);
            }
        });
        socket.on('error', (err) => {
            console.error("WebSocket error:", err);
        });
        socket.on('close', () => {
            console.error("WebSocket connection closed");
        });
    });
});
