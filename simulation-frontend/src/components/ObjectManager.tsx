import React, {useRef, useState} from 'react';
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
    const fileInputRef = useRef<HTMLInputElement>(null);

    /**
     * Handles object deletion with confirmation
     */
    const handleDeleteObject = async (objectId: string) => {
        const objectToDelete = objects.find(obj => obj.ID === objectId);
        if (!objectToDelete) return;

        const confirmed = window.confirm(
            `Are you sure you want to delete "${objectToDelete.OriginalFilename}"? This action cannot be undone.`
        );

        if (!confirmed) return;

        try {
            await storageService.deleteObject(objectId);
            const updatedObjects = objects.filter(obj => obj.ID !== objectId);
            onObjectsChange(updatedObjects);

            // Clear selection if deleted object was selected
            if (selectedObject?.ID === objectId) {
                onObjectSelect(null);
            }

            console.log(`Successfully deleted object: ${objectToDelete.OriginalFilename}`);
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
            console.log(`Downloading object: ${object.OriginalFilename}`);
            const blob = await storageService.downloadObject(object.ID);
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = object.OriginalFilename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            console.log(`Successfully downloaded: ${object.OriginalFilename}`);
        } catch (error) {
            console.error('Download failed:', error);
            setError(error instanceof Error ? error.message : 'Download failed');
        }
    };

    /**
     * Handles bulk upload of GLB files
     */
    const handleBulkUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        setIsUploading(true);
        setError(null);

        const totalFiles = files.length;
        let completedFiles = 0;

        try {
            console.log(`Starting bulk upload of ${totalFiles} files...`);

            const uploadPromises = Array.from(files).map(async (file) => {
                try {
                    // Upload without location data for bulk upload
                    const uploadedObject = await storageService.uploadObject(file);
                    completedFiles++;
                    setUploadProgress(Math.round((completedFiles / totalFiles) * 100));
                    return uploadedObject;
                } catch (error) {
                    console.error(`Failed to upload ${file.name}:`, error);
                    return null;
                }
            });

            const results = await Promise.all(uploadPromises);
            const successfulUploads = results.filter(obj => obj !== null) as Object3D[];

            if (successfulUploads.length > 0) {
                const updatedObjects = [...objects, ...successfulUploads];
                onObjectsChange(updatedObjects);
                console.log(`Successfully uploaded ${successfulUploads.length} objects`);
            }

            if (successfulUploads.length < totalFiles) {
                const failedCount = totalFiles - successfulUploads.length;
                setError(`${failedCount} out of ${totalFiles} uploads failed`);
            }

        } catch (error) {
            console.error('Bulk upload failed:', error);
            setError('Bulk upload failed');
        } finally {
            setIsUploading(false);
            setUploadProgress(0);

            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
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

    /**
     * Gets object location summary
     */
    const getLocationSummary = (object: Object3D): string => {
        if (object.latitude !== undefined && object.longitude !== undefined) {
            const altStr = object.altitude !== undefined ? ` (${object.altitude.toFixed(1)}m)` : '';
            return `📍 ${object.latitude.toFixed(4)}, ${object.longitude.toFixed(4)}${altStr}`;
        }
        return '📍 No location data';
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
                        multiple
                        onChange={handleBulkUpload}
                        style={{display: 'none'}}
                        id="bulk-upload"
                        disabled={isUploading}
                    />
                    <label
                        htmlFor="bulk-upload"
                        className={`btn-primary btn-small ${isUploading ? 'loading' : ''}`}
                        style={{cursor: isUploading ? 'not-allowed' : 'pointer'}}
                    >
                        {isUploading ? 'Uploading...' : 'Bulk Upload'}
                    </label>
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

            <div className="object-list">
                {objects.length === 0 ? (
                    <div className="empty-state">
                        <p>No 3D objects found.</p>
                        <p>Use "Add 3D Object" button to place objects on the map or "Bulk Upload" to upload multiple files.</p>
                    </div>
                ) : (
                    objects.map((object) => (
                        <div
                            key={object.ID}
                            className={`object-item ${selectedObject?.ID === object.ID ? 'selected' : ''}`}
                            onClick={() => onObjectSelect(object)}
                        >
                            <div className="object-info">
                                <div className="object-name" title={object.OriginalFilename}>
                                    {object.OriginalFilename}
                                </div>
                                <div className="object-details">
                                    <span className="object-size">{formatFileSize(object.Size)}</span>
                                    <span className="object-date">
                                        {new Date(object.UploadedAt).toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="object-location" title="Location coordinates">
                                    {getLocationSummary(object)}
                                </div>
                            </div>

                            <div className="object-actions">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownloadObject(object);
                                    }}
                                    className="btn-secondary btn-tiny"
                                    title="Download GLB file"
                                >
                                    ⬇️
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteObject(object.ID);
                                    }}
                                    className="btn-danger btn-tiny"
                                    title="Delete object"
                                >
                                    🗑️
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Object Details Panel - Only show when object is selected */}
            {selectedObject && (
                <div className="object-details-panel">
                    <h4>Selected Object Details</h4>
                    <div className="detail-grid">
                        <div className="detail-item">
                            <label>Filename:</label>
                            <span title={selectedObject.OriginalFilename}>{selectedObject.OriginalFilename}</span>
                        </div>
                        <div className="detail-item">
                            <label>ID:</label>
                            <span className="object-id" title={selectedObject.ID}>
                                {selectedObject.ID.substring(0, 8)}...
                            </span>
                        </div>
                        <div className="detail-item">
                            <label>Size:</label>
                            <span>{formatFileSize(selectedObject.Size)}</span>
                        </div>
                        <div className="detail-item">
                            <label>Type:</label>
                            <span>{selectedObject.ContentType}</span>
                        </div>
                        <div className="detail-item">
                            <label>Uploaded:</label>
                            <span>{new Date(selectedObject.UploadedAt).toLocaleString()}</span>
                        </div>
                        {selectedObject.latitude !== undefined && (
                            <>
                                <div className="detail-item">
                                    <label>Latitude:</label>
                                    <span>{formatCoordinate(selectedObject.latitude)}</span>
                                </div>
                                <div className="detail-item">
                                    <label>Longitude:</label>
                                    <span>{formatCoordinate(selectedObject.longitude)}</span>
                                </div>
                                {selectedObject.altitude !== undefined && (
                                    <div className="detail-item">
                                        <label>Altitude:</label>
                                        <span>{formatCoordinate(selectedObject.altitude, 1)}m</span>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div className="detail-actions">
                        <button
                            onClick={() => handleDownloadObject(selectedObject)}
                            className="btn-primary btn-small"
                        >
                            Download File
                        </button>
                        <button
                            onClick={() => onObjectSelect(null)}
                            className="btn-secondary btn-small"
                        >
                            Clear Selection
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};