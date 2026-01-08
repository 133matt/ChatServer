const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// Cockroach / Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Chat API with CockroachDB is running');
});

// Get last N messages
app.get('/messages', async (req, res) => {
  const limit = Number(req.query.limit) || 50;

  try {
    const result = await pool.query(
      `SELECT id, username, text, timestamp
       FROM messages
       ORDER BY timestamp ASC
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('GET /messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add a message
app.post('/messages', async (req, res) => {
  const { username, text, timestamp } = req.body || {};

  if (!username || !text || !timestamp) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO messages (username, text, timestamp)
       VALUES ($1, $2, $3)
       RETURNING id, username, text, timestamp`,
      [username, text, timestamp]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /messages error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Chat API listening on ${PORT}`);
});
