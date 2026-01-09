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

app.get('/', (req, res) => res.json({ status: 'OK' }));

// GET messages - return ms timestamps
app.get('/messages', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const result = await pool.query(`
      SELECT id, username, text, extract(epoch from timestamp)::bigint * 1000 as timestamp
      FROM messages 
      ORDER BY timestamp DESC 
      LIMIT $1
    `, [limit]);
    res.json(result.rows.reverse());
    console.log(`GET: ${result.rows.length}`);
  } catch (err) {
    console.error('GET:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST - store as TIMESTAMPTZ, return ms
app.post('/messages', async (req, res) => {
  try {
    const { username, text, timestamp } = req.body;
    
    if (!username?.trim() || !text?.trim()) {
      return res.status(400).json({ error: 'Missing username/text' });
    }

    // Convert to TIMESTAMPTZ
    let ts;
    if (typeof timestamp === 'string') {
      ts = `'${timestamp}'::timestamptz`;
    } else {
      ts = `to_timestamp(${Number(timestamp)} / 1000)`;
    }

    const result = await pool.query(`
      INSERT INTO messages (username, text, timestamp) 
      VALUES ($1, $2, ${ts})
      RETURNING id, username, text, extract(epoch from timestamp)::bigint * 1000 as timestamp
    `, [username.trim(), text.trim()]);
    
    console.log('POST:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create/repair table
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) NOT NULL,
        text TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_time ON messages(timestamp DESC);
    `);
    
    // Fix any bad data
    await pool.query(`DELETE FROM messages WHERE timestamp::text = 'Invalid Timestamp'`);
    
    console.log('✅ DB ready');
  } catch (err) {
    console.error('Init:', err);
  }
}

const PORT = process.env.PORT || 10000;
initDB().then(() => {
  app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));
});
