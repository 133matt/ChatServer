const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
// FIX: Increased payload limit to 100MB for video uploads
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Database Pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// Test database connection
pool.query('SELECT NOW()', (err, result) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected:', result.rows[0]);
  }
});

// ===== GET Messages =====
app.get('/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    const result = await pool.query(
      `SELECT 
        id,
        username,
        text,
        EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp,
        file_url,
        media_type
      FROM messages 
      ORDER BY timestamp DESC 
      LIMIT $1`,
      [limit]
    );

    // Return in ascending order (oldest first)
    const messages = result.rows.reverse();
    res.json(messages);
  } catch (error) {
    console.error('❌ GET /messages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===== POST Message =====
app.post('/messages', async (req, res) => {
  try {
    const { username, text, timestamp, fileUrl, mediaType, device } = req.body;

    // Validate required fields
    if (!username) {
      return res.status(400).json({ error: 'Username required' });
    }

    if (!text && !fileUrl) {
      return res.status(400).json({ 
        error: 'Message text or file URL required' 
      });
    }

    // FIX: Convert milliseconds to PostgreSQL timestamp
    // Use to_timestamp() to convert from Unix milliseconds
    const result = await pool.query(
      `INSERT INTO messages (username, text, timestamp, file_url, media_type, device)
       VALUES ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6)
       RETURNING 
        id,
        username,
        text,
        EXTRACT(EPOCH FROM timestamp) * 1000 as timestamp,
        file_url,
        media_type`,
      [
        username,
        text || null,
        timestamp || Date.now(),
        fileUrl || null,
        mediaType || null,
        device || null,
      ]
    );

    const message = result.rows[0];
    console.log('✅ Message inserted:', message.id, username);

    res.status(201).json({
      id: message.id,
      username: message.username,
      text: message.text,
      timestamp: parseInt(message.timestamp),
      file_url: message.file_url,
      media_type: message.media_type,
    });
  } catch (error) {
    console.error('❌ POST /messages error:', error);
    console.error('Error details:', error.detail, error.message);
    
    res.status(500).json({ 
      error: error.message,
      details: error.detail || null,
      code: error.code || null,
    });
  }
});

// ===== Status Endpoint =====
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ===== Health Check =====
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ 
      status: 'healthy',
      database: 'connected',
      timestamp: result.rows[0].now,
    });
  } catch (error) {
    res.status(500).json({ 
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// ===== Error Handler =====
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// ===== Start Server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n✅ ChatServer running on port ${PORT}`);
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`📊 Messages: http://localhost:${PORT}/messages`);
  console.log(`🔍 Health: http://localhost:${PORT}/health\n`);
});
