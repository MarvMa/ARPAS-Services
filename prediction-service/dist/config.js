"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.config = {
    port: parseInt(process.env.PREDICTION_PORT || '3000', 10),
    storageUrl: process.env.STORAGE_URL || 'http://localhost',
    cacheUrl: process.env.CACHE_URL || 'http://localhost',
};
console.log('Configuration loaded:', exports.config);
// Validate configuration
if (isNaN(exports.config.port) || exports.config.port <= 0) {
    throw new Error('Invalid port number in configuration');
}
if (!exports.config.storageUrl) {
    throw new Error('Storage URL must be defined in configuration');
}
if (!exports.config.cacheUrl) {
    throw new Error('Cache URL must be defined in configuration');
}
