import React, {useState, useContext} from 'react';
import {MapContainer, TileLayer, Marker, useMapEvents} from 'react-leaflet';
import {AppContext} from '../context/AppContext';

const MapView: React.FC = () => {
    const {setSelectedPosition} = useContext(AppContext);
    const [clickPosition, setClickPosition] = useState<[number, number] | null>(null);

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

    return (
        <MapContainer center={[52.52, 13.405]} zoom={15} style={{height: '500px', width: '100%'}}>
            <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution="&copy; OpenStreetMap contributors"
            />
            <LocationPicker/>
            {clickPosition && <Marker position={clickPosition}/>}
        </MapContainer>
    );
};

export default MapView;