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

module.exports = {
    upload,
    useGCS,
    bucket,
    uploadFileToGCS,
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
