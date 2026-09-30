const { Pool } = require('pg');
require('dotenv').config(); // .env file se password uthane ke liye

// Neon database se connect karne ka setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Neon ke liye SSL zaroori hota hai
    }
});

// Test connection
pool.connect()
    .then(() => console.log('✅ Neon Database Connected Successfully!'))
    .catch((err) => console.error('❌ Database Connection Error:', err));

module.exports = pool;