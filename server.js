const express = require('express');
const cors = require('cors');
const { v4: uuid } = require('uuid');

const app = express();
const PORT = process.env.PORT || 10000; // Render sets PORT env var

let messages = [];

app.use(cors());
app.use(express.json());

app.get('/messages', (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const start = Math.max(messages.length - limit, 0);
  res.json(messages.slice(start));
});

app.post('/messages', (req, res) => {
  const { username, text, timestamp } = req.body || {};

  if (!username || !text || !timestamp) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const msg = {
    id: uuid(),
    username,
    text,
    timestamp
  };

  messages.push(msg);
  if (messages.length > 500) {
    messages = messages.slice(-500);
  }

  res.status(201).json(msg);
});

app.get('/', (req, res) => {
  res.send('Chat API is running');
});

app.listen(PORT, () => {
  console.log(`Chat API listening on ${PORT}`);
});
