const WebSocket = require('ws');

// Create WebSocket connection - adjust host/port if needed
const ws = new WebSocket('ws://localhost:80/ws/predict');

// Create a base timestamp and position
const baseTime = new Date();
let count = 0;

ws.on('open', () => {
    console.log('WebSocket connection established');

    // Send 10 messages with 0.2s interval
    const interval = setInterval(() => {
        if (count >= 10) {
            clearInterval(interval);
            setTimeout(() => ws.close(), 1000); // Wait for final response
            return;
        }

        // Create message with incrementing timestamp and slightly changing position
        const message = {
            latitude: 54.5 + (count * 0.01),
            longitude: 17.4 + (count * 0.01),
            altitude: 100.0 + (count * 5.0),
            timestamp: new Date(baseTime.getTime() + (count * 200)).toISOString(),
            speed: 50,
            heading: 90
        };

        console.log(`Sending message ${count+1}:`, JSON.stringify(message));
        ws.send(JSON.stringify(message));
        count++;
    }, 200);
});

ws.on('message', (data) => {
    console.log('Received:', data.toString());
});

ws.on('close', () => {
    console.log('Connection closed');
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});