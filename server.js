// ===== server.js - STABLE VERSION =====
// CockroachDB for messages + Cloudinary for videos (100MB)

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const express = require('express');
const ytdl = require('ytdl-core');
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
app.use(cors());
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

// ===== INITIALIZE DATABASE TABLE =====
async function initializeDatabase() {
  try {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(255) NOT NULL,
        text TEXT,
        image TEXT,
        video_url TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(createTableQuery);
    console.log('✅ Database table initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error.message);
  }
}

initializeDatabase();

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

// ===== HEALTH CHECK =====
app.get('/health', async (req, res) => {
  try {
    const dbCheck = await pool.query('SELECT NOW()');
    const cloudinaryCheck = process.env.CLOUDINARY_CLOUD_NAME ? 'configured' : 'missing';
    const { rows: countRows } = await pool.query('SELECT COUNT(*) as count FROM messages');
    const messageCount = parseInt(countRows[0].count, 10);

    res.json({
      status: 'healthy',
      database: 'CockroachDB connected',
      cloudinary: cloudinaryCheck,
      messageCount: messageCount,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
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

    if (!Array.isArray(rows)) {
      console.warn('⚠️ Messages data is not an array');
      return res.json([]);
    }

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

    // Validate input
    if (!username || !username.trim()) {
      return res.status(400).json({
        error: 'Invalid: username is required'
      });
    }

    if (!text && !image && !videoUrl) {
      return res.status(400).json({
        error: 'Invalid: at least text, image, or video is required'
      });
    }

    const id = uuidv4();
    const ts = timestamp ? new Date(timestamp).toISOString() : new Date().toISOString();
    const cleanUsername = (username || 'Anonymous').trim().slice(0, 255);

    const insertQuery = `
      INSERT INTO messages (id, username, text, image, video_url, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, username, text, image, video_url AS "videoUrl", timestamp;
    `;

    const values = [
      id,
      cleanUsername,
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
      timestamp: saved.timestamp
    });

    res.json({
      success: true,
      messageId: saved.id,
      message: saved
    });
  } catch (error) {
    console.error('❌ POST /messages error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to save message',
      message: error.message
    });
  }
});

// ===== DELETE ALL MESSAGES =====
app.delete('/messages/clear', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM messages');
    const deletedCount = result.rowCount || 0;

    console.log(`✅ Deleted ${deletedCount} messages from CockroachDB`);

    res.json({
      success: true,
      message: `Deleted ${deletedCount} messages`,
      deletedCount: deletedCount
    });
  } catch (error) {
    console.error('❌ DELETE /messages/clear error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to delete messages',
      message: error.message
    });
  }
});

// ===== UPLOAD VIDEO TO CLOUDINARY =====
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ 
        success: false, 
        error: 'No file provided' 
      });
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
      success: false,
      error: 'Upload failed',
      message: error.message
    });
  }
});
// ===== NEW ENDPOINT: DOWNLOAD YOUTUBE VIDEO =====
app.post('/download-youtube', async (req, res) => {
  const { youtubeUrl, username, timestamp } = req.body;

  if (!youtubeUrl) {
    return res.status(400).json({ 
      success: false, 
      error: 'YouTube URL is required' 
    });
  }

  try {
    console.log(`🎥 Downloading YouTube video: ${youtubeUrl}`);

    // Validate it's a valid YouTube URL
    if (!ytdl.validateURL(youtubeUrl)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid YouTube URL' 
      });
    }

    // Get video info
    const info = await ytdl.getInfo(youtubeUrl);
    const videoTitle = info.videoDetails.title;
    console.log(`📝 Video title: ${videoTitle}`);

    // Get video formats (choose best quality mp4)
    const formats = ytdl.filterFormats(info.formats, 'audioandvideo');
    const format = formats.find(f => f.mimeType && f.mimeType.includes('video/mp4')) || formats[0];

    if (!format) {
      return res.status(400).json({ 
        success: false, 
        error: 'No suitable video format found' 
      });
    }

    // Create download stream
    const stream = ytdl(youtubeUrl, { format });

    // Upload to Cloudinary (same as your video upload)
    const cloudinary = require('cloudinary').v2;
    // Make sure CLOUDINARY_URL is set in your .env

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        public_id: `youtube-${Date.now()}`,
        folder: 'youtube-downloads'
      },
      async (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload error:', error);
          return res.status(500).json({ 
            success: false, 
            error: 'Failed to upload to Cloudinary' 
          });
        }

        console.log(`✅ Video uploaded to Cloudinary: ${result.secure_url}`);

        // Save to database
        try {
          const message = {
            id: Date.now().toString(),
            username,
            videoUrl: result.secure_url + '?quality=auto:good&fetch_format=mp4',
            timestamp,
            youtubeTitle: videoTitle
          };

          // Save to your database (using your existing method)
          // For example, if using MongoDB:
          // await Message.create(message);

          // Or if using your current system:
          messages.push(message);

          return res.json({ 
            success: true,
            message: `✅ YouTube video processed: ${videoTitle}`
          });
        } catch (dbError) {
          console.error('❌ Database error:', dbError);
          return res.status(500).json({ 
            success: false, 
            error: 'Failed to save video' 
          });
        }
      }
    );

    // Pipe the stream
    stream.pipe(uploadStream);

    // Error handling for download stream
    stream.on('error', (error) => {
      console.error('❌ Download error:', error.message);
      return res.status(500).json({ 
        success: false, 
        error: `Download failed: ${error.message}` 
      });
    });

  } catch (error) {
    console.error('❌ YouTube download error:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});



// ===== START SERVER =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 ChatServer running on port ${PORT}`);
  console.log(`📊 Database: CockroachDB`);
  console.log(`☁️  Storage: Cloudinary`);
  console.log(`🎥 Max video: 100MB`);
  console.log(`💾 Messaging: CockroachDB messages table\n`);
  console.log('Endpoints:');
  console.log('  GET  /ping - Check if online');
  console.log('  GET  /health - Full health check');
  console.log('  GET  /messages - Fetch messages from CockroachDB');
  console.log('  POST /messages - Save message to CockroachDB');
  console.log('  DELETE /messages/clear - Clear all messages');
  console.log('  POST /upload - Upload video to Cloudinary\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

