const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const prisma = require('./prisma');

const app = express();
app.use(express.json());
app.use(helmet()); // Secure HTTP headers

// CORS configuration - restrict to your front-end domain in production
const allowedOrigins = [
  'http://localhost:3000',
  'https://activitflow.vercel.app' // Replace with your production URL
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

// Rate limiting for auth routes (100 requests per 15 minutes)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const JWT_SECRET = process.env.JWT_SECRET || 'N$1kQ2025_DB';

const router = express.Router();

router.post('/register', authLimiter, async (req, res) => {
    console.log('Received /api/auth/register request:', req.body);
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: { email, password: hashedPassword }
        });
        
        console.log('User created:', email);
        res.status(201).json({ message: 'User created' });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

router.post('/login', authLimiter, async (req, res) => {
    console.log('Received /api/auth/login request:', req.body);
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }
        
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
        console.log('User logged in:', email);
        res.json({ token });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Test route to verify API is running
router.get('/test', (req, res) => {
    console.log('Received /api/auth/test request');
    res.json({ message: 'Auth API is running' });
});

// Mount the router at both the base and the full API path to support both 
// local Express and Vercel serverless routing
app.use(['/api/auth', '/'], router);

module.exports = app;