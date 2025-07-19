import React, {useState, useRef} from 'react';
import axios from 'axios';

function getRandomColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
}

export interface ProfileUploaderProps {
    onUploaded?: () => void;
}

const ProfileUploader: React.FC<ProfileUploaderProps> = ({onUploaded}) => {
    const [file, setFile] = useState<File | null>(null);
    const [color, setColor] = useState<string>(getRandomColor());
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0] || null;
        setFile(selectedFile);
    };

    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setColor(e.target.value);
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        const formData = new FormData();
        // color zuerst, dann file!
        formData.append('color', color);
        formData.append('file', file);
        try {
            const res = await axios.post('/simulation/profiles/upload', formData, {
                headers: {'Content-Type': 'multipart/form-data'},
            });
            console.log('Upload response:', res.data);
            setFile(null);
            setColor(getRandomColor());
            if (fileInputRef.current) fileInputRef.current.value = '';
            if (onUploaded) onUploaded();
        } catch (err) {
            console.error('Upload failed:', err);
        } finally {
            setUploading(false);
        }
    };

    return (
        <div>
            <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                ref={fileInputRef}
                disabled={uploading}
            />
            <input
                type="color"
                value={color}
                onChange={handleColorChange}
                disabled={uploading}
                style={{marginLeft: 8}}
            />
            <button
                onClick={handleUpload}
                disabled={!file || uploading}
                style={{marginLeft: 8}}
            >
                Profil hochladen
            </button>
        </div>
    );
};

export default ProfileUploader;
