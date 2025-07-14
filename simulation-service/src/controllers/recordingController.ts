import {Request, Response} from 'express';
import {RecordingService} from '@/services/recordingServices';
import {ApiResponse} from '@/types';
import {logger} from '@/middleware/logger';

export class RecordingController {
    private recordingService: RecordingService;

    constructor() {
        this.recordingService = new RecordingService();
    }

    /**
     * Upload and process a recording file
     */
    uploadRecording = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
        try {
            const {color} = req.body;
            const file = req.file;

            if (!file) {
                res.status(400).json({
                    success: false,
                    error: 'No file uploaded'
                });
                return;
            }

            const processedRecording = await this.recordingService.processRecording(file, color);

            res.status(200).json({
                success: true,
                data: processedRecording,
                message: 'Recording uploaded and processed successfully'
            });

        } catch (error) {
            logger.error('Error uploading recording:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload recording'
            });
        }
    };

    /**
     * Get all recordings
     */
    getAllRecordings = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
        try {
            const recordings = await this.recordingService.getAllRecordings();

            res.status(200).json({
                success: true,
                data: recordings
            });

        } catch (error) {
            logger.error('Error fetching recordings:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch recordings'
            });
        }
    };

    /**
     * Get recording by ID
     */
    getRecordingById = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
        try {
            const {id} = req.params;
            const recording = await this.recordingService.getRecordingById(id);

            if (!recording) {
                res.status(404).json({
                    success: false,
                    error: 'Recording not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                data: recording
            });

        } catch (error) {
            logger.error('Error fetching recording:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch recording'
            });
        }
    };

    /**
     * Get path data for a recording
     */
    getRecordingPath = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
        try {
            const {id} = req.params;
            const pathData = await this.recordingService.getRecordingPath(id);

            res.status(200).json({
                success: true,
                data: pathData
            });

        } catch (error) {
            logger.error('Error fetching recording path:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to fetch recording path'
            });
        }
    };

    /**
     * Delete a recording
     */
    deleteRecording = async (req: Request, res: Response<ApiResponse>): Promise<void> => {
        try {
            const {id} = req.params;
            await this.recordingService.deleteRecording(id);

            res.status(200).json({
                success: true,
                message: 'Recording deleted successfully'
            });
        } catch (error) {
            logger.error('Error deleting recording:', error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete recording'
            });
        }
    };
}