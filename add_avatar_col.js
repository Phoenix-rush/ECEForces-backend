const pool = require('./db');

async function migrate() {
    try {
        await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(255)');
        console.log('Successfully added avatar_url column to users table');
    } catch (e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
migrate();
