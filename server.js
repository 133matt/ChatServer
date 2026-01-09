const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors({ origin: true }));

// CockroachDB - Render DATABASE_URL auto-parses
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('DB pool error:', err));

// Health check
app.get('/', (req, res) => res.json({ status: 'OK', time: new Date().toISOString() }));

// GET messages - NEWEST 50 first
app.get('/messages', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const result = await pool.query(`
      SELECT id, username, text, timestamp 
      FROM messages 
      ORDER BY timestamp DESC 
      LIMIT $1
    `, [limit]);
    
    res.json(result.rows.reverse()); // Oldest first for chat UI
    console.log(`GET /messages: ${result.rows.length} msgs`);
  } catch (err) {
    console.error('GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST message - let DB generate UUID
app.post('/messages', async (req, res) => {
  try {
    const { username, text, timestamp } = req.body;
    
    if (!username?.trim() || !text?.trim() || !timestamp) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const result = await pool.query(`
      INSERT INTO messages (username, text, timestamp) 
      VALUES ($1, $2, to_timestamp($3 / 1000))
      RETURNING id, username, text, timestamp
    `, [username.trim(), text.trim(), Number(timestamp)]);
    
    console.log('POST success:', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Init table
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) NOT NULL,
        text TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp);
    `);
    console.log('✅ Table ready');
  } catch (err) {
    console.error('Init error:', err);
  }
}

const PORT = process.env.PORT || 10000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
  });
});
