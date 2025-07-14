import React from 'react';
import axios from '../axios';

const ProfileUploader: React.FC = () => {
    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const text = await file.text();
        const json = JSON.parse(text);

        const res = await axios.post('/simulation/upload', json);
        console.log('Upload response:', res.data);
    };

    return <input type="file" accept=".json" onChange={handleUpload}/>;
};

export default ProfileUploader;
