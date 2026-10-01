const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');

let upload;
const useGCS = (process.env.NODE_ENV === 'production' || process.env.GCS_BUCKET_NAME) ? true : false;

let bucket;
if (useGCS) {
    console.log('Configuring Google Cloud Storage for image uploads...');
    const multerGoogleStorage = require('multer-cloud-storage');
    
    const config = {
        bucket: process.env.GCS_BUCKET_NAME,
        uniformBucketLevelAccess: true,
        projectId: process.env.FIRESTORE_PROJECT_ID || 'darkbrood',
        destination: 'uploads',
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    };
    
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        config.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    
    upload = multer({
        storage: multerGoogleStorage.storageEngine(config),
        limits: { fileSize: 50 * 1024 * 1024 } // Increased limit to 50MB
    });

    const storageClient = new Storage({
        projectId: config.projectId,
        ...(config.keyFilename && { keyFilename: config.keyFilename })
    });
    bucket = storageClient.bucket(config.bucket);
} else {
    console.log('Configuring local filesystem storage for image uploads...');
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    });
    
    upload = multer({
        storage: storage,
        limits: { fileSize: 50 * 1024 * 1024 } // Increased limit to 50MB
    });
}

// Audio file filter for MP3, WAV, OGG, etc.
const audioFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm'];
    if (file.mimetype.startsWith('audio/') || allowedExts.includes(ext) || file.mimetype === 'video/ogg') {
        cb(null, true);
    } else {
        cb(new Error('오디오 파일(MP3, WAV, OGG 등)만 업로드할 수 있습니다.'), false);
    }
};

let uploadAudio;
if (useGCS) {
    const multerGoogleStorage = require('multer-cloud-storage');
    const audioConfig = {
        bucket: process.env.GCS_BUCKET_NAME,
        uniformBucketLevelAccess: true,
        projectId: process.env.FIRESTORE_PROJECT_ID || 'darkbrood',
        destination: 'uploads',
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    };
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        audioConfig.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    uploadAudio = multer({
        storage: multerGoogleStorage.storageEngine(audioConfig),
        fileFilter: audioFilter,
        limits: { fileSize: 50 * 1024 * 1024 }
    });
} else {
    const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, uniqueSuffix + path.extname(file.originalname));
        }
    });
    uploadAudio = multer({
        storage: storage,
        fileFilter: audioFilter,
        limits: { fileSize: 50 * 1024 * 1024 }
    });
}

// Helper to upload a local file directly to GCS and return its URL
async function uploadFileToGCS(localFilePath, destinationFilename) {
    if (!useGCS) {
        throw new Error('GCS is not configured');
    }
    const destPath = 'uploads/' + destinationFilename;
    await bucket.upload(localFilePath, {
        destination: destPath,
        metadata: {
            cacheControl: 'public, max-age=31536000',
        }
    });
    return `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${destPath}`;
}

// Helper to safely delete a file from GCS or local disk
async function deleteFileFromStorage(fileUrl) {
    if (!fileUrl) return;
    try {
        if (useGCS) {
            const cleanUrl = fileUrl.split('?')[0];
            const parts = cleanUrl.split('/');
            const filename = parts[parts.length - 1];
            if (bucket && filename) {
                await bucket.file('uploads/' + filename).delete({ ignoreNotFound: true });
            }
        } else {
            const filename = path.basename(fileUrl);
            const localPath = path.join(__dirname, '..', 'public', 'uploads', filename);
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
            }
        }
    } catch (e) {
        console.error('Error deleting file from storage:', e);
    }
}

module.exports = {
    upload,
    uploadAudio,
    useGCS,
    bucket,
    uploadFileToGCS,
    deleteFileFromStorage,
    getImageUrl: (req, file) => {
        if (!file) return null;
        if (useGCS) {
            // For GCS, multer-cloud-storage returns the public URL in linkUrl.
            // Fallback to path to ensure the "uploads/" prefix is included.
            return file.linkUrl || file.publicUrl || file.link || `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${file.path || file.filename}`;
        } else {
            return `/uploads/${file.filename}`;
        }
    }
};
