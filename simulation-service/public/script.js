let projectId = null;
let users = [];
let objects = [];

const map = L.map('map').setView([52.48239, 13.43674], 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19
}).addTo(map);

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const projRes = await fetch('/api/simulation/project');
        const projData = await projRes.json();
        projectId = projData.id;
        await loadExistingObjects();
    } catch (err) {
        console.error('Error fetching project info', err);
    }
});

async function loadExistingObjects() {
    if (!projectId) return;
    const res = await fetch(`/api/storage/projects/${projectId}/objects`);
    if (!res.ok) return;
    const project = await res.json();
    if (project.objects) {
        for (const objRef of project.objects) {
            const obj = objRef.object;
            if (!obj) continue;
            const lat = objRef.position?.latitude;
            const lon = objRef.position?.longitude;
            addObjectToUI(obj.id, obj.original_filename, lat, lon);
        }
    }
}

document.getElementById('addUserBtn').addEventListener('click', () => {
    const idx = users.length;
    const entryDiv = document.createElement('div');
    entryDiv.className = 'userEntry';
    // File input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    // Color input
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = getRandomColor();
    // Info text
    const infoSpan = document.createElement('span');
    infoSpan.className = 'fileInfo';
    infoSpan.textContent = '(no file selected)';

    entryDiv.appendChild(fileInput);
    entryDiv.appendChild(colorInput);
    entryDiv.appendChild(infoSpan);
    document.getElementById('usersContainer').appendChild(entryDiv);

    const user = {
        file: null,
        color: colorInput.value,
        dataPoints: [],
        ws: null,
        intervalId: null,
        loadedObjects: new Set(),
        polyline: null
    };
    users.push(user);

    colorInput.addEventListener('input', () => {
        user.color = colorInput.value;
        if (user.polyline) {
            user.polyline.setStyle({color: user.color});
        }
    });

    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        infoSpan.textContent = 'Loading...';
        user.file = file;
        const text = await file.text();
        let jsonData;
        try {
            jsonData = JSON.parse(text);
        } catch (err) {
            infoSpan.textContent = 'Error: Invalid JSON';
            return;
        }
        const locPoints = jsonData.filter(p => p.sensor === "Location");
        const orientPoints = jsonData.filter(p => p.sensor === "Orientation");
        if (locPoints.length === 0) {
            infoSpan.textContent = 'Error: No Location data';
            return;
        }
        locPoints.sort((a, b) => BigInt(a.time) - BigInt(b.time));
        const startTime = BigInt(locPoints[0].time);
        const endTime = BigInt(locPoints[locPoints.length - 1].time);
        const durationSec = Number(endTime - startTime) / 1e9;

        orientPoints.sort((a, b) => BigInt(a.time) - BigInt(b.time));
        let j = 0;
        user.dataPoints = locPoints.map(loc => {
            const tLoc = BigInt(loc.time);
            while (j < orientPoints.length && BigInt(orientPoints[j].time) < tLoc) {
                j++;
            }
            let headingDeg = 0, pitchDeg = 0;
            if (orientPoints.length > 0) {
                let cand = orientPoints[j] || orientPoints[orientPoints.length - 1];
                let candPrev = j > 0 ? orientPoints[j - 1] : null;
                if (candPrev && cand) {
                    const diff1 = Math.abs(Number(BigInt(cand.time) - tLoc));
                    const diff2 = candPrev ? Math.abs(Number(BigInt(candPrev.time) - tLoc)) : Number.MAX_VALUE;
                    if (diff2 < diff1) cand = candPrev;
                }
                if (cand.sensor === "Orientation") {
                    const yaw = parseFloat(cand.yaw);
                    const pitch = parseFloat(cand.pitch);
                    headingDeg = (yaw * 180 / Math.PI) % 360;
                    if (headingDeg < 0) headingDeg += 360;
                    pitchDeg = pitch * 180 / Math.PI;
                }
            }
            if (orientPoints.length === 0 && loc.bearing && parseFloat(loc.bearing) >= 0) {
                headingDeg = parseFloat(loc.bearing);
            }
            const altitude = loc.altitudeAboveMeanSeaLevel ? parseFloat(loc.altitudeAboveMeanSeaLevel)
                : (loc.altitude ? parseFloat(loc.altitude) : 0);
            return {
                latitude: parseFloat(loc.latitude),
                longitude: parseFloat(loc.longitude),
                altitude: altitude,
                heading: headingDeg,
                pitch: pitchDeg
            };
        });
        infoSpan.textContent = `Points: ${locPoints.length}, Duration: ${durationSec.toFixed(1)}s`;
        const latLngs = user.dataPoints.map(p => [p.latitude, p.longitude]);
        user.polyline = L.polyline(latLngs, {color: user.color}).addTo(map);
        const bounds = L.latLngBounds([]);
        users.forEach(u => {
            if (u.polyline) bounds.extend(u.polyline.getBounds());
        });
        if (bounds.isValid()) {
            map.fitBounds(bounds);
        }
        const uploadUrl = `/api/simulation/upload?color=${encodeURIComponent(user.color)}`;
        try {
            const response = await fetch(uploadUrl, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: text
            });
            if (!response.ok) {
                console.error('Upload failed:', await response.text());
            } else {
                const result = await response.json();
                console.log(`Uploaded track (ID=${result.id}, ${result.points} points)`);
            }
        } catch (err) {
            console.error('Error uploading track data', err);
        }
    });
});

let pendingObjectFile = null;
document.getElementById('addObjectBtn').addEventListener('click', () => {
    const fileInput = document.getElementById('objFileInput');
    const file = fileInput.files[0];
    if (!file) {
        alert("Please choose a 3D object file first.");
        return;
    }
    pendingObjectFile = file;
    logMessage(`Click on the map to place the object "${file.name}"`);
    map.once('click', async (e) => {
        if (!pendingObjectFile) return;
        const {lat, lng} = e.latlng;
        const file = pendingObjectFile;
        pendingObjectFile = null;
        // Objekt hochladen (POST /objects)
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await fetch(`/api/storage/objects`, {method: 'POST', body: formData});
            if (!res.ok) {
                throw new Error(`Upload failed: ${res.status}`);
            }
            const objMeta = await res.json();
            const objId = objMeta.id;
            const objName = objMeta.original_filename;
            const refRes = await fetch(`/api/storage/projects/${projectId}/objects`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    object_id: objId,
                    position: {latitude: lat, longitude: lng, altitude: 0},
                    rotation_x: 0, rotation_y: 0, rotation_z: 0,
                    scale_x: 1, scale_y: 1, scale_z: 1
                })
            });
            if (!refRes.ok) {
                throw new Error(`Project association failed: ${refRes.status}`);
            }
            addObjectToUI(objId, objName, lat, lng);
            logMessage(`Object "${objName}" uploaded and placed at (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        } catch (err) {
            console.error('Error adding object to project:', err);
            logMessage("Error adding object. See console for details.");
        }
        document.getElementById('objFileInput').value = "";
    });
});

function addObjectToUI(objectId, name, lat, lon) {
    const marker = L.marker([lat, lon]).addTo(map).bindPopup(name || "Object");
    const li = document.createElement('li');
    li.textContent = `${name || objectId} at [${lat.toFixed(5)}, ${lon.toFixed(5)}]`;
    const delBtn = document.createElement('button');
    delBtn.textContent = "Delete";
    delBtn.addEventListener('click', async () => {
        try {
            await fetch(`/api/storage/projects/${projectId}/objects/${objectId}`, {method: 'DELETE'});
            await fetch(`/api/storage/objects/${objectId}`, {method: 'DELETE'});
            logMessage(`Object ${name || objectId} deleted`);
        } catch (err) {
            console.error('Error deleting object', err);
        }
        map.removeLayer(marker);
        li.remove();
        objects = objects.filter(o => o.id !== objectId);
    });
    li.appendChild(delBtn);
    document.getElementById('objectsList').appendChild(li);
    objects.push({id: objectId, name: name, lat: lat, lon: lon, marker: marker});
}

document.getElementById('startBtn').addEventListener('click', async () => {
    if (users.length === 0) return;
    await fetch('/api/simulation/start', {method: 'POST'});
    document.getElementById('startBtn').disabled = true;
    document.getElementById('stopBtn').disabled = false;
    users.forEach(user => {
        user.loadedObjects.clear();
        const protocol = (location.protocol === 'https:') ? 'wss:' : 'ws:';
        user.ws = new WebSocket(`${protocol}//${location.host}/ws/predict`);
        user.ws.onmessage = async (event) => {
            try {
                const ids = JSON.parse(event.data);
                if (Array.isArray(ids)) {
                    for (const id of ids) {
                        if (!user.loadedObjects.has(id)) {
                            user.loadedObjects.add(id);
                            const obj = objects.find(o => o.id === id);
                            let name = obj ? obj.name : null;
                            if (!obj) {
                                const metaRes = await fetch(`/api/storage/objects/${id}`);
                                if (metaRes.ok) {
                                    const meta = await metaRes.json();
                                    name = meta.original_filename;
                                    objects.push({id: id, name: name, lat: 0, lon: 0, marker: null});
                                }
                            }
                            await fetch(`/api/storage/objects/${id}/download`);
                            logMessage(`Loaded object ${name || id}`);
                        }
                    }
                }
            } catch (err) {
                console.error("Error in WS message handling:", err);
            }
        };
        user.ws.onopen = () => {
            let idx = 0;
            user.intervalId = setInterval(() => {
                if (idx < user.dataPoints.length) {
                    const p = user.dataPoints[idx++];
                    const message = {
                        position: {latitude: p.latitude, longitude: p.longitude, altitude: p.altitude},
                        viewingDirection: {heading: p.heading, pitch: p.pitch},
                        frustum: {fovHorizontal: 90, fovVertical: 60, viewDistance: 30}
                    };
                    user.ws.send(JSON.stringify(message));
                } else {
                    clearInterval(user.intervalId);
                    user.ws.close();
                }
            }, 200);
        };
        user.ws.onclose = () => {
            const allClosed = users.every(u => u.ws && u.ws.readyState === WebSocket.CLOSED);
            if (allClosed) {
                logMessage("Benchmarking completed.");  // alle Simulationen beendet
                document.getElementById('startBtn').disabled = false;
                document.getElementById('stopBtn').disabled = true;
            }
        };
    });
});

document.getElementById('stopBtn').addEventListener('click', async () => {
    await fetch('/api/simulation/stop', {method: 'POST'});
    users.forEach(user => {
        if (user.intervalId) clearInterval(user.intervalId);
        if (user.ws && user.ws.readyState === WebSocket.OPEN) {
            user.ws.close();
        }
    });
    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    logMessage("Simulation stopped.");
});

document.getElementById('resetBtn').addEventListener('click', async () => {
    await fetch('/api/simulation/reset', {method: 'POST'});
    users.forEach(user => {
        if (user.intervalId) clearInterval(user.intervalId);
        if (user.ws) user.ws.close();
    });
    document.getElementById('usersContainer').innerHTML = "";
    users = [];

    objects.forEach(o => {
        if (o.marker) map.removeLayer(o.marker);
    });
    document.getElementById('objectsList').innerHTML = "";
    objects = [];

    map.setView([52.48239, 13.43674], 15);

    document.getElementById('startBtn').disabled = false;
    document.getElementById('stopBtn').disabled = true;
    logMessage("Simulation data cleared. Ready.");
});

function getRandomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
}

function logMessage(msg) {
    const logDiv = document.getElementById('log');
    logDiv.textContent = msg;
}
