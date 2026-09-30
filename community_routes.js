// community_routes.js — Community Routes
// Usage in main.js: app.use('/api', require('./community_routes')(pool, authenticateToken));

const express = require('express');

module.exports = (pool, authenticateToken) => {
    const router = express.Router();

    // ─── Helpers ────────────────────────────────────────────────────────────

    // Extract username from email (part before @)
    const USERNAME_EXPR = `SPLIT_PART(u.email, '@', 1)`;

    // ─── Comments: GET /api/comments/:problemId ──────────────────────────────

    router.get('/comments/:problemId', async (req, res) => {
        try {
            const { problemId } = req.params;
            const result = await pool.query(`
                SELECT
                    c.id,
                    c.content,
                    c.created_at,
                    c.user_id,
                    ${USERNAME_EXPR} AS username,
                    u.avatar_url
                FROM comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.problem_id = $1
                ORDER BY c.created_at DESC
                LIMIT 50
            `, [problemId]);
            res.json(result.rows);
        } catch (err) {
            console.error('GET /comments error:', err);
            res.status(500).json({ error: 'Failed to fetch comments.' });
        }
    });

    // ─── Comments: POST /api/comments/:problemId (auth required) ────────────

    router.post('/comments/:problemId', authenticateToken, async (req, res) => {
        try {
            const { problemId } = req.params;
            const { content } = req.body;
            const userId = req.user.userId;

            if (!content || content.trim().length === 0)
                return res.status(400).json({ error: 'Comment cannot be empty.' });
            if (content.trim().length > 500)
                return res.status(400).json({ error: 'Comment too long (max 500 chars).' });

            // Verify problem exists
            const probCheck = await pool.query('SELECT id FROM problems WHERE id = $1', [problemId]);
            if (probCheck.rows.length === 0)
                return res.status(404).json({ error: 'Problem not found.' });

            const insert = await pool.query(
                `INSERT INTO comments (user_id, problem_id, content)
                 VALUES ($1, $2, $3)
                 RETURNING id, content, created_at, user_id`,
                [userId, problemId, content.trim()]
            );

            const userRow = await pool.query(
                `SELECT ${USERNAME_EXPR} AS username, avatar_url FROM users WHERE id = $1`,
                [userId]
            );

            res.json({
                ...insert.rows[0],
                username: userRow.rows[0].username,
                avatar_url: userRow.rows[0].avatar_url,
            });
        } catch (err) {
            console.error('POST /comments error:', err);
            res.status(500).json({ error: 'Failed to post comment.' });
        }
    });

    // ─── Comments: DELETE /api/comments/:commentId (own only) ───────────────

    router.delete('/comments/:commentId', authenticateToken, async (req, res) => {
        try {
            const { commentId } = req.params;
            const userId = req.user.userId;

            const result = await pool.query(
                'DELETE FROM comments WHERE id = $1 AND user_id = $2 RETURNING id',
                [commentId, userId]
            );

            if (result.rows.length === 0)
                return res.status(404).json({ error: 'Comment not found or not yours.' });

            res.json({ message: 'Deleted.' });
        } catch (err) {
            console.error('DELETE /comments error:', err);
            res.status(500).json({ error: 'Failed to delete comment.' });
        }
    });

    // ─── Leaderboard: GET /api/leaderboard ──────────────────────────────────

    router.get('/leaderboard', async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    ${USERNAME_EXPR} AS username,
                    u.avatar_url,
                    u.created_at,
                    COUNT(DISTINCT s.problem_id)::int  AS problems_solved,
                    COUNT(s.id)::int                   AS total_ac
                FROM users u
                LEFT JOIN submissions s
                    ON u.id = s.user_id AND s.verdict = 'AC'
                GROUP BY u.id, u.email, u.avatar_url, u.created_at
                ORDER BY problems_solved DESC, total_ac ASC, u.created_at ASC
                LIMIT 25
            `);
            res.json(result.rows);
        } catch (err) {
            console.error('GET /leaderboard error:', err);
            res.status(500).json({ error: 'Failed to fetch leaderboard.' });
        }
    });

    // ─── Activity Feed: GET /api/feed ────────────────────────────────────────

    router.get('/feed', async (req, res) => {
        try {
            const result = await pool.query(`
                SELECT
                    s.id,
                    s.verdict,
                    s.execution_time,
                    s.created_at,
                    p.title     AS problem_title,
                    p.slug      AS problem_slug,
                    p.difficulty,
                    ${USERNAME_EXPR} AS username
                FROM submissions s
                JOIN problems p ON s.problem_id = p.id
                JOIN users   u ON s.user_id    = u.id
                WHERE s.verdict NOT IN ('PENDING')
                ORDER BY s.created_at DESC
                LIMIT 30
            `);
            res.json(result.rows);
        } catch (err) {
            console.error('GET /feed error:', err);
            res.status(500).json({ error: 'Failed to fetch feed.' });
        }
    });

    // ─── Platform Stats: GET /api/stats ─────────────────────────────────────

    router.get('/stats', async (req, res) => {
        try {
            const [usersRes, subsRes, solvedRes, problemsRes] = await Promise.all([
                pool.query('SELECT COUNT(*)::int AS count FROM users'),
                pool.query("SELECT COUNT(*)::int AS count FROM submissions WHERE verdict != 'PENDING'"),
                pool.query(`
                    SELECT COUNT(*)::int AS count
                    FROM (
                        SELECT DISTINCT user_id, problem_id
                        FROM submissions WHERE verdict = 'AC'
                    ) t
                `),
                pool.query('SELECT COUNT(*)::int AS count FROM problems'),
            ]);
            res.json({
                totalUsers:       usersRes.rows[0].count,
                totalSubmissions: subsRes.rows[0].count,
                totalSolved:      solvedRes.rows[0].count,
                totalProblems:    problemsRes.rows[0].count,
            });
        } catch (err) {
            console.error('GET /stats error:', err);
            res.status(500).json({ error: 'Failed to fetch stats.' });
        }
    });

    // ─── Posts: GET /api/posts ───────────────────────────────────────────────

    router.get('/posts', async (req, res) => {
        try {
            // Extract userId from token if present (optional auth)
            let currentUserId = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
                    currentUserId = decoded.userId;
                } catch {}
            }
            // Support optional search query param
            const searchTerm = req.query.search?.trim();
            const whereClause = searchTerm
                ? `WHERE p.title ILIKE $1 OR p.content ILIKE $1 OR ${USERNAME_EXPR} ILIKE $1`
                : '';
            const queryParams = searchTerm ? [`%${searchTerm}%`] : [];

            const result = await pool.query(`
                SELECT
                    p.id,
                    p.title,
                    p.content,
                    p.created_at,
                    p.user_id,
                    ${USERNAME_EXPR} AS username,
                    u.avatar_url,
                    COALESCE(SUM(CASE WHEN pv.value =  1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
                    COALESCE(SUM(CASE WHEN pv.value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
                FROM posts p
                JOIN users u ON p.user_id = u.id
                LEFT JOIN post_votes pv ON pv.post_id = p.id
                ${whereClause}
                GROUP BY p.id, p.title, p.content, p.created_at, p.user_id, u.email, u.avatar_url
                ORDER BY p.created_at DESC
                LIMIT 50
            `, queryParams);

            // Attach current user's vote if logged in
            let userVotes = {};
            if (currentUserId) {
                const votesRes = await pool.query(
                    'SELECT post_id, value FROM post_votes WHERE user_id = $1',
                    [currentUserId]
                );
                votesRes.rows.forEach(v => { userVotes[v.post_id] = v.value; });
            }

            const posts = result.rows.map(p => ({
                ...p,
                score: p.upvotes - p.downvotes,
                user_vote: userVotes[p.id] || null,
            }));

            res.json(posts);
        } catch (err) {
            console.error('GET /posts error:', err);
            res.status(500).json({ error: 'Failed to fetch posts.' });
        }
    });

    // ─── Posts: GET /api/posts/:id (single post) ────────────────────────────

    router.get('/posts/:id', async (req, res) => {
        try {
            const { id } = req.params;

            // Optional auth for user_vote
            let currentUserId = null;
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                try {
                    const jwt = require('jsonwebtoken');
                    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
                    currentUserId = decoded.userId;
                } catch {}
            }

            const result = await pool.query(`
                SELECT
                    p.id,
                    p.title,
                    p.content,
                    p.created_at,
                    p.user_id,
                    ${USERNAME_EXPR} AS username,
                    u.avatar_url,
                    COALESCE(SUM(CASE WHEN pv.value =  1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
                    COALESCE(SUM(CASE WHEN pv.value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
                FROM posts p
                JOIN users u ON p.user_id = u.id
                LEFT JOIN post_votes pv ON pv.post_id = p.id
                WHERE p.id = $1
                GROUP BY p.id, p.title, p.content, p.created_at, p.user_id, u.email, u.avatar_url
            `, [id]);

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Post not found.' });
            }

            const post = result.rows[0];
            let userVote = null;
            if (currentUserId) {
                const voteRes = await pool.query(
                    'SELECT value FROM post_votes WHERE user_id = $1 AND post_id = $2',
                    [currentUserId, id]
                );
                if (voteRes.rows.length > 0) userVote = voteRes.rows[0].value;
            }

            res.json({
                ...post,
                score: post.upvotes - post.downvotes,
                user_vote: userVote,
            });
        } catch (err) {
            console.error('GET /posts/:id error:', err);
            res.status(500).json({ error: 'Failed to fetch post.' });
        }
    });

    // ─── Posts: POST /api/posts (auth required) ─────────────────────────────

    router.post('/posts', authenticateToken, async (req, res) => {
        try {
            const { title, content } = req.body;
            const userId = req.user.userId;

            if (!title || title.trim().length === 0)
                return res.status(400).json({ error: 'Title cannot be empty.' });
            if (title.trim().length > 200)
                return res.status(400).json({ error: 'Title too long (max 200 chars).' });
            if (!content || content.trim().length === 0)
                return res.status(400).json({ error: 'Content cannot be empty.' });
            if (content.trim().length > 5000)
                return res.status(400).json({ error: 'Content too long (max 5000 chars).' });

            const insert = await pool.query(
                `INSERT INTO posts (user_id, title, content)
                 VALUES ($1, $2, $3)
                 RETURNING id, title, content, created_at, user_id`,
                [userId, title.trim(), content.trim()]
            );

            const userRow = await pool.query(
                `SELECT ${USERNAME_EXPR} AS username, avatar_url FROM users WHERE id = $1`,
                [userId]
            );

            res.json({
                ...insert.rows[0],
                username: userRow.rows[0].username,
                avatar_url: userRow.rows[0].avatar_url,
                upvotes: 0,
                downvotes: 0,
                score: 0,
                user_vote: null,
            });
        } catch (err) {
            console.error('POST /posts error:', err);
            res.status(500).json({ error: 'Failed to create post.' });
        }
    });

    // ─── Posts: DELETE /api/posts/:id (own only) ────────────────────────────

    router.delete('/posts/:id', authenticateToken, async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.userId;

            const result = await pool.query(
                'DELETE FROM posts WHERE id = $1 AND user_id = $2 RETURNING id',
                [id, userId]
            );

            if (result.rows.length === 0)
                return res.status(404).json({ error: 'Post not found or not yours.' });

            res.json({ message: 'Deleted.' });
        } catch (err) {
            console.error('DELETE /posts error:', err);
            res.status(500).json({ error: 'Failed to delete post.' });
        }
    });

    // ─── Posts: POST /api/posts/:id/vote (auth required) ────────────────────

    router.post('/posts/:id/vote', authenticateToken, async (req, res) => {
        try {
            const postId = req.params.id;
            const userId = req.user.userId;
            const { value } = req.body; // +1 or -1

            if (value !== 1 && value !== -1)
                return res.status(400).json({ error: 'Vote value must be 1 or -1.' });

            // Check if user already voted
            const existing = await pool.query(
                'SELECT id, value FROM post_votes WHERE user_id = $1 AND post_id = $2',
                [userId, postId]
            );

            let userVote = null;

            if (existing.rows.length > 0) {
                if (existing.rows[0].value === value) {
                    // Same vote again → remove (toggle off)
                    await pool.query('DELETE FROM post_votes WHERE id = $1', [existing.rows[0].id]);
                    userVote = null;
                } else {
                    // Different vote → update
                    await pool.query('UPDATE post_votes SET value = $1 WHERE id = $2', [value, existing.rows[0].id]);
                    userVote = value;
                }
            } else {
                // New vote
                await pool.query(
                    'INSERT INTO post_votes (user_id, post_id, value) VALUES ($1, $2, $3)',
                    [userId, postId, value]
                );
                userVote = value;
            }

            // Return updated counts
            const counts = await pool.query(`
                SELECT
                    COALESCE(SUM(CASE WHEN value =  1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
                    COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
                FROM post_votes WHERE post_id = $1
            `, [postId]);

            const { upvotes, downvotes } = counts.rows[0];

            res.json({
                upvotes,
                downvotes,
                score: upvotes - downvotes,
                user_vote: userVote,
            });
        } catch (err) {
            console.error('POST /posts/:id/vote error:', err);
            res.status(500).json({ error: 'Failed to vote.' });
        }
    });

    return router;
};
