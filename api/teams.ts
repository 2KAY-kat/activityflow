import express, { Response } from 'express';
import crypto from 'crypto';
import prisma from './prisma';
import { AuthRequest, authenticate } from './middleware/auth';

const router = express.Router();

router.post(['/', '/api/teams'], authenticate, async (req: AuthRequest, res: Response) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Team name is required' });
  }

  try {
    const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const team = await prisma.team.create({
      data: {
        name,
        inviteCode,
        members: {
          create: {
            userId: req.userId!,
            role: 'OWNER',
          },
        },
      },
      include: {
        members: true,
      },
    });

    res.status(201).json(team);
  } catch (error) {
    console.error('Error creating team:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

router.post(['/join', '/api/teams/join'], authenticate, async (req: AuthRequest, res: Response) => {
  const { inviteCode } = req.body;
  if (!inviteCode) {
    return res.status(400).json({ error: 'Invite code is required' });
  }

  try {
    const team = await prisma.team.findUnique({
      where: { inviteCode },
    });

    if (!team) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const existingMember = await prisma.teamMember.findUnique({
      where: {
        userId_teamId: {
          userId: req.userId!,
          teamId: team.id,
        },
      },
    });

    if (existingMember) {
      return res.status(400).json({ error: 'Already a member of this team' });
    }

    await prisma.teamMember.create({
      data: {
        userId: req.userId!,
        teamId: team.id,
        role: 'MEMBER',
      },
    });

    res.json({ message: 'Successfully joined team', team });
  } catch (error) {
    console.error('Error joining team:', error);
    res.status(500).json({ error: 'Failed to join team' });
  }
});

router.get(['/', '/api/teams'], authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const memberships = await prisma.teamMember.findMany({
      where: { userId: req.userId! },
      include: {
        team: {
          include: {
            _count: {
              select: { members: true, tickets: true },
            },
          },
        },
      },
    });

    res.json(memberships.map((membership) => membership.team));
  } catch (error) {
    console.error('Error fetching teams:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

router.get(['/:teamId/members', '/api/teams/:teamId/members'], authenticate, async (req: AuthRequest, res: Response) => {
  const teamIdParam = req.params.teamId;
  const teamId = parseInt(typeof teamIdParam === 'string' ? teamIdParam : teamIdParam[0], 10);

  if (Number.isNaN(teamId)) {
    return res.status(400).json({ error: 'Invalid team ID' });
  }

  try {
    const membership = await prisma.teamMember.findUnique({
      where: {
        userId_teamId: {
          userId: req.userId!,
          teamId,
        },
      },
    });

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    const members = await prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: { id: true, email: true },
        },
      },
    });

    res.json(
      members.map((member) => ({
        id: member.user.id,
        email: member.user.email,
        role: member.role,
      }))
    );
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

const app = express();
app.use(express.json());
app.use(router);

export default app;

