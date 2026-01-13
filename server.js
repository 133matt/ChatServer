const express = require('express');
const { Client } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// ===== DATABASE CONNECTION =====
const getClient = () => {
  // Try COCKROACHDB_URL first, fall back to DATABASE_URL
  const connectionString = process.env.COCKROACHDB_URL || process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('❌ No database URL found! Set COCKROACHDB_URL or DATABASE_URL environment variable');
  }

  const client = new Client({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false }
  });
  return client;
};

// ===== INITIALIZE DATABASE =====
async function initializeDatabase() {
  try {
    const client = getClient();
    await client.connect();

    // Create messages table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(255) NOT NULL,
        text TEXT,
        image TEXT,
        videoUrl VARCHAR(2048),
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('✅ Database initialized');
    await client.end();
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

initializeDatabase();

// ===== HEALTH CHECK =====
app.get('/health', async (req, res) => {
  try {
    const client = getClient();
    await client.connect();
    
    const result = await client.query('SELECT NOW()');
    
    await client.end();
    
    res.json({
      status: 'healthy',
      database: 'connected',
      timestamp: result.rows[0].now
    });
  } catch (error) {
    console.error('❌ Health check error:', error.message);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// ===== PING ENDPOINT =====
app.get('/ping', (req, res) => {
  res.json({ status: 'pong', timestamp: Date.now() });
});

// ===== GET ALL MESSAGES =====
app.get('/messages', async (req, res) => {
  try {
    const client = getClient();
    await client.connect();

    const result = await client.query(`
      SELECT 
        id,
        username,
        text,
        image,
        videoUrl,
        timestamp
      FROM messages
      ORDER BY timestamp ASC
      LIMIT 100
    `);

    await client.end();

    // Handle both URLs and base64 data
    const messages = result.rows.map(row => {
      let imageData = null;
      
      if (row.image) {
        // Image is stored as TEXT, so it's either a URL or base64 string
        imageData = row.image;
      }

      return {
        id: row.id,
        username: row.username,
        text: row.text || null,
        image: imageData,
        videoUrl: row.videoUrl || null,
        timestamp: row.timestamp
      };
    });

    res.json(messages);
  } catch (error) {
    console.error('❌ Get messages error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== POST MESSAGE =====
app.post('/messages', async (req, res) => {
  try {
    const { username, text, image, videoUrl, timestamp } = req.body;

    if (!username || !timestamp) {
      return res.status(400).json({
        success: false,
        error: 'Username and timestamp required'
      });
    }

    const client = getClient();
    await client.connect();

    // Store image as TEXT - handle URLs and base64 strings
    const imageData = image || null;

    const result = await client.query(`
      INSERT INTO messages (username, text, image, videoUrl, timestamp)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [username, text || null, imageData, videoUrl || null, timestamp]);

    await client.end();

    res.json({
      success: true,
      id: result.rows[0].id,
      message: 'Message saved'
    });
  } catch (error) {
    console.error('❌ Post message error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== RESET CHAT (DELETE ALL MESSAGES) =====
app.post('/reset', async (req, res) => {
  try {
    const client = getClient();
    await client.connect();

    const result = await client.query('DELETE FROM messages');

    console.log(`🧹 Chat reset - ${result.rowCount} messages deleted`);

    await client.end();

    res.json({
      success: true,
      message: 'Chat reset - all messages deleted',
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('❌ Reset error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== DELETE SPECIFIC MESSAGE =====
app.delete('/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const client = getClient();
    await client.connect();

    const result = await client.query(
      'DELETE FROM messages WHERE id = $1',
      [id]
    );

    await client.end();

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    res.json({
      success: true,
      message: 'Message deleted'
    });
  } catch (error) {
    console.error('❌ Delete message error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== GET MESSAGE COUNT =====
app.get('/stats', async (req, res) => {
  try {
    const client = getClient();
    await client.connect();

    const result = await client.query('SELECT COUNT(*) as total FROM messages');
    const total = result.rows[0].total;

    await client.end();

    res.json({
      totalMessages: total,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Stats error:', error.message);
    res.status(500).json({
      error: error.message
    });
  }
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err.message);
  res.status(500).json({
    error: err.message
  });
});

// ===== 404 HANDLER =====
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found'
  });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════╗
║  🚀 ChatRoom Server Running       ║
║  Port: ${PORT}                          ║
║  Status: ✅ Ready to chat        ║
╚═══════════════════════════════════╝
  `);
});
