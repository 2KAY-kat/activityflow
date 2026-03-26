import prisma from '../prisma';
import { buildAssignmentUrl, sendAssignmentEmail } from './email';

type AssignmentNotificationInput = {
  actorUserId: number;
  teamId: number;
  ticketId: number;
  ticketTitle: string;
  ticketKey?: string | null;
  assigneeId?: number | null;
  assigneeCollaboratorId?: number | null;
};

export async function sendTicketAssignmentNotification({
  actorUserId,
  teamId,
  ticketId,
  ticketTitle,
  ticketKey,
  assigneeId,
  assigneeCollaboratorId,
}: AssignmentNotificationInput) {
  if (!assigneeId && !assigneeCollaboratorId) {
    return;
  }

  const [actor, team] = await Promise.all([
    prisma.user.findUnique({
      where: { id: actorUserId },
      select: { email: true },
    }),
    prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        name: true,
        inviteCode: true,
      },
    }),
  ]);

  if (!team) {
    console.warn(`Assignment email skipped because team ${teamId} was not found.`);
    return;
  }

  const assignedByName = actor?.email || 'A Team Member';

  if (assigneeId) {
    const assignee = await prisma.user.findUnique({
      where: { id: assigneeId },
      select: { email: true },
    });

    if (!assignee?.email) {
      console.warn(`Assignment email skipped because local user ${assigneeId} has no email.`);
      return;
    }

    await sendAssignmentEmail({
      toEmail: assignee.email,
      ticketTitle,
      ticketKey,
      assignedByName,
      teamName: team.name,
      actionUrl: buildAssignmentUrl({ teamId, ticketId }),
      requiresJoinConfirmation: false,
    });
    return;
  }

  if (!assigneeCollaboratorId) {
    return;
  }

  const collaborator = await prisma.repoCollaborator.findUnique({
    where: { id: assigneeCollaboratorId },
    select: {
      id: true,
      email: true,
      login: true,
      displayName: true,
      linkedUserId: true,
      linkedUser: {
        select: {
          email: true,
        },
      },
    },
  });

  if (!collaborator) {
    console.warn(`Assignment email skipped because collaborator ${assigneeCollaboratorId} was not found.`);
    return;
  }

  const recipientEmail = collaborator.linkedUser?.email || collaborator.email;
  if (!recipientEmail) {
    console.warn(
      `Assignment email skipped because collaborator ${collaborator.login || collaborator.id} has no accessible email address.`
    );
    return;
  }

  let requiresJoinConfirmation = true;

  if (collaborator.linkedUserId) {
    const membership = await prisma.teamMember.findUnique({
      where: {
        userId_teamId: {
          userId: collaborator.linkedUserId,
          teamId,
        },
      },
      select: { id: true },
    });

    requiresJoinConfirmation = !membership;
  }

  await sendAssignmentEmail({
    toEmail: recipientEmail,
    ticketTitle,
    ticketKey,
    assignedByName,
    teamName: team.name,
    actionUrl: buildAssignmentUrl({
      teamId,
      ticketId,
      inviteCode: requiresJoinConfirmation ? team.inviteCode : null,
    }),
    inviteCode: requiresJoinConfirmation ? team.inviteCode : undefined,
    requiresJoinConfirmation,
  });
}
