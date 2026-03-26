import prisma from '../prisma';

export const PRESENCE_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
export const PRESENCE_IDLE_WINDOW_MS = 15 * 60 * 1000;

export type PresenceStatus = 'ACTIVE' | 'IDLE' | 'OFFLINE' | 'PENDING' | 'UNLINKED';

export function getPresenceStatus(lastActiveAt: Date | null | undefined, now = new Date()): PresenceStatus {
  if (!lastActiveAt) {
    return 'OFFLINE';
  }

  const age = now.getTime() - lastActiveAt.getTime();

  if (age <= PRESENCE_ACTIVE_WINDOW_MS) {
    return 'ACTIVE';
  }

  if (age <= PRESENCE_IDLE_WINDOW_MS) {
    return 'IDLE';
  }

  return 'OFFLINE';
}

export async function markUserActive(userId: number, timestamp = new Date()) {
  await prisma.user.update({
    where: { id: userId },
    data: { lastActiveAt: timestamp },
  });
}

export async function markTeamMemberActive(userId: number, teamId: number, timestamp = new Date()) {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { lastActiveAt: timestamp },
    }),
    prisma.teamMember.update({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
      data: { lastActiveAt: timestamp },
    }),
  ]);
}
