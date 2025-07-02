import fastify from "fastify";
import wsPlugin from "./websocket.js";
import {config} from "./config.js";

process.on('unhandledRejection', err => {
    console.error('UNHANDLED REJECTION:', err);
    process.exit(1);
});
process.on('uncaughtException', err => {
    console.error('UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

async function main() {
    const app = fastify({
        logger: true,
        ignoreTrailingSlash: true
    });
    app.register(wsPlugin);

    try {
        await app.listen({port: config.port, host: '0.0.0.0'})
        console.info('Prediction service is running on port ' + config.port);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }

}

main().catch(console.error);