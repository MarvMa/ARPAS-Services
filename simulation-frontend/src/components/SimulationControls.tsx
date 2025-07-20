import React, { useState, useCallback, useMemo } from 'react';
import { Profile, SimulationState } from '../types/simulation';

interface SimulationControlsProps {
    profiles: Profile[];
    selectedProfiles: Profile[];
    onProfileSelectionChange: (profiles: Profile[]) => void;
    onStartSimulation: (config: { profiles: Profile[]; optimized: boolean; intervalMs: number }) => Promise<void>;
    onStopSimulation: () => Promise<void>;
    simulationState: SimulationState | null;
    onExportResults: () => Promise<void>;
    onClearResults: () => void;
    onDeleteProfile?: (profileId: string) => void;
    onProfileVisibilityToggle?: (profileId: string) => void;
    onFocusProfile?: (profileId: string) => void;
}

export const SimulationControls: React.FC<SimulationControlsProps> = ({
                                                                          profiles,
                                                                          selectedProfiles,
                                                                          onProfileSelectionChange,
                                                                          onStartSimulation,
                                                                          onStopSimulation,
                                                                          simulationState,
                                                                          onExportResults,
                                                                          onClearResults,
                                                                          onDeleteProfile,
                                                                          onProfileVisibilityToggle,
                                                                          onFocusProfile
                                                                      }) => {
    const [optimized, setOptimized] = useState<boolean>(true);
    const [intervalMs, setIntervalMs] = useState<number>(200); // Default 200ms interval
    const [isStarting, setIsStarting] = useState<boolean>(false);

    /**
     * Memoized derived state
     */
    const derivedState = useMemo(() => {
        const isRunning = simulationState?.isRunning || false;
        const canStart = !isRunning && selectedProfiles.length > 0 && !isStarting;
        const visibleProfilesCount = profiles.filter(p => p.isVisible).length;
        const activeProfilesCount = simulationState ? Object.keys(simulationState.profileStates).length : 0;

        return {
            isRunning,
            canStart,
            visibleProfilesCount,
            activeProfilesCount
        };
    }, [simulationState, selectedProfiles.length, isStarting, profiles]);

    /**
     * Handles profile selection changes
     */
    const handleProfileToggle = useCallback((profile: Profile) => {
        const isSelected = selectedProfiles.some(p => p.id === profile.id);
        if (isSelected) {
            onProfileSelectionChange(selectedProfiles.filter(p => p.id !== profile.id));
        } else {
            onProfileSelectionChange([...selectedProfiles, profile]);
        }
    }, [selectedProfiles, onProfileSelectionChange]);

    /**
     * Handles profile visibility toggle
     */
    const handleVisibilityToggle = useCallback((profileId: string) => {
        if (onProfileVisibilityToggle) {
            onProfileVisibilityToggle(profileId);
        }
    }, [onProfileVisibilityToggle]);

    /**
     * Handles focusing on a specific profile on the map
     */
    const handleFocusProfile = useCallback((profileId: string) => {
        if (onFocusProfile) {
            onFocusProfile(profileId);
        }
    }, [onFocusProfile]);

    /**
     * Handles simulation start with validation
     */
    const handleStartSimulation = useCallback(async () => {
        if (selectedProfiles.length === 0) {
            alert('Please select at least one profile for simulation');
            return;
        }

        if (intervalMs < 50 || intervalMs > 5000) {
            alert('Interval must be between 50ms and 5000ms');
            return;
        }

        setIsStarting(true);
        try {
            await onStartSimulation({
                profiles: selectedProfiles,
                optimized,
                intervalMs
            });
            console.log(`Started ${optimized ? 'optimized' : 'unoptimized'} simulation with ${intervalMs}ms interval`);
        } catch (error) {
            console.error('Failed to start simulation:', error);
            alert('Failed to start simulation. Please check the console for details.');
        } finally {
            setIsStarting(false);
        }
    }, [selectedProfiles, optimized, intervalMs, onStartSimulation]);

    /**
     * Handles simulation stop
     */
    const handleStopSimulation = useCallback(async () => {
        try {
            await onStopSimulation();
            console.log('Simulation stopped successfully');
        } catch (error) {
            console.error('Failed to stop simulation:', error);
            alert('Failed to stop simulation properly.');
        }
    }, [onStopSimulation]);

    /**
     * Selects all profiles
     */
    const selectAllProfiles = useCallback(() => {
        onProfileSelectionChange([...profiles]);
    }, [profiles, onProfileSelectionChange]);

    /**
     * Deselects all profiles
     */
    const deselectAllProfiles = useCallback(() => {
        onProfileSelectionChange([]);
    }, [onProfileSelectionChange]);

    /**
     * Shows all profiles on the map
     */
    const showAllProfiles = useCallback(() => {
        profiles.forEach(profile => {
            if (!profile.isVisible && onProfileVisibilityToggle) {
                onProfileVisibilityToggle(profile.id);
            }
        });
    }, [profiles, onProfileVisibilityToggle]);

    /**
     * Hides all profiles from the map
     */
    const hideAllProfiles = useCallback(() => {
        profiles.forEach(profile => {
            if (profile.isVisible && onProfileVisibilityToggle) {
                onProfileVisibilityToggle(profile.id);
            }
        });
    }, [profiles, onProfileVisibilityToggle]);

    /**
     * Handles interval change with validation
     */
    const handleIntervalChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const value = Number(event.target.value);
        if (value >= 50 && value <= 5000) {
            setIntervalMs(value);
        }
    }, []);

    return (
        <div className="simulation-controls">
            <div className="controls-header">
                <h2>Simulation Controls</h2>
                <div className="status-indicator">
                    <span className={`status-light ${derivedState.isRunning ? 'running' : 'stopped'}`}></span>
                    <span className="status-text">
                        {derivedState.isRunning ? 'Running' : 'Stopped'}
                    </span>
                </div>
            </div>

            {/* Profile Management */}
            <div className="control-group">
                <div className="profile-management-header">
                    <h3>Profile Management ({profiles.length} total, {derivedState.visibleProfilesCount} visible)</h3>
                    <div className="profile-management-actions">
                        <button
                            type="button"
                            onClick={showAllProfiles}
                            className="btn-secondary btn-small"
                            title="Show all profiles on map"
                        >
                            👁️ Show All
                        </button>
                        <button
                            type="button"
                            onClick={hideAllProfiles}
                            className="btn-secondary btn-small"
                            title="Hide all profiles from map"
                        >
                            🙈 Hide All
                        </button>
                    </div>
                </div>

                <div className="profile-list">
                    {profiles.map((profile) => {
                        const isSelected = selectedProfiles.some(p => p.id === profile.id);
                        return (
                            <div
                                key={profile.id}
                                className={`profile-item ${isSelected ? 'selected' : ''} ${profile.isVisible ? 'visible' : 'hidden'}`}
                            >
                                <div className="profile-main">
                                    <div className="profile-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => handleProfileToggle(profile)}
                                            disabled={derivedState.isRunning}
                                            title="Select for simulation"
                                        />
                                    </div>
                                    <div className="profile-info">
                                        <div className="profile-name">{profile.name}</div>
                                        <div className="profile-details">
                                            <span className="data-points">{profile.data.length} points</span>
                                            <div
                                                className="profile-color"
                                                style={{ backgroundColor: profile.color }}
                                            ></div>
                                        </div>
                                    </div>
                                </div>

                                <div className="profile-actions">
                                    <button
                                        onClick={() => handleVisibilityToggle(profile.id)}
                                        className={`btn-secondary btn-tiny ${profile.isVisible ? 'visible' : 'hidden'}`}
                                        title={profile.isVisible ? 'Hide from map' : 'Show on map'}
                                    >
                                        {profile.isVisible ? '👁️' : '🙈'}
                                    </button>
                                    <button
                                        onClick={() => handleFocusProfile(profile.id)}
                                        className="btn-primary btn-tiny"
                                        title="Focus on map"
                                        disabled={!profile.isVisible}
                                    >
                                        🎯
                                    </button>
                                    {onDeleteProfile && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteProfile(profile.id);
                                            }}
                                            className="btn-danger btn-tiny"
                                            disabled={derivedState.isRunning}
                                            title="Delete Profile"
                                        >
                                            🗑️
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Simulation Configuration */}
            <div className="control-group">
                <h3>Simulation Configuration</h3>

                {/* Optimization Mode Toggle */}
                <label className="optimization-toggle">
                    <input
                        type="checkbox"
                        checked={optimized}
                        onChange={(e) => setOptimized(e.target.checked)}
                        disabled={derivedState.isRunning}
                    />
                    <span className="toggle-slider"></span>
                    <span className="toggle-label">
                        {optimized ? 'Optimized Mode (WebSocket + Caching)' : 'Unoptimized Mode (Distance-based)'}
                    </span>
                </label>
                <div className="mode-description">
                    {optimized ? (
                        <p>Uses WebSocket connections for real-time object detection with caching optimization. Each profile gets its own WebSocket connection.</p>
                    ) : (
                        <p>Downloads 3D objects when within 10 meters proximity without WebSocket connections for performance comparison.</p>
                    )}
                </div>

                {/* Data Transmission Interval */}
                <div className="interval-control">
                    <label htmlFor="interval">Data Transmission Interval (ms):</label>
                    <div className="interval-input-group">
                        <input
                            id="interval"
                            type="number"
                            min="50"
                            max="5000"
                            step="50"
                            value={intervalMs}
                            onChange={handleIntervalChange}
                            disabled={derivedState.isRunning}
                            className="interval-input"
                        />
                        <div className="interval-presets">
                            {[100, 200, 500, 1000].map(preset => (
                                <button
                                    key={preset}
                                    type="button"
                                    onClick={() => setIntervalMs(preset)}
                                    disabled={derivedState.isRunning}
                                    className={`btn-secondary btn-tiny ${intervalMs === preset ? 'active' : ''}`}
                                >
                                    {preset}ms
                                </button>
                            ))}
                        </div>
                    </div>
                    <small>
                        Lower values provide more frequent data transmission and smoother animation but higher computational load.
                        {optimized ? ' WebSocket data will be sent at this interval.' : ' Distance checks will be performed at this interval.'}
                    </small>
                </div>
            </div>

            {/* Profile Selection for Simulation */}
            <div className="control-group">
                <div className="profile-selection-header">
                    <h3>Simulation Selection ({selectedProfiles.length}/{profiles.length})</h3>
                    <div className="profile-selection-actions">
                        <button
                            type="button"
                            onClick={selectAllProfiles}
                            disabled={derivedState.isRunning}
                            className="btn-secondary btn-small"
                        >
                            Select All
                        </button>
                        <button
                            type="button"
                            onClick={deselectAllProfiles}
                            disabled={derivedState.isRunning}
                            className="btn-secondary btn-small"
                        >
                            Clear Selection
                        </button>
                    </div>
                </div>
                <div className="selection-info">
                    <small>
                        Select profiles to include in the simulation. Each selected profile will {optimized ? 'establish its own WebSocket connection' : 'perform distance-based object detection'}.
                        Map visibility is independent of simulation selection.
                    </small>
                </div>
            </div>

            {/* Simulation Controls */}
            <div className="control-group">
                <div className="simulation-actions">
                    <button
                        type="button"
                        onClick={handleStartSimulation}
                        disabled={!derivedState.canStart}
                        className={`btn-primary ${isStarting ? 'loading' : ''}`}
                    >
                        {isStarting ? 'Starting...' : 'Start Simulation'}
                    </button>

                    <button
                        type="button"
                        onClick={handleStopSimulation}
                        disabled={!derivedState.isRunning}
                        className="btn-danger"
                    >
                        Stop Simulation
                    </button>
                </div>

                {!derivedState.canStart && selectedProfiles.length === 0 && (
                    <small className="error-hint">Please select at least one profile to start simulation.</small>
                )}
            </div>

            {/* Results Management */}
            <div className="control-group">
                <h3>Results Management</h3>
                <div className="results-actions">
                    <button
                        type="button"
                        onClick={onExportResults}
                        className="btn-secondary"
                    >
                        Export All Results
                    </button>

                    <button
                        type="button"
                        onClick={onClearResults}
                        className="btn-warning"
                    >
                        Clear Results
                    </button>
                </div>
            </div>

            {/* Simulation Statistics */}
            {simulationState && (
                <div className="control-group">
                    <h3>Current Simulation Status</h3>
                    <div className="simulation-stats">
                        <div className="stat">
                            <span className="stat-label">Running Time:</span>
                            <span className="stat-value">
                                {Math.floor((Date.now() - simulationState.startTime) / 1000)}s
                            </span>
                        </div>
                        <div className="stat">
                            <span className="stat-label">Active Profiles:</span>
                            <span className="stat-value">{derivedState.activeProfilesCount}</span>
                        </div>
                        <div className="stat">
                            <span className="stat-label">Mode:</span>
                            <span className="stat-value">{optimized ? 'Optimized' : 'Unoptimized'}</span>
                        </div>
                        <div className="stat">
                            <span className="stat-label">Interval:</span>
                            <span className="stat-value">{intervalMs}ms</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};