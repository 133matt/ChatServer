const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();

app.use(express.json());
app.use(cors({ origin: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('DB pool error:', err));

// Health check
app.get('/', (req, res) => res.json({ status: 'OK' }));

// GET messages - return timestamps as milliseconds
app.get('/messages', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const result = await pool.query(`
      SELECT id, username, text, 
             EXTRACT(EPOCH FROM timestamp)::BIGINT * 1000 as timestamp
      FROM messages 
      ORDER BY timestamp DESC 
      LIMIT $1
    `, [limit]);
    
    res.json(result.rows.reverse());
    console.log(`GET: ${result.rows.length} messages`);
  } catch (err) {
    console.error('GET error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST message - accept ms or ISO string
app.post('/messages', async (req, res) => {
  try {
    const { username, text, timestamp } = req.body;
    
    if (!username?.trim() || !text?.trim()) {
      return res.status(400).json({ error: 'Missing username/text' });
    }

    // Convert timestamp to Date
    let ts = new Date();
    if (timestamp) {
      if (typeof timestamp === 'string') {
        ts = new Date(timestamp);
      } else {
        ts = new Date(Number(timestamp));
      }
    }

    const result = await pool.query(`
      INSERT INTO messages (username, text, timestamp) 
      VALUES ($1, $2, $3)
      RETURNING id, username, text, 
                EXTRACT(EPOCH FROM timestamp)::BIGINT * 1000 as timestamp
    `, [username.trim(), text.trim(), ts]);
    
    console.log('POST: saved', result.rows[0].id);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Init DB - DROP old table, create fresh
async function initDB() {
  try {
    // Drop old table if exists (CAREFUL - deletes all data!)
    await pool.query('DROP TABLE IF EXISTS messages CASCADE');
    console.log('Dropped old table');

    // Create fresh table with correct schema
    await pool.query(`
      CREATE TABLE messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) NOT NULL,
        text TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_timestamp ON messages(timestamp DESC);
    `);
    console.log('✅ Fresh table created');
  } catch (err) {
    console.error('Init error:', err);
  }
}

const PORT = process.env.PORT || 10000;
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Chat server on port ${PORT}`);
    console.log(`📡 API: https://chatserver-numj.onrender.com`);
  });
});
