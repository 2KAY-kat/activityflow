require('dotenv').config();
const mongoose = require('mongoose');

console.log("Testing DB Connection...");
console.log("URI:", process.env.MONGODB_URI.replace(/:([^:@]{3,})@/, ':***@')); // Hide password

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log("Successfully connected to MongoDB.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("MongoDB Connection Failed:", err.message);
    process.exit(1);
  });
