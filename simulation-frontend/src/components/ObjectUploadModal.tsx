import React, {useState, useContext} from 'react';
import axios from 'axios';
import {AppContext} from '../context/AppContext';

const ObjectUploadModal: React.FC = () => {
    const {selectedPosition, setSelectedPosition, showUploadModal, setShowUploadModal} = useContext(AppContext);

    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [altitude, setAltitude] = useState(selectedPosition?.altitude.toString() || '0');

    const handleSubmit = async () => {
        if (!file || !selectedPosition) return;

        setLoading(true);
        setError(null);

        const formData = new FormData();
        formData.append('file', file);
        formData.append('latitude', selectedPosition.latitude.toString());
        formData.append('longitude', selectedPosition.longitude.toString());
        formData.append('altitude', altitude);

        try {
            const res = await axios.post('/storage/objects/upload', formData);
            console.log('Upload successful:', res.data);
            setSuccess(true);
            setTimeout(() => {
                setShowUploadModal(false);
                setSelectedPosition(null);
                setSuccess(false);
                setFile(null);
            }, 2000);
        } catch (err: any) {
            console.error('Upload failed:', err);
            const errorMsg = err.response?.data?.message || 'Failed to upload 3D object';
            setError(errorMsg);
        } finally {
            setLoading(false);
        }
    };

    const closeModal = () => {
        setShowUploadModal(false);
        setSelectedPosition(null);
        setError(null);
        setFile(null);
    };

    if (!showUploadModal) return null;

    return (
        <div className="modal">
            <div className="modal-content">
                <h2>Upload 3D Object</h2>

                {success ? (
                    <div className="success-message">
                        Object uploaded successfully!
                    </div>
                ) : (
                    <>
                        <p>Selected
                            Location: {selectedPosition?.latitude.toFixed(6)}°, {selectedPosition?.longitude.toFixed(6)}°</p>

                        <div className="form-group">
                            <label htmlFor="file-upload">3D Object File (GLB format)</label>
                            <input
                                id="file-upload"
                                type="file"
                                accept=".glb"
                                onChange={(e) => setFile(e.target.files?.[0] || null)}
                            />
                            <small>Only GLB files are supported</small>
                        </div>

                        <div className="form-group">
                            <label htmlFor="altitude">Altitude (meters)</label>
                            <input
                                id="altitude"
                                type="number"
                                step="0.1"
                                value={altitude}
                                onChange={(e) => setAltitude(e.target.value)}
                            />
                        </div>

                        {error && <div className="error-message">{error}</div>}

                        <div className="modal-actions">
                            <button onClick={closeModal}>Cancel</button>
                            <button
                                onClick={handleSubmit}
                                disabled={!file || loading}
                                className={loading ? 'loading' : ''}
                            >
                                {loading ? 'Uploading...' : 'Upload'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default ObjectUploadModal;