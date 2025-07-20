import React, {useEffect, useRef, useState, useMemo, useCallback, forwardRef, useImperativeHandle} from 'react';
import {MapContainer, TileLayer, Polyline, CircleMarker, Marker, useMapEvents} from 'react-leaflet';
import {LatLngExpression, LatLngBoundsExpression, LatLngTuple, LeafletMouseEvent, DivIcon} from 'leaflet';
import {Profile, InterpolatedPoint, SimulationState, Object3D} from '../types/simulation';
import {interpolatePoints, smoothPoints} from '../utils/interpolation';
import 'leaflet/dist/leaflet.css';

interface MapViewerProps {
    profiles: Profile[];
    selectedProfiles: Profile[];
    simulationState: SimulationState | null;
    showInterpolated: boolean;
    smoothingEnabled: boolean;
    objects3D: Object3D[];
    selectedObject: Object3D | null;
    onObjectSelect: (object: Object3D | null) => void;
    onMapClick?: (lat: number, lng: number) => void;
    isAddingMode?: boolean;
    onProfileVisibilityToggle?: (profileId: string) => void;
}

const MapViewer = forwardRef<any, MapViewerProps>(({
                                                       profiles,
                                                       selectedProfiles,
                                                       simulationState,
                                                       showInterpolated,
                                                       smoothingEnabled,
                                                       objects3D,
                                                       selectedObject,
                                                       onObjectSelect,
                                                       onMapClick,
                                                       isAddingMode = false,
                                                       onProfileVisibilityToggle
                                                   }, ref) => {
    const [interpolatedData, setInterpolatedData] = useState<Map<string, InterpolatedPoint[]>>(new Map());
    const [currentPositions, setCurrentPositions] = useState<Map<string, InterpolatedPoint>>(new Map());
    const mapRef = useRef<any>(null);
    const animationFrameRef = useRef<number>();

    const intervalMs = 200; // Default interval for interpolation

    /**
     * Custom map event handler component
     */
    const MapEventHandler: React.FC = () => {
        useMapEvents({
            click: (e: LeafletMouseEvent) => {
                if (isAddingMode && onMapClick) {
                    onMapClick(e.latlng.lat, e.latlng.lng);
                } else {
                    onObjectSelect?.(null);
                }
            }
        });
        return null;
    };

    /**
     * Creates a 3D object marker icon
     */
    const create3DObjectIcon = useCallback((isSelected: boolean = false): DivIcon => {
        return new DivIcon({
            html: `<div class="object-marker ${isSelected ? 'selected' : ''}">
                <div class="object-icon">📦</div>
                ${isSelected ? '<div class="selection-ring"></div>' : ''}
            </div>`,
            className: 'custom-object-marker',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    }, []);

    /**
     * Memoized profile IDs to detect changes
     */
    const allProfileIds = useMemo(() =>
            profiles.map(p => p.id).sort().join(','),
        [profiles]
    );

    /**
     * Updates interpolated data when profiles change
     */
    useEffect(() => {
        const newInterpolatedData = new Map<string, InterpolatedPoint[]>();

        profiles.forEach(profile => {
            try {
                let interpolated = interpolatePoints(profile.data, intervalMs);

                if (smoothingEnabled) {
                    interpolated = smoothPoints(interpolated, 3);
                }

                newInterpolatedData.set(profile.id, interpolated);
            } catch (error) {
                console.error(`Error interpolating profile ${profile.id}:`, error);
            }
        });

        setInterpolatedData(newInterpolatedData);
    }, [allProfileIds, smoothingEnabled]);

    /**
     * Smooth real-time position updates during simulation - FIXED ANIMATION
     */
    useEffect(() => {
        if (!simulationState?.isRunning) {
            setCurrentPositions(new Map());
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            return;
        }

        const updatePositions = () => {
            const newPositions = new Map<string, InterpolatedPoint>();
            const currentTime = Date.now();
            const elapsedTime = currentTime - simulationState.startTime;

            Object.entries(simulationState.profileStates).forEach(([profileId, profileState]) => {
                const profile = profiles.find(p => p.id === profileId);
                if (!profile?.data || profile.data.length === 0) return;

                // Sort data points by timestamp
                const sortedData = [...profile.data].sort((a, b) => a.timestamp - b.timestamp);

                if (sortedData.length === 0) return;

                // Calculate what the current simulation time should be
                const profileStartTime = sortedData[0].timestamp;
                const currentSimulationTime = profileStartTime + elapsedTime;

                // Find the appropriate segment based on current simulation time
                let segmentIndex = 0;
                for (let i = 0; i < sortedData.length - 1; i++) {
                    if (currentSimulationTime >= sortedData[i].timestamp &&
                        currentSimulationTime < sortedData[i + 1].timestamp) {
                        segmentIndex = i;
                        break;
                    }
                    if (currentSimulationTime >= sortedData[i].timestamp) {
                        segmentIndex = i;
                    }
                }

                // Handle end of route
                if (segmentIndex >= sortedData.length - 1) {
                    const lastPoint = sortedData[sortedData.length - 1];
                    newPositions.set(profileId, {
                        ...lastPoint,
                        isInterpolated: false
                    });
                    return;
                }

                const currentPoint = sortedData[segmentIndex];
                const nextPoint = sortedData[segmentIndex + 1];

                // Calculate smooth interpolation progress within the current segment
                const segmentDuration = nextPoint.timestamp - currentPoint.timestamp;
                const segmentElapsed = currentSimulationTime - currentPoint.timestamp;
                const progress = segmentDuration > 0 ? Math.max(0, Math.min(1, segmentElapsed / segmentDuration)) : 0;

                // Linear interpolation for smooth movement
                const interpolatedLat = currentPoint.lat + (nextPoint.lat - currentPoint.lat) * progress;
                const interpolatedLng = currentPoint.lng + (nextPoint.lng - currentPoint.lng) * progress;

                // Interpolate optional values
                const interpolatedSpeed = currentPoint.speed && nextPoint.speed
                    ? currentPoint.speed + (nextPoint.speed - currentPoint.speed) * progress
                    : currentPoint.speed || nextPoint.speed;

                const interpolatedAltitude = currentPoint.altitude && nextPoint.altitude
                    ? currentPoint.altitude + (nextPoint.altitude - currentPoint.altitude) * progress
                    : currentPoint.altitude || nextPoint.altitude;

                // Interpolate bearing (handling circular nature)
                let interpolatedBearing: number | undefined;
                if (currentPoint.bearing !== undefined && nextPoint.bearing !== undefined) {
                    let bearingDiff = nextPoint.bearing - currentPoint.bearing;
                    if (bearingDiff > 180) bearingDiff -= 360;
                    if (bearingDiff < -180) bearingDiff += 360;
                    interpolatedBearing = currentPoint.bearing + bearingDiff * progress;
                    if (interpolatedBearing < 0) interpolatedBearing += 360;
                    if (interpolatedBearing >= 360) interpolatedBearing -= 360;
                } else {
                    interpolatedBearing = currentPoint.bearing || nextPoint.bearing;
                }

                newPositions.set(profileId, {
                    lat: interpolatedLat,
                    lng: interpolatedLng,
                    timestamp: currentSimulationTime,
                    speed: interpolatedSpeed,
                    altitude: interpolatedAltitude,
                    bearing: interpolatedBearing,
                    isInterpolated: true
                });
            });

            setCurrentPositions(newPositions);

            // Continue animation loop if simulation is still running
            if (simulationState?.isRunning) {
                animationFrameRef.current = requestAnimationFrame(updatePositions);
            }
        };

        // Start animation loop
        updatePositions();

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [simulationState?.isRunning, simulationState?.startTime, profiles]);

    /**
     * Calculate visible profiles data for bounds/center
     */
    const visibleProfilesData = useMemo(() => {
        const visible = profiles.filter(profile => profile.isVisible);
        return visible.map(profile => ({
            id: profile.id,
            data: showInterpolated ?
                (interpolatedData.get(profile.id) || []) :
                profile.data
        }));
    }, [profiles.map(p => `${p.id}:${p.isVisible}`).join(','), showInterpolated, interpolatedData.size]);

    /**
     * Memoized map bounds calculation
     */
    const mapBounds = useMemo((): LatLngBoundsExpression | undefined => {
        const allPoints: { lat: number; lng: number }[] = [];

        // Add profile data points from visible profiles
        visibleProfilesData.forEach(({data}) => {
            allPoints.push(...data);
        });

        // Add 3D object locations
        objects3D.forEach(obj => {
            if (obj.latitude !== undefined && obj.longitude !== undefined) {
                allPoints.push({lat: obj.latitude, lng: obj.longitude});
            }
        });

        if (allPoints.length === 0) return undefined;

        const lats = allPoints.map(p => p.lat);
        const lngs = allPoints.map(p => p.lng);

        return [
            [Math.min(...lats), Math.min(...lngs)] as LatLngTuple,
            [Math.max(...lats), Math.max(...lngs)] as LatLngTuple
        ];
    }, [visibleProfilesData, objects3D.length]);

    /**
     * Memoized map center calculation
     */
    const mapCenter = useMemo((): LatLngExpression => {
        const allPoints: { lat: number; lng: number }[] = [];

        visibleProfilesData.forEach(({data}) => {
            allPoints.push(...data);
        });

        objects3D.forEach(obj => {
            if (obj.latitude !== undefined && obj.longitude !== undefined) {
                allPoints.push({lat: obj.latitude, lng: obj.longitude});
            }
        });

        if (allPoints.length === 0) {
            return [39.6142, 3.0394]; // Default to Mallorca coordinates from sample data
        }

        const lats = allPoints.map(p => p.lat);
        const lngs = allPoints.map(p => p.lng);

        const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

        return [centerLat, centerLng];
    }, [visibleProfilesData, objects3D.length]);

    /**
     * Renders 3D object markers on the map (without popups)
     */
    const render3DObjectMarkers = () => {
        return objects3D
            .filter(obj => obj.latitude !== undefined && obj.longitude !== undefined)
            .map((obj) => (
                <Marker
                    key={`object-${obj.ID}`}
                    position={[obj.latitude!, obj.longitude!]}
                    icon={create3DObjectIcon(selectedObject?.ID === obj.ID)}
                    eventHandlers={{
                        click: (e) => {
                            e.originalEvent.stopPropagation();
                            onObjectSelect?.(obj);
                        }
                    }}
                />
            ));
    };

    /**
     * Renders profile polylines
     */
    const renderProfilePolylines = (profile: Profile) => {
        const data = showInterpolated
            ? interpolatedData.get(profile.id) || []
            : profile.data.map(p => ({...p, isInterpolated: false}));

        if (data.length < 2) return null;

        const positions: LatLngExpression[] = data.map(point => [point.lat, point.lng]);

        return (
            <Polyline
                key={`polyline-${profile.id}`}
                positions={positions}
                color={profile.color}
                weight={3}
                opacity={0.7}
                dashArray={showInterpolated ? undefined : '10, 5'}
            />
        );
    };

    /**
     * Renders markers for original data points (without popups)
     */
    const renderOriginalMarkers = (profile: Profile) => {
        if (showInterpolated) return null;

        return profile.data.slice(0, 50).map((point, index) => (
            <CircleMarker
                key={`marker-${profile.id}-${index}`}
                center={[point.lat, point.lng]}
                radius={4}
                fillColor={profile.color}
                color="white"
                weight={1}
                fillOpacity={0.8}
            />
        ));
    };

    /**
     * Renders interpolated points (without popups)
     */
    const renderInterpolatedMarkers = (profile: Profile) => {
        if (!showInterpolated) return null;

        const interpolated = interpolatedData.get(profile.id) || [];

        return interpolated
            .filter(point => !point.isInterpolated)
            .slice(0, 50)
            .map((point, index) => (
                <CircleMarker
                    key={`interpolated-marker-${profile.id}-${index}`}
                    center={[point.lat, point.lng]}
                    radius={3}
                    fillColor={profile.color}
                    color="white"
                    weight={1}
                    fillOpacity={0.6}
                />
            ));
    };

    /**
     * Renders current position markers during simulation with smooth animation - NO BOUNCING
     */
    const renderCurrentPositions = () => {
        if (!simulationState?.isRunning) return null;

        return Array.from(currentPositions.entries()).map(([profileId, position]) => {
            const profile = selectedProfiles.find(p => p.id === profileId);
            if (!profile) return null;

            return (
                <CircleMarker
                    key={`current-${profileId}`}
                    center={[position.lat, position.lng]}
                    radius={8}
                    fillColor={profile.color}
                    color="white"
                    weight={2}
                    fillOpacity={1}
                    className="current-position-marker-smooth"
                />
            );
        });
    };

    /**
     * Focuses and zooms to a specific profile
     */
    const focusProfile = useCallback((profileId: string) => {
        const profile = profiles.find(p => p.id === profileId);
        if (!profile || !mapRef.current) return;

        const data = showInterpolated
            ? interpolatedData.get(profile.id) || []
            : profile.data;

        if (data.length === 0) return;

        const bounds = data.map(point => [point.lat, point.lng]) as LatLngTuple[];

        if (mapRef.current && mapRef.current.fitBounds) {
            mapRef.current.fitBounds(bounds, {padding: [20, 20]});
        }
    }, [profiles, interpolatedData, showInterpolated]);

    useImperativeHandle(ref, () => ({
        focusProfile
    }), [focusProfile]);

    return (
        <div className="map-viewer">
            <div className="map-controls">
                <div className="map-legend">
                    <h4>Map Legend</h4>
                    <div className="legend-items">
                        {profiles.filter(profile => profile.isVisible).map(profile => (
                            <div key={profile.id} className="legend-item">
                                <div
                                    className="legend-color"
                                    style={{backgroundColor: profile.color}}
                                ></div>
                                <span className="legend-label">{profile.name}</span>
                                <span className="legend-count">
                                    ({showInterpolated
                                    ? interpolatedData.get(profile.id)?.length || 0
                                    : profile.data.length} points)
                                </span>
                                {onProfileVisibilityToggle && (
                                    <button
                                        className="legend-toggle btn-tiny"
                                        onClick={() => onProfileVisibilityToggle(profile.id)}
                                        title="Toggle visibility"
                                    >
                                        👁️
                                    </button>
                                )}
                            </div>
                        ))}
                        {objects3D.length > 0 && (
                            <div className="legend-item">
                                <div className="legend-color object-legend">📦</div>
                                <span className="legend-label">3D Objects</span>
                                <span className="legend-count">({objects3D.length})</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="map-info">
                    {simulationState?.isRunning && (
                        <div className="simulation-info">
                            <div className="info-item">
                                <span className="info-label">Status:</span>
                                <span className="info-value running">Running</span>
                            </div>
                            <div className="info-item">
                                <span className="info-label">Mode:</span>
                                <span className="info-value">
                                    {showInterpolated ? 'Interpolated' : 'Original'}
                                </span>
                            </div>
                        </div>
                    )}
                    {isAddingMode && (
                        <div className="adding-mode-info">
                            <div className="info-item">
                                <span className="info-label">Mode:</span>
                                <span className="info-value adding">Adding 3D Object</span>
                            </div>
                            <div className="info-hint">Click on the map to place object</div>
                        </div>
                    )}
                </div>
            </div>

            <MapContainer
                ref={mapRef}
                center={mapCenter}
                zoom={13}
                bounds={mapBounds}
                style={{height: '600px', width: '100%'}}
                className={`leaflet-map ${isAddingMode ? 'adding-mode' : ''}`}
            >
                <MapEventHandler/>

                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {/* Render profile data for visible profiles */}
                {profiles.filter(profile => profile.isVisible).map(profile => (
                    <React.Fragment key={profile.id}>
                        {renderProfilePolylines(profile)}
                        {renderOriginalMarkers(profile)}
                        {renderInterpolatedMarkers(profile)}
                    </React.Fragment>
                ))}

                {/* Render current positions during simulation */}
                {renderCurrentPositions()}

                {/* Render 3D object markers */}
                {render3DObjectMarkers()}
            </MapContainer>
        </div>
    );
});

export {MapViewer};