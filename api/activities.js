const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const activitySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: String,
  title: String,
  clientName: String,
  location: String,
  date: String,
  time: String,
  duration: Number,
  description: String,
  reminderTime: Number,
  completed: Boolean,
  progress: Number,
  createdAt: { type: Date, default: Date.now }
});

const Activity = mongoose.model('Activity', activitySchema);

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

// Get all activities for user
app.get('/', authenticate, async (req, res) => {
  const activities = await Activity.find({ userId: req.userId });
  res.json(activities);
});

// Create activity
app.post('/', authenticate, async (req, res) => {
  const activity = new Activity({ ...req.body, userId: req.userId });
  await activity.save();
  res.status(201).json(activity);
});

// Update activity
app.put('/:id', authenticate, async (req, res) => {
  const activity = await Activity.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    req.body,
    { new: true }
  );
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  res.json(activity);
});

// Delete activity
app.delete('/:id', authenticate, async (req, res) => {
  const activity = await Activity.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  res.json({ message: 'Deleted' });
});

module.exports = app;