import React, { useContext, useEffect } from 'react';
import MapView from './components/MapView';
import Controls from './components/Controls';
import ProfileUploader from './components/ProfileUploader';
import ProfileList from './components/ProfileList';
import ObjectUploadModal from './components/ObjectUploadModal';
import { AppProvider, AppContext } from './context/AppContext';

const AppContent: React.FC = () => {
    const { selectedPosition, setShowUploadModal } = useContext(AppContext);

    useEffect(() => {
        if (selectedPosition) {
            setShowUploadModal(true);
        }
    }, [selectedPosition, setShowUploadModal]);

    return (
        <div>
            <h1>Simulation UI</h1>
            <ProfileUploader />
            <Controls />
            <ProfileList />
            <MapView />
            <ObjectUploadModal />
        </div>
    );
};

const App: React.FC = () => {
    return (
        <AppProvider>
            <AppContent />
        </AppProvider>
    );
};

export default App;