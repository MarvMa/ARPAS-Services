"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheClient = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
class CacheClient {
    baseUrl;
    constructor() {
        this.baseUrl = config_1.config.cacheUrl;
    }
    async preload(ids) {
        return true;
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/preload`, { ids });
            return response.status === 200;
        }
        catch (error) {
            console.error('Error preloading cache:', error);
            return false;
        }
    }
}
exports.CacheClient = CacheClient;
