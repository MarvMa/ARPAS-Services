import React from 'react';

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

// Remove local profile fetching, accept profiles, visibleProfiles, onToggle, onZoom, loading as props
interface ProfileListProps {
    profiles: Profile[];
    visibleProfiles: string[];
    onToggle: (id: string) => void;
    onZoom: (id: string) => void;
    loading?: boolean;
}

const ProfileList: React.FC<ProfileListProps> = ({ profiles, visibleProfiles, onToggle, onZoom, loading }) => {
    // Eye icons as SVG
    const EyeOpen = (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M1 10C2.73 5.61 7.27 2.5 12 2.5C16.73 2.5 21.27 5.61 23 10C21.27 14.39 16.73 17.5 12 17.5C7.27 17.5 2.73 14.39 1 10Z"
                stroke="#333" strokeWidth="2"/>
            <circle cx="12" cy="10" r="3" stroke="#333" strokeWidth="2"/>
        </svg>
    );
    const EyeClosed = (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M1 10C2.73 5.61 7.27 2.5 12 2.5C16.73 2.5 21.27 5.61 23 10C21.27 14.39 16.73 17.5 12 17.5C7.27 17.5 2.73 14.39 1 10Z"
                stroke="#333" strokeWidth="2"/>
            <path d="M4 4L20 20" stroke="#333" strokeWidth="2"/>
        </svg>
    );
    if (loading) return <div>Loading profiles...</div>;

    return (
        <div>
            <h3>Profile</h3>
            <table style={{width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #0001', overflow: 'hidden'}}>
                <thead>
                <tr style={{background: '#f5f5f5'}}>
                    <th style={{padding: '8px 6px', textAlign: 'left'}}>Farbe</th>
                    <th style={{padding: '8px 6px', textAlign: 'left'}}>Profil-ID</th>
                    <th style={{padding: '8px 6px', textAlign: 'right'}}>Dauer (s)</th>
                    <th style={{padding: '8px 6px', textAlign: 'right'}}>Start (Lat, Lon)</th>
                    <th style={{padding: '8px 6px', textAlign: 'right'}}>Ende (Lat, Lon)</th>
                    <th style={{padding: '8px 6px', textAlign: 'center'}}>Sichtbar</th>
                    <th style={{padding: '8px 6px', textAlign: 'center'}}>Zoomen</th>
                </tr>
                </thead>
                <tbody>
                {profiles.length === 0 ? (
                    <tr>
                        <td colSpan={7} style={{textAlign: 'center', padding: 12}}>No profiles found.</td>
                    </tr>
                ) : (
                    profiles.map(profile => (
                        <tr key={profile.id} style={{borderBottom: '1px solid #eee', textAlign: 'center', verticalAlign: 'middle'}}>
                            <td style={{padding: '8px 6px', textAlign: 'center'}}>
                                <span style={{display: 'inline-block', width: 18, height: 18, borderRadius: 4, background: profile.color, border: '1px solid #ccc'}}></span>
                            </td>
                            <td style={{padding: '8px 6px', fontFamily: 'monospace', textAlign: 'left'}}>{profile.id.slice(0, 8)}</td>
                            <td style={{padding: '8px 6px', textAlign: 'right'}}>{profile.duration}</td>
                            <td style={{padding: '8px 6px', textAlign: 'right'}}>{profile.startLat.toFixed(5)}, {profile.startLon.toFixed(5)}</td>
                            <td style={{padding: '8px 6px', textAlign: 'right'}}>{profile.endLat.toFixed(5)}, {profile.endLon.toFixed(5)}</td>
                            <td style={{padding: '8px 6px', textAlign: 'center'}}>
                                <button
                                    onClick={() => onToggle(profile.id)}
                                    style={{background: 'none', border: 'none', cursor: 'pointer', outline: 'none'}}
                                    title={visibleProfiles.includes(profile.id) ? 'Profil ausblenden' : 'Profil einblenden'}
                                >
                                    {visibleProfiles.includes(profile.id) ? EyeOpen : EyeClosed}
                                </button>
                            </td>
                            <td style={{padding: '8px 6px', textAlign: 'center'}}>
                                <button
                                    onClick={() => onZoom(profile.id)}
                                    style={{background: '#f5f5f5', border: '1px solid #bbb', borderRadius: 4, cursor: 'pointer', padding: 4}}
                                    title="Auf diese Route zoomen"
                                >
                                    🔍
                                </button>
                            </td>
                        </tr>
                    ))
                )}
                </tbody>
            </table>
        </div>
    );
};

export default ProfileList;