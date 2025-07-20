import React, {useEffect, useRef, useState, useMemo, useCallback} from 'react';
import {MapContainer, TileLayer, Polyline, CircleMarker, Popup, Marker, useMapEvents} from 'react-leaflet';
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

export const MapViewer: React.FC<MapViewerProps> = ({
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
                                                    }) => {
    const [interpolatedData, setInterpolatedData] = useState<Map<string, InterpolatedPoint[]>>(new Map());
    const [currentPositions, setCurrentPositions] = useState<Map<string, InterpolatedPoint>>(new Map());
    const mapRef = useRef<any>(null);

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
     * Memoized 3D object icon creation
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

    const allProfileIds = useMemo(() =>
            profiles.map(p => p.id).sort().join(','),
        [profiles]
    );

    const selectedProfilesData = useMemo(() =>
            selectedProfiles.map(p => ({id: p.id, dataLength: p.data.length})),
        [selectedProfiles]
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
     * Updates current positions during simulation - simplified
     */
    useEffect(() => {
        if (!simulationState?.isRunning) {
            setCurrentPositions(new Map());
            return;
        }

        const updateCurrentPositions = () => {
            const newPositions = new Map<string, InterpolatedPoint>();

            try {
                Object.entries(simulationState.profileStates).forEach(([profileId, profileState]) => {
                    const interpolated = interpolatedData.get(profileId);
                    if (interpolated && profileState.currentIndex < interpolated.length) {
                        newPositions.set(profileId, interpolated[profileState.currentIndex]);
                    }
                });

                setCurrentPositions(newPositions);
            } catch (error) {
                console.error('Error updating current positions:', error);
            }
        };

        updateCurrentPositions();
        const interval = setInterval(updateCurrentPositions, 100);

        return () => clearInterval(interval);
    }, [simulationState?.isRunning, simulationState?.currentTime]); // Simplified dependencies

    /**
     * Calculate visible profiles data for bounds/center - simplified
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
     * Memoized map bounds calculation - simplified
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
    }, [visibleProfilesData, objects3D.length]); // Simplified dependencies

    /**
     * Memoized map center calculation - simplified
     */
    const mapCenter = useMemo((): LatLngExpression => {
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

        if (allPoints.length === 0) {
            return [51.505, -0.09]; // Default to London
        }

        const lats = allPoints.map(p => p.lat);
        const lngs = allPoints.map(p => p.lng);

        const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

        return [centerLat, centerLng];
    }, [visibleProfilesData, objects3D.length]); // Simplified dependencies

    /**
     * Downloads a 3D object
     */
    const downloadObject = useCallback(async (object: Object3D) => {
        try {
            const apiBase = (import.meta as any).env?.DEV ? '/api/storage' : 'http://localhost:8080/api/storage';
            const response = await fetch(`${apiBase}/objects/${object.id}/download`);
            if (!response.ok) throw new Error('Download failed');

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = object.original_filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            alert('Failed to download object');
        }
    }, []);

    /**
     * Formats file size for display
     */
    const formatFileSize = useCallback((bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }, []);

    /**
     * Renders 3D object markers on the map
     */
    const render3DObjectMarkers = () => {
        return objects3D
            .filter(obj => obj.latitude !== undefined && obj.longitude !== undefined)
            .map((obj) => (
                <Marker
                    key={`object-${obj.id}`}
                    position={[obj.latitude!, obj.longitude!]}
                    icon={create3DObjectIcon(selectedObject?.id === obj.id)}
                    eventHandlers={{
                        click: (e) => {
                            e.originalEvent.stopPropagation();
                            onObjectSelect?.(obj);
                        }
                    }}
                >
                    <Popup>
                        <div className="object-popup">
                            <div className="popup-header">
                                <strong>📦 {obj.original_filename}</strong>
                            </div>
                            <div className="popup-content">
                                <div className="popup-field">
                                    <label>ID:</label>
                                    <span className="object-id-short">{obj.id.substring(0, 8)}...</span>
                                </div>
                                <div className="popup-field">
                                    <label>Size:</label>
                                    <span>{formatFileSize(obj.size)}</span>
                                </div>
                                <div className="popup-field">
                                    <label>Location:</label>
                                    <span>
                    {obj.latitude?.toFixed(6)}, {obj.longitude?.toFixed(6)}
                                        {obj.altitude !== undefined && <><br/>Alt: {obj.altitude.toFixed(1)}m</>}
                  </span>
                                </div>
                                <div className="popup-field">
                                    <label>Uploaded:</label>
                                    <span>{new Date(obj.uploaded_at).toLocaleDateString()}</span>
                                </div>
                            </div>
                            <div className="popup-actions">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        downloadObject(obj);
                                    }}
                                    className="btn-secondary btn-tiny"
                                >
                                    Download
                                </button>
                            </div>
                        </div>
                    </Popup>
                </Marker>
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
     * Renders markers for original data points
     */
    const renderOriginalMarkers = (profile: Profile) => {
        if (showInterpolated) return null;

        return profile.data.slice(0, 50).map((point, index) => ( // Limit to 50 markers for performance
            <CircleMarker
                key={`marker-${profile.id}-${index}`}
                center={[point.lat, point.lng]}
                radius={4}
                fillColor={profile.color}
                color="white"
                weight={1}
                fillOpacity={0.8}
            >
                <Popup>
                    <div>
                        <strong>{profile.name}</strong><br/>
                        Point {index + 1}<br/>
                        Lat: {point.lat.toFixed(6)}<br/>
                        Lng: {point.lng.toFixed(6)}<br/>
                        {point.speed && <span>Speed: {point.speed.toFixed(2)} m/s<br/></span>}
                        {point.altitude && <span>Altitude: {point.altitude.toFixed(1)} m<br/></span>}
                        Time: {new Date(point.timestamp).toLocaleTimeString()}
                    </div>
                </Popup>
            </CircleMarker>
        ));
    };

    /**
     * Renders interpolated points
     */
    const renderInterpolatedMarkers = (profile: Profile) => {
        if (!showInterpolated) return null;

        const interpolated = interpolatedData.get(profile.id) || [];

        return interpolated
            .filter(point => !point.isInterpolated)
            .slice(0, 50) // Limit for performance
            .map((point, index) => (
                <CircleMarker
                    key={`interpolated-marker-${profile.id}-${index}`}
                    center={[point.lat, point.lng]}
                    radius={3}
                    fillColor={profile.color}
                    color="white"
                    weight={1}
                    fillOpacity={0.6}
                >
                    <Popup>
                        <div>
                            <strong>{profile.name}</strong><br/>
                            Original Point<br/>
                            Lat: {point.lat.toFixed(6)}<br/>
                            Lng: {point.lng.toFixed(6)}<br/>
                            {point.speed && <span>Speed: {point.speed.toFixed(2)} m/s<br/></span>}
                            {point.altitude && <span>Altitude: {point.altitude.toFixed(1)} m<br/></span>}
                            Time: {new Date(point.timestamp).toLocaleTimeString()}
                        </div>
                    </Popup>
                </CircleMarker>
            ));
    };

    /**
     * Renders current position markers during simulation
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
                    className="current-position-marker"
                >
                    <Popup>
                        <div>
                            <strong>{profile.name}</strong><br/>
                            Current Position<br/>
                            Lat: {position.lat.toFixed(6)}<br/>
                            Lng: {position.lng.toFixed(6)}<br/>
                            {position.speed && <span>Speed: {position.speed.toFixed(2)} m/s<br/></span>}
                            {position.altitude && <span>Altitude: {position.altitude.toFixed(1)} m<br/></span>}
                            {position.isInterpolated && <span><em>Interpolated</em><br/></span>}
                            Time: {new Date(position.timestamp).toLocaleTimeString()}
                        </div>
                    </Popup>
                </CircleMarker>
            );
        });
    };

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
                                        className="legend-toggle"
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
};