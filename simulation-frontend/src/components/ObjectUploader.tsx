import React, { useState } from 'react';
import axios from '../axios';

const ObjectUploader: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [lat, setLat] = useState('');
    const [lng, setLng] = useState('');

    const handleSubmit = async () => {
        if (!file || !lat || !lng) return;
        const formData = new FormData();
        formData.append('file', file);
        formData.append('latitude', lat);
        formData.append('longitude', lng);

        const res = await axios.post('/simulation/object', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        });
        console.log('Object uploaded:', res.data);
    };

    return (
        <div>
            <input type="file" accept=".glb" onChange={e => setFile(e.target.files?.[0] || null)} />
            <input type="text" placeholder="Latitude" value={lat} onChange={e => setLat(e.target.value)} />
            <input type="text" placeholder="Longitude" value={lng} onChange={e => setLng(e.target.value)} />
            <button onClick={handleSubmit}>Upload 3D Object</button>
        </div>
    );
};

export default ObjectUploader;