import express, { Response } from 'express';
import prisma from './prisma';
import { AuthRequest, authenticate } from './middleware/auth';
import { getGitHubAppConfig } from './utils/github-app';
import { syncGitHubCollaborators, syncGitHubInstallationsAndRepositories } from './utils/github-sync';

const router = express.Router();

function assertGitHubConfigured() {
  try {
    getGitHubAppConfig();
    return true;
  } catch {
    return false;
  }
}

router.get(['/status', '/api/github/status'], authenticate, async (_req: AuthRequest, res: Response) => {
  res.json({ configured: assertGitHubConfigured() });
});

router.get(['/installations', '/api/github/installations'], authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const installations = await prisma.gitHubInstallation.findMany({
      where: { createdByUserId: req.userId! },
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        _count: {
          select: { repositories: true },
        },
      },
    });

    res.json(installations);
  } catch (error) {
    console.error('Fetch GitHub installations error:', error);
    res.status(500).json({ error: 'Failed to fetch GitHub installations' });
  }
});

router.post(['/installations/sync', '/api/github/installations/sync'], authenticate, async (req: AuthRequest, res: Response) => {
  if (!assertGitHubConfigured()) {
    return res.status(503).json({ error: 'GitHub integration is not configured on the server' });
  }

  try {
    const repositories = await syncGitHubInstallationsAndRepositories(req.userId!);
    res.json({ message: 'GitHub installations synced', repositoryCount: repositories.length });
  } catch (error: any) {
    console.error('Sync GitHub installations error:', error);
    res.status(500).json({ error: error.message || 'Failed to sync GitHub installations' });
  }
});

router.get(['/repositories', '/api/github/repositories'], authenticate, async (req: AuthRequest, res: Response) => {
  const installationIdParam = req.query.installationId;
  const installationId =
    typeof installationIdParam === 'string' && installationIdParam.length > 0
      ? parseInt(installationIdParam, 10)
      : undefined;

  if (installationIdParam !== undefined && Number.isNaN(installationId)) {
    return res.status(400).json({ error: 'Invalid installation ID' });
  }

  try {
    const repositories = await prisma.gitHubRepository.findMany({
      where: {
        ...(installationId ? { installationId } : {}),
        installation: {
          createdByUserId: req.userId!,
        },
      },
      orderBy: [{ fullName: 'asc' }],
      include: {
        installation: {
          select: {
            id: true,
            accountLogin: true,
            accountType: true,
            createdByUserId: true,
          },
        },
        _count: {
          select: {
            collaborators: true,
            teams: true,
          },
        },
      },
    });

    res.json(repositories);
  } catch (error) {
    console.error('Fetch GitHub repositories error:', error);
    res.status(500).json({ error: 'Failed to fetch GitHub repositories' });
  }
});

router.post(
  ['/repositories/:id/sync-collaborators', '/api/github/repositories/:id/sync-collaborators'],
  authenticate,
  async (req: AuthRequest, res: Response) => {
    if (!assertGitHubConfigured()) {
      return res.status(503).json({ error: 'GitHub integration is not configured on the server' });
    }

    const idParam = req.params.id;
    const repositoryId = parseInt(typeof idParam === 'string' ? idParam : idParam[0], 10);

    if (Number.isNaN(repositoryId)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    try {
      const repository = await prisma.gitHubRepository.findFirst({
        where: {
          id: repositoryId,
          installation: {
            createdByUserId: req.userId!,
          },
        },
      });

      if (!repository) {
        return res.status(404).json({ error: 'Repository not found' });
      }

      const collaborators = await syncGitHubCollaborators(repositoryId);
      res.json({ message: 'Collaborators synced', collaboratorCount: collaborators.length, collaborators });
    } catch (error: any) {
      console.error('Sync GitHub collaborators error:', error);
      res.status(500).json({ error: error.message || 'Failed to sync GitHub collaborators' });
    }
  }
);

router.get(
  ['/repositories/:id/collaborators', '/api/github/repositories/:id/collaborators'],
  authenticate,
  async (req: AuthRequest, res: Response) => {
    const idParam = req.params.id;
    const repositoryId = parseInt(typeof idParam === 'string' ? idParam : idParam[0], 10);

    if (Number.isNaN(repositoryId)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    try {
      const collaborators = await prisma.repoCollaborator.findMany({
        where: {
          repositoryId,
          isActive: true,
          repository: {
            installation: {
              createdByUserId: req.userId!,
            },
          },
        },
        orderBy: [{ login: 'asc' }],
      });

      res.json(collaborators);
    } catch (error) {
      console.error('Fetch GitHub collaborators error:', error);
      res.status(500).json({ error: 'Failed to fetch GitHub collaborators' });
    }
  }
);

const app = express();
app.use(express.json());
app.use(router);

export default app;
