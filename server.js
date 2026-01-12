const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const app = express();

// Increase limits for large file uploads
app.use(express.json({ limit: '100mb' }));
app.use(express.raw({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(cors({ origin: true }));

// Increase payload size for streaming
app.set('json spaces', 2);

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

// GET messages
app.get('/messages', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const result = await pool.query(`
      SELECT id, username, text, image, device,
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

// POST message - handles large files with streaming
app.post('/messages', async (req, res) => {
  try {
    const { username, text, timestamp, image, device } = req.body;
    
    if (!username?.trim() || (!text?.trim() && !image)) {
      return res.status(400).json({ error: 'Need text or image/video' });
    }

    // For very large base64, don't store in RAM - truncate for DB
    let imageToStore = image;
    if (image && image.length > 50000000) {
      console.log('⚠️ Image too large for storage, truncating to 50MB');
      imageToStore = image.substring(0, 50000000);
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

    const deviceInfo = device || 'Unknown';

    const result = await pool.query(`
      INSERT INTO messages (username, text, image, device, timestamp) 
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, text, image, device,
                EXTRACT(EPOCH FROM timestamp)::BIGINT * 1000 as timestamp
    `, [username.trim(), text?.trim() || '', imageToStore || null, deviceInfo, ts]);
    
    console.log('POST: saved', result.rows[0].id, 'from', deviceInfo, '- Image:', imageToStore ? (imageToStore.length / 1024 / 1024).toFixed(2) + ' MB' : 'none');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('POST error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Init DB
async function initDB() {
  try {
    await pool.query('DROP TABLE IF EXISTS messages CASCADE');
    console.log('Dropped old table');

    await pool.query(`
      CREATE TABLE messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) NOT NULL,
        text TEXT,
        image TEXT,
        device VARCHAR(100),
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
