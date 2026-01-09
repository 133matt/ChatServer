const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors({
  origin: true,  // Allow Chrome extension
  credentials: true
}));

// CockroachDB connection (use your DATABASE_URL from Render env)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('DB pool error:', err);
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Chat server running', timestamp: Date.now() });
});

// Get messages (NEWEST first, latest 50)
app.get('/messages', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const result = await pool.query(`
      SELECT id, username, text, timestamp 
      FROM messages 
      ORDER BY timestamp DESC 
      LIMIT $1
    `, [limit]);
    
    // Reverse to show oldest first in UI
    const messages = result.rows.reverse();
    console.log(`GET /messages: returned ${messages.length}`);
    res.json(messages);
  } catch (err) {
    console.error('GET /messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Post new message
app.post('/messages', async (req, res) => {
  try {
    const { username, text, timestamp } = req.body;
    
    if (!username || !text || !timestamp) {
      return res.status(400).json({ error: 'Missing username, text, or timestamp' });
    }

    const result = await pool.query(`
      INSERT INTO messages (username, text, timestamp) 
      VALUES ($1, $2, $3) 
      RETURNING id, username, text, timestamp
    `, [username.trim(), text.trim(), new Date(timestamp)]);
    
    console.log('POST /messages:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST /messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Create table on startup (if missing)
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) NOT NULL,
        text TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL
      )
    `);
    console.log('✅ DB table ready');
  } catch (err) {
    console.error('DB init error:', err);
  }
}

const PORT = process.env.PORT || 10000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Chat server on port ${PORT}`);
  });
});
