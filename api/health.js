const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const prisma = require('./prisma');

const app = express();
app.use(express.json());
app.use(helmet());

// CORS configuration - restrict to your front-end domain
const allowedOrigins = [
  'http://localhost:3000',
  'https://activitflow.vercel.app'
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

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        // Ping the database
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ status: 'error', database: 'disconnected', details: error.message });
    }
});

app.use(['/api/health', '/'], router);

module.exports = app;
