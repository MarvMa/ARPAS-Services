import React, {useState, useEffect, useRef} from 'react';
import {SimulationControls} from './components/SimulationControls';
import {MapViewer} from './components/MapViewer';
import {ObjectManager} from './components/ObjectManager';
import {SimulationService} from './services/simulationService';
import {DataCollector} from './services/dataCollector';
import {StorageService} from './services/storageService';
import {ProfileService} from './services/profileService';
import {Profile, SimulationState, SimulationConfig, Object3D} from './types/simulation';

// Define the profiles to be loaded automatically
const PRELOADED_PROFILES: string[] = [
    'Disseminat_Var_668-2025-07-19_15-27-54.json',
    // Add your profile filenames here
    // Example: 'profile1.json', 'profile2.json'
];

const App: React.FC = () => {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [selectedProfiles, setSelectedProfiles] = useState<Profile[]>([]);
    const [simulationState, setSimulationState] = useState<SimulationState | null>(null);
    const [objects3D, setObjects3D] = useState<Object3D[]>([]);
    const [selectedObject, setSelectedObject] = useState<Object3D | null>(null);
    const [showInterpolated, setShowInterpolated] = useState<boolean>(true);
    const [smoothingEnabled, setSmoothingEnabled] = useState<boolean>(false);
    const [isAddingMode, setIsAddingMode] = useState<boolean>(false);
    const [storageServiceAvailable, setStorageServiceAvailable] = useState<boolean>(false);
    const [isLoadingProfiles, setIsLoadingProfiles] = useState<boolean>(false);
    const [loadingError, setLoadingError] = useState<string | null>(null);

    const [simulationService] = useState(() => new SimulationService());
    const [dataCollector] = useState(() => new DataCollector());
    const [storageService] = useState(() => new StorageService());
    const [profileService] = useState(() => new ProfileService());

    const fileInputRef = useRef<HTMLInputElement>(null);

    /**
     * Initializes the application and loads data
     */
    useEffect(() => {
        initializeApp();
        dataCollector.loadFromLocalStorage();
    }, [dataCollector]);

    /**
     * Initializes the application with storage service check and data loading
     */
    const initializeApp = async () => {
        // Check storage service availability
        const isStorageAvailable = await storageService.healthCheck();
        setStorageServiceAvailable(isStorageAvailable);

        if (isStorageAvailable) {
            await load3DObjects();
        } else {
            console.warn('Storage service is not available. 3D object features will be disabled.');
        }

        // Load predefined profiles from public folder
        await loadPredefinedProfiles();
    };

    /**
     * Loads predefined profiles from the public/profiles folder
     */
    const loadPredefinedProfiles = async () => {
        if (PRELOADED_PROFILES.length === 0) {
            console.log('No predefined profiles to load');
            return;
        }

        setIsLoadingProfiles(true);
        setLoadingError(null);

        try {
            const loadPromises = PRELOADED_PROFILES.map(async (filename) => {
                try {
                    const url = `/profiles/${filename}`;
                    const profile = await profileService.loadProfileFromUrl(url, filename);
                    console.log(`Successfully loaded profile: ${filename}`);
                    return profile;
                } catch (error) {
                    console.error(`Failed to load profile ${filename}:`, error);
                    return null;
                }
            });

            const results = await Promise.all(loadPromises);
            const successfulProfiles = results.filter(profile => profile !== null) as Profile[];

            if (successfulProfiles.length > 0) {
                setProfiles(profileService.getAllProfiles());
                console.log(`Loaded ${successfulProfiles.length} predefined profiles`);
            }

            if (successfulProfiles.length < PRELOADED_PROFILES.length) {
                setLoadingError(`Only loaded ${successfulProfiles.length} out of ${PRELOADED_PROFILES.length} profiles. Check console for details.`);
            }
        } catch (error) {
            console.error('Failed to load predefined profiles:', error);
            setLoadingError('Failed to load predefined profiles. Check console for details.');
        } finally {
            setIsLoadingProfiles(false);
        }
    };

    /**
     * Loads 3D objects from storage service
     */
    const load3DObjects = async () => {
        try {
            const objects = await storageService.getAllObjects();
            setObjects3D(objects);
            console.log(`Loaded ${objects.length} 3D objects`);
        } catch (error) {
            console.error('Failed to load 3D objects:', error);
        }
    };

    /**
     * Monitors simulation state changes
     */
    useEffect(() => {
        const interval = setInterval(() => {
            const currentState = simulationService.getSimulationState();
            setSimulationState(currentState);
        }, 500);

        return () => clearInterval(interval);
    }, [simulationService]);

    /**
     * Handles file upload for profiles
     */
    const handleProfileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        const uploadPromises = Array.from(files).map(async (file) => {
            try {
                const profile = await profileService.parseJsonFile(file);
                profileService.addProfile(profile);
                return profile;
            } catch (error) {
                console.error(`Failed to parse ${file.name}:`, error);
                alert(`Failed to parse ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                return null;
            }
        });

        const results = await Promise.all(uploadPromises);
        const successfulProfiles = results.filter(profile => profile !== null) as Profile[];

        if (successfulProfiles.length > 0) {
            setProfiles(profileService.getAllProfiles());
            alert(`Successfully loaded ${successfulProfiles.length} profile(s)`);
        }

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    /**
     * Handles map click for adding 3D objects
     */
    const handleMapClick = async (lat: number, lng: number) => {
        if (!isAddingMode) return;

        if (!storageServiceAvailable) {
            alert('Storage service is not available. Cannot add 3D objects.');
            return;
        }

        // Trigger file selection for GLB upload
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.glb';
        fileInput.style.display = 'none';

        fileInput.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            try {
                const uploadedObject = await storageService.uploadObject(file, lat, lng);
                const updatedObjects = [...objects3D, uploadedObject];
                setObjects3D(updatedObjects);
                setIsAddingMode(false);
                alert(`Successfully added 3D object at ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
            } catch (error) {
                console.error('Failed to upload 3D object:', error);
                alert(`Failed to upload 3D object: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        };

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    };

    /**
     * Starts a new simulation with the specified configuration
     */
    const handleStartSimulation = async (config: SimulationConfig) => {
        try {
            const simulationId = await simulationService.startSimulation(config);
            console.log(`Started simulation: ${simulationId}`);
        } catch (error) {
            console.error('Failed to start simulation:', error);
            throw error;
        }
    };

    /**
     * Stops the current simulation and processes results
     */
    const handleStopSimulation = async () => {
        try {
            const results = await simulationService.stopSimulation();
            if (results) {
                console.log('Simulation completed:', results);
                alert(`Simulation completed! Downloaded ${results.totalObjects} objects with average latency of ${results.averageLatency.toFixed(2)}ms`);
            }
        } catch (error) {
            console.error('Failed to stop simulation:', error);
            throw error;
        }
    };

    /**
     * Exports all simulation results
     */
    const handleExportResults = async () => {
        try {
            await dataCollector.exportAllResults();
            alert('Results exported successfully!');
        } catch (error) {
            console.error('Failed to export results:', error);
            alert('Failed to export results. Please check the console for details.');
        }
    };

    /**
     * Clears all stored simulation results
     */
    const handleClearResults = () => {
        const confirmed = window.confirm(
            'Are you sure you want to clear all simulation results? This action cannot be undone.'
        );

        if (confirmed) {
            dataCollector.clearResults();
            alert('All results have been cleared.');
        }
    };

    /**
     * Handles profile deletion
     */
    const handleDeleteProfile = (profileId: string) => {
        const confirmed = window.confirm('Are you sure you want to delete this profile?');
        if (confirmed) {
            profileService.removeProfile(profileId);
            setProfiles(profileService.getAllProfiles());
            setSelectedProfiles(prev => prev.filter(p => p.id !== profileId));
        }
    };

    /**
     * Exports all profiles to JSON
     */
    const handleExportProfiles = () => {
        try {
            const jsonString = profileService.exportProfiles();
            const blob = new Blob([jsonString], {type: 'application/json'});
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = `profiles_export_${Date.now()}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            alert('Profiles exported successfully!');
        } catch (error) {
            console.error('Failed to export profiles:', error);
            alert('Failed to export profiles.');
        }
    };

    /**
     * Reloads predefined profiles
     */
    const handleReloadProfiles = async () => {
        const confirmed = window.confirm('This will reload all predefined profiles. Continue?');
        if (confirmed) {
            profileService.clearAllProfiles();
            setProfiles([]);
            setSelectedProfiles([]);
            await loadPredefinedProfiles();
        }
    };

    return (
        <div className="app">
            <header className="app-header">
                <h1>Simulation Dashboard</h1>
                <div className="header-controls">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        multiple
                        onChange={handleProfileUpload}
                        style={{display: 'none'}}
                        id="profile-upload"
                    />
                    <label htmlFor="profile-upload" className="btn-secondary">
                        Load Profiles
                    </label>
                    <button onClick={handleExportProfiles} className="btn-secondary">
                        Export Profiles
                    </button>
                    {PRELOADED_PROFILES.length > 0 && (
                        <button onClick={handleReloadProfiles} className="btn-secondary">
                            Reload Predefined
                        </button>
                    )}
                    <button
                        onClick={() => setIsAddingMode(!isAddingMode)}
                        className={`btn-primary ${isAddingMode ? 'active' : ''}`}
                        disabled={!storageServiceAvailable}
                        title={!storageServiceAvailable ? 'Storage service not available' : ''}
                    >
                        {isAddingMode ? 'Cancel Adding' : 'Add 3D Object'}
                    </button>
                </div>
            </header>

            <main className="app-main">
                <div className="left-panel">
                    {loadingError && (
                        <div className="error-message">
                            <span>{loadingError}</span>
                            <button onClick={() => setLoadingError(null)} className="error-close">×</button>
                        </div>
                    )}

                    {isLoadingProfiles && (
                        <div className="loading-indicator">
                            <span>Loading predefined profiles...</span>
                        </div>
                    )}

                    <SimulationControls
                        profiles={profiles}
                        selectedProfiles={selectedProfiles}
                        onProfileSelectionChange={setSelectedProfiles}
                        onStartSimulation={handleStartSimulation}
                        onStopSimulation={handleStopSimulation}
                        simulationState={simulationState}
                        onExportResults={handleExportResults}
                        onClearResults={handleClearResults}
                        onDeleteProfile={handleDeleteProfile}
                    />

                    {storageServiceAvailable && (
                        <ObjectManager
                            storageService={storageService}
                            objects={objects3D}
                            onObjectsChange={setObjects3D}
                            onObjectSelect={setSelectedObject}
                            selectedObject={selectedObject}
                        />
                    )}
                </div>

                <div className="right-panel">
                    <div className="map-header">
                        <h2>Route Visualization</h2>
                        <div className="map-controls">
                            <label className="control-toggle">
                                <input
                                    type="checkbox"
                                    checked={showInterpolated}
                                    onChange={(e) => setShowInterpolated(e.target.checked)}
                                />
                                Show Interpolated Data
                            </label>

                            <label className="control-toggle">
                                <input
                                    type="checkbox"
                                    checked={smoothingEnabled}
                                    onChange={(e) => setSmoothingEnabled(e.target.checked)}
                                    disabled={!showInterpolated}
                                />
                                Enable Smoothing
                            </label>
                        </div>
                    </div>

                    <MapViewer
                        profiles={profiles}
                        selectedProfiles={selectedProfiles}
                        simulationState={simulationState}
                        showInterpolated={showInterpolated}
                        smoothingEnabled={smoothingEnabled}
                        objects3D={objects3D}
                        selectedObject={selectedObject}
                        onObjectSelect={setSelectedObject}
                        onMapClick={handleMapClick}
                        isAddingMode={isAddingMode}
                    />
                </div>
            </main>

            <footer className="app-footer">
                <div className="footer-info">
                    <span>Simulation Framework v1.0</span>
                    <span>
                        {profiles.length} profiles loaded |
                        {selectedProfiles.length} selected |
                        {objects3D.length} 3D objects |
                        {simulationState?.isRunning ? ' Running' : ' Stopped'}
                        {!storageServiceAvailable && ' | Storage service unavailable'}
                    </span>
                </div>
            </footer>
        </div>
    );
};

export default App;