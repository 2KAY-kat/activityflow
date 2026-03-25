import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import cors from 'cors';
import dotenv from 'dotenv';
import auth from './api/auth';
import tickets from './api/tickets';
import health from './api/health';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// Serve static assets from the root
app.use(express.static(path.join(__dirname)));

// API Routes
app.use('/api/auth', auth);
app.use('/api/tickets', tickets);
app.use('/api/health', health);

// SPA Fallback: send index.html for any unmatched route
app.use((req: Request, res: Response, next: NextFunction) => {
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
