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
    simulationPositions?: { [profileId: string]: number };
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
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="25" viewBox="0 0 15 25" opacity="0.5">
            <path d="M7.5 0C3.358 0 0 3.358 0 7.5c0 7.5 7.5 17.5 7.5 17.5s7.5-10 7.5-17.5C15 3.358 11.642 0 7.5 0z" fill="#2563eb" opacity="0.5"/>
            <circle cx="7.5" cy="7.5" r="2.5" fill="white" opacity="0.5"/>
        </svg>
    `),
    iconSize: [15, 25],
    iconAnchor: [7, 25],
    popupAnchor: [1, -20],
});

const endIcon = new Icon({
    iconUrl: 'data:image/svg+xml;base64,' + btoa(`
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="25" viewBox="0 0 15 25" opacity="0.5">
            <path d="M7.5 0C3.358 0 0 3.358 0 7.5c0 7.5 7.5 17.5 7.5 17.5s7.5-10 7.5-17.5C15 3.358 11.642 0 7.5 0z" fill="#dc2626" opacity="0.5"/>
            <circle cx="7.5" cy="7.5" r="2.5" fill="white" opacity="0.5"/>
        </svg>
    `),
    iconSize: [15, 25],
    iconAnchor: [7, 25],
    popupAnchor: [1, -20],
});

const MapView: React.FC<MapViewProps> = ({profiles, visibleProfiles, focusProfileId, simulationPositions = {}}) => {
    const {setSelectedPosition} = useContext(AppContext);
    const [clickPosition, setClickPosition] = useState<[number, number] | null>(null);
    const [simulationPositionsState, setSimulationPositions] = useState<SimulationPosition[]>([]);

    // Ref for MapContainer - MUST be defined before useEffect
    const mapRef = useRef<any>(null);

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
                const map = mapRef.current;
                map.fitBounds(positions, {padding: [30, 30]});
            }
        }
    }, [focusProfileId, profiles]);

    // Blinking dot icon as SVG
    const getBlinkingIcon = (color: string) => new Icon({
        iconUrl: 'data:image/svg+xml;base64,' + btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
                <circle cx="9" cy="9" r="7" fill="${color}"/>
            </svg>
        `),
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        className: 'blinking-dot',
    });

    // Add blinking animation CSS
    useEffect(() => {
        const style = document.createElement('style');
        style.innerHTML = `.blinking-dot { animation: blinker-dot 1s linear infinite; }
        @keyframes blinker-dot { 50% { opacity: 0.2; } }`;
        document.head.appendChild(style);
        return () => {
            document.head.removeChild(style);
        };
    }, []);

    const MAPTILER_API_KEY = "DYMa1PKOd2TNvandRH4w";

    return (
        <MapContainer
            ref={mapRef}
            style={{height: '60vh', width: '100%', borderRadius: 8, margin: '16px 0', boxShadow: '0 2px 8px #0001'}}
            center={[52.52, 13.405]}
            zoom={22} // Start at max zoom
            scrollWheelZoom={true}
            maxZoom={22}
            minZoom={3}
            maxBounds={[[-85, -180], [85, 180]]}
        >
            <TileLayer
                url={`https://api.maptiler.com/maps/streets/{z}/{x}/{y}.png?key=${MAPTILER_API_KEY}`}
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a>'
                maxZoom={22}
                minZoom={3}
            />
            {bounds && <FitBounds bounds={bounds}/>}
            <LocationPicker/>
            {profiles.filter(p => visibleProfiles.includes(p.id)).map(profile => (
                <Polyline
                    key={profile.id}
                    positions={profile.route.map(pt => [pt.latitude, pt.longitude])}
                    pathOptions={{color: profile.color, weight: 4, opacity: 0.7}}
                />
            ))}
            {/* Start/End markers */}
            {profiles.filter(p => visibleProfiles.includes(p.id)).map(profile => (
                <Marker
                    key={profile.id + '-start'}
                    position={[profile.startLat, profile.startLon]}
                    icon={startIcon}
                />
            ))}
            {profiles.filter(p => visibleProfiles.includes(p.id)).map(profile => (
                <Marker
                    key={profile.id + '-end'}
                    position={[profile.endLat, profile.endLon]}
                    icon={endIcon}
                />
            ))}
            {/* Blinking simulation dot for each running profile */}
            {Object.entries(simulationPositions).map(([profileId, idx]) => {
                const profile = profiles.find(p => p.id === profileId);
                if (!profile || !profile.route || !profile.route[idx]) {
                    console.warn('Simulation dot: No valid route position for', profileId, idx, profile?.route);
                    return null;
                }
                const pt = profile.route[idx];
                // Debug: Log the marker position
                console.debug('Simulation dot for', profileId, 'at index', idx, '->', pt.latitude, pt.longitude);
                return (
                    <Marker
                        key={profileId + '-sim-dot'}
                        position={[parseFloat(pt.latitude as any), parseFloat(pt.longitude as any)]}
                        icon={getBlinkingIcon(profile.color || '#4caf50')}
                    />
                );
            })}
        </MapContainer>
    );
};

export default MapView;
