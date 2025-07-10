const WebSocket = require('ws');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');

async function createAndUploadTestObject() {
    try {
        const formData = new FormData();

        const testFilePath = path.resolve("./Duck.glb");

        if (!fs.existsSync(testFilePath)) {
            console.error(`Test file not found at: ${testFilePath}`);
            throw new Error("Test model file not found");
        }

        formData.append("file", fs.createReadStream(testFilePath));

        console.log(`Uploading test file: ${testFilePath}`);

        // Upload the object to the storage service
        const response = await axios.post(
            "http://localhost:80/api/storage/objects/upload",
            formData,
            {
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            }
        );

        console.log("Object uploaded successfully:", response.data);
        return response.data;
    } catch (error) {
        console.error("Error creating and uploading test object:", error);
        throw error;
    }
}

// WebSocket test client
function testWebSocket(objectId) {
    const ws = new WebSocket('ws://localhost:80/ws/predict');

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
                heading: 90,
            };

            console.log(`Sending message ${count + 1}:`, JSON.stringify(message));
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
}

async function main() {
    try {
        // Upload test object if needed
        const objectData = await createAndUploadTestObject();

        testWebSocket();
    } catch (error) {
        console.error("Error in main process:", error);
    }
}

main().catch(error => {
    console.error("Unhandled error in main:", error);
});