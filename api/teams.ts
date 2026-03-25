import express from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const prisma = new PrismaClient();
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'N$1kQ2025_DB';

// Middleware to authenticate
const authenticate = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });

    const token = authHeader.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
        if (err) return res.status(401).json({ error: 'Invalid token' });
        req.user = decoded;
        next();
    });
};

// Create a team
router.post('/', authenticate, async (req: any, res: any) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Team name is required' });

    try {
        const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();
        
        const team = await prisma.team.create({
            data: {
                name,
                inviteCode,
                members: {
                    create: {
                        userId: req.user.userId,
                        role: 'OWNER'
                    }
                }
            },
            include: {
                members: true
            }
        });

        res.status(201).json(team);
    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: 'Failed to create team' });
    }
});

// Join a team via invite code
router.post('/join', authenticate, async (req: any, res: any) => {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ error: 'Invite code is required' });

    try {
        const team = await prisma.team.findUnique({
            where: { inviteCode }
        });

        if (!team) return res.status(404).json({ error: 'Invalid invite code' });

        // Check if already a member
        const existingMember = await prisma.teamMember.findUnique({
            where: {
                userId_teamId: {
                    userId: req.user.userId,
                    teamId: team.id
                }
            }
        });

        if (existingMember) return res.status(400).json({ error: 'Already a member of this team' });

        await prisma.teamMember.create({
            data: {
                userId: req.user.userId,
                teamId: team.id,
                role: 'MEMBER'
            }
        });

        res.json({ message: 'Successfully joined team', team });
    } catch (error) {
        console.error('Error joining team:', error);
        res.status(500).json({ error: 'Failed to join team' });
    }
});

// Get user's teams
router.get('/', authenticate, async (req: any, res: any) => {
    try {
        const memberships = await prisma.teamMember.findMany({
            where: { userId: req.user.userId },
            include: {
                team: {
                    include: {
                        _count: {
                            select: { members: true, tickets: true }
                        }
                    }
                }
            }
        });

        res.json(memberships.map(m => m.team));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch teams' });
    }
});

// Get team members
router.get('/:teamId/members', authenticate, async (req: any, res: any) => {
    const teamId = parseInt(req.params.teamId);

    try {
        // Verify user is member of this team
        const membership = await prisma.teamMember.findUnique({
            where: {
                userId_teamId: {
                    userId: req.user.userId,
                    teamId
                }
            }
        });

        if (!membership) return res.status(403).json({ error: 'Not a member of this team' });

        const members = await prisma.teamMember.findMany({
            where: { teamId },
            include: {
                user: {
                    select: { id: true, email: true }
                }
            }
        });

        res.json(members.map(m => ({
            id: m.user.id,
            email: m.user.email,
            role: m.role
        })));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch members' });
    }
});

const app = express();
app.use(express.json());
// Universal routing for both absolute (Vercel) and mounted (Express) paths
app.use(['/api/teams', '/'], router);

export default app;
