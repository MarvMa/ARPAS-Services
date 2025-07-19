import { Profile, DataPoint, RawLocationData } from '../types/simulation';

export class ProfileService {
    private profiles: Profile[] = [];
    private colorPalette = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];

    /**
     * Parses uploaded JSON files containing location data
     */
    async parseJsonFile(file: File): Promise<Profile> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (event) => {
                try {
                    const content = event.target?.result as string;
                    const rawData: RawLocationData[] = JSON.parse(content);

                    const profile = this.createProfileFromData(rawData, file.name);
                    resolve(profile);
                } catch (error) {
                    console.error('Failed to parse JSON file:', error);
                    reject(new Error(`Failed to parse JSON file: ${error instanceof Error ? error.message : 'Unknown error'}`));
                }
            };

            reader.onerror = () => {
                reject(new Error('Failed to read file'));
            };

            reader.readAsText(file);
        });
    }

    /**
     * Creates a profile from raw location data
     */
    private createProfileFromData(rawData: RawLocationData[], filename: string): Profile {
        // Filter out metadata entries and only keep location sensor data
        const locationData = rawData.filter(entry =>
            entry.sensor === 'Location' &&
            entry.latitude &&
            entry.longitude &&
            entry.time
        );

        if (locationData.length === 0) {
            throw new Error('No valid location data found in file');
        }

        const dataPoints: DataPoint[] = locationData.map(entry => {
            // Convert nanosecond timestamp to milliseconds
            let timestamp = parseInt(entry.time);
            if (timestamp > Date.now() * 1000000) {
                // Appears to be nanoseconds, convert to milliseconds
                timestamp = Math.floor(timestamp / 1000000);
            }

            return {
                lat: parseFloat(entry.latitude),
                lng: parseFloat(entry.longitude),
                timestamp,
                speed: entry.speed && entry.speed !== '-1' ? parseFloat(entry.speed) : undefined,
                altitude: entry.altitude && entry.altitude !== '0' ? parseFloat(entry.altitude) : undefined,
                bearing: entry.bearing && entry.bearing !== '-1' ? parseFloat(entry.bearing) : undefined,
                horizontalAccuracy: entry.horizontalAccuracy ? parseFloat(entry.horizontalAccuracy) : undefined,
                verticalAccuracy: entry.verticalAccuracy ? parseFloat(entry.verticalAccuracy) : undefined,
            };
        });

        // Sort by timestamp to ensure correct order
        dataPoints.sort((a, b) => a.timestamp - b.timestamp);

        // Generate profile name from filename
        const profileName = this.generateProfileName(filename);

        const profile: Profile = {
            id: this.generateProfileId(),
            name: profileName,
            data: dataPoints,
            color: this.getNextColor()
        };

        return profile;
    }

    /**
     * Generates a unique profile ID
     */
    private generateProfileId(): string {
        return `profile_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Generates a user-friendly profile name from filename
     */
    private generateProfileName(filename: string): string {
        // Remove file extension and clean up the name
        let name = filename.replace(/\.[^/.]+$/, '');

        // Extract meaningful parts (remove common prefixes/suffixes)
        name = name.replace(/^(Disseminat_|Var_)/, '');

        // Convert underscores to spaces and title case
        name = name.replace(/_/g, ' ');
        name = name.replace(/\b\w/g, l => l.toUpperCase());

        // Add timestamp if the name looks like it contains one
        const timestampMatch = name.match(/(\d{4}-\d{2}-\d{2}[\s_]\d{2}-\d{2}-\d{2})/);
        if (timestampMatch) {
            const timestamp = timestampMatch[1].replace(/[\s_]/g, ' ');
            name = name.replace(timestampMatch[1], `(${timestamp})`);
        }

        return name || 'Unnamed Profile';
    }

    /**
     * Gets the next available color from the palette
     */
    private getNextColor(): string {
        const usedColors = this.profiles.map(p => p.color);
        const availableColors = this.colorPalette.filter(color => !usedColors.includes(color));

        if (availableColors.length > 0) {
            return availableColors[0];
        }

        // If all colors are used, generate a random color
        return `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`;
    }

    /**
     * Adds a profile to the managed collection
     */
    addProfile(profile: Profile): void {
        this.profiles.push(profile);
    }

    /**
     * Removes a profile by ID
     */
    removeProfile(profileId: string): boolean {
        const index = this.profiles.findIndex(p => p.id === profileId);
        if (index !== -1) {
            this.profiles.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * Gets all managed profiles
     */
    getAllProfiles(): Profile[] {
        return [...this.profiles];
    }

    /**
     * Gets a profile by ID
     */
    getProfile(profileId: string): Profile | undefined {
        return this.profiles.find(p => p.id === profileId);
    }

    /**
     * Validates location data format
     */
    validateLocationData(data: any[]): boolean {
        if (!Array.isArray(data) || data.length === 0) {
            return false;
        }

        // Check if at least some entries have the required location fields
        const locationEntries = data.filter(entry =>
            entry.sensor === 'Location' &&
            entry.latitude &&
            entry.longitude
        );

        return locationEntries.length > 0;
    }

    /**
     * Exports profiles to JSON format
     */
    exportProfiles(): string {
        return JSON.stringify(this.profiles, null, 2);
    }

    /**
     * Imports profiles from JSON string
     */
    importProfiles(jsonString: string): Profile[] {
        try {
            const importedProfiles: Profile[] = JSON.parse(jsonString);

            // Validate imported profiles
            const validProfiles = importedProfiles.filter(profile =>
                profile.id &&
                profile.name &&
                Array.isArray(profile.data) &&
                profile.color
            );

            // Add unique IDs to avoid conflicts
            validProfiles.forEach(profile => {
                profile.id = this.generateProfileId();
                this.addProfile(profile);
            });

            return validProfiles;
        } catch (error) {
            throw new Error(`Failed to import profiles: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
        }
    }

    /**
     * Clears all profiles
     */
    clearAllProfiles(): void {
        this.profiles = [];
    }

    /**
     * Gets summary statistics for a profile
     */
    getProfileStatistics(profileId: string): {
        totalPoints: number;
        duration: number;
        distance: number;
        averageSpeed: number;
        bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
    } | null {
        const profile = this.getProfile(profileId);
        if (!profile || profile.data.length === 0) {
            return null;
        }

        const data = profile.data;
        const lats = data.map(p => p.lat);
        const lngs = data.map(p => p.lng);
        const speeds = data.filter(p => p.speed !== undefined).map(p => p.speed!);

        // Calculate total distance using Haversine formula
        let totalDistance = 0;
        for (let i = 1; i < data.length; i++) {
            totalDistance += this.calculateDistance(data[i-1], data[i]);
        }

        const duration = data[data.length - 1].timestamp - data[0].timestamp;
        const averageSpeed = speeds.length > 0
            ? speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length
            : 0;

        return {
            totalPoints: data.length,
            duration,
            distance: totalDistance,
            averageSpeed,
            bounds: {
                minLat: Math.min(...lats),
                maxLat: Math.max(...lats),
                minLng: Math.min(...lngs),
                maxLng: Math.max(...lngs)
            }
        };
    }

    /**
     * Calculates distance between two points using Haversine formula
     */
    private calculateDistance(point1: DataPoint, point2: DataPoint): number {
        const R = 6371000; // Earth's radius in meters
        const lat1Rad = (point1.lat * Math.PI) / 180;
        const lat2Rad = (point2.lat * Math.PI) / 180;
        const deltaLatRad = ((point2.lat - point1.lat) * Math.PI) / 180;
        const deltaLngRad = ((point2.lng - point1.lng) * Math.PI) / 180;

        const a =
            Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
            Math.cos(lat1Rad) * Math.cos(lat2Rad) *
            Math.sin(deltaLngRad / 2) * Math.sin(deltaLngRad / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }
}