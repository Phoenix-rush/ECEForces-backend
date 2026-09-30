// add_comments_table.js — Run once: node add_comments_table.js
require('dotenv').config();
const pool = require('./db');

async function migrate() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS comments (
                id         SERIAL  PRIMARY KEY,
                user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
                problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
                content    TEXT    NOT NULL
                           CHECK (LENGTH(TRIM(content)) > 0)
                           CHECK (LENGTH(content) <= 500),
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_comments_problem  ON comments(problem_id);
            CREATE INDEX IF NOT EXISTS idx_comments_user     ON comments(user_id);
            CREATE INDEX IF NOT EXISTS idx_comments_created  ON comments(created_at DESC);
        `);
        console.log('✅  comments table ready.');
    } catch (err) {
        console.error('❌  Migration failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
