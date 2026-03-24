const express = require('express');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname)));

const auth = require('./api/auth');
const tickets = require('./api/tickets');

// the Vercel functions act as standalone express apps
app.use('/api/auth', auth);
app.use('/api/tickets', tickets);

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
