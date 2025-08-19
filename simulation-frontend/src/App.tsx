import React, {useState, useEffect, useRef, useCallback} from 'react';
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
    'Gaby-2025-07-27_18-54-39.json',
    'Gio-2025-07-27_18-54-39.json',
    'Liane-2025-07-27_18-54-40.json',
    'Marcel-2025-07-27_18-54-39.json',
    'Marvin-2025-07-27_18-54-40.json'
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

    // Service instances
    const [simulationService] = useState(() => new SimulationService());
    const [dataCollector] = useState(() => new DataCollector());
    const [storageService] = useState(() => new StorageService());
    const [profileService] = useState(() => new ProfileService());

    const fileInputRef = useRef<HTMLInputElement>(null);
    const mapViewerRef = useRef<any>(null);

    /**
     * Initialize app on mount
     */
    useEffect(() => {
        let isMounted = true;

        const initializeApp = async () => {
            try {
                console.log('Initializing application...');

                // Check storage service availability
                const isStorageAvailable = await storageService.healthCheck();
                if (isMounted) {
                    setStorageServiceAvailable(isStorageAvailable);
                    console.log(`Storage service ${isStorageAvailable ? 'available' : 'unavailable'}`);
                }

                // Load 3D objects if storage is available
                if (isStorageAvailable) {
                    await load3DObjects();
                } else {
                    console.warn('Storage service is not available. 3D object features will be disabled.');
                }

                // Load predefined profiles from public folder
                await loadPredefinedProfiles();

                // Load data collector from localStorage
                dataCollector.loadFromLocalStorage();
                console.log('Application initialization completed');

            } catch (error) {
                console.error('Failed to initialize app:', error);
                if (isMounted) {
                    setLoadingError('Failed to initialize application. Check console for details.');
                }
            }
        };

        initializeApp();

        return () => {
            isMounted = false;
        };
    }, []);

    /**
     * Update simulation service with 3D objects when they change
     */
    useEffect(() => {
        simulationService.setAvailableObjects(objects3D);
    }, [objects3D, simulationService]);

    /**
     * Loads 3D objects from storage service
     */
    const load3DObjects = useCallback(async () => {
        try {
            const objects = await storageService.getAllObjects();
            setObjects3D(objects);
            console.log(`Loaded ${objects.length} 3D objects from storage service`);
        } catch (error) {
            console.error('Failed to load 3D objects:', error);
            setLoadingError('Failed to load 3D objects from storage service');
        }
    }, [storageService]);

    /**
     * Loads predefined profiles from the public/profiles folder
     */
    const loadPredefinedProfiles = useCallback(async () => {
        if (PRELOADED_PROFILES.length === 0) {
            console.log('No predefined profiles to load');
            return;
        }

        setIsLoadingProfiles(true);
        setLoadingError(null);

        try {
            console.log(`Loading ${PRELOADED_PROFILES.length} predefined profiles:`, PRELOADED_PROFILES);

            const loadPromises = PRELOADED_PROFILES.map(async (filename) => {
                try {
                    const url = `/profiles/${filename}`;
                    const profile = await profileService.loadProfileFromUrl(url, filename);
                    console.log(`Successfully loaded profile: ${filename} (${profile.data.length} points)`);
                    return profile;
                } catch (error) {
                    console.error(`Failed to load profile ${filename}:`, error);
                    return null;
                }
            });

            const results = await Promise.all(loadPromises);
            const successfulProfiles = results.filter(profile => profile !== null) as Profile[];

            if (successfulProfiles.length > 0) {
                const allProfiles = profileService.getAllProfiles();
                setProfiles([...allProfiles]);
                console.log(`Successfully loaded ${successfulProfiles.length} predefined profiles`);
            }

            if (successfulProfiles.length < PRELOADED_PROFILES.length) {
                const failedCount = PRELOADED_PROFILES.length - successfulProfiles.length;
                const errorMessage = `Only loaded ${successfulProfiles.length} out of ${PRELOADED_PROFILES.length} profiles. ${failedCount} failed to load.`;
                setLoadingError(errorMessage);
            }

        } catch (error) {
            console.error('Failed to load predefined profiles:', error);
            setLoadingError('Failed to load predefined profiles. Check console for details.');
        } finally {
            setIsLoadingProfiles(false);
        }
    }, [profileService]);

    /**
     * Monitor simulation state with controlled updates
     */
    useEffect(() => {
        let intervalId: number;

        const updateSimulationState = () => {
            const currentState = simulationService.getSimulationState();
            setSimulationState(prevState => {
                // Only update if there's a meaningful change
                if (!prevState && !currentState) return prevState;
                if (!prevState && currentState) return currentState;
                if (prevState && !currentState) return null;
                if (prevState && currentState) {
                    // Compare meaningful properties to avoid unnecessary updates
                    if (prevState.isRunning !== currentState.isRunning ||
                        prevState.currentTime !== currentState.currentTime ||
                        Object.keys(prevState.profileStates).length !== Object.keys(currentState.profileStates).length) {
                        return currentState;
                    }
                }
                return prevState;
            });
        };

        intervalId = window.setInterval(updateSimulationState, 500);

        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [simulationService]);

    /**
     * Handle profile selection changes
     */
    const handleProfileSelectionChange = useCallback((newSelectedProfiles: Profile[]) => {
        setSelectedProfiles(newSelectedProfiles);
        console.log(`Selected ${newSelectedProfiles.length} profiles for simulation`);
    }, []);

    /**
     * Handle profile visibility toggle
     */
    const handleProfileVisibilityToggle = useCallback((profileId: string) => {
        setProfiles(prevProfiles => {
            return prevProfiles.map(profile =>
                profile.id === profileId
                    ? {...profile, isVisible: !profile.isVisible}
                    : profile
            );
        });
    }, []);

    /**
     * Handles file upload for profiles
     */
    const handleProfileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files) return;

        console.log(`Uploading ${files.length} profile files...`);
        const uploadPromises = Array.from(files).map(async (file) => {
            try {
                const profile = await profileService.parseJsonFile(file);
                profileService.addProfile(profile);
                console.log(`Successfully parsed ${file.name} (${profile.data.length} points)`);
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
            setProfiles([...profileService.getAllProfiles()]);
            alert(`Successfully loaded ${successfulProfiles.length} profile(s)`);
        }

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [profileService]);

    /**
     * Handles map click for adding 3D objects
     */
    const handleMapClick = useCallback(async (lat: number, lng: number) => {
        if (!isAddingMode) return;

        console.log(`Adding 3D object at ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

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
                const uploadedObject = await storageService.uploadObject(file, lat, lng, 52);
                setObjects3D(prev => [...prev, uploadedObject]);
                setIsAddingMode(false);
                alert(`Successfully added 3D object at ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
                console.log(`Uploaded 3D object: ${uploadedObject.OriginalFilename}`);
            } catch (error) {
                console.error('Failed to upload 3D object:', error);
                alert(`Failed to upload 3D object: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        };

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }, [isAddingMode, storageServiceAvailable, storageService]);

    /**
     * Starts a new simulation with the specified configuration
     */
    const handleStartSimulation = useCallback(async (config: SimulationConfig) => {
        try {
            console.log(`Starting ${config.optimized ? 'optimized' : 'unoptimized'} simulation with ${config.profiles.length} profiles`);
            const simulationId = await simulationService.startSimulation(config);
            console.log(`Simulation started successfully: ${simulationId}`);
        } catch (error) {
            console.error('Failed to start simulation:', error);
            throw error;
        }
    }, [simulationService]);

    /**
     * Stops the current simulation and processes results
     */
    const handleStopSimulation = useCallback(async () => {
        try {
            console.log('Stopping simulation...');
            const results = await simulationService.stopSimulation();
            if (results) {
                console.log('Simulation completed:', results);
                alert(`Simulation completed! Downloaded ${results.totalObjects} objects with average latency of ${results.averageLatency.toFixed(2)}ms`);
            }
        } catch (error) {
            console.error('Failed to stop simulation:', error);
            throw error;
        }
    }, [simulationService]);

    /**
     * Exports all simulation results
     */
    const handleExportResults = useCallback(async () => {
        try {
            await dataCollector.exportAllResults();
            alert('Results exported successfully!');
            console.log('All simulation results exported');
        } catch (error) {
            console.error('Failed to export results:', error);
            alert('Failed to export results. Please check the console for details.');
        }
    }, [dataCollector]);

    /**
     * Clears all stored simulation results
     */
    const handleClearResults = useCallback(() => {
        const confirmed = window.confirm(
            'Are you sure you want to clear all simulation results? This action cannot be undone.'
        );

        if (confirmed) {
            dataCollector.clearResults();
            alert('All results have been cleared.');
            console.log('All simulation results cleared');
        }
    }, [dataCollector]);

    /**
     * Handles profile deletion
     */
    const handleDeleteProfile = useCallback((profileId: string) => {
        const confirmed = window.confirm('Are you sure you want to delete this profile?');
        if (confirmed) {
            profileService.removeProfile(profileId);
            setProfiles([...profileService.getAllProfiles()]);
            setSelectedProfiles(prev => prev.filter(p => p.id !== profileId));
            console.log(`Deleted profile: ${profileId}`);
        }
    }, [profileService]);

    /**
     * Exports all profiles to JSON
     */
    const handleExportProfiles = useCallback(() => {
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
            console.log('All profiles exported');
        } catch (error) {
            console.error('Failed to export profiles:', error);
            alert('Failed to export profiles.');
        }
    }, [profileService]);

    /**
     * Reloads predefined profiles
     */
    const handleReloadProfiles = useCallback(async () => {
        const confirmed = window.confirm('This will reload all predefined profiles. Continue?');
        if (confirmed) {
            profileService.clearAllProfiles();
            setProfiles([]);
            setSelectedProfiles([]);
            await loadPredefinedProfiles();
        }
    }, [profileService, loadPredefinedProfiles]);

    /**
     * Focus handler for SimulationControls
     */
    const handleFocusProfile = useCallback((profileId: string) => {
        if (mapViewerRef.current && typeof mapViewerRef.current.focusProfile === 'function') {
            mapViewerRef.current.focusProfile(profileId);
        }
    }, []);

    return (
        <div className="app">
            <header className="app-header">
                <h1>Enhanced Simulation Dashboard</h1>
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
                        onProfileSelectionChange={handleProfileSelectionChange}
                        onStartSimulation={handleStartSimulation}
                        onStopSimulation={handleStopSimulation}
                        simulationState={simulationState}
                        onExportResults={handleExportResults}
                        onClearResults={handleClearResults}
                        onDeleteProfile={handleDeleteProfile}
                        onProfileVisibilityToggle={handleProfileVisibilityToggle}
                        onFocusProfile={handleFocusProfile}
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
                        <h2>Real-time Route Visualization</h2>
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
                        ref={mapViewerRef}
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
                        onProfileVisibilityToggle={handleProfileVisibilityToggle}
                    />
                    
                </div>
            </main>

            <footer className="app-footer">
                <div className="footer-info">
                    <span>Enhanced Simulation Framework v2.0</span>
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