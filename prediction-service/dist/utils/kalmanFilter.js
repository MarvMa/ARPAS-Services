"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.smoothData = smoothData;
const kalmanjs_1 = __importDefault(require("kalmanjs"));
const kalmanFilter = new kalmanjs_1.default({ R: 0.01, Q: 3 });
function smoothData(data) {
    return data.map(value => kalmanFilter.filter(value));
}
