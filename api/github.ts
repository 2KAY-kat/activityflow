import express, { Response } from 'express';
import prisma from './prisma';
import { AuthRequest, authenticate } from './middleware/auth';

const router = express.Router();

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
