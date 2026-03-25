import express, { Request, Response, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import prisma from './prisma';

const app = express();
app.use(express.json());
app.use(helmet());

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3005',
  'https://activitflow.vercel.app'
];

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin) || origin === 'null') {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for: ${origin}`));
    }
  }
}));

const router: Router = express.Router();

router.get('/', async (req: Request, res: Response) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (error: any) {
        console.error('Health check error:', error);
        res.status(500).json({ status: 'error', database: 'disconnected', details: error.message });
    }
});

app.use(['/api/health', '/'], router);

export default app;
