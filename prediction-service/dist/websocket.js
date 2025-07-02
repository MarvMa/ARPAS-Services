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
    app.register(websocket_1.default);
    app.get('/ws/predict', { websocket: true }, (socket, _request) => {
        console.log("WebSocket connection established!");
        socket.on('message', async (message) => {
            try {
                console.log("Received message:", message);
                const sensorData = JSON.parse(message.toString());
                const ids = predictor.predict(sensorData);
                (0, cacheClient_1.preloadCache)(ids).catch(console.error);
                socket.send(JSON.stringify({ objectIds: ids }));
            }
            catch (error) {
                console.error('Error processing message:', error);
            }
        });
        socket.on('error', (err) => {
            console.error("WebSocket error:", err);
        });
    });
});
