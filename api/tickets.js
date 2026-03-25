const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const connectDB = require('./db');

connectDB().catch(console.error);

const ticketSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  status: { type: String, enum: ['To Do', 'In Progress', 'Done'], default: 'To Do' },
  priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
  assignee: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

const Ticket = mongoose.model('Ticket', ticketSchema);

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

// Get ALL tickets (Shared among devs)
app.get('/', authenticate, async (req, res) => {
  try {
    const tickets = await Ticket.find().sort({ createdAt: -1 });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Create ticket
app.post('/', authenticate, async (req, res) => {
  try {
    const ticket = new Ticket({ ...req.body, createdBy: req.userId });
    await ticket.save();
    res.status(201).json(ticket);
  } catch (error) {
    res.status(400).json({ error: 'Failed to create ticket', details: error.message });
  }
});

// Update ticket
app.put('/:id', authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findOneAndUpdate(
      { _id: req.params.id }, // No userId requirement so anyone can update
      req.body,
      { new: true }
    );
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json(ticket);
  } catch (error) {
    res.status(400).json({ error: 'Failed to update ticket' });
  }
});

// Delete ticket
app.delete('/:id', authenticate, async (req, res) => {
  try {
    const ticket = await Ticket.findOneAndDelete({ _id: req.params.id });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete ticket' });
  }
});

module.exports = app;
