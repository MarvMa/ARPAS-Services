import React from 'react';
import axios from '../axios';

const Controls: React.FC = () => {
    const start = () => axios.post('/simulation/start');
    const stop = () => axios.post('/simulation/stop');
    const reset = () => axios.post('/simulation/reset');

    return (
        <div>
            <button onClick={start}>Start Simulation</button>
            <button onClick={stop}>Stop</button>
            <button onClick={reset}>Reset</button>
        </div>
    );
};

export default Controls;