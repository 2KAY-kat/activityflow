const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const prisma = require('./prisma');

const app = express();
app.use(express.json());
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET || 'N$1kQ2025_DB';

const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.userId = decoded.userId;
    next();
  });
};

const router = express.Router();

// Get ALL tickets (Shared among devs)
router.get('/', authenticate, async (req, res) => {
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
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, status, priority, assignee } = req.body;
    const ticket = await prisma.ticket.create({
      data: {
        title,
        description,
        status: status || 'To Do',
        priority: priority || 'Medium',
        assignee,
        userId: req.userId
      }
    });
    res.status(201).json(ticket);
  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(400).json({ error: 'Failed to create ticket', details: error.message });
  }
});

// Update ticket
router.put('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }
    
    const { title, description, status, priority, assignee } = req.body;
    
    const ticket = await prisma.ticket.update({
      where: { id },
      data: {
        title,
        description,
        status,
        priority,
        assignee
      }
    });
    
    res.json(ticket);
  } catch (error) {
    console.error('Update ticket error:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Delete ticket
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ticket ID' });
    }

    await prisma.ticket.delete({
      where: { id }
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Delete ticket error:', error);
    if (error.code === 'P2025') {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

// Mount the router at both the base and the full API path to support both 
// local Express and Vercel serverless routing
app.use(['/api/tickets', '/'], router);

module.exports = app;
