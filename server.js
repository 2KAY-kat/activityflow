const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

// Serve static assets from the root
// (css, js, sw.js, manifest.json, etc.)
app.use(express.static(path.join(__dirname)));

// API Routes
const auth = require('./api/auth');
const tickets = require('./api/tickets');

app.use('/api/auth', auth);
app.use('/api/tickets', tickets);

// SPA Fallback: send index.html for any unmatched route
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(path.join(__dirname, 'index.html'));
    } else {
        next();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running locally on http://localhost:${PORT}`);
});
