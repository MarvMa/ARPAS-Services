"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Predictor = void 0;
const kalmanFilter_1 = require("./utils/kalmanFilter");
class Predictor {
    history = [];
    maxHistorySize = 30;
    predict(sensor) {
        this.history.push(sensor);
        if (this.history.length > this.maxHistorySize) {
            this.history.shift(); // Remove the oldest entry if we exceed max size
        }
        // TODO: Put into a separate function
        const lats = this.history.map(data => data.latitude);
        const smoothedLats = (0, kalmanFilter_1.smoothData)(lats);
        const lastLat = smoothedLats[smoothedLats.length - 1];
        const lons = this.history.map(data => data.longitude);
        const smoothedLons = (0, kalmanFilter_1.smoothData)(lons);
        const lastLon = smoothedLons[smoothedLons.length - 1];
        return 0; // Placeholder for actual prediction logic
    }
    async predictWithModel(sensor) {
        // Placeholder for model prediction logic
        // This could involve calling a machine learning model or algorithm
        return this.predict(sensor);
    }
}
exports.Predictor = Predictor;
