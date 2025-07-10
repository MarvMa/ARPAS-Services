"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Predictor = void 0;
const kalmanjs_1 = __importDefault(require("kalmanjs"));
const storageClient_1 = require("./clients/storageClient");
class Predictor {
    history = [];
    maxHistorySize = 30;
    latKalman;
    lonKalman;
    altKalman;
    storageClient;
    // Config
    DEFAULT_FOV = 60; // degrees
    DEFAULT_VIEW_DISTANCE = 100; // meters
    PREDICTION_TIME_SECONDS = 5;
    KALMAN_CONFIG = {
        R: 0.01, // Measurement noise
        Q: 3, // Process noise
        A: 1 // State transition
    };
    constructor() {
        // R: measurement noise, Q: process noise, A: state transition
        this.latKalman = new kalmanjs_1.default(this.KALMAN_CONFIG);
        this.lonKalman = new kalmanjs_1.default(this.KALMAN_CONFIG);
        this.altKalman = new kalmanjs_1.default(this.KALMAN_CONFIG);
        this.storageClient = new storageClient_1.StorageClient();
    }
    calculateHeading(current, previous) {
        if (current.heading !== undefined) {
            return current.heading;
        }
        const dLat = current.latitude - previous.latitude;
        const dLon = current.longitude - previous.longitude;
        return (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
    }
    calculatePitch(current, previous) {
        const dAlt = current.altitude - previous.altitude;
        const dLatLon = Math.sqrt(Math.pow(current.latitude - previous.latitude, 2) +
            Math.pow(current.longitude - previous.longitude, 2));
        return Math.atan2(dAlt, dLatLon) * 180 / Math.PI;
    }
    calculateVelocity(current, previous) {
        const timeDiff = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000; // in seconds
        return {
            latitudeVelocity: (current.latitude - previous.latitude) / timeDiff,
            longitudeVelocity: (current.longitude - previous.longitude) / timeDiff,
            altitudeVelocity: (current.altitude - previous.altitude) / timeDiff
        };
    }
    async predict(sensor) {
        this.history.push(sensor);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift(); // Remove the oldest entry if we exceed max size
        }
        if (this.history.length < 2) {
            return []; // TODO: Return a default value or handle insufficient data
        }
        const current = this.history[this.history.length - 1];
        const previous = this.history[this.history.length - 2];
        const velocity = this.calculateVelocity(current, previous);
        const predictedLat = this.latKalman.filter(current.latitude + velocity.latitudeVelocity * this.PREDICTION_TIME_SECONDS);
        const predictedLon = this.lonKalman.filter(current.longitude + velocity.longitudeVelocity * this.PREDICTION_TIME_SECONDS);
        const predictedAlt = this.altKalman.filter(current.altitude + velocity.altitudeVelocity * this.PREDICTION_TIME_SECONDS);
        const heading = this.calculateHeading(current, previous);
        const pitch = this.calculatePitch(current, previous);
        console.info('Predicted position:', predictedLat, predictedLon, predictedAlt);
        console.info('Predicted heading:', heading);
        console.info('Predicted pitch:', pitch);
        const prediction = {
            position: {
                latitude: predictedLat,
                longitude: predictedLon,
                altitude: predictedAlt
            },
            viewingDirection: {
                heading: heading,
                pitch: pitch
            },
            frustum: {
                fovHorizontal: this.DEFAULT_FOV,
                fovVertical: this.DEFAULT_FOV * 0.75,
                viewDistance: this.DEFAULT_VIEW_DISTANCE
            }
        };
        return this.getPredictedObjectIds(prediction);
    }
    async getPredictedObjectIds(prediction) {
        try {
            return await this.storageClient.getPredictedModels(prediction);
        }
        catch (error) {
            console.error('Error fetching prediction from StorageClient:', error);
        }
        return [];
    }
}
exports.Predictor = Predictor;
