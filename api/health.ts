import express, { Request, Response, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import prisma from './prisma';

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

const router: Router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    try {
        // Ping the database
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (error: any) {
        console.error('Health check error:', error);
        res.status(500).json({ status: 'error', database: 'disconnected', details: error.message });
    }
});

app.use(['/api/health', '/'], router);

export default app;
