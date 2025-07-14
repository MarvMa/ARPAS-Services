import {Repository} from 'typeorm';
import {Recording} from '@/models/Recording';
import {AppDataSource} from '@/config/database';
import {
    ProcessedRecording,
    LocationData,
    PathPoint,
    RecordingMetadata,
    MetadataEntry,
    RecordingData
} from '@/types/recording';
import {readJsonFile} from '@/utils/fileUtils';
import {calculateBounds} from '@/utils/pathUtils';
import {logger} from '@/middleware/logger';

export class RecordingService {
    private recordingRepository: Repository<Recording>;

    constructor() {
        this.recordingRepository = AppDataSource.getRepository(Recording);
    }

    /**
     * Check if an entry is a metadata entry
     */
    private isMetadataEntry(entry: any): entry is MetadataEntry {
        return entry.sensor === 'Metadata' && entry['device id'] !== undefined;
    }

    /**
     * Check if an entry is a location data entry
     */
    private isLocationEntry(entry: any): entry is LocationData {
        return entry.sensor === 'Location' && entry.latitude !== undefined && entry.longitude !== undefined;
    }

    /**
     * Convert string values to numbers safely
     */
    private parseNumericValue(value: string | number): number {
        if (typeof value === 'number') return value;
        const parsed = parseFloat(value);
        return isNaN(parsed) ? 0 : parsed;
    }

    /**
     * Process and save a recording from uploaded file
     */
    async processRecording(file: Express.Multer.File, color: string): Promise<ProcessedRecording> {
        try {
            // Read and parse the JSON file
            const rawData = await readJsonFile<RecordingData>(file.path);

            // Filter location data entries
            const locationData = rawData.filter(entry => this.isLocationEntry(entry)) as LocationData[];

            // Find metadata entry
            const metadataEntry = rawData.find(entry => this.isMetadataEntry(entry)) as MetadataEntry | undefined;

            if (locationData.length === 0) {
                throw new Error('No location data found in the uploaded file');
            }

            // Convert location data to PathPoint format
            const pathPoints: PathPoint[] = locationData.map(entry => ({
                latitude: this.parseNumericValue(entry.latitude),
                longitude: this.parseNumericValue(entry.longitude),
                altitude: this.parseNumericValue(entry.altitude || entry.altitudeAboveMeanSeaLevel || '0'),
                timestamp: new Date(parseInt(entry.time) / 1000000), // Convert nanoseconds to milliseconds
                speed: this.parseNumericValue(entry.speed) !== -1 ? this.parseNumericValue(entry.speed) : undefined,
                bearing: this.parseNumericValue(entry.bearing) !== -1 ? this.parseNumericValue(entry.bearing) : undefined,
                horizontalAccuracy: this.parseNumericValue(entry.horizontalAccuracy),
                verticalAccuracy: this.parseNumericValue(entry.verticalAccuracy)
            }));

            // Calculate bounds
            const bounds = calculateBounds(pathPoints);

            // Calculate duration
            const firstTimestamp = pathPoints[0].timestamp.getTime();
            const lastTimestamp = pathPoints[pathPoints.length - 1].timestamp.getTime();
            const duration = (lastTimestamp - firstTimestamp) / 1000; // Convert to seconds

            // Extract metadata
            const metadata: RecordingMetadata | undefined = metadataEntry ? {
                deviceId: metadataEntry['device id'],
                deviceName: metadataEntry['device name'],
                platform: metadataEntry.platform,
                appVersion: metadataEntry.appVersion,
                recordingTime: metadataEntry['recording time'],
                timezone: metadataEntry['recording timezone'],
                version: metadataEntry.version,
                sensors: metadataEntry.sensors
            } : undefined;

            // Create recording entity
            const recording = new Recording();
            recording.originalFilename = file.originalname;
            recording.color = color;
            recording.duration = duration;
            recording.pointCount = pathPoints.length;
            recording.bounds = bounds;
            recording.metadata = metadata;
            recording.filePath = file.path;

            // Save to database
            const savedRecording = await this.recordingRepository.save(recording);

            logger.info(`Recording processed successfully: ${savedRecording.id}`);

            return {
                id: savedRecording.id,
                originalFilename: savedRecording.originalFilename,
                color: savedRecording.color,
                duration: savedRecording.duration,
                pointCount: savedRecording.pointCount,
                bounds: savedRecording.bounds,
                metadata: savedRecording.metadata,
                createdAt: savedRecording.createdAt
            };

        } catch (error) {
            logger.error('Error processing recording:', error);
            throw new Error(`Failed to process recording: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get all recordings
     */
    async getAllRecordings(): Promise<ProcessedRecording[]> {
        const recordings = await this.recordingRepository.find({
            order: {createdAt: 'DESC'}
        });

        return recordings.map(recording => ({
            id: recording.id,
            originalFilename: recording.originalFilename,
            color: recording.color,
            duration: recording.duration,
            pointCount: recording.pointCount,
            bounds: recording.bounds,
            metadata: recording.metadata,
            createdAt: recording.createdAt
        }));
    }

    /**
     * Get recording by ID
     */
    async getRecordingById(id: string): Promise<ProcessedRecording | null> {
        const recording = await this.recordingRepository.findOne({where: {id}});

        if (!recording) {
            return null;
        }

        return {
            id: recording.id,
            originalFilename: recording.originalFilename,
            color: recording.color,
            duration: recording.duration,
            pointCount: recording.pointCount,
            bounds: recording.bounds,
            metadata: recording.metadata,
            createdAt: recording.createdAt
        };
    }

    /**
     * Get path data for a recording
     */
    async getRecordingPath(id: string): Promise<PathPoint[]> {
        const recording = await this.recordingRepository.findOne({where: {id}});

        if (!recording) {
            throw new Error('Recording not found');
        }

        // Read the original file and extract path points
        const rawData = await readJsonFile<RecordingData>(recording.filePath);
        const locationData = rawData.filter(entry => this.isLocationEntry(entry)) as LocationData[];

        return locationData.map(entry => ({
            latitude: this.parseNumericValue(entry.latitude),
            longitude: this.parseNumericValue(entry.longitude),
            altitude: this.parseNumericValue(entry.altitude || entry.altitudeAboveMeanSeaLevel || '0'),
            timestamp: new Date(parseInt(entry.time) / 1000000), // Convert nanoseconds to milliseconds
            speed: this.parseNumericValue(entry.speed) !== -1 ? this.parseNumericValue(entry.speed) : undefined,
            bearing: this.parseNumericValue(entry.bearing) !== -1 ? this.parseNumericValue(entry.bearing) : undefined,
            horizontalAccuracy: this.parseNumericValue(entry.horizontalAccuracy),
            verticalAccuracy: this.parseNumericValue(entry.verticalAccuracy)
        }));
    }

    /**
     * Delete a recording
     */
    async deleteRecording(id: string): Promise<void> {
        const recording = await this.recordingRepository.findOne({where: {id}});

        if (!recording) {
            throw new Error('Recording not found');
        }

        await this.recordingRepository.remove(recording);
        logger.info(`Recording deleted: ${id}`);
    }
}