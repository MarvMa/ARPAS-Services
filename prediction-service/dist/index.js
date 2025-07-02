"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const websocket_js_1 = __importDefault(require("./websocket.js"));
const config_js_1 = require("./config.js");
process.on('unhandledRejection', err => {
    console.error('UNHANDLED REJECTION:', err);
    process.exit(1);
});
process.on('uncaughtException', err => {
    console.error('UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});
async function main() {
    const app = (0, fastify_1.default)({
        logger: true,
        ignoreTrailingSlash: true
    });
    app.register(websocket_js_1.default);
    try {
        await app.listen({ port: config_js_1.config.port, host: '0.0.0.0' });
        console.info('Prediction service is running on port ' + config_js_1.config.port);
    }
    catch (error) {
        console.error(error);
        process.exit(1);
    }
}
main().catch(console.error);
