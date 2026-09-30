// add_password_resets_table.js — Run once: node add_password_resets_table.js
require('dotenv').config();
const pool = require('./db');

async function migrate() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id          SERIAL PRIMARY KEY,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token       VARCHAR(64) NOT NULL UNIQUE,
                expires_at  TIMESTAMP NOT NULL,
                used        BOOLEAN DEFAULT FALSE,
                created_at  TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
            CREATE INDEX IF NOT EXISTS idx_password_resets_user  ON password_resets(user_id);
        `);
        console.log('password_resets table ready.');
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
