const multer = require('multer');
const path = require('path');
const fs = require('fs');

let upload;
let fileUpload;
const useGCS = (process.env.NODE_ENV === 'production' || process.env.GCS_BUCKET_NAME) ? true : false;

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
        limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
    });
    
    fileUpload = multer({
        storage: multerGoogleStorage.storageEngine(config),
        limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
    });
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
        limits: { fileSize: 5 * 1024 * 1024 }
    });
    
    fileUpload = multer({
        storage: storage,
        limits: { fileSize: 50 * 1024 * 1024 }
    });
}

module.exports = {
    upload,
    fileUpload,
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
