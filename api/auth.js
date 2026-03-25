const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const connectDB = require('./db');

// Execute connection (works in both Vercel serverless and local Express)
connectDB().catch(console.error);

const userSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true }
});

const User = mongoose.model('User', userSchema);

const JWT_SECRET = process.env.JWT_SECRET || 'N$1kQ2025_DB';

app.post('/register', async (req, res) => {
    console.log('Received /api/auth/register request:', req.body);
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ email, password: hashedPassword });
        await user.save();
        console.log('User created:', email);
        res.status(201).json({ message: 'User created' });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

app.post('/login', async (req, res) => {
    console.log('Received /api/auth/login request:', req.body);
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });
        console.log('User logged in:', email);
        res.json({ token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Test route to verify API is running
app.get('/test', (req, res) => {
    console.log('Received /api/auth/test request');
    res.json({ message: 'Auth API is running' });
});

module.exports = app;