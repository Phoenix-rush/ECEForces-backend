// admin_routes.js — Admin panel API routes
// Usage in main.js: app.use('/api/admin', require('./admin_routes')(pool, authenticateToken));

const express = require('express');

// Admin emails loaded from ADMIN_EMAILS env var (comma-separated)
// Example: ADMIN_EMAILS=pushkar@bitmesra.ac.in,admin@eceforces.com
const getAdminEmails = () => {
    const raw = process.env.ADMIN_EMAILS || '';
    return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
};

const isAdmin = (req, res, next) => {
    const adminEmails = getAdminEmails();
    if (adminEmails.length === 0) {
        return res.status(403).json({ error: 'No admin emails configured. Set ADMIN_EMAILS in .env' });
    }
    if (!adminEmails.includes(req.user.email.toLowerCase())) {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
};

module.exports = (pool, authenticateToken) => {
    const router = express.Router();

    // All admin routes require auth + admin check
    router.use(authenticateToken, isAdmin);

    // ─── GET /api/admin/problems — list all problems ────────────────────────

    router.get('/problems', async (req, res) => {
        try {
            const result = await pool.query(
                'SELECT id, slug, title, difficulty, tags, created_at FROM problems ORDER BY id ASC'
            );
            res.json(result.rows);
        } catch (err) {
            console.error('Admin GET /problems error:', err);
            res.status(500).json({ error: 'Failed to fetch problems.' });
        }
    });

    // ─── GET /api/admin/problems/:id — single problem with all fields ───────

    router.get('/problems/:id', async (req, res) => {
        try {
            const result = await pool.query('SELECT * FROM problems WHERE id = $1', [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Problem not found.' });
            res.json(result.rows[0]);
        } catch (err) {
            console.error('Admin GET /problems/:id error:', err);
            res.status(500).json({ error: 'Failed to fetch problem.' });
        }
    });

    // ─── POST /api/admin/problems — create a new problem ────────────────────

    router.post('/problems', async (req, res) => {
        try {
            const { slug, title, statement, difficulty, tags, time_limit, required_module_name, constraints, sample_examples, editorial } = req.body;

            if (!slug || !title || !statement) {
                return res.status(400).json({ error: 'slug, title, and statement are required.' });
            }

            const result = await pool.query(
                `INSERT INTO problems (slug, title, statement, difficulty, tags, time_limit, required_module_name, constraints, sample_examples, editorial)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING *`,
                [
                    slug.trim(),
                    title.trim(),
                    statement.trim(),
                    difficulty || 'easy',
                    tags || [],
                    time_limit || 5000,
                    required_module_name || null,
                    constraints || null,
                    sample_examples || null,
                    editorial || null,
                ]
            );

            res.status(201).json(result.rows[0]);
        } catch (err) {
            if (err.code === '23505') {
                return res.status(400).json({ error: 'A problem with this slug already exists.' });
            }
            console.error('Admin POST /problems error:', err);
            res.status(500).json({ error: 'Failed to create problem.' });
        }
    });

    // ─── PUT /api/admin/problems/:id — update a problem ─────────────────────

    router.put('/problems/:id', async (req, res) => {
        try {
            const { slug, title, statement, difficulty, tags, time_limit, required_module_name, constraints, sample_examples, editorial } = req.body;

            const result = await pool.query(
                `UPDATE problems
                 SET slug = COALESCE($1, slug),
                     title = COALESCE($2, title),
                     statement = COALESCE($3, statement),
                     difficulty = COALESCE($4, difficulty),
                     tags = COALESCE($5, tags),
                     time_limit = COALESCE($6, time_limit),
                     required_module_name = COALESCE($7, required_module_name),
                     constraints = COALESCE($8, constraints),
                     sample_examples = COALESCE($9, sample_examples),
                     editorial = COALESCE($10, editorial)
                 WHERE id = $11
                 RETURNING *`,
                [
                    slug?.trim() || null,
                    title?.trim() || null,
                    statement?.trim() || null,
                    difficulty || null,
                    tags || null,
                    time_limit || null,
                    required_module_name || null,
                    constraints || null,
                    sample_examples || null,
                    editorial || null,
                    req.params.id,
                ]
            );

            if (result.rows.length === 0) return res.status(404).json({ error: 'Problem not found.' });
            res.json(result.rows[0]);
        } catch (err) {
            if (err.code === '23505') {
                return res.status(400).json({ error: 'A problem with this slug already exists.' });
            }
            console.error('Admin PUT /problems/:id error:', err);
            res.status(500).json({ error: 'Failed to update problem.' });
        }
    });

    // ─── DELETE /api/admin/problems/:id — delete a problem ──────────────────

    router.delete('/problems/:id', async (req, res) => {
        try {
            const result = await pool.query('DELETE FROM problems WHERE id = $1 RETURNING id', [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ error: 'Problem not found.' });
            res.json({ message: 'Problem deleted.', id: result.rows[0].id });
        } catch (err) {
            console.error('Admin DELETE /problems/:id error:', err);
            res.status(500).json({ error: 'Failed to delete problem.' });
        }
    });

    // ─── GET /api/admin/check — verify admin status ─────────────────────────

    router.get('/check', (req, res) => {
        res.json({ admin: true, email: req.user.email });
    });

    return router;
};
