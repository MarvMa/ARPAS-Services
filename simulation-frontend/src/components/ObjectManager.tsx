import React, {useState, useRef} from 'react';
import {Object3D} from '../types/simulation';
import {StorageService} from '../services/storageService';

interface ObjectManagerProps {
    storageService: StorageService;
    objects: Object3D[];
    onObjectsChange: (objects: Object3D[]) => void;
    onObjectSelect: (object: Object3D | null) => void;
    selectedObject: Object3D | null;
}

export const ObjectManager: React.FC<ObjectManagerProps> = ({
                                                                storageService,
                                                                objects,
                                                                onObjectsChange,
                                                                onObjectSelect,
                                                                selectedObject
                                                            }) => {
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isAddingMode, setIsAddingMode] = useState(false);
    const [newObjectLocation, setNewObjectLocation] = useState<{
        lat: number;
        lng: number;
        alt?: number;
    } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    /**
     * Handles file upload for 3D objects
     */
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.name.toLowerCase().endsWith('.glb')) {
            setError('Only GLB files are supported');
            return;
        }

        setIsUploading(true);
        setError(null);
        setUploadProgress(0);

        try {
            const uploadedObject = await storageService.uploadObject(
                file,
                newObjectLocation?.lat,
                newObjectLocation?.lng,
                newObjectLocation?.alt
            );

            const updatedObjects = [...objects, uploadedObject];
            onObjectsChange(updatedObjects);

            setIsAddingMode(false);
            setNewObjectLocation(null);
            alert(`Successfully uploaded: ${uploadedObject.original_filename}`);
        } catch (error) {
            console.error('Upload failed:', error);
            setError(error instanceof Error ? error.message : 'Upload failed');
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    /**
     * Handles object deletion
     */
    const handleDeleteObject = async (objectId: string) => {
        const objectToDelete = objects.find(obj => obj.id === objectId);
        if (!objectToDelete) return;

        const confirmed = window.confirm(
            `Are you sure you want to delete "${objectToDelete.original_filename}"? This action cannot be undone.`
        );

        if (!confirmed) return;

        try {
            await storageService.deleteObject(objectId);
            const updatedObjects = objects.filter(obj => obj.id !== objectId);
            onObjectsChange(updatedObjects);

            if (selectedObject?.id === objectId) {
                onObjectSelect(null);
            }

            alert('Object deleted successfully');
        } catch (error) {
            console.error('Delete failed:', error);
            setError(error instanceof Error ? error.message : 'Delete failed');
        }
    };

    /**
     * Handles object download
     */
    const handleDownloadObject = async (object: Object3D) => {
        try {
            const blob = await storageService.downloadObject(object.id);
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
            setError(error instanceof Error ? error.message : 'Download failed');
        }
    };

    /**
     * Starts the process of adding a new object at a specific location
     */
    const startAddingObject = (lat: number, lng: number, alt?: number) => {
        setNewObjectLocation({lat, lng, alt});
        setIsAddingMode(true);
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    /**
     * Cancels the adding process
     */
    const cancelAdding = () => {
        setIsAddingMode(false);
        setNewObjectLocation(null);
        setError(null);
    };

    /**
     * Formats file size for display
     */
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    /**
     * Formats coordinates for display
     */
    const formatCoordinate = (value: number | undefined, decimals: number = 6): string => {
        return value !== undefined ? value.toFixed(decimals) : 'N/A';
    };

    return (
        <div className="object-manager">
            <div className="object-manager-header">
                <h3>3D Objects ({objects.length})</h3>
                <div className="object-manager-actions">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".glb"
                        onChange={handleFileUpload}
                        style={{display: 'none'}}
                    />
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className="btn-primary btn-small"
                    >
                        {isUploading ? 'Uploading...' : 'Upload GLB'}
                    </button>
                </div>
            </div>

            {error && (
                <div className="error-message">
                    <span>{error}</span>
                    <button onClick={() => setError(null)} className="error-close">×</button>
                </div>
            )}

            {isUploading && (
                <div className="upload-progress">
                    <div className="progress-bar">
                        <div
                            className="progress-fill"
                            style={{width: `${uploadProgress}%`}}
                        ></div>
                    </div>
                    <span>Uploading... {uploadProgress}%</span>
                </div>
            )}

            {isAddingMode && newObjectLocation && (
                <div className="adding-mode-info">
                    <div className="adding-location">
                        <strong>Adding object at:</strong><br/>
                        Lat: {formatCoordinate(newObjectLocation.lat)}<br/>
                        Lng: {formatCoordinate(newObjectLocation.lng)}
                        {newObjectLocation.alt && <><br/>Alt: {formatCoordinate(newObjectLocation.alt, 1)}m</>}
                    </div>
                    <button onClick={cancelAdding} className="btn-secondary btn-small">
                        Cancel
                    </button>
                </div>
            )}

            <div className="object-list">
                {objects.length === 0 ? (
                    <div className="empty-state">
                        <p>No 3D objects found.</p>
                        <p>Upload a GLB file to get started.</p>
                    </div>
                ) : (
                    objects.map((object) => (
                        <div
                            key={object.id}
                            className={`object-item ${selectedObject?.id === object.id ? 'selected' : ''}`}
                            onClick={() => onObjectSelect(object)}
                        >
                            <div className="object-info">
                                <div className="object-name">{object.original_filename}</div>
                                <div className="object-details">
                                    <span className="object-size">{formatFileSize(object.size)}</span>
                                    <span className="object-date">
                    {new Date(object.uploaded_at).toLocaleDateString()}
                  </span>
                                </div>
                                {(object.latitude !== undefined && object.longitude !== undefined) && (
                                    <div className="object-location">
                                        📍 {formatCoordinate(object.latitude)}, {formatCoordinate(object.longitude)}
                                        {object.altitude !== undefined && ` (${formatCoordinate(object.altitude, 1)}m)`}
                                    </div>
                                )}
                            </div>

                            <div className="object-actions">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownloadObject(object);
                                    }}
                                    className="btn-secondary btn-tiny"
                                    title="Download"
                                >
                                    ⬇️
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteObject(object.id);
                                    }}
                                    className="btn-danger btn-tiny"
                                    title="Delete"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {selectedObject && (
                <div className="object-details-panel">
                    <h4>Object Details</h4>
                    <div className="detail-grid">
                        <div className="detail-item">
                            <label>Filename:</label>
                            <span>{selectedObject.original_filename}</span>
                        </div>
                        <div className="detail-item">
                            <label>ID:</label>
                            <span className="object-id">{selectedObject.id}</span>
                        </div>
                        <div className="detail-item">
                            <label>Size:</label>
                            <span>{formatFileSize(selectedObject.size)}</span>
                        </div>
                        <div className="detail-item">
                            <label>Content Type:</label>
                            <span>{selectedObject.content_type}</span>
                        </div>
                        <div className="detail-item">
                            <label>Uploaded:</label>
                            <span>{new Date(selectedObject.uploaded_at).toLocaleString()}</span>
                        </div>
                        {selectedObject.latitude !== undefined && (
                            <div className="detail-item">
                                <label>Latitude:</label>
                                <span>{formatCoordinate(selectedObject.latitude)}</span>
                            </div>
                        )}
                        {selectedObject.longitude !== undefined && (
                            <div className="detail-item">
                                <label>Longitude:</label>
                                <span>{formatCoordinate(selectedObject.longitude)}</span>
                            </div>
                        )}
                        {selectedObject.altitude !== undefined && (
                            <div className="detail-item">
                                <label>Altitude:</label>
                                <span>{formatCoordinate(selectedObject.altitude, 1)}m</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Export the function for external map interaction
export const useObjectManager = () => {
    const [isAddingMode, setIsAddingMode] = useState(false);

    return {
        isAddingMode,
        startAddingObject: (lat: number, lng: number, alt?: number) => {
            setIsAddingMode(true);
            // This would be handled by the parent component
        },
        cancelAdding: () => setIsAddingMode(false)
    };
};