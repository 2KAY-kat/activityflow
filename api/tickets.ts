import express, { Request, Response, NextFunction, Router } from 'express';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import cors from 'cors';
import prisma from './prisma';
import { ticketSchema, ticketUpdateSchema } from './validation';

const app = express();
app.use(express.json());
app.use(helmet());

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3005',
  'https://activitflow.vercel.app'
];

app.use(cors({
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes(origin) || origin === 'null') {
      callback(null, true);
    } else {
      callback(new Error(`CORS blocked for: ${origin}`));
    }
  }
}));

const JWT_SECRET = process.env.JWT_SECRET || 'N$1kQ2025_DB';

interface AuthRequest extends Request {
  userId?: number;
}

const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  
  jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.userId = decoded.userId;
    next();
  });
};

const router: Router = express.Router();

// Get ALL tickets
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const tickets = await prisma.ticket.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: { email: true }
        }
      }
    });
    res.json(tickets);
  } catch (error) {
    console.error('Fetch tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Create ticket
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const validation = ticketSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validation.error.format() 
      });
    }

    const { title, description, status, priority, assignee } = validation.data;
    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        status,
        priority,
        assignee,
        userId: req.userId!
      }
    });
    res.status(201).json(ticket);
  } catch (error: any) {
    console.error('Create ticket error:', error);
    res.status(400).json({ error: 'Failed to create ticket', details: error.message });
  }
});

// Update ticket
router.put('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const idParam = req.params.id;
    const id = parseInt(typeof idParam === 'string' ? idParam : idParam![0]);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }
    
    const validation = ticketUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: validation.error.format() 
      });
    }
    
    const { title, description, status, priority, assignee } = validation.data;
    const ticket = await prisma.ticket.update({
      where: { id },
      data: { title, description, status, priority, assignee }
    });
    res.json(ticket);
  } catch (error: any) {
    console.error('Update ticket error:', error);
    if (error.code === 'P2025') return res.status(404).json({ error: 'Ticket not found' });
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Delete ticket
router.delete('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const idParam = req.params.id;
    const id = parseInt(typeof idParam === 'string' ? idParam : idParam![0]);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ticket ID' });

    await prisma.ticket.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error: any) {
    console.error('Delete ticket error:', error);
    if (error.code === 'P2025') return res.status(404).json({ error: 'Ticket not found' });
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

app.use(['/api/tickets', '/'], router);

export default app;
