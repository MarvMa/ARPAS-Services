"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.preloadCache = preloadCache;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
async function preloadCache(ids) {
    await axios_1.default.post(`${config_1.config.cacheUrl}:${config_1.config.cachePort}/preload`, { ids });
}
