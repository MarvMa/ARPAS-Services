import {Profile, DataPoint} from '../types/simulation';

// Enhanced type for the specific data format we're dealing with
interface LocationEntry {
    sensor?: string;
    latitude?: string;
    longitude?: string;
    time?: string;
    speed?: string;
    bearing?: string;
    altitude?: string;
    altitudeAboveMeanSeaLevel?: string;
    horizontalAccuracy?: string;
    verticalAccuracy?: string;
    bearingAccuracy?: string;
    speedAccuracy?: string;

    [key: string]: any;
}

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
            color: this.getNextColor(),
            isVisible: true
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
                // Skip metadata entries
                if (entry.sensor === 'Metadata' || entry.sensor === 'metadata') {
                    continue;
                }

                // Filter for location sensor entries
                if (entry.sensor && entry.sensor !== 'Location') {
                    continue;
                }

                const locationEntry = entry as LocationEntry;

                // Extract latitude and longitude - handle string values
                const lat = this.parseNumericValue(locationEntry.latitude);
                const lng = this.parseNumericValue(locationEntry.longitude);

                if (lat === null || lng === null) {
                    console.warn('Entry missing valid coordinates, skipping:', entry);
                    continue;
                }

                // Extract timestamp - handle the specific "time" field with nanosecond precision
                const timestamp = this.parseTimestamp(locationEntry.time);

                if (timestamp === null) {
                    console.warn('Entry missing timestamp, skipping:', entry);
                    continue;
                }

                // Parse optional numeric fields, treating "-1" as invalid
                const speed = this.parseOptionalNumeric(locationEntry.speed);
                const bearing = this.parseOptionalNumeric(locationEntry.bearing);
                const altitude = this.parseOptionalNumeric(locationEntry.altitude) ||
                    this.parseOptionalNumeric(locationEntry.altitudeAboveMeanSeaLevel);
                const horizontalAccuracy = this.parseOptionalNumeric(locationEntry.horizontalAccuracy);
                const verticalAccuracy = this.parseOptionalNumeric(locationEntry.verticalAccuracy);

                const dataPoint: DataPoint = {
                    lat,
                    lng,
                    timestamp,
                    speed,
                    altitude,
                    bearing,
                    horizontalAccuracy,
                    verticalAccuracy
                };

                dataPoints.push(dataPoint);
            } catch (error) {
                console.warn('Failed to parse entry:', entry, error);
            }
        }

        console.log(`Parsed ${dataPoints.length} valid location points from ${rawArray.length} entries`);
        return dataPoints;
    }

    /**
     * Parses a string value to number, handling edge cases
     */
    private parseNumericValue(value: string | number | undefined): number | null {
        if (value === undefined || value === null || value === '') {
            return null;
        }

        const numValue = typeof value === 'string' ? parseFloat(value) : value;

        if (isNaN(numValue)) {
            return null;
        }

        return numValue;
    }

    /**
     * Parses optional numeric values, treating "-1" and invalid values as undefined
     */
    private parseOptionalNumeric(value: string | number | undefined): number | undefined {
        const parsed = this.parseNumericValue(value);

        // Treat -1 as "no data" which is common in sensor data
        if (parsed === null || parsed === -1) {
            return undefined;
        }

        return parsed;
    }

    /**
     * Parses timestamp from the specific format used in the data
     */
    private parseTimestamp(timeValue: string | number | undefined): number | null {
        if (!timeValue) {
            return null;
        }

        let timestamp: number;

        if (typeof timeValue === 'string') {
            // Try parsing as ISO date first
            const date = new Date(timeValue);
            if (!isNaN(date.getTime())) {
                return date.getTime();
            }

            // Parse as number
            timestamp = parseInt(timeValue);
        } else {
            timestamp = timeValue;
        }

        if (isNaN(timestamp)) {
            return null;
        }

        const absTimestamp = Math.abs(timestamp);

        // Nanoseconds have ~19 digits (1e18 and above)
        if (absTimestamp >= 1e17) {
            return Math.floor(timestamp / 1_000_000); // Convert nanoseconds to milliseconds
        }
        // Microseconds have ~16 digits (1e15 and above)
        if (absTimestamp >= 1e14) {
            return Math.floor(timestamp / 1_000); // Convert microseconds to milliseconds
        }
        // If it's likely in seconds (10^10 or less)
        if (absTimestamp <= 1e12) {
            return timestamp * 1000; // Convert seconds to milliseconds
        }
        return timestamp;
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
                new Error(`Failed to fetch profile: ${response.statusText}`);
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
     * Exports profiles to JSON format
     */
    exportProfiles(): string {
        return JSON.stringify(this.profiles, null, 2);
    }

    /**
     * Clears all profiles
     */
    clearAllProfiles(): void {
        this.profiles = [];
    }

}