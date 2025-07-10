import express from "express";
import axios from "axios";
import Database from "better-sqlite3";

const PORT = process.env.SIMULATION_PORT;
const STORAGE_API = process.env.STORAGE_URL;

const db = new Database(':memory:');
db.exec(`CREATE TABLE IF NOT EXISTS simulations
         (
             id
             INTEGER
             PRIMARY
             KEY
             AUTOINCREMENT,
             color
             TEXT,
             data
             TEXT,
             points
             INTEGER,
             duration
             REAL
         )`);

let projectId: string = "";

async function initProject() {
    try {
        const res = await axios.get(`${STORAGE_API}/projects`);
        const projects = res.data;
        let project = projects.find((p: any) => p.title === "ARPAS Example Project");
        if (!project) {
            const createRes = await axios.post(`${STORAGE_API}/projects`, {
                title: "APAS Example Project",
                description: ""
            });
            project = createRes.data;
        }
        projectId = project.id;
        console.log(`Using project ${projectId} (${project.title})`);
    } catch (err) {
        console.error("Failed to initialize project in StorageService", err);
        process.exit(1);
    }
}

const app = express();
app.use(express.json({limit: '50mb'}));
app.use('/', express.static('public'));

app.get('/api/simulation/project', (_, res) => {
    res.json({id: projectId, title: "ARPAS Example Project"});
});


app.post('/api/simulation/upload', (req, res) => {
    try {
        const dataArray = req.body;
        if (!Array.isArray(dataArray)) {
            throw new Error("Invalid JSON format");
        }
        const locPoints = dataArray.filter(pt => pt.sensor === "Location");
        const numPoints = locPoints.length;
        if (numPoints === 0) {
            return res.status(400).json({error: "No location data in file"});
        }
        locPoints.sort((a, b) => {
            const tA = BigInt(a.time), tB = BigInt(b.time);
            return tA < tB ? -1 : (tA > tB ? 1 : 0);
        });
        const startTime = BigInt(locPoints[0].time);
        const endTime = BigInt(locPoints[locPoints.length - 1].time);
        const durationSec = Number(endTime - startTime) / 1e9;  // Nanosekunden in Sekunden

        const colorParam = req.query.color || (req.body.color);
        const color = (typeof colorParam === "string" && colorParam) ? colorParam : "#0000ff";

        const dataText = JSON.stringify(dataArray);
        const stmt = db.prepare(`INSERT INTO simulations (color, data, points, duration)
                                 VALUES (?, ?, ?, ?)`);
        const info = stmt.run(color, dataText, numPoints, durationSec);
        const newId = info.lastInsertRowid;
        res.status(201).json({id: newId, points: numPoints, duration: durationSec});
    } catch (err) {
        console.error("Upload error:", err);
        res.status(400).json({error: "Invalid JSON file"});
    }
});

app.post('/api/simulation/start', (_, res) => {
    // @ts-ignore
    const count = db.prepare(`SELECT COUNT(*) AS cnt
                              FROM simulations`).get().cnt;
    console.log(`Starting simulation for ${count} user(s)`);
    return res.json({message: "Simulation started", users: count});
});

app.post('/api/simulation/stop', (_, res) => {
    console.log("Stopping simulation (if running)");
    return res.json({message: "Simulation stopped"});
});

app.post('/api/simulation/reset', (_, res) => {
    db.prepare(`DELETE
                FROM simulations`).run();
    console.log("Simulation reset (all data cleared)");
    return res.json({message: "Simulation reset completed"});
});

initProject().then(() => {
    app.listen(PORT, () => {
        console.log(`SimulationService listening on port ${PORT}`);
    });
});
