require('dotenv').config(); 
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const pool = require('./db'); 
const authRoutes = require('./auth');
const multer = require('multer');
const path = require('path');
const { judgeQueue } = require('./queue');
const { startJudgeWorker } = require('./worker');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' } // Restrict to actual frontend domain before public release
});

app.use(cors());
app.use(express.json()); 
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'eceforces_avatars',
        allowed_formats: ['jpg', 'png', 'jpeg', 'webp']
    }
});
const upload = multer({ storage: storage });

// Auth routes (Signup / Login)
app.use('/api/auth', authRoutes);

app.get('/api/ping', (req, res) => {
    res.json({ message: "ECEForces Server is LIVE." });
});

// Fetch all problems
app.get('/api/problems', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM problems');
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to connect to database." });
    }
});

// Get solved problem IDs for the logged-in user (optional auth — returns empty if not logged in)
app.get('/api/user/solved', async (req, res) => {
    // Optional auth: try to extract user but don't fail if not present
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.json({ solvedIds: [] });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const result = await pool.query(
            'SELECT DISTINCT problem_id FROM submissions WHERE user_id = $1 AND verdict = $2',
            [decoded.userId, 'AC']
        );
        res.json({ solvedIds: result.rows.map(r => r.problem_id) });
    } catch {
        res.json({ solvedIds: [] });
    }
});

// Fetch single problem by slug
app.get('/api/problems/:slug', async (req, res) => {
    try {
        const { slug } = req.params;
        const result = await pool.query('SELECT * FROM problems WHERE slug = $1', [slug]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Problem not found" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Database error" });
    }
});

// Socket.io — after submission, client subscribes to its submission room for real-time verdict
io.on('connection', (socket) => {
    socket.on('subscribe', (submissionId) => {
        if (submissionId) socket.join(`submission:${submissionId}`);
    });
});

// Auth middleware: verify JWT token
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Extract token from Bearer header
    
    if (!token) return res.status(401).json({ error: "Access denied. Login required!" });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Invalid or expired token!" });
        req.user = user; // Attach user payload to request
        next();
    });
};

// Per-user rate limit — 1 submission / 10 seconds
const submitLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 1,
    keyGenerator: (req) => req.user?.userId?.toString() || ipKeyGenerator(req),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many submissions — please wait 10 seconds before trying again." },
});

// Queue-based submission: returns immediately, judging happens via background worker
app.post('/api/submit', authenticateToken, submitLimiter, async (req, res) => {
    const { code, problemSlug } = req.body;
    const userId = req.user.userId;
    
    if (!code || !problemSlug) {
        return res.status(400).json({ error: "Both code and problemSlug are required." });
    }

    try {
        const probRes = await pool.query('SELECT id FROM problems WHERE slug = $1', [problemSlug]);
        if (probRes.rows.length === 0) {
            return res.status(404).json({ error: "Problem not found in database!" });
        }
        const problemId = probRes.rows[0].id;

        // Insert PENDING submission row — the returned ID is used by the frontend to subscribe via socket
        const insertRes = await pool.query(
            'INSERT INTO submissions (user_id, problem_id, code, verdict, execution_time) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [userId, problemId, code, 'PENDING', 0]
        );
        const submissionId = insertRes.rows[0].id;

        // Add job to queue — background worker will pick it up
        await judgeQueue.add('judge', { submissionId, code, problemSlug });

        console.log(`Queued submission #${submissionId} for: ${problemSlug} by User ID: ${userId}`);

        res.json({ submissionId, verdict: 'PENDING', status: 'queued' });
    } catch (error) {
        console.error("Submission error:", error);
        res.status(500).json({ error: "Server error during submission process." });
    }
});

// Polling fallback for submission status
app.get('/api/submissions/:id/status', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;

    try {
        const result = await pool.query(
            'SELECT id, verdict, execution_time FROM submissions WHERE id = $1 AND user_id = $2',
            [id, userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Submission not found." });
        }
        res.json(result.rows[0]);
    } catch (error) {
        console.error("Error fetching submission status:", error);
        res.status(500).json({ error: "Server error." });
    }
});

app.get('/api/submissions', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    try {
        const result = await pool.query(`
            SELECT 
                s.id, 
                s.verdict, 
                s.execution_time, 
                s.created_at, 
                p.title, 
                p.slug 
            FROM submissions s
            JOIN problems p ON s.problem_id = p.id
            WHERE s.user_id = $1
            ORDER BY s.created_at DESC
        `, [userId]);

        res.json(result.rows);
    } catch (error) {
        console.error("Error fetching submissions:", error);
        res.status(500).json({ error: "Server error while fetching submissions." });
    }
});

app.get('/api/profile', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    try {
        const userRes = await pool.query('SELECT email, created_at, avatar_url FROM users WHERE id = $1', [userId]);
        
        const heatmapRes = await pool.query(`
            SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(DISTINCT problem_id) as count
            FROM submissions
            WHERE user_id = $1 AND verdict = 'AC'
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
            ORDER BY date ASC
        `, [userId]);

        const totalSolvedRes = await pool.query(`
            SELECT COUNT(DISTINCT problem_id) as total_solved
            FROM submissions
            WHERE user_id = $1 AND verdict = 'AC'
        `, [userId]);

        // Contribution = net votes received on user's posts
        const contribRes = await pool.query(`
            SELECT COALESCE(SUM(pv.value), 0)::int AS contribution
            FROM post_votes pv
            JOIN posts p ON pv.post_id = p.id
            WHERE p.user_id = $1
        `, [userId]);

        res.json({
            email: userRes.rows[0].email,
            joinedAt: userRes.rows[0].created_at,
            avatarUrl: userRes.rows[0].avatar_url,
            totalSolved: parseInt(totalSolvedRes.rows[0].total_solved || 0),
            contribution: contribRes.rows[0].contribution,
            heatmapData: heatmapRes.rows
        });
    } catch (error) {
        console.error("Error fetching profile:", error);
        res.status(500).json({ error: "Server error while fetching profile." });
    }
});

// Public profile by username (no auth required)
app.get('/api/profile/:username', async (req, res) => {
    const { username } = req.params;

    try {
        // Username = part before @ in email
        const userRes = await pool.query(
            `SELECT id, email, created_at, avatar_url FROM users WHERE SPLIT_PART(email, '@', 1) = $1`,
            [username]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const user = userRes.rows[0];
        const userId = user.id;

        const heatmapRes = await pool.query(`
            SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(DISTINCT problem_id) as count
            FROM submissions
            WHERE user_id = $1 AND verdict = 'AC'
            GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
            ORDER BY date ASC
        `, [userId]);

        const totalSolvedRes = await pool.query(`
            SELECT COUNT(DISTINCT problem_id) as total_solved
            FROM submissions
            WHERE user_id = $1 AND verdict = 'AC'
        `, [userId]);

        const contribRes = await pool.query(`
            SELECT COALESCE(SUM(pv.value), 0)::int AS contribution
            FROM post_votes pv
            JOIN posts p ON pv.post_id = p.id
            WHERE p.user_id = $1
        `, [userId]);

        res.json({
            username: username,
            email: user.email,
            joinedAt: user.created_at,
            avatarUrl: user.avatar_url,
            totalSolved: parseInt(totalSolvedRes.rows[0].total_solved || 0),
            contribution: contribRes.rows[0].contribution,
            heatmapData: heatmapRes.rows
        });
    } catch (error) {
        console.error("Error fetching public profile:", error);
        res.status(500).json({ error: "Server error while fetching profile." });
    }
});

app.post('/api/profile/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    const userId = req.user.userId;
    
    if (!req.file) {
        return res.status(400).json({ error: "No image provided." });
    }

    try {
        const avatarUrl = req.file.path; // Cloudinary URL
        await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);
        res.json({ message: "Avatar updated successfully", avatarUrl: avatarUrl });
    } catch (error) {
        console.error("Error updating avatar:", error);
        res.status(500).json({ error: "Failed to update avatar." });
    }
});

// Avatar Delete Endpoint
app.delete('/api/profile/avatar', authenticateToken, async (req, res) => {
    const userId = req.user.userId;

    try {
        const userRes = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [userId]);
        const avatarUrl = userRes.rows[0]?.avatar_url;

        if (avatarUrl) {
            const parts = avatarUrl.split('/');
            const filenameWithExt = parts[parts.length - 1];
            const publicId = `eceforces_avatars/${filenameWithExt.split('.')[0]}`;
            
            try {
                await cloudinary.uploader.destroy(publicId);
            } catch(e) {
                console.error("Cloudinary destroy error:", e);
            }
        }

        await pool.query('UPDATE users SET avatar_url = NULL WHERE id = $1', [userId]);
        res.json({ message: "Avatar removed successfully" });
    } catch (error) {
        console.error("Error deleting avatar:", error);
        res.status(500).json({ error: "Failed to remove avatar." });
    }
});

// ─── Admin Routes ───────────────────────────────────────────────────────────
// Problem CRUD for admin users (requires ADMIN_EMAILS in .env)
const adminRoutes = require('./admin_routes')(pool, authenticateToken);
app.use('/api/admin', adminRoutes);

// ─── Community Routes ───────────────────────────────────────────────────────
// Stats, Feed, Leaderboard, Comments APIs
const communityRoutes = require('./community_routes')(pool, authenticateToken);
app.use('/api', communityRoutes);

// Start judge worker in-process (no separate service needed)
startJudgeWorker(io);

// Listen on PORT (using server.listen for Socket.io compatibility)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});