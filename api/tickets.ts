import express, { Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import prisma from './prisma';
import { ticketSchema, ticketUpdateSchema } from './validation';
import { AuthRequest, authenticate } from './middleware/auth';
import { isTeamAssignee, isTeamMember } from './utils/team-access';

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

async function canAccessTicket(userId: number, ticket: { userId: number; teamId: number | null }) {
  if (ticket.teamId) {
    return isTeamMember(userId, ticket.teamId);
  }

  return ticket.userId === userId;
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

    const { title, description, status, priority, assigneeId, teamId } = validation.data;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    if (!(await isTeamMember(req.userId!, teamId))) {
      return res.status(403).json({ error: 'Not a member of this team' });
    }

    if (assigneeId && !(await isTeamAssignee(teamId, assigneeId))) {
      return res.status(400).json({ error: 'Assignee must be a member of the selected team' });
    }

    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        status,
        priority,
        assigneeId,
        teamId,
        userId: req.userId!,
      },
      include: {
        assignee: { select: { id: true, email: true } },
      },
    });

    if (assigneeId && ticket.assignee) {
      const { sendAssignmentEmail } = require('./utils/email');
      const creator = await prisma.user.findUnique({ where: { id: req.userId! } });
      sendAssignmentEmail(ticket.assignee.email, title, creator?.email || 'A Team Member').catch(console.error);
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
    const id = parseInt(typeof idParam === 'string' ? idParam : idParam![0], 10);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }

    const validation = ticketUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: 'Validation failed', details: validation.error.format() });
    }

    const existingTicket = await prisma.ticket.findUnique({
      where: { id },
      include: { assignee: true },
    });

    if (!existingTicket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (!(await canAccessTicket(req.userId!, existingTicket))) {
      return res.status(403).json({ error: 'You do not have access to this ticket' });
    }

    const { title, description, status, priority, assigneeId, teamId } = validation.data;
    const nextTeamId = teamId ?? existingTicket.teamId ?? undefined;

    if (teamId && !(await isTeamMember(req.userId!, teamId))) {
      return res.status(403).json({ error: 'Not a member of the selected team' });
    }

    if (nextTeamId && assigneeId && !(await isTeamAssignee(nextTeamId, assigneeId))) {
      return res.status(400).json({ error: 'Assignee must be a member of the selected team' });
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      data: { title, description, status, priority, assigneeId, teamId },
      include: {
        assignee: { select: { id: true, email: true } },
      },
    });

    if (assigneeId && assigneeId !== existingTicket.assigneeId && ticket.assignee) {
      const { sendAssignmentEmail } = require('./utils/email');
      const updater = await prisma.user.findUnique({ where: { id: req.userId! } });
      sendAssignmentEmail(ticket.assignee.email, title || ticket.title, updater?.email || 'A Team Member').catch(console.error);
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
    const id = parseInt(typeof idParam === 'string' ? idParam : idParam![0], 10);

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
