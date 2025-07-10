"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageClient = void 0;
const config_1 = require("../config");
const axios_1 = __importDefault(require("axios"));
class StorageClient {
    baseUrl;
    constructor() {
        this.baseUrl = config_1.config.storageUrl;
    }
    async getPredictedModels(query) {
        try {
            const response = await axios_1.default.post(`${this.baseUrl}/api/storage/predict`, query);
            return response.data;
        }
        catch (error) {
            console.error('Error fetching prediction:', error);
            return [];
        }
    }
}
exports.StorageClient = StorageClient;
