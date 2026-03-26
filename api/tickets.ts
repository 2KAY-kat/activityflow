import express, { Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import prisma from './prisma';
import { ticketSchema, ticketUpdateSchema } from './validation';
import { AuthRequest, authenticate } from './middleware/auth';
import { isRepoCollaborator, isTeamAssignee, isTeamMember } from './utils/team-access';
import { buildTicketKey } from './utils/ticket-key';
import { sendTicketAssignmentNotification } from './utils/assignment-notifications';

const app = express();
app.use(express.json());
app.use(helmet());

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3005',
  'http://localhost:3010',
  'https://activitflow.vercel.app',
];

app.use(
  cors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin) || origin === 'null') {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked for: ${origin}`));
      }
    },
  })
);

const router = express.Router();

type TeamContext = {
  id: number;
  sourceType: string;
  githubRepoId: number | null;
} | null;

function buildLifecycleFieldsForCreate(status: string) {
  const now = new Date();

  if (status === 'Done') {
    return {
      startedAt: now,
      completedAt: now,
    };
  }

  if (status === 'In Progress') {
    return {
      startedAt: now,
      completedAt: null,
    };
  }

  return {};
}

function buildLifecycleFieldsForUpdate(
  status: string | undefined,
  existingTicket: { startedAt: Date | null; completedAt: Date | null }
) {
  if (!status) {
    return {};
  }

  const now = new Date();

  if (status === 'Done') {
    return {
      startedAt: existingTicket.startedAt || now,
      completedAt: existingTicket.completedAt || now,
    };
  }

  if (status === 'In Progress') {
    return {
      startedAt: existingTicket.startedAt || now,
      completedAt: null,
    };
  }

  return {
    completedAt: null,
  };
}

async function getTeamContext(teamId: number): Promise<TeamContext> {
  return prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      sourceType: true,
      githubRepoId: true,
    },
  });
}

async function canAccessTicket(userId: number, ticket: { userId: number; teamId: number | null }) {
  if (ticket.teamId) {
    return isTeamMember(userId, ticket.teamId);
  }

  return ticket.userId === userId;
}

async function canUserUpdateTicketStatus(
  userId: number,
  ticket: { assigneeId: number | null; assigneeCollaboratorId: number | null }
) {
  if (ticket.assigneeId) {
    return ticket.assigneeId === userId;
  }

  if (ticket.assigneeCollaboratorId) {
    const collaborator = await prisma.repoCollaborator.findUnique({
      where: { id: ticket.assigneeCollaboratorId },
      select: { linkedUserId: true },
    });

    return collaborator?.linkedUserId === userId;
  }

  return true;
}

async function resolveAssignmentData(
  team: TeamContext,
  assigneeId: number | null | undefined,
  assigneeCollaboratorId: number | null | undefined
) {
  if (team?.sourceType === 'GITHUB') {
    if (!team.githubRepoId) {
      throw new Error('GitHub-backed teams must have a linked repository');
    }

    if (assigneeCollaboratorId && !(await isRepoCollaborator(team.githubRepoId, assigneeCollaboratorId))) {
      throw new Error('Assignee collaborator must belong to the selected repository');
    }

    return {
      assigneeId: null,
      assigneeCollaboratorId: assigneeCollaboratorId ?? null,
    };
  }

  if (team?.id && assigneeId && !(await isTeamAssignee(team.id, assigneeId))) {
    throw new Error('Assignee must be a member of the selected team');
  }

  return {
    assigneeId: assigneeId ?? null,
    assigneeCollaboratorId: null,
  };
}

router.get(['/', '/api/tickets'], authenticate, async (req: AuthRequest, res: Response) => {
  const teamIdQuery = req.query.teamId;
  const teamId = typeof teamIdQuery === 'string' && teamIdQuery.length > 0 ? parseInt(teamIdQuery, 10) : undefined;

  if (teamIdQuery !== undefined && Number.isNaN(teamId)) {
    return res.status(400).json({ error: 'Invalid team ID' });
  }

  try {
    if (teamId && !(await isTeamMember(req.userId!, teamId))) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    const tickets = await prisma.ticket.findMany({
      where: teamId ? { teamId } : { userId: req.userId! },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { email: true } },
        assignee: { select: { id: true, email: true } },
        assigneeCollaborator: {
          select: {
            id: true,
            login: true,
            displayName: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });

    res.json(tickets);
  } catch (error) {
    console.error('Fetch tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

router.post(['/', '/api/tickets'], authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const validation = ticketSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.format() });
    }

    const { title, description, status, priority, assigneeId, assigneeCollaboratorId, teamId } = validation.data;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    if (!(await isTeamMember(req.userId!, teamId))) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    const team = await getTeamContext(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Selected team was not found' });
    }

    const assignmentData = await resolveAssignmentData(team, assigneeId, assigneeCollaboratorId);

    const createdTicket = await prisma.ticket.create({
      data: {
        title,
        description,
        status,
        priority,
        teamId,
        userId: req.userId!,
        ...assignmentData,
        ...buildLifecycleFieldsForCreate(status),
      },
      include: {
        assignee: { select: { id: true, email: true } },
        assigneeCollaborator: {
          select: {
            id: true,
            login: true,
            displayName: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });

    const ticket = await prisma.ticket.update({
      where: { id: createdTicket.id },
      data: { ticketKey: buildTicketKey(createdTicket.id) },
      include: {
        assignee: { select: { id: true, email: true } },
        assigneeCollaborator: {
          select: {
            id: true,
            login: true,
            displayName: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });

    if ((assignmentData.assigneeId || assignmentData.assigneeCollaboratorId) && ticket.teamId) {
      sendTicketAssignmentNotification({
        actorUserId: req.userId!,
        teamId: ticket.teamId,
        ticketId: ticket.id,
        ticketTitle: title,
        ticketKey: ticket.ticketKey,
        assigneeId: assignmentData.assigneeId,
        assigneeCollaboratorId: assignmentData.assigneeCollaboratorId,
      }).catch(console.error);
    }

    res.status(201).json(ticket);
  } catch (error: any) {
    console.error('Create ticket error:', error);
    res.status(400).json({ error: 'Failed to create ticket', details: error.message });
  }
});

router.put(['/:id', '/api/tickets/:id'], authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const idParam = req.params.id;
    const id = parseInt(typeof idParam === 'string' ? idParam : idParam[0], 10);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }

    const validation = ticketUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.format() });
    }

    const existingTicket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        status: true,
        userId: true,
        teamId: true,
        assigneeId: true,
        assigneeCollaboratorId: true,
        startedAt: true,
        completedAt: true,
      },
    });

    if (!existingTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (!(await canAccessTicket(req.userId!, existingTicket))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }

    const { title, description, status, priority, assigneeId, assigneeCollaboratorId, teamId } = validation.data;

    const nextTeamId = teamId ?? existingTicket.teamId ?? undefined;
    let team: TeamContext = null;

    if (nextTeamId) {
      if (!(await isTeamMember(req.userId!, nextTeamId))) {
        return res.status(403).json({ error: 'Not a member of the selected team' });
      }

      team = await getTeamContext(nextTeamId);
      if (!team) {
        return res.status(404).json({ error: 'Selected team was not found' });
      }
    }

    const shouldUpdateAssignment =
      assigneeId !== undefined || assigneeCollaboratorId !== undefined || teamId !== undefined;

    const assignmentData = shouldUpdateAssignment
      ? await resolveAssignmentData(team, assigneeId, assigneeCollaboratorId)
      : {};

    if (status !== undefined && status !== existingTicket.status) {
      const effectiveAssignee = {
        assigneeId: 'assigneeId' in assignmentData ? assignmentData.assigneeId ?? null : existingTicket.assigneeId,
        assigneeCollaboratorId:
          'assigneeCollaboratorId' in assignmentData
            ? assignmentData.assigneeCollaboratorId ?? null
            : existingTicket.assigneeCollaboratorId,
      };
      const canUpdateStatus = await canUserUpdateTicketStatus(req.userId!, effectiveAssignee);
      if (!canUpdateStatus) {
        return res.status(403).json({ error: 'Only the assigned user can update this ticket status' });
      }
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        title,
        description,
        status,
        priority,
        teamId,
        ...assignmentData,
        ...buildLifecycleFieldsForUpdate(status, existingTicket),
      },
      include: {
        assignee: { select: { id: true, email: true } },
        assigneeCollaborator: {
          select: {
            id: true,
            login: true,
            displayName: true,
            avatarUrl: true,
            email: true,
          },
        },
      },
    });

    const assigneeChanged =
      ('assigneeId' in assignmentData && assignmentData.assigneeId !== existingTicket.assigneeId) ||
      ('assigneeCollaboratorId' in assignmentData &&
        assignmentData.assigneeCollaboratorId !== existingTicket.assigneeCollaboratorId);

    if (assigneeChanged && ticket.teamId && (ticket.assigneeId || ticket.assigneeCollaboratorId)) {
      sendTicketAssignmentNotification({
        actorUserId: req.userId!,
        teamId: ticket.teamId,
        ticketId: ticket.id,
        ticketTitle: title || existingTicket.title,
        ticketKey: ticket.ticketKey,
        assigneeId: ticket.assigneeId,
        assigneeCollaboratorId: ticket.assigneeCollaboratorId,
      }).catch(console.error);
    }

    res.json(ticket);
  } catch (error: any) {
    console.error('Update ticket error:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

router.delete(['/:id', '/api/tickets/:id'], authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const idParam = req.params.id;
    const id = parseInt(typeof idParam === 'string' ? idParam : idParam[0], 10);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }

    const existingTicket = await prisma.ticket.findUnique({
      where: { id },
      select: { id: true, userId: true, teamId: true },
    });

    if (!existingTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (!(await canAccessTicket(req.userId!, existingTicket))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }

    await prisma.ticket.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error: any) {
    console.error('Delete ticket error:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

app.use(router);
export default app;
