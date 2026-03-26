import express, { Response } from 'express';
import crypto from 'crypto';
import prisma from './prisma';
import { AuthRequest, authenticate } from './middleware/auth';
import { teamSchema } from './validation';
import { syncGitHubCollaborators } from './utils/github-sync';

const router = express.Router();

async function requireTeamMembership(userId: number, teamId: number) {
  return prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId,
      },
    },
  });
}

async function buildGitHubTeamStatus(teamId: number) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      sourceType: true,
      githubRepoId: true,
      lastGithubSyncAt: true,
      githubRepository: {
        select: {
          id: true,
          fullName: true,
          defaultBranch: true,
          htmlUrl: true,
          lastSyncedAt: true,
        },
      },
    },
  });

  if (!team) {
    return null;
  }

  if (team.sourceType !== 'GITHUB' || !team.githubRepoId || !team.githubRepository) {
    return {
      id: team.id,
      name: team.name,
      sourceType: team.sourceType,
    };
  }

  const [collaboratorCount, linkedCollaboratorCount] = await prisma.$transaction([
    prisma.repoCollaborator.count({
      where: {
        repositoryId: team.githubRepoId,
        isActive: true,
      },
    }),
    prisma.repoCollaborator.count({
      where: {
        repositoryId: team.githubRepoId,
        isActive: true,
        linkedUserId: {
          not: null,
        },
      },
    }),
  ]);

  return {
    id: team.id,
    name: team.name,
    sourceType: team.sourceType,
    repositoryId: team.githubRepository.id,
    repositoryFullName: team.githubRepository.fullName,
    repositoryUrl: team.githubRepository.htmlUrl,
    defaultBranch: team.githubRepository.defaultBranch,
    lastSyncedAt: team.lastGithubSyncAt || team.githubRepository.lastSyncedAt,
    collaboratorCount,
    linkedCollaboratorCount,
  };
}

router.post(['/', '/api/teams'], authenticate, async (req: AuthRequest, res: Response) => {
  const validation = teamSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ error: 'Validation failed', details: validation.error.format() });
  }

  const { name, sourceType, githubRepositoryId } = validation.data;

  try {
    let githubRepository = null;
    let githubSync: {
      collaboratorCount?: number;
      lastSyncedAt?: Date | null;
      warning?: string;
    } | null = null;

    if (sourceType === 'GITHUB') {
      githubRepository = await prisma.gitHubRepository.findFirst({
        where: {
          id: githubRepositoryId!,
          installation: {
            createdByUserId: req.userId!,
          },
        },
        select: {
          id: true,
          fullName: true,
          defaultBranch: true,
          htmlUrl: true,
          lastSyncedAt: true,
        },
      });

      if (!githubRepository) {
        return res.status(404).json({ error: 'Selected GitHub repository was not found' });
      }
    }

    const inviteCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    const team = await prisma.team.create({
      data: {
        name,
        inviteCode,
        sourceType,
        githubRepoId: githubRepository?.id,
        defaultBranch: githubRepository?.defaultBranch,
        lastGithubSyncAt: githubRepository?.lastSyncedAt || null,
        members: {
          create: {
            userId: req.userId!,
            role: 'OWNER',
          },
        },
      },
      include: {
        githubRepository: {
          select: {
            id: true,
            fullName: true,
            defaultBranch: true,
            htmlUrl: true,
            lastSyncedAt: true,
          },
        },
        members: true,
      },
    });

    if (sourceType === 'GITHUB' && githubRepository?.id) {
      try {
        const collaborators = await syncGitHubCollaborators(githubRepository.id);
        const githubStatus = await buildGitHubTeamStatus(team.id);
        githubSync = {
          collaboratorCount: collaborators.length,
          lastSyncedAt: githubStatus && 'lastSyncedAt' in githubStatus ? githubStatus.lastSyncedAt : null,
        };
      } catch (syncError) {
        console.error('Initial GitHub collaborator sync failed:', syncError);
        githubSync = {
          warning: 'Team created, but GitHub collaborators could not be synced yet.',
        };
      }
    }

    res.status(201).json({ team, githubSync });
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
            githubRepository: {
              select: {
                id: true,
                fullName: true,
                defaultBranch: true,
                htmlUrl: true,
                lastSyncedAt: true,
              },
            },
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

router.get(['/:teamId/github/status', '/api/teams/:teamId/github/status'], authenticate, async (req: AuthRequest, res: Response) => {
  const teamIdParam = req.params.teamId;
  const teamId = parseInt(typeof teamIdParam === 'string' ? teamIdParam : teamIdParam[0], 10);

  if (Number.isNaN(teamId)) {
    return res.status(400).json({ error: 'Invalid team ID' });
  }

  try {
    const membership = await requireTeamMembership(req.userId!, teamId);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    const githubStatus = await buildGitHubTeamStatus(teamId);
    if (!githubStatus) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (githubStatus.sourceType !== 'GITHUB') {
      return res.status(400).json({ error: 'This team is not linked to a GitHub repository' });
    }

    res.json(githubStatus);
  } catch (error) {
    console.error('Error fetching GitHub team status:', error);
    res.status(500).json({ error: 'Failed to fetch GitHub team status' });
  }
});

router.post(['/:teamId/github/sync', '/api/teams/:teamId/github/sync'], authenticate, async (req: AuthRequest, res: Response) => {
  const teamIdParam = req.params.teamId;
  const teamId = parseInt(typeof teamIdParam === 'string' ? teamIdParam : teamIdParam[0], 10);

  if (Number.isNaN(teamId)) {
    return res.status(400).json({ error: 'Invalid team ID' });
  }

  try {
    const membership = await requireTeamMembership(req.userId!, teamId);
    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        sourceType: true,
        githubRepoId: true,
      },
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.sourceType !== 'GITHUB' || !team.githubRepoId) {
      return res.status(400).json({ error: 'This team is not linked to a GitHub repository' });
    }

    const collaborators = await syncGitHubCollaborators(team.githubRepoId);
    const githubStatus = await buildGitHubTeamStatus(teamId);

    res.json({
      message: 'GitHub collaborators synced',
      collaboratorCount: collaborators.length,
      ...(githubStatus || {}),
    });
  } catch (error: any) {
    console.error('Error syncing GitHub collaborators for team:', error);
    res.status(500).json({ error: error.message || 'Failed to sync GitHub collaborators' });
  }
});

router.get(['/:teamId/members', '/api/teams/:teamId/members'], authenticate, async (req: AuthRequest, res: Response) => {
  const teamIdParam = req.params.teamId;
  const teamId = parseInt(typeof teamIdParam === 'string' ? teamIdParam : teamIdParam[0], 10);

  if (Number.isNaN(teamId)) {
    return res.status(400).json({ error: 'Invalid team ID' });
  }

  try {
    const membership = await requireTeamMembership(req.userId!, teamId);

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        sourceType: true,
        githubRepoId: true,
      },
    });

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (team.sourceType === 'GITHUB' && team.githubRepoId) {
      const collaborators = await prisma.repoCollaborator.findMany({
        where: {
          repositoryId: team.githubRepoId,
          isActive: true,
        },
        orderBy: [{ login: 'asc' }],
        select: {
          id: true,
          login: true,
          displayName: true,
          email: true,
          roleName: true,
          permission: true,
          avatarUrl: true,
          linkedUserId: true,
        },
      });

      return res.json(
        collaborators.map((collaborator) => ({
          id: collaborator.id,
          name: collaborator.displayName || collaborator.login,
          email: collaborator.email,
          login: collaborator.login,
          role: collaborator.roleName || collaborator.permission || 'COLLABORATOR',
          avatarUrl: collaborator.avatarUrl,
          linkedUserId: collaborator.linkedUserId,
          type: 'github',
        }))
      );
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
        name: member.user.email,
        email: member.user.email,
        role: member.role,
        type: 'manual',
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
