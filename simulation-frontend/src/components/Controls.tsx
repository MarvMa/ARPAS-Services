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

const Controls: React.FC<{ profileId: string | null }> = ({profileId}) => {
    const [status, setStatus] = useState<SimulationStatus>({running: false});
    const [loading, setLoading] = useState(false);
    const [routePoints, setRoutePoints] = useState<SensorData[]>([]);
    const wsRef = useRef<WebSocket | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);
    const currentIndexRef = useRef(0);
    const disabled = !profileId;

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
        if (!profileId) return;

        const interval = setInterval(async () => {
            try {
                const res = await axios.get(`/api/simulation/${profileId}/status`);
                setStatus(res.data);
            } catch (error) {
                console.error('Failed to get simulation status:', error);
            }
        }, 3000); // Keep it at 3 seconds, not 1 second

        return () => clearInterval(interval);
    }, [profileId]);

    // Fetch route points when profile changes
    useEffect(() => {
        if (!profileId) {
            setRoutePoints([]);
            return;
        }

        const fetchRoutePoints = async () => {
            try {
                const res = await axios.get(`/api/simulation/${profileId}/route`);
                setRoutePoints(res.data || []);
            } catch (error) {
                console.error('Failed to fetch route points:', error);
            }
        };

        fetchRoutePoints();
    }, [profileId]);

    // Create WebSocket connection to prediction service
    const createWebSocketConnection = () => {
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

    // Send simulation data via WebSocket
    const sendSimulationData = async () => {
        if (!wsRef.current || !profileId || currentIndexRef.current >= routePoints.length) {
            return;
        }

        const currentPoint = routePoints[currentIndexRef.current];
        if (!currentPoint) return;

        try {
            const message = JSON.stringify({
                profileId,
                ...currentPoint,
                timestamp: Date.now()
            });

            if (wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(message);
                console.log(`Sent data for profile ${profileId}:`, currentPoint);
            }
        } catch (error) {
            console.error('Error sending simulation data:', error);
        }

        currentIndexRef.current++;
    };

    const start = async () => {
        if (!profileId) return;
        setLoading(true);
        try {
            // Start simulation state management on backend
            await axios.post(`/api/simulation/${profileId}/start`);

            // Create WebSocket connection to prediction service
            wsRef.current = createWebSocketConnection();

            // Wait for WebSocket to connect before starting data transmission
            if (wsRef.current) {
                wsRef.current.onopen = () => {
                    console.log('WebSocket connected, starting data transmission');
                    currentIndexRef.current = 0;

                    // Start sending data every second
                    intervalRef.current = setInterval(sendSimulationData, 1000);
                };
            }

            setStatus({running: true});
        } catch (error) {
            console.error('Failed to start simulation:', error);
        } finally {
            setLoading(false);
        }
    };

    const stop = async () => {
        if (!profileId) return;
        setLoading(true);
        try {
            // Stop simulation state management on backend
            await axios.post(`/api/simulation/${profileId}/stop`);

            // Close WebSocket connection
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            // Stop data transmission interval
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }

            setStatus({running: false});
        } catch (error) {
            console.error('Failed to stop simulation:', error);
        } finally {
            setLoading(false);
        }
    };

    const reset = async () => {
        if (!profileId) return;
        setLoading(true);
        try {
            // Reset simulation state on backend
            await axios.post(`/api/simulation/${profileId}/reset`);

            // Reset local state
            currentIndexRef.current = 0;

            // Close WebSocket if running
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }

            // Stop data transmission interval
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }

            setStatus({running: false, currentIndex: 0, progress: 0});
        } catch (error) {
            console.error('Failed to reset simulation:', error);
        } finally {
            setLoading(false);
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
        };
    }, []);

    return (
        <div style={{
            padding: '16px',
            background: '#f5f5f5',
            borderRadius: '8px',
            marginBottom: '16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }}>
            <h3 style={{margin: '0 0 12px 0'}}>
                Simulation Controls
                {profileId && (
                    <span style={{fontSize: '14px', color: '#666', marginLeft: '8px'}}>
                        Profile: {profileId.slice(0, 8)}
                    </span>
                )}
            </h3>

            {status.progress !== undefined && (
                <div style={{marginBottom: '12px'}}>
                    <div style={{
                        background: '#e0e0e0',
                        borderRadius: '4px',
                        height: '8px',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            background: status.running ? '#4CAF50' : '#2196F3',
                            height: '100%',
                            width: `${status.progress}%`,
                            transition: 'width 0.3s ease'
                        }}></div>
                    </div>
                    <small style={{color: '#666'}}>
                        Progress: {status.currentIndex || 0} / {status.totalPoints || 0} points
                    </small>
                </div>
            )}

            <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
                <button
                    onClick={start}
                    disabled={disabled || loading || status.running}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '4px',
                        border: 'none',
                        background: status.running ? '#ccc' : '#4CAF50',
                        color: 'white',
                        cursor: disabled || loading || status.running ? 'not-allowed' : 'pointer'
                    }}
                >
                    {loading ? 'Loading...' : 'Start Simulation'}
                </button>
                <button
                    onClick={stop}
                    disabled={disabled || loading || !status.running}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '4px',
                        border: 'none',
                        background: !status.running ? '#ccc' : '#f44336',
                        color: 'white',
                        cursor: disabled || loading || !status.running ? 'not-allowed' : 'pointer'
                    }}
                >
                    Stop
                </button>
                <button
                    onClick={reset}
                    disabled={disabled || loading}
                    style={{
                        padding: '8px 16px',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#FF9800',
                        color: 'white',
                        cursor: disabled || loading ? 'not-allowed' : 'pointer'
                    }}
                >
                    Reset
                </button>

                <div style={{
                    marginLeft: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <div style={{
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: status.running ? '#4CAF50' : '#ccc'
                    }}></div>
                    <span style={{fontSize: '14px', color: '#666'}}>
                        {status.running ? 'Running' : 'Stopped'}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default Controls;
