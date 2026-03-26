import prisma from '../prisma';
import {
  createInstallationAccessToken,
  getAppInstallation,
  listInstallationRepositories,
  listRepositoryCollaborators,
} from './github-app';

type SyncInstallationsOptions = {
  installationId?: number;
};

async function upsertInstallationForUser(createdByUserId: number, installationId: number) {
  const installation = await getAppInstallation(installationId);
  const existingInstallation = await prisma.gitHubInstallation.findUnique({
    where: { githubInstallationId: installation.id },
    select: {
      id: true,
      createdByUserId: true,
    },
  });

  if (existingInstallation && existingInstallation.createdByUserId !== createdByUserId) {
    throw new Error('This GitHub App installation is already linked to another ActivityFlow user.');
  }

  return prisma.gitHubInstallation.upsert({
    where: { githubInstallationId: installation.id },
    update: {
      accountLogin: installation.account?.login || installation.account?.slug || 'unknown',
      accountType: installation.account?.type || 'Unknown',
      createdByUserId,
    },
    create: {
      githubInstallationId: installation.id,
      accountLogin: installation.account?.login || installation.account?.slug || 'unknown',
      accountType: installation.account?.type || 'Unknown',
      createdByUserId,
    },
  });
}

export async function syncGitHubInstallationsAndRepositories(createdByUserId: number, options: SyncInstallationsOptions = {}) {
  const targetInstallationIds = options.installationId
    ? [options.installationId]
    : (
        await prisma.gitHubInstallation.findMany({
          where: { createdByUserId },
          select: { githubInstallationId: true },
          orderBy: [{ updatedAt: 'desc' }],
        })
      ).map((installation) => installation.githubInstallationId);
  const syncedRepositories = [];

  for (const installationId of targetInstallationIds) {
    const storedInstallation = await upsertInstallationForUser(createdByUserId, installationId);

    const installationTokenResponse = await createInstallationAccessToken(installationId);
    const repositoryResponse = await listInstallationRepositories(installationTokenResponse.token);
    const repositories = Array.isArray(repositoryResponse.repositories) ? repositoryResponse.repositories : [];
    const activeRepositoryIds = new Set<number>();

    for (const repository of repositories) {
      activeRepositoryIds.add(repository.id);
      const storedRepository = await prisma.gitHubRepository.upsert({
        where: { githubRepoId: repository.id },
        update: {
          installationId: storedInstallation.id,
          ownerLogin: repository.owner?.login || storedInstallation.accountLogin,
          name: repository.name,
          fullName: repository.full_name,
          defaultBranch: repository.default_branch,
          isPrivate: repository.private,
          htmlUrl: repository.html_url,
          isActive: true,
          lastSyncedAt: new Date(),
        },
        create: {
          githubRepoId: repository.id,
          installationId: storedInstallation.id,
          ownerLogin: repository.owner?.login || storedInstallation.accountLogin,
          name: repository.name,
          fullName: repository.full_name,
          defaultBranch: repository.default_branch,
          isPrivate: repository.private,
          htmlUrl: repository.html_url,
          isActive: true,
          lastSyncedAt: new Date(),
        },
      });

      syncedRepositories.push(storedRepository);
    }

    await prisma.gitHubRepository.updateMany({
      where: {
        installationId: storedInstallation.id,
        githubRepoId: {
          notIn: Array.from(activeRepositoryIds),
        },
      },
      data: {
        isActive: false,
      },
    });
  }

  return syncedRepositories;
}

export async function syncGitHubCollaborators(repositoryId: number) {
  const repository = await prisma.gitHubRepository.findUnique({
    where: { id: repositoryId },
    include: {
      installation: true,
    },
  });

  if (!repository) {
    throw new Error('Repository not found');
  }

  const installationTokenResponse = await createInstallationAccessToken(repository.installation.githubInstallationId);
  const collaborators = await listRepositoryCollaborators(
    installationTokenResponse.token,
    repository.ownerLogin,
    repository.name
  );

  const activeGithubUserIds = new Set<number>();

  for (const collaborator of collaborators) {
    activeGithubUserIds.add(collaborator.id);

    const linkedUser = await prisma.user.findUnique({
      where: { githubUserId: collaborator.id },
      select: { id: true },
    });

    await prisma.repoCollaborator.upsert({
      where: {
        repositoryId_githubUserId: {
          repositoryId,
          githubUserId: collaborator.id,
        },
      },
      update: {
        login: collaborator.login,
        displayName: collaborator.name,
        avatarUrl: collaborator.avatar_url,
        email: collaborator.email,
        roleName: collaborator.role_name,
        permission: collaborator.permissions
          ? Object.entries(collaborator.permissions)
              .filter(([, allowed]) => Boolean(allowed))
              .map(([permission]) => permission)
              .join(', ')
          : null,
        linkedUserId: linkedUser?.id || null,
        isActive: true,
        lastSyncedAt: new Date(),
      },
      create: {
        repositoryId,
        githubUserId: collaborator.id,
        login: collaborator.login,
        displayName: collaborator.name,
        avatarUrl: collaborator.avatar_url,
        email: collaborator.email,
        roleName: collaborator.role_name,
        permission: collaborator.permissions
          ? Object.entries(collaborator.permissions)
              .filter(([, allowed]) => Boolean(allowed))
              .map(([permission]) => permission)
              .join(', ')
          : null,
        linkedUserId: linkedUser?.id || null,
        isActive: true,
        lastSyncedAt: new Date(),
      },
    });
  }

  await prisma.repoCollaborator.updateMany({
    where: {
      repositoryId,
      githubUserId: {
        notIn: Array.from(activeGithubUserIds),
      },
    },
    data: {
      isActive: false,
      lastSyncedAt: new Date(),
    },
  });

  await prisma.gitHubRepository.update({
    where: { id: repositoryId },
    data: {
      lastSyncedAt: new Date(),
    },
  });

  await prisma.team.updateMany({
    where: { githubRepoId: repositoryId },
    data: {
      lastGithubSyncAt: new Date(),
    },
  });

  return prisma.repoCollaborator.findMany({
    where: {
      repositoryId,
      isActive: true,
    },
    orderBy: [{ login: 'asc' }],
  });
}
