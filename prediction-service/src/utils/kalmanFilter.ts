import KalmanFilter from 'kalmanjs';

const kalmanFilter = new KalmanFilter({R:0.01, Q: 3});

export function smoothData(data: number[]): number[] {
    return data.map(value => kalmanFilter.filter(value));
}