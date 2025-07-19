import React, {useState, useContext, useEffect, useRef} from 'react';
import {MapContainer, TileLayer, Marker, Polyline, useMap, useMapEvents} from 'react-leaflet';
import {AppContext} from '../context/AppContext';
import {Icon} from 'leaflet';

interface Profile {
    id: string;
    color: string;
    duration: number;
    startLat: number;
    startLon: number;
    endLat: number;
    endLon: number;
    route: { latitude: number; longitude: number; }[];
}

interface MapViewProps {
    profiles: Profile[];
    visibleProfiles: string[];
    focusProfileId: string | null;
}

interface SimulationPosition {
    profileId: string;
    latitude: number;
    longitude: number;
    altitude: number;
    timestamp: number;
}

// Helper to compute bounds from all profile start/end points
function getBounds(profiles: Profile[]): [[number, number], [number, number]] | null {
    const lats = profiles.flatMap(p => [p.startLat, p.endLat]);
    const lons = profiles.flatMap(p => [p.startLon, p.endLon]);
    if (lats.length === 0 || lons.length === 0) return null;
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    // Always return tuples of length 2
    return [
        [minLat, minLon] as [number, number],
        [maxLat, maxLon] as [number, number]
    ];
}

function getBoundsFromProfiles(profiles: Profile[]): [[number, number], [number, number]] | null {
    const allPoints: [number, number][] = [];
    profiles.forEach(p => {
        if (p.route && p.route.length > 0) {
            p.route.forEach(pt => allPoints.push([
                parseFloat(pt.latitude as any),
                parseFloat(pt.longitude as any)
            ] as [number, number]));
        }
    });
    if (allPoints.length < 2) return null;
    const lats = allPoints.map(p => p[0]);
    const lons = allPoints.map(p => p[1]);
    return [
        [Math.min(...lats), Math.min(...lons)] as [number, number],
        [Math.max(...lats), Math.max(...lons)] as [number, number]
    ];
}

const FitBounds: React.FC<{ bounds: [[number, number], [number, number]] | null }> = ({bounds}) => {
    const map = useMap();
    const didFit = useRef(false);
    const hasInitialBounds = useRef(false);

    useEffect(() => {
        // Only fit bounds on initial load, not on visibility changes
        if (bounds && !hasInitialBounds.current) {
            map.fitBounds(bounds, {padding: [30, 30]});
            setTimeout(() => map.setZoom(19), 100);
            hasInitialBounds.current = true;
        }
        if (!bounds && !hasInitialBounds.current) {
            map.setView([52.52, 13.405], 19);
            hasInitialBounds.current = true;
        }
    }, [bounds, map]);

    return null;
};

const startIcon = new Icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
            <path d="M12.5 0C5.596 0 0 5.596 0 12.5c0 12.5 12.5 28.5 12.5 28.5s12.5-16 12.5-28.5C25 5.596 19.404 0 12.5 0z" fill="#2563eb"/>
            <circle cx="12.5" cy="12.5" r="4" fill="white"/>
        </svg>
    `),
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
});

const endIcon = new Icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
            <path d="M12.5 0C5.596 0 0 5.596 0 12.5c0 12.5 12.5 28.5 12.5 28.5s12.5-16 12.5-28.5C25 5.596 19.404 0 12.5 0z" fill="#dc2626"/>
            <circle cx="12.5" cy="12.5" r="4" fill="white"/>
        </svg>
    `),
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
});

const MapView: React.FC<MapViewProps> = ({profiles, visibleProfiles, focusProfileId}) => {
    const {setSelectedPosition} = useContext(AppContext);
    const [clickPosition, setClickPosition] = useState<[number, number] | null>(null);
    const [simulationPositions, setSimulationPositions] = useState<SimulationPosition[]>([]);

    // Ref for MapContainer - MUST be defined before useEffect
    const mapRef = useRef<any>(null);

    // NOTE: WebSocket connection is now handled by the Controls component when simulation starts
    // This component only displays the simulation positions received from the Controls component

    // Clean up old simulation positions
    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setSimulationPositions(prev => 
                prev.filter(p => now - p.timestamp < 60000) // Keep positions for 1 minute
            );
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const bounds = getBoundsFromProfiles(profiles.filter(p => visibleProfiles.includes(p.id)));

    const LocationPicker = () => {
        useMapEvents({
            click(e) {
                const position = [e.latlng.lat, e.latlng.lng];
                setClickPosition(position as [number, number]);
                setSelectedPosition({
                    latitude: e.latlng.lat,
                    longitude: e.latlng.lng,
                    altitude: 0
                });
            }
        });
        return null;
    };

    // Focus effect: zoom to profile when focusProfileId changes
    useEffect(() => {
        if (!focusProfileId) return;
        const profile = profiles.find(p => p.id === focusProfileId);
        if (profile && profile.route && profile.route.length > 1) {
            const positions: [number, number][] = profile.route.map(pt => [
                parseFloat(pt.latitude as any),
                parseFloat(pt.longitude as any)
            ]) as [number, number][];
            if (positions.length > 1 && mapRef.current) {
                // Use the correct Leaflet map instance
                const map = mapRef.current;
                map.fitBounds(positions, {padding: [30, 30]});
                setTimeout(() => map.setZoom(19), 100);
            }
        }
    }, [focusProfileId, profiles]);

    // Create animated marker icon for simulation
    const simulationIcon = (color: string) => new Icon({
        iconUrl: 'data:image/svg+xml;base64,' + btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="8" fill="${color}" stroke="#fff" stroke-width="2" opacity="0.8"/>
                <circle cx="10" cy="10" r="4" fill="#fff"/>
                <animateTransform attributeName="transform" type="rotate" dur="2s" repeatCount="indefinite" values="0 10 10;360 10 10"/>
            </svg>
        `),
        iconSize: [20, 20],
        iconAnchor: [10, 10],
    });

    return (
        <div>
            <MapContainer
                center={[52.52, 13.405]}
                zoom={19}
                maxZoom={22}
                style={{height: '500px', width: '100%'}}
                scrollWheelZoom
                ref={mapRef}
            >
                {/* Use satellite tiles for better high-zoom experience */}
                <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                    attribution="Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
                    maxZoom={22}
                />
                {/* Add street overlay for better navigation */}
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap contributors"
                    maxZoom={22}
                    opacity={0.6}
                />
                <FitBounds bounds={bounds}/>
                <LocationPicker/>
                {clickPosition && <Marker position={clickPosition}/>}
                
                {/* Render simulation positions */}
                {simulationPositions.map(simPos => {
                    const profile = profiles.find(p => p.id === simPos.profileId);
                    if (!profile || !visibleProfiles.includes(profile.id)) return null;
                    
                    return (
                        <Marker
                            key={`sim-${simPos.profileId}`}
                            position={[simPos.latitude, simPos.longitude]}
                            icon={simulationIcon(profile.color)}
                            title={`Simulation: ${profile.id.slice(0, 8)} - Alt: ${simPos.altitude}m`}
                        />
                    );
                })}
                
                {profiles.filter(p => visibleProfiles.includes(p.id) && p.route && p.route.length > 1).map(profile => {
                    const positions: [number, number][] = profile.route.map(pt => [
                        parseFloat(pt.latitude as any),
                        parseFloat(pt.longitude as any)
                    ]) as [number, number][];
                    return (
                        <React.Fragment key={profile.id}>
                            <Polyline
                                positions={positions as [number, number][]}
                                pathOptions={{
                                    color: profile.color,
                                    weight: 6,
                                    opacity: 0.8,
                                    dashArray: '10, 5'
                                }}
                            />
                            <Marker
                                position={positions[0] as [number, number]}
                                icon={startIcon}
                                title={`Start: ${profile.id.slice(0, 8)}`}
                            />
                            <Marker
                                position={positions[positions.length - 1] as [number, number]}
                                icon={endIcon}
                                title={`Ende: ${profile.id.slice(0, 8)}`}
                            />
                            {positions.length > 10 && positions.filter((_, index) => index % Math.floor(positions.length / 5) === 0 && index !== 0 && index !== positions.length - 1).map((pos, idx) => (
                                <Marker
                                    key={`waypoint-${profile.id}-${idx}`}
                                    position={pos}
                                    icon={new Icon({
                                        iconUrl: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="4" fill="${profile.color}" stroke="#fff" stroke-width="2"/></svg>`),
                                        iconSize: [12, 12],
                                        iconAnchor: [6, 6]
                                    })}
                                    title={`Waypoint: ${profile.id.slice(0, 8)}`}
                                />
                            ))}
                        </React.Fragment>
                    );
                })}
            </MapContainer>
        </div>
    );
};

export default MapView;
