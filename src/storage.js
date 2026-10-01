const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { Storage } = require('@google-cloud/storage');

let ffmpegStatic = null;
try {
    ffmpegStatic = require('ffmpeg-static');
} catch (e) {
    // ffmpeg-static may not be present in some minimal setups; fallback to system 'ffmpeg'
}

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
        limits: { fileSize: 50 * 1024 * 1024 }
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
        limits: { fileSize: 50 * 1024 * 1024 }
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

// Temp folder for incoming raw audio before ffmpeg normalization
const audioTempDir = path.join(os.tmpdir(), 'darkbrood-audio-temp');
if (!fs.existsSync(audioTempDir)) {
    fs.mkdirSync(audioTempDir, { recursive: true });
}

// Multer always saves audio to local temp disk first so ffmpeg can process it
const audioDiskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, audioTempDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'raw-' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
    }
});

const uploadAudio = multer({
    storage: audioDiskStorage,
    fileFilter: audioFilter,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// Resolve ffmpeg binary (ffmpeg-static or system PATH)
function getFfmpegPath() {
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
        return ffmpegStatic;
    }
    return 'ffmpeg';
}

/**
 * Normalizes an audio file to -16 LUFS (EBU R128 international standard) and converts to 192k MP3
 */
function normalizeAudioFile(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const ffmpeg = getFfmpegPath();
        const args = [
            '-y',
            '-i', inputPath,
            '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
            '-c:a', 'libmp3lame',
            '-b:a', '192k',
            '-ar', '44100',
            outputPath
        ];

        execFile(ffmpeg, args, (err, stdout, stderr) => {
            if (err) {
                console.error('FFmpeg normalization error:', err, stderr);
                return reject(err);
            }
            resolve(outputPath);
        });
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

/**
 * Normalizes uploaded audio on server and saves to final storage (GCS in prod, uploads dir locally)
 */
async function processAndSaveAudio(file) {
    const rawPath = file.path;
    const finalFilename = Date.now() + '-' + Math.round(Math.random() * 1e9) + '.mp3';
    const normalizedTempPath = path.join(audioTempDir, 'norm-' + finalFilename);

    let processedPath = rawPath;
    let isNormalized = false;

    try {
        await normalizeAudioFile(rawPath, normalizedTempPath);
        processedPath = normalizedTempPath;
        isNormalized = true;
    } catch (normErr) {
        console.warn('Loudness normalization failed, falling back to raw audio:', normErr);
        processedPath = rawPath;
    }

    const finalSize = fs.statSync(processedPath).size;
    let fileUrl = '';

    if (useGCS) {
        fileUrl = await uploadFileToGCS(processedPath, finalFilename);
    } else {
        const localDest = path.join(__dirname, '..', 'public', 'uploads', finalFilename);
        fs.copyFileSync(processedPath, localDest);
        fileUrl = `/uploads/${finalFilename}`;
    }

    // Clean up temporary files
    try {
        if (fs.existsSync(rawPath)) fs.unlinkSync(rawPath);
        if (isNormalized && fs.existsSync(normalizedTempPath)) fs.unlinkSync(normalizedTempPath);
    } catch (cleanupErr) {
        console.warn('Temp cleanup warning:', cleanupErr);
    }

    return {
        fileUrl,
        fileSize: finalSize,
        isNormalized
    };
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
    normalizeAudioFile,
    processAndSaveAudio,
    getImageUrl: (req, file) => {
        if (!file) return null;
        if (useGCS) {
            return file.linkUrl || file.publicUrl || file.link || `https://storage.googleapis.com/${process.env.GCS_BUCKET_NAME}/${file.path || file.filename}`;
        } else {
            return `/uploads/${file.filename}`;
        }
    }
};
