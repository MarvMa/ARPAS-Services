"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchMetadata = fetchMetadata;
const config_1 = require("../config");
const axios_1 = __importDefault(require("axios"));
async function fetchMetadata(id) {
    const response = await axios_1.default.get(`${config_1.config.storageUrl}:${config_1.config.storagePort}/objects/${id}`);
    return response.data;
}
