import React, {useContext, useEffect, useState, useCallback} from 'react';
import MapView from './components/MapView';
import Controls from './components/Controls';
import ProfileUploader from './components/ProfileUploader';
import ProfileList from './components/ProfileList';
import ObjectUploadModal from './components/ObjectUploadModal';
import {AppProvider, AppContext} from './context/AppContext';
import axios from 'axios';

interface Profile {
    id: string;
    color: string;
    duration: number;
    startLat: number;
    startLon: number;
    endLat: number;
    endLon: number;
    route: { latitude: number; longitude: number; }[];
}

const AppContent: React.FC = () => {
    const {selectedPosition, setShowUploadModal} = useContext(AppContext);
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [visibleProfiles, setVisibleProfiles] = useState<string[]>([]);
    const [focusProfileId, setFocusProfileId] = useState<string | null>(null);
    const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
    const [simulationPositions, setSimulationPositions] = useState<{ [profileId: string]: number }>({});

    const fetchProfiles = useCallback(async () => {
        setLoading(true);
        try {
            const res = await axios.get('/api/simulation/profiles');
            console.log('Profiles response:', res.data);
            const loadedProfiles = Array.isArray(res.data) ? res.data : [];
            setProfiles(loadedProfiles);
            setVisibleProfiles(loadedProfiles.map((p: Profile) => p.id));
        } catch (error) {
            console.error('Failed to fetch profiles:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProfiles();
    }, [fetchProfiles]);

    useEffect(() => {
        if (selectedPosition) {
            setShowUploadModal(true);
        }
    }, [selectedPosition, setShowUploadModal]);

    const handleProfileUploaded = () => fetchProfiles();

    const handleToggleProfile = (id: string) => {
        setVisibleProfiles(v => v.includes(id) ? v.filter(pid => pid !== id) : [...v, id]);
    };
    const handleZoomProfile = (id: string) => {
        setFocusProfileId(id);
    };
    const handleSelectProfile = (id: string, checked: boolean) => {
        setSelectedProfiles(prev => checked ? [...prev, id] : prev.filter(pid => pid !== id));
    };
    // Handler to update simulation position for a profile
    const handleSimulationPosition = (profileId: string, index: number) => {
        setSimulationPositions(prev => ({ ...prev, [profileId]: index }));
    };

    return (
        <div>
            <h1>ARPAS-Simulation Interface</h1>
            <ProfileUploader onUploaded={handleProfileUploaded}/>
            <Controls profileIds={selectedProfiles} onSimulationPosition={handleSimulationPosition} />
            <ProfileList
                profiles={profiles}
                visibleProfiles={visibleProfiles}
                onToggle={handleToggleProfile}
                onZoom={handleZoomProfile}
                loading={loading}
                selectedProfiles={selectedProfiles}
                onSelectProfile={handleSelectProfile}
            />
            <MapView
                profiles={profiles}
                visibleProfiles={visibleProfiles}
                focusProfileId={focusProfileId}
                simulationPositions={simulationPositions}
            />
            <ObjectUploadModal/>
        </div>
    );
};

const App: React.FC = () => {
    return (
        <AppProvider>
            <AppContent/>
        </AppProvider>
    );
};

export default App;