import React, { createContext, useState, ReactNode } from 'react';

type Position = {
    latitude: number;
    longitude: number;
    altitude: number;
};

type AppContextType = {
    selectedPosition: Position | null;
    setSelectedPosition: (position: Position | null) => void;
    showUploadModal: boolean;
    setShowUploadModal: (show: boolean) => void;
};

export const AppContext = createContext<AppContextType>({
    selectedPosition: null,
    setSelectedPosition: () => {},
    showUploadModal: false,
    setShowUploadModal: () => {}
});

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
    const [showUploadModal, setShowUploadModal] = useState(false);

    return (
        <AppContext.Provider value={{
            selectedPosition,
            setSelectedPosition,
            showUploadModal,
            setShowUploadModal
        }}>
            {children}
        </AppContext.Provider>
    );
};