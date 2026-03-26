import express, { Request, Response, Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authSchema } from './validation';
import prisma from './prisma';
import { AuthRequest, authenticate } from './middleware/auth';
import { buildGitHubAuthorizeUrl, exchangeCodeForUserToken, fetchGitHubUser, getAppBaseUrl, getGitHubAppConfig } from './utils/github-app';
import { markUserActive } from './utils/presence';

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

function isGitHubConfigured() {
    try {
        getGitHubAppConfig();
        return true;
    } catch {
        return false;
    }
}

function buildStateToken(returnTo?: string) {
    return jwt.sign(
        {
            mode: 'login',
            returnTo: returnTo && returnTo.startsWith('/') ? returnTo : '/',
        },
        JWT_SECRET,
        { expiresIn: '10m' }
    );
}

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

        await markUserActive(user.id);
        
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (error: any) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get(['/github/start', '/api/auth/github/start'], authLimiter, async (req: Request, res: Response) => {
    if (!isGitHubConfigured()) {
        return res.status(503).json({ error: 'GitHub login is not configured on this server' });
    }

    try {
        const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
        const state = buildStateToken(returnTo);
        res.redirect(buildGitHubAuthorizeUrl(state));
    } catch (error: any) {
        console.error('GitHub auth start error:', error);
        res.status(500).json({ error: 'Failed to start GitHub login' });
    }
});

router.get(['/github/callback', '/api/auth/github/callback'], authLimiter, async (req: Request, res: Response) => {
    if (!isGitHubConfigured()) {
        return res.status(503).json({ error: 'GitHub login is not configured on this server' });
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const installationId = typeof req.query.installation_id === 'string' ? req.query.installation_id : '';
    const setupAction = typeof req.query.setup_action === 'string' ? req.query.setup_action : '';

    if (installationId && !state) {
        const redirectBase = getAppBaseUrl().replace(/\/$/, '');
        const hashParams = new URLSearchParams({
            githubInstallationId: installationId,
            setupAction: setupAction || 'install',
        });

        return res.redirect(`${redirectBase}/#${hashParams.toString()}`);
    }

    if (!code || !state) {
        return res.status(400).json({ error: 'Missing GitHub callback parameters' });
    }

    try {
        const decoded = jwt.verify(state, JWT_SECRET) as { returnTo?: string };
        const tokenResponse = await exchangeCodeForUserToken(code);
        const githubToken = tokenResponse.access_token;

        if (!githubToken) {
            return res.status(401).json({ error: 'GitHub did not return an access token' });
        }

        const githubUser = await fetchGitHubUser(githubToken);

        let user = await prisma.user.findUnique({
            where: { githubUserId: githubUser.id },
        });

        const fallbackEmail = `github-${githubUser.id}@users.noreply.activityflow.local`;

        if (!user) {
            const candidateEmail = typeof githubUser.email === 'string' && githubUser.email.length > 0
                ? githubUser.email
                : fallbackEmail;

            const conflictingUser = await prisma.user.findUnique({
                where: { email: candidateEmail },
                select: { id: true },
            });

            user = await prisma.user.create({
                data: {
                    email: conflictingUser ? fallbackEmail : candidateEmail,
                    password: null,
                    authSource: 'GITHUB',
                    githubUserId: githubUser.id,
                    githubLogin: githubUser.login,
                    githubAvatarUrl: githubUser.avatar_url,
                    githubLinkedAt: new Date(),
                },
            });
        } else {
            user = await prisma.user.update({
                where: { id: user.id },
                data: {
                    githubLogin: githubUser.login,
                    githubAvatarUrl: githubUser.avatar_url,
                    githubLinkedAt: new Date(),
                },
            });
        }

        await markUserActive(user.id);

        const appToken = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
        const returnTo = decoded.returnTo && decoded.returnTo.startsWith('/') ? decoded.returnTo : '/';
        const redirectBase = getAppBaseUrl().replace(/\/$/, '');

        res.redirect(`${redirectBase}${returnTo}#authToken=${encodeURIComponent(appToken)}&provider=github`);
    } catch (error: any) {
        console.error('GitHub auth callback error:', error);
        res.status(500).json({ error: 'Failed to complete GitHub login' });
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
                lastActiveAt: true,
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
