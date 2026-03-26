import express, { Request, Response, Router } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import prisma from './prisma';
import { checkGitHubAppHealth } from './utils/github-app';

const app = express();
app.use(express.json());
app.use(helmet());

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3005',
  'http://localhost:3010',
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

router.get(['/', '/api/health'], async (req: Request, res: Response) => {
    try {
        const [databaseResult, github] = await Promise.allSettled([
            prisma.$queryRaw`SELECT 1`,
            checkGitHubAppHealth()
        ]);

        const databaseHealthy = databaseResult.status === 'fulfilled';
        const githubHealth = github.status === 'fulfilled'
            ? github.value
            : {
                enabled: true,
                status: 'error' as const,
                message: github.reason?.message || 'GitHub health check failed'
            };

        const overallStatus = !databaseHealthy
            ? 'error'
            : githubHealth.status === 'error' || githubHealth.status === 'not_configured'
                ? 'degraded'
                : 'ok';

        const payload = {
            status: overallStatus,
            database: {
                status: databaseHealthy ? 'connected' : 'disconnected',
                message: databaseHealthy ? 'Database connected' : databaseResult.reason?.message || 'Database connection failed'
            },
            github: githubHealth,
            timestamp: new Date().toISOString()
        };

        if (overallStatus === 'error') {
            return res.status(500).json(payload);
        }

        if (overallStatus === 'degraded') {
            return res.status(200).json(payload);
        }

        res.json(payload);
    } catch (error: any) {
        console.error('Health check error:', error);
        res.status(500).json({
            status: 'error',
            database: { status: 'disconnected', message: error.message || 'Database connection failed' },
            github: { enabled: false, status: 'error', message: 'Health check failed before GitHub could be checked' },
            timestamp: new Date().toISOString()
        });
    }
});

app.use(router);
export default app;
