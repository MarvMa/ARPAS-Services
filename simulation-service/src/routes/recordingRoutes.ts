import {Router} from 'express';
import multer from 'multer';
import path from 'path';
import {RecordingController} from '@/controllers/recordingController';
import {validateRecordingUpload, validateFileUpload} from '@/middleware/validation';

const router = Router();
const recordingController = new RecordingController();

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, process.env.UPLOAD_DIR || 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `recording-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB default
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
            cb(null, true);
        } else {
            cb(new Error('Only JSON files are allowed'));
        }
    }
});

// Routes
router.post('/upload', upload.single('file'), validateFileUpload, validateRecordingUpload, recordingController.uploadRecording);
router.get('/', recordingController.getAllRecordings);
router.get('/:id', recordingController.getRecordingById);
router.get('/:id/path', recordingController.getRecordingPath);
router.delete('/:id', recordingController.deleteRecording);

export default router;