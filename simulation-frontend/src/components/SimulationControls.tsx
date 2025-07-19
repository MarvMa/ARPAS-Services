import React, { useState, useEffect } from 'react';
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
                                                                          onDeleteProfile
                                                                      }) => {
    const [optimized, setOptimized] = useState<boolean>(true);
    const [intervalMs, setIntervalMs] = useState<number>(200);
    const [isStarting, setIsStarting] = useState<boolean>(false);

    /**
     * Handles profile selection changes
     */
    const handleProfileToggle = (profile: Profile) => {
        const isSelected = selectedProfiles.some(p => p.id === profile.id);
        if (isSelected) {
            onProfileSelectionChange(selectedProfiles.filter(p => p.id !== profile.id));
        } else {
            onProfileSelectionChange([...selectedProfiles, profile]);
        }
    };

    /**
     * Handles simulation start
     */
    const handleStartSimulation = async () => {
        if (selectedProfiles.length === 0) {
            alert('Please select at least one profile for simulation');
            return;
        }

        setIsStarting(true);
        try {
            await onStartSimulation({
                profiles: selectedProfiles,
                optimized,
                intervalMs
            });
        } catch (error) {
            console.error('Failed to start simulation:', error);
            alert('Failed to start simulation. Please check the console for details.');
        } finally {
            setIsStarting(false);
        }
    };

    /**
     * Handles simulation stop
     */
    const handleStopSimulation = async () => {
        try {
            await onStopSimulation();
        } catch (error) {
            console.error('Failed to stop simulation:', error);
            alert('Failed to stop simulation properly.');
        }
    };

    /**
     * Selects all profiles
     */
    const selectAllProfiles = () => {
        onProfileSelectionChange([...profiles]);
    };

    /**
     * Deselects all profiles
     */
    const deselectAllProfiles = () => {
        onProfileSelectionChange([]);
    };

    const isRunning = simulationState?.isRunning || false;
    const canStart = !isRunning && selectedProfiles.length > 0 && !isStarting;

    return (
        <div className="simulation-controls">
            <div className="controls-header">
                <h2>Simulation Controls</h2>
                <div className="status-indicator">
                    <span className={`status-light ${isRunning ? 'running' : 'stopped'}`}></span>
                    <span className="status-text">
            {isRunning ? 'Simulation Running' : 'Simulation Stopped'}
          </span>
                </div>
            </div>

            {/* Optimization Toggle */}
            <div className="control-group">
                <label className="optimization-toggle">
                    <input
                        type="checkbox"
                        checked={optimized}
                        onChange={(e) => setOptimized(e.target.checked)}
                        disabled={isRunning}
                    />
                    <span className="toggle-slider"></span>
                    <span className="toggle-label">
            {optimized ? 'Optimized Mode (WebSocket)' : 'Unoptimized Mode (No WebSocket)'}
          </span>
                </label>
                <div className="mode-description">
                    {optimized ? (
                        <p>Uses WebSocket connections for real-time object detection and caching optimization.</p>
                    ) : (
                        <p>Simulates object detection without WebSocket connections for comparison.</p>
                    )}
                </div>
            </div>

            {/* Interval Configuration */}
            <div className="control-group">
                <label htmlFor="interval">Data Transmission Interval (ms):</label>
                <input
                    id="interval"
                    type="number"
                    min="50"
                    max="5000"
                    step="50"
                    value={intervalMs}
                    onChange={(e) => setIntervalMs(Number(e.target.value))}
                    disabled={isRunning}
                />
                <small>Lower values provide smoother interpolation but higher computational load.</small>
            </div>

            {/* Profile Selection */}
            <div className="control-group">
                <div className="profile-selection-header">
                    <h3>Profile Selection ({selectedProfiles.length}/{profiles.length})</h3>
                    <div className="profile-selection-actions">
                        <button
                            type="button"
                            onClick={selectAllProfiles}
                            disabled={isRunning}
                            className="btn-secondary btn-small"
                        >
                            Select All
                        </button>
                        <button
                            type="button"
                            onClick={deselectAllProfiles}
                            disabled={isRunning}
                            className="btn-secondary btn-small"
                        >
                            Clear Selection
                        </button>
                    </div>
                </div>

                <div className="profile-list">
                    {profiles.map((profile) => {
                        const isSelected = selectedProfiles.some(p => p.id === profile.id);
                        return (
                            <div
                                key={profile.id}
                                className={`profile-item ${isSelected ? 'selected' : ''}`}
                            >
                                <div
                                    className="profile-main"
                                    onClick={() => !isRunning && handleProfileToggle(profile)}
                                >
                                    <div className="profile-checkbox">
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => handleProfileToggle(profile)}
                                            disabled={isRunning}
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

                                {onDeleteProfile && (
                                    <div className="profile-actions">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteProfile(profile.id);
                                            }}
                                            className="btn-danger btn-tiny"
                                            disabled={isRunning}
                                            title="Delete Profile"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Simulation Controls */}
            <div className="control-group">
                <div className="simulation-actions">
                    <button
                        type="button"
                        onClick={handleStartSimulation}
                        disabled={!canStart}
                        className={`btn-primary ${isStarting ? 'loading' : ''}`}
                    >
                        {isStarting ? 'Starting...' : 'Start Simulation'}
                    </button>

                    <button
                        type="button"
                        onClick={handleStopSimulation}
                        disabled={!isRunning}
                        className="btn-danger"
                    >
                        Stop Simulation
                    </button>
                </div>
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
                    <h3>Current Simulation</h3>
                    <div className="simulation-stats">
                        <div className="stat">
                            <span className="stat-label">Running Time:</span>
                            <span className="stat-value">
                {Math.floor((Date.now() - simulationState.startTime) / 1000)}s
              </span>
                        </div>
                        <div className="stat">
                            <span className="stat-label">Active Profiles:</span>
                            <span className="stat-value">{simulationState.profileStates.size}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};