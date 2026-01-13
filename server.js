// ===== server.js =====
// CockroachDB for messages/images + Cloudinary for videos (100MB)

const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();

// ===== COCKROACHDB SETUP =====
const pool = new Pool({
  connectionString: process.env.COCKROACHDB_URL,
  ssl: { rejectUnauthorized: false }
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ CockroachDB connection error:', err.message);
  } else {
    console.log('✅ CockroachDB connected:', res.rows[0]);
  }
});

// ===== CLOUDINARY SETUP =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Test Cloudinary connection
try {
  console.log('✅ Cloudinary configured:', process.env.CLOUDINARY_CLOUD_NAME);
} catch (error) {
  console.error('❌ Cloudinary config error:', error.message);
}

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Multer for video files (temporary storage before upload to Cloudinary)
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = 'uploads/';
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir);
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const supportedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/mpeg'];
    if (supportedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});

// ===== PING =====
app.get('/ping', (req, res) => {
  console.log('🔔 Ping received');
  res.json({
    status: 'online',
    timestamp: Date.now(),
    database: 'CockroachDB',
    storage: 'Cloudinary'
  });
});

// ===== GET MESSAGES (from CockroachDB) =====
app.get('/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;

    const { rows } = await pool.query(
      `SELECT id, username, text, image, video_url AS "videoUrl", timestamp
       FROM messages
       ORDER BY timestamp ASC
       LIMIT $1`,
      [limit]
    );

    console.log(`✅ Fetched ${rows.length} messages from CockroachDB`);
    res.json(rows);
  } catch (error) {
    console.error('❌ GET /messages error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch messages',
      message: error.message
    });
  }
});

// ===== POST MESSAGE (insert into CockroachDB) =====
app.post('/messages', async (req, res) => {
  try {
    const { username, text, image, videoUrl, timestamp } = req.body;

    if (!username || (!text && !image && !videoUrl)) {
      return res.status(400).json({
        error: 'Invalid message: need username and at least text/image/video'
      });
    }

    const ts = timestamp || Date.now();

    const insertQuery = `
      INSERT INTO messages (username, text, image, video_url, timestamp)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, username, text, image, video_url AS "videoUrl", timestamp;
    `;

    const values = [
      username || 'Anonymous',
      text || null,
      image || null,
      videoUrl || null,
      ts
    ];

    const { rows } = await pool.query(insertQuery, values);
    const saved = rows[0];

    console.log('✅ Message saved to CockroachDB:', {
      id: saved.id,
      username: saved.username,
      hasText: !!saved.text,
      hasImage: !!saved.image,
      hasVideo: !!saved.videoUrl,
      timestamp: new Date(saved.timestamp).toISOString()
    });

    res.json({
      success: true,
      messageId: saved.id,
      message: saved
    });
  } catch (error) {
    console.error('❌ POST /messages error:', error.message);
    res.status(500).json({
      error: 'Failed to save message',
      message: error.message
    });
  }
});

// ===== UPLOAD VIDEO TO CLOUDINARY =====
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const fileSize = req.file.size;
    const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);

    console.log(`📹 Uploading to Cloudinary: ${req.file.originalname} (${fileSizeMB}MB)`);

    // Upload to Cloudinary (streaming file)
    const uploadResult = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'video',
      public_id: `chatroom/videos/${Date.now()}`,
      chunk_size: 6000000, // 6MB chunks for large files
      overwrite: true
    });

    // Delete local temp file
    fs.unlink(req.file.path, (err) => {
      if (err) console.warn('⚠️ Could not delete temp file:', err.message);
    });

    const videoUrl = uploadResult.secure_url;

    console.log('✅ Video uploaded to Cloudinary:', {
      size: `${fileSizeMB}MB`,
      publicId: uploadResult.public_id,
      url: videoUrl,
      duration: uploadResult.duration ? `${uploadResult.duration}s` : 'unknown'
    });

    res.json({
      success: true,
      videoUrl: videoUrl,
      fileName: req.file.originalname,
      size: fileSize
    });
  } catch (error) {
    console.error('❌ Upload error:', error.message);

    // Cleanup on error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, () => {});
    }

    res.status(500).json({
      error: 'Upload failed',
      message: error.message
    });
  }
});

// ===== HEALTH CHECK =====
app.get('/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW()');
    const cloudinaryCheck = process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'missing';

    res.json({
      status: 'healthy',
      database: 'CockroachDB connected',
      cloudinary: cloudinaryCheck,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 ChatServer running on port ${PORT}`);
  console.log(`📊 Database: CockroachDB`);
  console.log(`☁️  Storage: Cloudinary`);
  console.log(`🎥 Max video: 100MB`);
  console.log(`💾 Messaging: CockroachDB messages table`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /ping - Check if online');
  console.log('  GET  /health - Full health check');
  console.log('  GET  /messages - Fetch messages from CockroachDB');
  console.log('  POST /messages - Save message to CockroachDB');
  console.log('  POST /upload - Upload video to Cloudinary');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});
