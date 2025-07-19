import React, {useState, useEffect, useRef} from 'react';
import axios from 'axios';

interface SimulationStatus {
    running: boolean;
    currentIndex?: number;
    totalPoints?: number;
    progress?: number;
}

interface SensorData {
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: number;
    speed: number;
    heading?: number;
}

interface ControlsProps {
    profileIds: string[];
    onSimulationPosition?: (profileId: string, index: number) => void;
}

const Controls: React.FC<ControlsProps> = ({ profileIds, onSimulationPosition }) => {
    const [statuses, setStatuses] = useState<{ [id: string]: SimulationStatus }>({});
    const [loading, setLoading] = useState<{ [id: string]: boolean }>({});
    const wsRefs = useRef<{ [id: string]: WebSocket | null }>({});
    const intervalRefs = useRef<{ [id: string]: NodeJS.Timeout | null }>({});
    const currentIndexRefs = useRef<{ [id: string]: number }>({});
    const [routePoints, setRoutePoints] = useState<{ [id: string]: SensorData[] }>({});

    // Get prediction service WebSocket URL from environment variables
    const getWebSocketURL = () => {
        const gatewayPort = process.env.REACT_APP_API_GATEWAY_PORT || '80';

        if (window.location.hostname !== 'localhost') {
            return `ws://${window.location.hostname}:${gatewayPort}/ws/predict`;
        }
        return process.env.REACT_APP_PREDICTION_WS_URL || `ws://localhost:${gatewayPort}/ws/predict`;
    };

    const PREDICTION_WS_URL = getWebSocketURL();

    // Poll simulation status less frequently to avoid 429 errors
    useEffect(() => {
        const intervals: NodeJS.Timeout[] = [];
        profileIds.forEach(profileId => {
            if (!profileId) return;
            const interval = setInterval(async () => {
                try {
                    const res = await axios.get(`/api/simulation/${profileId}/status`);
                    setStatuses(prev => ({ ...prev, [profileId]: res.data }));
                } catch (error) {
                    // Optionally handle error
                }
            }, 3000);
            intervals.push(interval);
        });
        return () => intervals.forEach(clearInterval);
    }, [profileIds]);

    // Fetch route points for all selected profiles
    useEffect(() => {
        profileIds.forEach(profileId => {
            if (!profileId) return;
            axios.get(`/api/simulation/${profileId}/route`).then(res => {
                setRoutePoints(prev => ({ ...prev, [profileId]: res.data || [] }));
            }).catch(() => {});
        });
    }, [profileIds]);

    // Create WebSocket connection to prediction service
    const createWebSocketConnection = (profileId: string) => {
        if (!profileId) return null;

        const ws = new WebSocket(PREDICTION_WS_URL);

        ws.onopen = () => {
            console.log('Connected to prediction service WebSocket for profile:', profileId);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('Received prediction data:', data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed for profile:', profileId);
        };

        return ws;
    };

    const sendSimulationDataWithTiming = (profileId: string) => {
        const ws = wsRefs.current[profileId];
        const points = routePoints[profileId] || [];
        let idx = currentIndexRefs.current[profileId] || 0;
        if (!ws || !profileId || idx >= points.length) return;

        const sendNext = () => {
            if (!ws || idx >= points.length) return;
            const currentPoint = points[idx];
            if (!currentPoint) return;
            try {
                const message = JSON.stringify({ profileId, ...currentPoint, timestamp: Date.now() });
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(message);
                }
            } catch {}
            idx++;
            currentIndexRefs.current[profileId] = idx;
            if (onSimulationPosition) onSimulationPosition(profileId, idx);
            if (idx < points.length) {
                const now = currentPoint.timestamp;
                const next = points[idx].timestamp;
                const diff = Math.max(0, next - now);
                intervalRefs.current[profileId] = setTimeout(sendNext, diff);
            }
        };
        sendNext();
    };

    const start = async () => {
        for (const profileId of profileIds) {
            setLoading(prev => ({ ...prev, [profileId]: true }));
            try {
                // Start simulation state management on backend
                await axios.post(`/api/simulation/${profileId}/start`);

                // Create WebSocket connection to prediction service
                wsRefs.current[profileId] = createWebSocketConnection(profileId);

                // Wait for WebSocket to connect before starting data transmission
                if (wsRefs.current[profileId]) {
                    wsRefs.current[profileId]!.onopen = () => {
                        console.log('WebSocket connected, starting data transmission');
                        currentIndexRefs.current[profileId] = 0;

                        // Start sending data every second
                        sendSimulationDataWithTiming(profileId);
                    };
                }
            } catch {}
            setLoading(prev => ({ ...prev, [profileId]: false }));
        }
    };

    const stop = () => {
        profileIds.forEach(profileId => {
            if (intervalRefs.current[profileId]) clearTimeout(intervalRefs.current[profileId]!);
            if (wsRefs.current[profileId]) wsRefs.current[profileId]!.close();
        });
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            profileIds.forEach(profileId => {
                if (wsRefs.current[profileId]) {
                    wsRefs.current[profileId].close();
                }
                if (intervalRefs.current[profileId]) {
                    clearInterval(intervalRefs.current[profileId]);
                }
            });
        };
    }, []);

    return (
        <div>
            <button onClick={start} disabled={profileIds.length === 0}>Simulation starten</button>
            <button onClick={stop} disabled={profileIds.length === 0}>Simulation stoppen</button>
            <div style={{marginTop: 16}}>
                {profileIds.map(profileId => {
                    const points = routePoints[profileId] || [];
                    const total = points.length;
                    const current = currentIndexRefs.current[profileId] || 0;
                    const progress = total > 0 ? current / total : 0;

                    // Zeitberechnung für Anzeige
                    let elapsed = 0;
                    let duration = 0;
                    if (points.length > 1) {
                        const first = points[0].timestamp;
                        const last = points[points.length - 1].timestamp;
                        duration = Math.round((last - first) / 1000);
                        if (current > 0 && current < points.length) {
                            elapsed = Math.round((points[current - 1].timestamp - first) / 1000);
                        } else if (current >= points.length) {
                            elapsed = duration;
                        }
                    }

                    // Status nur aus Backend holen
                    const status = statuses[profileId];

                    return (
                        <div key={profileId} style={{marginBottom: 16, padding: 8, border: '1px solid #eee', borderRadius: 4}}>
                            <strong>Profil {profileId.slice(0,8)}</strong><br/>
                            Status: {status?.running ? 'Läuft' : 'Gestoppt'}<br/>
                            <div style={{display: 'flex', alignItems: 'center', margin: '8px 0'}}>
                                <div style={{flex: 1, height: 18, background: '#eee', borderRadius: 8, overflow: 'hidden', marginRight: 8}}>
                                    <div style={{width: `${progress * 100}%`, height: '100%', background: '#4caf50', transition: 'width 0.3s'}}></div>
                                </div>
                                <span style={{minWidth: 80, fontSize: 13}}>{current} / {total} Punkte</span>
                            </div>
                            <div style={{fontSize: 13, color: '#555'}}>
                                Zeit: {elapsed}s / {duration}s
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default Controls;
