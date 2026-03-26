import express, { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authSchema } from './validation';
import prisma from './prisma';
import { AuthRequest, authenticate } from './middleware/auth';

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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const JWT_SECRET = process.env.JWT_SECRET || 'N$1kQ2025_DB';

// Bulletproof routing matching both /login and /api/auth/login
router.post(['/register', '/api/auth/register'], authLimiter, async (req: Request, res: Response) => {
    try {
        const validation = authSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: validation.error.format() 
            });
        }
        
        const { email, password } = validation.data;
        
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) return res.status(400).json({ error: 'User already exists' });
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.create({ data: { email, password: hashedPassword } });
        
        res.status(201).json({ message: 'User created' });
    } catch (error: any) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

router.post(['/login', '/api/auth/login'], authLimiter, async (req: Request, res: Response) => {
    try {
        const validation = authSchema.safeParse(req.body);
        if (!validation.success) return res.status(400).json({ error: 'Invalid input format' });

        const { email, password } = validation.data;
        const user = await prisma.user.findUnique({ where: { email } });

        if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get(['/me', '/api/auth/me'], authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.userId! },
            select: {
                id: true,
                email: true,
                authSource: true,
                githubUserId: true,
                githubLogin: true,
                githubAvatarUrl: true,
                githubLinkedAt: true,
            },
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Fetch current user error:', error);
        res.status(500).json({ error: 'Failed to fetch user profile' });
    }
});

app.use(router);
export default app;
