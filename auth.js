const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const router = express.Router();

// 1. SIGNUP API
router.post('/signup', async (req, res) => {
    const { email, password } = req.body;

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    try {
        // Password Hashing
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Insert into users table
        const result = await pool.query(
            'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
            [normalizedEmail, hashedPassword]
        );
        
        res.json({ message: "Signup successful!", user: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') { // Postgres unique violation code
            return res.status(400).json({ error: "Email already exists!" });
        }
        res.status(500).json({ error: "Server error during signup." });
    }
});

// 2. LOGIN API
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    try {
        // Look up user in database
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: "User not found!" });
        }

        const user = result.rows[0];

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: "Incorrect password!" });
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email }, 
            process.env.JWT_SECRET, 
            { expiresIn: '7d' } // Token valid for 7 days
        );

        res.json({ message: "Login successful!", token, userId: user.id });
    } catch (error) {
        res.status(500).json({ error: "Server error during login." });
    }
});



module.exports = router;