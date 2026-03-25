import express, { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authSchema } from './validation';
import prisma from './prisma';

const app = express();
app.use(express.json());
app.use(helmet()); 

const allowedOrigins = [
  'http://localhost:3000',
  'https://activitflow.vercel.app'
];

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const JWT_SECRET = process.env.JWT_SECRET || 'N$1kQ2025_DB';

const router = express.Router();

router.post('/register', authLimiter, async (req: Request, res: Response) => {
    try {
        const validation = authSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ 
                error: 'Validation failed', 
                details: validation.error.format() 
            });
        }
        
        const { email, password } = validation.data;
        
        const existingUser = await prisma.user.findUnique({
            where: { email }
        });

        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        await prisma.user.create({
            data: { email, password: hashedPassword }
        });
        
        res.status(201).json({ message: 'User created' });
    } catch (error: any) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Server error', details: error.message });
    }
});

router.post('/login', authLimiter, async (req: Request, res: Response) => {
    try {
        const validation = authSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: 'Invalid input format' });
        }

        const { email, password } = validation.data;
        
        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.use(['/api/auth', '/'], router);

export default app;
