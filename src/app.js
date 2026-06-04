require('dotenv').config();
const express = require('express');
const session = require('cookie-session');
const path = require('path');
const db = require('./db');
const { upload, getImageUrl } = require('./storage');

const app = express();
const PORT = process.env.PORT || 8080;

// Enable trusting reverse proxy headers (crucial for secure cookies behind Firebase Hosting proxy)
app.set('trust proxy', 1);

// Setup session
app.use(session({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'dark_solitude_secret_key'],
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

// Setup views and static folders
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Pass session variables to EJS templates globally
app.use((req, res, next) => {
    res.locals.isAdmin = req.session.isAdmin || false;
    res.locals.path = req.path;
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

// ----------------------------------------------------
// ROUTES
// ----------------------------------------------------

// Home (Notice list as dashboard)
app.get('/', async (req, res) => {
    try {
        const noticesSnap = await db.collection('posts')
            .where('type', '==', 'notice')
            .orderBy('createdAt', 'desc')
            .get();
        
        const notices = noticesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
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
        
        const posts = diarySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.render('diary', { posts });
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
        
        const notices = noticesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.render('notice', { notices });
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
        
        const allPosts = communitySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
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
        
        // Fetch comments for all posts
        const allCommentsSnap = await db.collection('comments')
            .orderBy('createdAt', 'asc')
            .get();
        const allComments = allCommentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Map comments to posts
        posts.forEach(post => {
            post.comments = allComments.filter(comment => comment.postId === post.id);
        });

        res.render('community', { 
            posts, 
            currentPage: page, 
            totalPages 
        });
    } catch (err) {
        console.error('Error in GET /community:', err.stack || err);
        res.status(500).send('Database Error');
    }
});

// Post creation for Diary & Notice (Admin only)
app.post('/post/new', requireAdmin, async (req, res) => {
    const { type, title, content } = req.body;
    if (!['diary', 'notice'].includes(type)) {
        return res.status(400).send('Invalid post type');
    }
    
    try {
        await db.collection('posts').add({
            type,
            title,
            content,
            imageUrl: null,
            authorIp: req.ip,
            createdAt: Date.now()
        });
        res.redirect(`/${type}`);
    } catch (err) {
        console.error('Error in POST /post/new:', err.stack || err);
        res.status(500).send('Error creating post');
    }
});

// Delete Post (Admin only)
app.post('/post/:id/delete', requireAdmin, async (req, res) => {
    try {
        const { redirectType } = req.body;
        await db.collection('posts').doc(req.params.id).delete();
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
        const imageUrl = getImageUrl(req, req.file);
        
        // Simple IP masking for anonymity representation
        const ipParts = req.ip.split('.');
        const maskedIp = ipParts.length >= 2 ? `${ipParts[0]}.${ipParts[1]}.xxx.xxx` : '익명';

        await db.collection('posts').add({
            type: 'community',
            title: title || '무제',
            content,
            imageUrl,
            authorIp: maskedIp,
            createdAt: Date.now()
        });
        res.redirect('/community');
    } catch (err) {
        console.error('Error in POST /community/new:', err.stack || err);
        res.status(500).send('Error submitting post');
    }
});

// Add Comment (Anonymous)
app.post('/community/:id/comment', async (req, res) => {
    const { content } = req.body;
    const postId = req.params.id;
    
    if (!content || content.trim() === '') {
        return res.redirect('/community');
    }
    
    try {
        const ipParts = req.ip.split('.');
        const maskedIp = ipParts.length >= 2 ? `${ipParts[0]}.${ipParts[1]}.xxx.xxx` : '익명';

        await db.collection('comments').add({
            postId,
            content,
            authorIp: maskedIp,
            createdAt: Date.now()
        });
        res.redirect('/community');
    } catch (err) {
        console.error('Error in POST /community/:id/comment:', err.stack || err);
        res.status(500).send('Error adding comment');
    }
});

// ----------------------------------------------------
// REAL-TIME CHAT (SIDEBAR ECHOES)
// ----------------------------------------------------

// Get latest 20 chat messages
app.get('/chat/messages', async (req, res) => {
    try {
        const snapshot = await db.collection('chat')
            .orderBy('createdAt', 'desc')
            .get();
        
        const rawMsgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Slicing first 20 and reversing to chronological order
        const latest20 = rawMsgs.slice(0, 20).reverse();
        res.json(latest20);
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
        const ipParts = req.ip.split('.');
        const maskedIp = ipParts.length >= 2 ? `${ipParts[0]}.${ipParts[1]}.xxx.xxx` : '익명';
        
        const createdAt = Date.now();
        // TTL policy helper: expiration set to 24 hours in the future
        const expireAt = createdAt + 24 * 60 * 60 * 1000;
        
        await db.collection('chat').add({
            content: content.substring(0, 100),
            authorIp: maskedIp,
            createdAt,
            expireAt
        });
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
        res.redirect('/');
    } else {
        res.render('login', { error: '잘못된 비밀번호입니다. 심연의 접근이 거부되었습니다.' });
    }
});

app.get('/login', (req, res) => {
    res.redirect('/admin');
});

app.get('/logout', (req, res) => {
    req.session = null;
    res.redirect('/');
});

// Start Server
app.listen(PORT, () => {
    console.log(`DarkBrood server is creeping on port ${PORT}...`);
});
