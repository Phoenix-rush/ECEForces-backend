// add_posts_tables.js — Run once: node add_posts_tables.js
require('dotenv').config();
const pool = require('./db');

async function migrate() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title       VARCHAR(200) NOT NULL,
                content     TEXT NOT NULL
                            CHECK (LENGTH(TRIM(content)) > 0)
                            CHECK (LENGTH(content) <= 5000),
                created_at  TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS post_votes (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                post_id     INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
                value       SMALLINT NOT NULL CHECK (value IN (-1, 1)),
                UNIQUE(user_id, post_id)
            );

            CREATE INDEX IF NOT EXISTS idx_posts_user       ON posts(user_id);
            CREATE INDEX IF NOT EXISTS idx_posts_created     ON posts(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_post_votes_post   ON post_votes(post_id);
            CREATE INDEX IF NOT EXISTS idx_post_votes_user   ON post_votes(user_id);
        `);
        console.log('✅  posts & post_votes tables ready.');
    } catch (err) {
        console.error('❌  Migration failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
