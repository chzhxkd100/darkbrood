require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('./db');
const { upload, getImageUrl, useGCS, bucket, uploadFileToGCS } = require('./storage');
const os = require('os');

// Helper to hash password using SHA-256
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

const app = express();
const PORT = process.env.PORT || 8080;

// Enable trusting reverse proxy headers (crucial for secure cookies behind Firebase Hosting proxy)
app.set('trust proxy', 1);

// Helper to generate a 5-character uppercase alphanumeric anonymous ID
function generateAnonId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 5; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// Custom single-cookie parser and verifier (to bypass Firebase Hosting stripping __session.sig)
app.use((req, res, next) => {
    const rawCookies = req.headers.cookie || '';
    const matches = rawCookies.match(/(?:^|; )__session=([^;]*)/);
    const cookieValue = matches ? decodeURIComponent(matches[1]) : null;
    
    req.session = {}; // Define empty session object by default
    let isNewSession = false;
    
    if (cookieValue) {
        const parts = cookieValue.split('.');
        if (parts.length === 2) {
            const [payload, signature] = parts;
            const secret = process.env.SESSION_SECRET || 'dark_solitude_secret_key';
            const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
            
            if (signature === expectedSig) {
                try {
                    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
                    // Check if session has expired (24h)
                    if (data.createdAt && Date.now() - data.createdAt < 24 * 60 * 60 * 1000) {
                        req.session = data;
                    }
                } catch (e) {
                    console.error('Session parsing error:', e);
                }
            }
        }
    }
    
    // If no session or no anonId in session, generate one
    if (!req.session.anonId) {
        req.session.anonId = generateAnonId();
        req.session.createdAt = req.session.createdAt || Date.now();
        isNewSession = true;
    }
    
    // Helper function to save session back to the cookie
    req.saveSession = () => {
        const payload = Buffer.from(JSON.stringify(req.session)).toString('base64');
        const secret = process.env.SESSION_SECRET || 'dark_solitude_secret_key';
        const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
        const value = payload + '.' + signature;
        const maxAgeSeconds = 24 * 60 * 60; // 24 hours
        res.setHeader('Set-Cookie', `__session=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    };
    
    // If we generated a new anonId or session, set the cookie immediately so it persists on subsequent requests
    if (isNewSession) {
        req.saveSession();
    }
    
    next();
});

// Setup views and static folders
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Pass session variables to EJS templates globally & disable CDN caching for dynamic routes
app.use(async (req, res, next) => {
    res.locals.isAdmin = req.session.isAdmin || false;
    res.locals.user = req.session.user || null;
    res.locals.anonId = req.session.anonId || null;
    res.locals.path = req.path;
    res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    
    try {
        const usersSnap = await db.collection('users').get();
        const usersMap = {};
        usersSnap.docs.forEach(doc => {
            const data = doc.data();
            usersMap[data.nickname] = data.profilePictureUrl || null;
        });
        res.locals.usersMap = usersMap;
    } catch (e) {
        console.error('Error fetching users map in global middleware:', e);
        res.locals.usersMap = {};
    }
    
    next();
});

// Middleware to check admin access
function requireAdmin(req, res, next) {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(403).send('Forbidden: Access denied. Operators only.');
    }
}

// ----------------------------------------------------
// SEED MOCK DATA FOR LOCAL DEVELOPMENT (If DB is empty)
// ----------------------------------------------------
async function seedMockData() {
    try {
        const postsSnap = await db.collection('posts').get();
        if (postsSnap.docs.length === 0) {
            console.log('Seeding mock data for the first run...');
            
            // Notice
            await db.collection('posts').add({
                type: 'notice',
                title: 'DarkBrood에 도달한 자들에게',
                content: '이곳은 어둠과 고독의 심연이다. Diary 탭은 나의 개인적인 독설과 기록이며, Community 탭은 흩어진 영혼들이 익명으로 배설하는 공간이다. 규칙은 단 하나. 증오를 가리지 말 것.',
                imageUrl: null,
                authorIp: '127.0.0.1',
                createdAt: Date.now() - 1000 * 60 * 60 * 24
            });

            // Diary
            await db.collection('posts').add({
                type: 'diary',
                title: '02 June 2026 - 첫 번째 파편',
                content: 'GCP에 서버를 올리며 느꼈던 고독에 대해 기록한다. 아무도 들어오지 않는 이 어둠 속에서 나는 코드를 두드린다. 클라우드의 무한한 팽창과 나의 쪼그라드는 자아. 기술 블로그라는 거창한 이름을 달았지만 그저 어둠 속의 절규일 뿐이다.',
                imageUrl: null,
                authorIp: '127.0.0.1',
                createdAt: Date.now() - 1000 * 60 * 60 * 5
            });

            // Community (anonymous)
            const post1 = await db.collection('posts').add({
                type: 'community',
                title: '나만 세상이 역겨운가?',
                content: '익명의 그늘 밑에서 묻는다. 매일 아침 지하철에서 닭장 속 닭처럼 시체 눈을 하고 출근하는 인간들을 보면 토기가 쏠린다. 다들 연극을 하고 있다.',
                imageUrl: null,
                authorIp: '182.16.xxx.xxx',
                createdAt: Date.now() - 1000 * 60 * 30
            });

            await db.collection('comments').add({
                postId: post1.id,
                content: '나도 마찬가지임. 세상 전체가 거대한 가식 덩어리다.',
                authorIp: '110.12.xxx.xxx',
                createdAt: Date.now() - 1000 * 60 * 10
            });
        }
    } catch (err) {
        console.error('Error seeding mock data:', err);
    }
}

// Check database type and seed if local
if (process.env.NODE_ENV !== 'production' && !process.env.FIRESTORE_PROJECT_ID) {
    seedMockData();
}

// Helper to attach comments to list of posts
async function attachCommentsToPosts(posts) {
    if (!posts || posts.length === 0) return;
    try {
        const allCommentsSnap = await db.collection('comments')
            .orderBy('createdAt', 'asc')
            .get();
        const allComments = allCommentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        posts.forEach(post => {
            post.comments = allComments.filter(comment => comment.postId === post.id);
        });
    } catch (e) {
        console.error('Error attaching comments to posts:', e);
    }
}

// Automatic patch notes notice registration
async function seedPatchNotes() {
    try {
        // ----------------------------------------------------
        // v1.2.0 Patch Note
        // ----------------------------------------------------
        const patchTitle120 = '[v1.2.0] 패치노트';
        
        // Clean up any older/incorrectly titled v1.2.0 notice posts if they exist
        const oldTitles120 = [
            'DarkBrood v1.2.0 패치노트'
        ];
        for (const title of oldTitles120) {
            const oldSnap = await db.collection('posts')
                .where('type', '==', 'notice')
                .where('title', '==', title)
                .get();
            for (const doc of oldSnap.docs) {
                await db.collection('posts').doc(doc.id).delete();
            }
        }

        const noticeSnap120 = await db.collection('posts')
            .where('type', '==', 'notice')
            .where('title', '==', patchTitle120)
            .get();
            
        const contentStr120 = `어두운 심연에서 거주하는 자들이여, 다음과 같이 편의 기능 개선이 적용되었습니다.

- 타인의 상세 정보를 볼 수 있는 공개 프로필 기능 도입
- 작성글 모아보기 및 페이지 이동 기능 구현
- 작성자 프로필 사진 확대 표시 적용
- 게시글 검색 조건 및 필터 제공

더 깊고 고독한 사색을 즐기시길 바랍니다.`;

        if (noticeSnap120.docs.length > 0) {
            const docId = noticeSnap120.docs[0].id;
            await db.collection('posts').doc(docId).set({
                type: 'notice',
                title: patchTitle120,
                content: contentStr120,
                imageUrl: null,
                authorIp: '127.0.0.1',
                authorNickname: '운영자',
                createdAt: noticeSnap120.docs[0].data().createdAt || Date.now()
            });
        } else {
            console.log('Publishing v1.2.0 patch notes notice...');
            await db.collection('posts').add({
                type: 'notice',
                title: patchTitle120,
                content: contentStr120,
                imageUrl: null,
                authorIp: '127.0.0.1',
                authorNickname: '운영자',
                createdAt: Date.now()
            });
        }

    } catch (err) {
        console.error('Error seeding patch notes:', err);
    }
}
seedPatchNotes();


// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------

// Setup chunk storage for local multer (saves chunks to public/uploads/tmp/<uploadId>/<chunkIndex>)
const localChunkStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadId = req.query.uploadId;
        if (!uploadId) {
            return cb(new Error('Missing uploadId'));
        }
        // Sanitize uploadId to prevent directory traversal
        const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
        const dir = path.join(__dirname, '..', 'public', 'uploads', 'tmp', safeUploadId);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const chunkIndex = req.query.chunkIndex || '0';
        const safeChunkIndex = chunkIndex.replace(/[^0-9]/g, '');
        cb(null, safeChunkIndex);
    }
});
const uploadLocalChunk = multer({
    storage: localChunkStorage,
    limits: { fileSize: 10 * 1024 * 1024 } // max 10MB per chunk
});
const uploadMemoryChunk = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Route to handle individual chunk upload
app.post('/upload/chunk', (req, res, next) => {
    if (useGCS) {
        uploadMemoryChunk.single('chunk')(req, res, next);
    } else {
        uploadLocalChunk.single('chunk')(req, res, next);
    }
}, async (req, res) => {
    try {
        if (useGCS) {
            const { uploadId, chunkIndex } = req.query;
            if (!uploadId) {
                return res.status(400).send('Missing uploadId');
            }
            const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
            const safeChunkIndex = (chunkIndex || '0').replace(/[^0-9]/g, '');
            
            const tempFilename = `uploads/tmp/${safeUploadId}/${safeChunkIndex}`;
            const file = bucket.file(tempFilename);
            await file.save(req.file.buffer);
        }
        res.json({ success: true, message: 'Chunk uploaded successfully' });
    } catch (err) {
        console.error('Error uploading chunk to GCS:', err);
        res.status(500).send('Error uploading chunk: ' + err.message);
    }
});

// Route to handle merging of uploaded chunks
app.post('/upload/complete', async (req, res) => {
    const { uploadId, filename, totalChunks } = req.body;
    if (!uploadId || !filename || !totalChunks) {
        return res.status(400).send('Missing uploadId, filename, or totalChunks');
    }

    try {
        const safeUploadId = uploadId.replace(/[^a-zA-Z0-9_-]/g, '');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const finalFilename = uniqueSuffix + path.extname(filename);
        
        let imageUrl;
        if (useGCS) {
            // Cloud-native merge on GCP Cloud Run
            const localPath = path.join(os.tmpdir(), finalFilename);
            const writeStream = fs.createWriteStream(localPath);

            // Fetch each chunk from GCS and write to local temp file
            for (let i = 0; i < totalChunks; i++) {
                const chunkGCSPath = `uploads/tmp/${safeUploadId}/${i}`;
                const chunkFile = bucket.file(chunkGCSPath);
                
                const exists = await chunkFile.exists();
                if (!exists[0]) {
                    throw new Error(`Chunk ${i} is missing on GCS`);
                }

                await new Promise((resolve, reject) => {
                    const readStream = chunkFile.createReadStream();
                    readStream.pipe(writeStream, { end: false });
                    readStream.on('end', resolve);
                    readStream.on('error', reject);
                });
            }
            writeStream.end();

            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            // Upload the merged file to GCS
            imageUrl = await uploadFileToGCS(localPath, finalFilename);

            // Clean up local merged file
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
            }

            // Clean up GCS chunks
            const [files] = await bucket.getFiles({ prefix: `uploads/tmp/${safeUploadId}/` });
            await Promise.all(files.map(file => file.delete()));

        } else {
            // Local merge
            const tmpDir = path.join(__dirname, '..', 'public', 'uploads', 'tmp', safeUploadId);
            const finalPath = path.join(__dirname, '..', 'public', 'uploads', finalFilename);
            
            // Ensure destination uploads directory exists
            const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }

            const writeStream = fs.createWriteStream(finalPath);
            
            // Pipe each chunk stream sequentially to the write stream
            for (let i = 0; i < totalChunks; i++) {
                const chunkPath = path.join(tmpDir, i.toString());
                if (!fs.existsSync(chunkPath)) {
                    throw new Error(`Chunk ${i} is missing`);
                }
                const chunkStream = fs.createReadStream(chunkPath);
                await new Promise((resolve, reject) => {
                    chunkStream.pipe(writeStream, { end: false });
                    chunkStream.on('end', resolve);
                    chunkStream.on('error', reject);
                });
            }
            writeStream.end();
            
            await new Promise((resolve, reject) => {
                writeStream.on('finish', resolve);
                writeStream.on('error', reject);
            });

            // Clean up chunks
            for (let i = 0; i < totalChunks; i++) {
                const chunkPath = path.join(tmpDir, i.toString());
                if (fs.existsSync(chunkPath)) {
                    fs.unlinkSync(chunkPath);
                }
            }
            if (fs.existsSync(tmpDir)) {
                fs.rmdirSync(tmpDir);
            }

            imageUrl = `/uploads/${finalFilename}`;
        }

        res.json({ success: true, url: imageUrl });
    } catch (err) {
        console.error('Error merging chunks:', err);
        res.status(500).send('Error merging chunks: ' + err.message);
    }
});

// Home (Notice list as dashboard)
app.get('/', async (req, res) => {
    try {
        const noticesSnap = await db.collection('posts')
            .where('type', '==', 'notice')
            .orderBy('createdAt', 'desc')
            .get();
        
        const notices = noticesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Attach comments to notices
        await attachCommentsToPosts(notices);
        
        let introText = null;
        try {
            const introDoc = await db.collection('config').doc('intro').get();
            if (introDoc.exists) {
                introText = introDoc.data().content;
            }
        } catch (e) {
            console.error('Error fetching intro text:', e);
        }
        
        res.render('index', { notices, introText });
    } catch (err) {
        console.error('Error in GET /:', err.stack || err);
        res.status(500).send('Database Error');
    }
});

// Diary (Operator Blog)
app.get('/diary', async (req, res) => {
    try {
        const diarySnap = await db.collection('posts')
            .where('type', '==', 'diary')
            .orderBy('createdAt', 'desc')
            .get();
        
        let allPosts = diarySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Filter by author nickname if query parameter is provided
        const authorFilter = req.query.author ? req.query.author.trim() : null;
        if (authorFilter) {
            allPosts = allPosts.filter(post => post.authorNickname === authorFilter);
        }
        
        // Search filtering
        const searchQuery = req.query.searchQuery ? req.query.searchQuery.trim() : null;
        const searchType = req.query.searchType ? req.query.searchType.trim() : 'all';
        if (searchQuery) {
            const queryLower = searchQuery.toLowerCase();
            allPosts = allPosts.filter(post => {
                if (searchType === 'title') {
                    return post.title && post.title.toLowerCase().includes(queryLower);
                } else if (searchType === 'content') {
                    return post.content && post.content.toLowerCase().includes(queryLower);
                } else if (searchType === 'author') {
                    return (post.authorNickname && post.authorNickname.toLowerCase().includes(queryLower)) ||
                           (post.authorIp && post.authorIp.toLowerCase().includes(queryLower));
                } else { // 'all'
                    return (post.title && post.title.toLowerCase().includes(queryLower)) ||
                           (post.content && post.content.toLowerCase().includes(queryLower)) ||
                           (post.authorNickname && post.authorNickname.toLowerCase().includes(queryLower)) ||
                           (post.authorIp && post.authorIp.toLowerCase().includes(queryLower));
                }
            });
        }
        
        // Pagination logic
        const currentPage = parseInt(req.query.page) || 1;
        const limit = 5; // 5 posts per page
        const totalPosts = allPosts.length;
        const totalPages = Math.ceil(totalPosts / limit) || 1;
        
        // Safe bounds for currentPage
        const page = Math.max(1, Math.min(currentPage, totalPages));
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        
        const posts = allPosts.slice(startIndex, endIndex);
        
        // Attach comments to diary posts
        await attachCommentsToPosts(posts);
        
        res.render('diary', { 
            posts, 
            currentPage: page,
            totalPages,
            authorFilter,
            searchQuery,
            searchType
        });
    } catch (err) {
        console.error('Error in GET /diary:', err.stack || err);
        res.status(500).send('Database Error');
    }
});

// Notice list page
app.get('/notice', async (req, res) => {
    try {
        const noticesSnap = await db.collection('posts')
            .where('type', '==', 'notice')
            .orderBy('createdAt', 'desc')
            .get();
        
        const allNotices = noticesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Pagination logic
        const currentPage = parseInt(req.query.page) || 1;
        const limit = 5; // 5 posts per page
        const totalNotices = allNotices.length;
        const totalPages = Math.ceil(totalNotices / limit) || 1;
        
        // Safe bounds for currentPage
        const page = Math.max(1, Math.min(currentPage, totalPages));
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        
        const notices = allNotices.slice(startIndex, endIndex);
        
        // Attach comments to notices
        await attachCommentsToPosts(notices);
        
        res.render('notice', { 
            notices,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        console.error('Error in GET /notice:', err.stack || err);
        res.status(500).send('Database Error');
    }
});

// Community (Anonymous board)
app.get('/community', async (req, res) => {
    try {
        const communitySnap = await db.collection('posts')
            .where('type', '==', 'community')
            .orderBy('createdAt', 'desc')
            .get();
        
        let allPosts = communitySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Filter by author nickname or anonymous IP/ID if query parameter is provided
        const authorFilter = req.query.author ? req.query.author.trim() : null;
        if (authorFilter) {
            allPosts = allPosts.filter(post => {
                const nick = post.authorNickname;
                const ip = post.authorIp;
                return (nick && nick === authorFilter) || (ip && ip === authorFilter);
            });
        }
        
        // Search filtering
        const searchQuery = req.query.searchQuery ? req.query.searchQuery.trim() : null;
        const searchType = req.query.searchType ? req.query.searchType.trim() : 'all';
        if (searchQuery) {
            const queryLower = searchQuery.toLowerCase();
            allPosts = allPosts.filter(post => {
                if (searchType === 'title') {
                    return post.title && post.title.toLowerCase().includes(queryLower);
                } else if (searchType === 'content') {
                    return post.content && post.content.toLowerCase().includes(queryLower);
                } else if (searchType === 'author') {
                    return (post.authorNickname && post.authorNickname.toLowerCase().includes(queryLower)) ||
                           (post.authorIp && post.authorIp.toLowerCase().includes(queryLower));
                } else { // 'all'
                    return (post.title && post.title.toLowerCase().includes(queryLower)) ||
                           (post.content && post.content.toLowerCase().includes(queryLower)) ||
                           (post.authorNickname && post.authorNickname.toLowerCase().includes(queryLower)) ||
                           (post.authorIp && post.authorIp.toLowerCase().includes(queryLower));
                }
            });
        }
        
        // Pagination logic
        const currentPage = parseInt(req.query.page) || 1;
        const limit = 5; // 5 posts per page
        const totalPosts = allPosts.length;
        const totalPages = Math.ceil(totalPosts / limit) || 1;
        
        // Safe bounds for currentPage
        const page = Math.max(1, Math.min(currentPage, totalPages));
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        
        const posts = allPosts.slice(startIndex, endIndex);
        
        // Fetch comments for posts
        await attachCommentsToPosts(posts);

        res.render('community', { 
            posts, 
            currentPage: page, 
            totalPages,
            authorFilter,
            searchQuery,
            searchType
        });
    } catch (err) {
        console.error('Error in GET /community:', err.stack || err);
        res.status(500).send('Database Error');
    }
});

// Post creation for Diary & Notice
app.post('/post/new', upload.single('image'), async (req, res) => {
    const { type, title, content } = req.body;
    if (!['diary', 'notice'].includes(type)) {
        return res.status(400).send('Invalid post type');
    }
    
    // Authorization check
    if (type === 'notice' && !req.session.isAdmin) {
        return res.status(403).send('Forbidden: Access denied. Operators only.');
    }
    if (type === 'diary' && !req.session.user) {
        return res.status(401).send('Unauthorized: Please log in first.');
    }
    
    try {
        const imageUrl = getImageUrl(req, req.file) || req.body.imageUrl || null;
        const postData = {
            type,
            title,
            content,
            imageUrl,
            authorIp: req.ip,
            createdAt: Date.now()
        };
        
        if (type === 'diary') {
            postData.authorNickname = req.session.user.nickname;
            postData.authorId = req.session.user.id;
        } else {
            postData.authorNickname = 'Admin';
        }
        
        await db.collection('posts').add(postData);
        res.redirect(`/${type}`);
    } catch (err) {
        console.error('Error in POST /post/new:', err.stack || err);
        res.status(500).send('Error creating post');
    }
});

// Delete Post (Admin, or Author for diaries)
app.post('/post/:id/delete', async (req, res) => {
    try {
        const { redirectType } = req.body;
        const postId = req.params.id;
        
        const postDoc = await db.collection('posts').doc(postId).get();
        if (!postDoc.exists) {
            return res.status(404).send('Post not found');
        }
        
        const post = postDoc.data();
        let isAuthorized = false;
        
        if (req.session.isAdmin) {
            isAuthorized = true;
        } else if (req.session.user && (post.authorId === req.session.user.id || post.authorNickname === req.session.user.nickname)) {
            isAuthorized = true;
        } else if (post.type === 'community' && req.session.anonId && post.authorIp === req.session.anonId) {
            isAuthorized = true;
        }
        
        if (!isAuthorized) {
            return res.status(403).send('Forbidden: You are not authorized to delete this post.');
        }
        
        await db.collection('posts').doc(postId).delete();
        res.redirect(`/${redirectType || ''}`);
    } catch (err) {
        console.error('Error in POST /post/:id/delete:', err.stack || err);
        res.status(500).send('Error deleting post');
    }
});

// Update Introduction (Admin only)
app.post('/intro/update', requireAdmin, async (req, res) => {
    const { content } = req.body;
    try {
        await db.collection('config').doc('intro').set({
            content: content || '',
            updatedAt: Date.now()
        });
        res.redirect('/');
    } catch (err) {
        console.error('Error in POST /intro/update:', err.stack || err);
        res.status(500).send('Error updating introduction');
    }
});

// Community Post Creation (Anonymous + Multer Image Upload)
app.post('/community/new', upload.single('image'), async (req, res) => {
    const { title, content } = req.body;
    
    if (!content || content.trim() === '') {
        return res.status(400).send('Content is required');
    }
    
    try {
        let imageUrls = [];
        if (req.body.imageUrls) {
            try {
                imageUrls = JSON.parse(req.body.imageUrls);
            } catch (e) {
                if (typeof req.body.imageUrls === 'string') {
                    imageUrls = [req.body.imageUrls];
                }
            }
        }

        const imageUrl = getImageUrl(req, req.file) || req.body.imageUrl || (imageUrls.length > 0 ? imageUrls[0] : null);
        const postData = {
            type: 'community',
            title: title || '무제',
            content,
            imageUrl,
            imageUrls: imageUrls.length > 0 ? imageUrls : (imageUrl ? [imageUrl] : []),
            authorIp: req.session.anonId || '익명',
            createdAt: Date.now()
        };

        if (req.session.user) {
            postData.authorNickname = req.session.user.nickname;
            postData.authorId = req.session.user.id;
        } else if (req.session.isAdmin) {
            postData.authorNickname = '운영자';
        }

        await db.collection('posts').add(postData);
        res.redirect('/community');
    } catch (err) {
        console.error('Error in POST /community/new:', err.stack || err);
        res.status(500).send('Error submitting post');
    }
});

// Unified Add Comment / Reply (Notice, Diary, Community)
app.post('/post/:id/comment', upload.single('commentImage'), async (req, res) => {
    const { content, parentId, redirectType } = req.body;
    const postId = req.params.id;
    
    if ((!content || content.trim() === '') && !req.file) {
        return res.redirect(`/${redirectType || ''}`);
    }
    
    try {
        const imageUrl = getImageUrl(req, req.file) || null;
        const commentData = {
            postId,
            content: content || '',
            imageUrl,
            authorIp: req.session.anonId || '익명',
            createdAt: Date.now()
        };

        if (parentId && parentId.trim() !== '') {
            commentData.parentId = parentId.trim();
        }

        if (req.session.user) {
            commentData.authorNickname = req.session.user.nickname;
            commentData.authorId = req.session.user.id;
        } else if (req.session.isAdmin) {
            commentData.authorNickname = '운영자';
        }

        await db.collection('comments').add(commentData);
        res.redirect(`/${redirectType || ''}`);
    } catch (err) {
        console.error('Error in POST /post/:id/comment:', err.stack || err);
        res.status(500).send('Error adding comment');
    }
});

// Legacy route fallback redirecting to the unified one
app.post('/community/:id/comment', async (req, res) => {
    req.body.redirectType = 'community';
    res.redirect(307, `/post/${req.params.id}/comment`);
});

// Delete Comment/Reply (Owner or Admin)
app.post('/comment/:id/delete', async (req, res) => {
    const commentId = req.params.id;
    const { redirectType } = req.body;
    
    try {
        const commentDoc = await db.collection('comments').doc(commentId).get();
        if (!commentDoc.exists) {
            return res.status(404).send('Comment not found');
        }
        
        const comment = commentDoc.data();
        let isAuthorized = false;
        
        if (req.session.isAdmin) {
            isAuthorized = true;
        } else if (req.session.user && comment.authorId === req.session.user.id) {
            isAuthorized = true;
        } else if (!comment.authorId && req.session.anonId && comment.authorIp === req.session.anonId) {
            isAuthorized = true;
        }
        
        if (!isAuthorized) {
            return res.status(403).send('Forbidden: You are not authorized to delete this comment.');
        }
        
        // Delete the main comment
        await db.collection('comments').doc(commentId).delete();
        
        // Cascade delete child replies
        const childSnap = await db.collection('comments')
            .where('parentId', '==', commentId)
            .get();
        for (const doc of childSnap.docs) {
            await db.collection('comments').doc(doc.id).delete();
        }
        
        res.redirect(`/${redirectType || ''}`);
    } catch (err) {
        console.error('Error in POST /comment/:id/delete:', err.stack || err);
        res.status(500).send('Error deleting comment');
    }
});

// ----------------------------------------------------
// REAL-TIME CHAT (SIDEBAR ECHOES)
// ----------------------------------------------------

// Get chat messages (supports cursor-based polling via since timestamp)
app.get('/chat/messages', async (req, res) => {
    try {
        const since = req.query.since ? parseInt(req.query.since, 10) : null;
        
        if (since && !isNaN(since)) {
            // Fetch only new messages since the last received message timestamp
            const snapshot = await db.collection('chat')
                .where('createdAt', '>', since)
                .orderBy('createdAt', 'asc')
                .limit(50)
                .get();
            const newMsgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            return res.json(newMsgs);
        } else {
            // Initial load: fetch latest 20 messages, ordering by createdAt descending
            const snapshot = await db.collection('chat')
                .orderBy('createdAt', 'desc')
                .limit(20)
                .get();
            
            const rawMsgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const latest20 = rawMsgs.reverse(); // Display chronologically
            return res.json(latest20);
        }
    } catch (err) {
        console.error('Error fetching chat messages:', err.stack || err);
        res.status(500).json({ error: 'Database Error' });
    }
});

// Send a new chat message (anonymous with masked IP and 24h TTL field)
app.post('/chat/send', async (req, res) => {
    const { content } = req.body;
    if (!content || content.trim() === '') {
        return res.status(400).json({ error: 'Content is required' });
    }
    try {
        const createdAt = Date.now();
        // TTL policy helper: expiration set to 24 hours in the future
        const expireAt = createdAt + 24 * 60 * 60 * 1000;
        
        const chatData = {
            content: content.substring(0, 100),
            authorIp: req.session.anonId || '익명',
            createdAt,
            expireAt
        };

        if (req.session.user) {
            chatData.authorNickname = req.session.user.nickname;
        } else if (req.session.isAdmin) {
            chatData.authorNickname = '운영자';
        }

        await db.collection('chat').add(chatData);
        res.json({ success: true });
    } catch (err) {
        console.error('Error in POST /chat/send:', err.stack || err);
        res.status(500).json({ error: 'Database Error' });
    }
});

// ----------------------------------------------------
// ADMIN AUTHENTICATION
// ----------------------------------------------------
app.get('/admin', (req, res) => {
    res.render('login', { error: null });
});

app.post('/admin', (req, res) => {
    const { password } = req.body;
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password === adminPassword) {
        req.session.isAdmin = true;
        req.session.createdAt = Date.now();
        req.saveSession();
        res.redirect('/');
    } else {
        res.render('login', { error: '잘못된 비밀번호입니다. 심연의 접근이 거부되었습니다.' });
    }
});

app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/diary');
    }
    res.render('user_login', { error: null, success: null });
});

app.post('/login', async (req, res) => {
    const { nickname, password } = req.body;
    if (!nickname || !password) {
        return res.render('user_login', { error: '닉네임과 비밀번호를 모두 입력해주세요.', success: null });
    }
    
    try {
        const trimmedNickname = nickname.trim();
        const userSnap = await db.collection('users')
            .where('nickname', '==', trimmedNickname)
            .get();
            
        if (userSnap.docs.length === 0) {
            return res.render('user_login', { error: '존재하지 않는 닉네임입니다.', success: null });
        }
        
        const user = userSnap.docs[0].data();
        const userId = userSnap.docs[0].id;
        const hashedPassword = hashPassword(password);
        
        if (user.password !== hashedPassword) {
            return res.render('user_login', { error: '비밀번호가 일치하지 않습니다.', success: null });
        }
        
        req.session.user = {
            id: userId,
            nickname: user.nickname
        };
        req.session.createdAt = Date.now();
        req.saveSession();
        
        res.redirect('/diary');
    } catch (err) {
        console.error('Error in POST /login:', err);
        res.render('user_login', { error: '로그인 중 서버 오류가 발생했습니다.', success: null });
    }
});

app.post('/signup', async (req, res) => {
    const { nickname, password } = req.body;
    if (!nickname || !password) {
        return res.render('user_login', { error: '닉네임과 비밀번호를 모두 입력해주세요.', success: null });
    }
    
    try {
        const trimmedNickname = nickname.trim();
        if (trimmedNickname.length < 2 || trimmedNickname.length > 15) {
            return res.render('user_login', { error: '닉네임은 2자 이상 15자 이하여야 합니다.', success: null });
        }
        
        const userSnap = await db.collection('users')
            .where('nickname', '==', trimmedNickname)
            .get();
            
        if (userSnap.docs.length > 0) {
            return res.render('user_login', { error: '이미 존재하는 닉네임입니다.', success: null });
        }
        
        const hashedPassword = hashPassword(password);
        await db.collection('users').add({
            nickname: trimmedNickname,
            password: hashedPassword,
            createdAt: Date.now()
        });
        
        res.render('user_login', { error: null, success: '회원가입이 완료되었습니다. 로그인해 주세요!' });
    } catch (err) {
        console.error('Error in POST /signup:', err);
        res.render('user_login', { error: '회원가입 중 서버 오류가 발생했습니다.', success: null });
    }
});

app.get('/logout', (req, res) => {
    // Delete the __session cookie
    res.setHeader('Set-Cookie', `__session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    res.redirect('/');
});

// ----------------------------------------------------
// USER PROFILE
// ----------------------------------------------------
app.get('/profile', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.redirect(`/profile/${req.session.user.id}`);
});

app.get('/profile/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists) {
            return res.status(404).send('User not found');
        }
        
        const userData = userDoc.data();
        
        // Fetch all posts to filter in memory (safeguard against complex GCP index errors)
        const postsSnap = await db.collection('posts').get();
        const allPosts = postsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const userPosts = allPosts
            .filter(post => post.authorId === userId || (post.authorNickname && post.authorNickname === userData.nickname))
            .sort((a, b) => b.createdAt - a.createdAt);
            
        // Pagination logic for user's posts
        const currentPage = parseInt(req.query.page) || 1;
        const limit = 5; // 5 posts per page
        const totalPosts = userPosts.length;
        const totalPages = Math.ceil(totalPosts / limit) || 1;
        
        // Safe bounds for currentPage
        const page = Math.max(1, Math.min(currentPage, totalPages));
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        
        const paginatedPosts = userPosts.slice(startIndex, endIndex);
            
        const isOwnProfile = (req.session.user && req.session.user.id === userId) ? true : false;
        
        res.render('profile', { 
            userData: { id: userId, ...userData }, 
            userPosts: paginatedPosts, 
            isOwnProfile,
            currentPage: page,
            totalPages
        });
    } catch (err) {
        console.error('Error in GET /profile/:id:', err.stack || err);
        res.status(500).send('Database Error');
    }
});

app.post('/profile/update', upload.single('profilePic'), async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Unauthorized');
    }
    
    try {
        const updateData = {};
        if (req.file) {
            const imageUrl = getImageUrl(req, req.file);
            updateData.profilePictureUrl = imageUrl;
            // Update session so header can show it immediately
            req.session.user.profilePictureUrl = imageUrl;
        }
        
        const { bio } = req.body;
        if (typeof bio === 'string') {
            updateData.bio = bio.trim();
            req.session.user.bio = bio.trim();
        }
        
        if (Object.keys(updateData).length > 0) {
            await db.collection('users').doc(req.session.user.id).update(updateData);
            req.saveSession();
        }
        
        res.redirect('/profile');
    } catch (err) {
        console.error('Error in POST /profile/update:', err.stack || err);
        res.status(500).send('Error updating profile');
    }
});


// Start Server
app.listen(PORT, () => {
    console.log(`DarkBrood server is creeping on port ${PORT}...`);
});
