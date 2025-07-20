import {Profile, DataPoint, RawLocationData} from '../types/simulation';

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
                    const rawData = JSON.parse(content);

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
     * Creates a profile from raw location data with flexible parsing
     */
    private createProfileFromData(rawData: any, filename: string): Profile {
        let dataPoints: DataPoint[] = [];

        // Check if rawData is an array
        if (Array.isArray(rawData)) {
            // Try to parse as array of location entries
            dataPoints = this.parseLocationArray(rawData);
        } else if (typeof rawData === 'object') {
            // Check if it's an object with a data array property
            const possibleArrayKeys = ['data', 'locations', 'points', 'coordinates', 'tracks'];
            for (const key of possibleArrayKeys) {
                if (Array.isArray(rawData[key])) {
                    dataPoints = this.parseLocationArray(rawData[key]);
                    break;
                }
            }
        }

        if (dataPoints.length === 0) {
            throw new Error('No valid location data found in file. Expected latitude/longitude data.');
        }

        // Sort by timestamp to ensure correct order
        dataPoints.sort((a, b) => a.timestamp - b.timestamp);

        const profileName = this.generateProfileName(filename);

        const profile: Profile = {
            id: this.generateProfileId(),
            name: profileName,
            data: dataPoints,
            color: this.getNextColor()
        };

        console.log(`Created profile "${profileName}" with ${dataPoints.length} points`);
        return profile;
    }

    /**
     * Parses an array of location entries with flexible field detection
     */
    private parseLocationArray(rawArray: any[]): DataPoint[] {
        const dataPoints: DataPoint[] = [];

        for (const entry of rawArray) {
            try {
                // Try different field names for latitude
                const lat = this.extractCoordinate(entry, ['latitude', 'lat', 'Latitude', 'Lat', 'y']);
                const lng = this.extractCoordinate(entry, ['longitude', 'lng', 'lon', 'Longitude', 'Lng', 'Lon', 'x']);

                if (lat === null || lng === null) {
                    continue; // Skip entries without valid coordinates
                }

                // Try different field names for timestamp
                const timestamp = this.extractTimestamp(entry, ['time', 'timestamp', 'Time', 'Timestamp', 'dateTime', 'DateTime']);

                if (timestamp === null) {
                    console.warn('Entry missing timestamp, skipping:', entry);
                    continue;
                }

                const dataPoint: DataPoint = {
                    lat,
                    lng,
                    timestamp,
                    speed: this.extractOptionalNumber(entry, ['speed', 'Speed', 'velocity', 'Velocity']),
                    altitude: this.extractOptionalNumber(entry, ['altitude', 'Altitude', 'alt', 'Alt', 'elevation', 'Elevation', 'z']),
                    bearing: this.extractOptionalNumber(entry, ['bearing', 'Bearing', 'heading', 'Heading', 'direction', 'Direction']),
                    horizontalAccuracy: this.extractOptionalNumber(entry, ['horizontalAccuracy', 'HorizontalAccuracy', 'accuracy', 'Accuracy']),
                    verticalAccuracy: this.extractOptionalNumber(entry, ['verticalAccuracy', 'VerticalAccuracy'])
                };

                dataPoints.push(dataPoint);
            } catch (error) {
                console.warn('Failed to parse entry:', entry, error);
            }
        }

        return dataPoints;
    }

    /**
     * Extracts a coordinate value from an entry trying multiple field names
     */
    private extractCoordinate(entry: any, fieldNames: string[]): number | null {
        for (const field of fieldNames) {
            if (field in entry) {
                const value = parseFloat(entry[field]);
                if (!isNaN(value)) {
                    return value;
                }
            }
        }
        return null;
    }

    /**
     * Extracts a timestamp from an entry trying multiple field names
     */
    private extractTimestamp(entry: any, fieldNames: string[]): number | null {
        for (const field of fieldNames) {
            if (field in entry) {
                let timestamp = entry[field];

                // Handle different timestamp formats
                if (typeof timestamp === 'string') {
                    // Try parsing as ISO date
                    const date = new Date(timestamp);
                    if (!isNaN(date.getTime())) {
                        return date.getTime();
                    }

                    // Try parsing as number
                    timestamp = parseInt(timestamp);
                }

                if (typeof timestamp === 'number') {
                    // Check if it's in nanoseconds (very large number)
                    if (timestamp > Date.now() * 1000000) {
                        return Math.floor(timestamp / 1000000); // Convert nanoseconds to milliseconds
                    }
                    // Check if it's in microseconds
                    else if (timestamp > Date.now() * 1000) {
                        return Math.floor(timestamp / 1000); // Convert microseconds to milliseconds
                    }
                    // Check if it's in seconds (too small)
                    else if (timestamp < Date.now() / 1000) {
                        return timestamp * 1000; // Convert seconds to milliseconds
                    }
                    // Assume it's already in milliseconds
                    return timestamp;
                }
            }
        }
        return null;
    }

    /**
     * Extracts an optional numeric value from an entry
     */
    private extractOptionalNumber(entry: any, fieldNames: string[]): number | undefined {
        for (const field of fieldNames) {
            if (field in entry) {
                const value = parseFloat(entry[field]);
                if (!isNaN(value) && value !== -1) { // -1 often means "no data"
                    return value;
                }
            }
        }
        return undefined;
    }

    /**
     * Generates a unique profile ID
     */
    private generateProfileId(): string {
        return `profile_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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
        return `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`;
    }

    /**
     * Loads a profile from a URL (for pre-loaded profiles)
     */
    async loadProfileFromUrl(url: string, filename: string): Promise<Profile> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch profile: ${response.statusText}`);
            }

            const rawData = await response.json();
            const profile = this.createProfileFromData(rawData, filename);
            this.addProfile(profile);
            return profile;
        } catch (error) {
            console.error(`Failed to load profile from ${url}:`, error);
            throw error;
        }
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

        // Check if at least some entries have recognizable location fields
        const hasValidEntries = data.some(entry => {
            const hasLat = this.extractCoordinate(entry, ['latitude', 'lat', 'Latitude', 'Lat']) !== null;
            const hasLng = this.extractCoordinate(entry, ['longitude', 'lng', 'lon', 'Longitude', 'Lng', 'Lon']) !== null;
            return hasLat && hasLng;
        });

        return hasValidEntries;
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
            totalDistance += this.calculateDistance(data[i - 1], data[i]);
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