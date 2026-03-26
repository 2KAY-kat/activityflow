import prisma from '../prisma';

export async function isTeamMember(userId: number, teamId: number) {
  const membership = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId,
        teamId,
      },
    },
  });

  return Boolean(membership);
}

export async function isTeamAssignee(teamId: number, assigneeId: number) {
  const membership = await prisma.teamMember.findUnique({
    where: {
      userId_teamId: {
        userId: assigneeId,
        teamId,
      },
    },
  });

  return Boolean(membership);
}
