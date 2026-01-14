// ===== server.js - COMPLETE WITH YTDL-CORE SUPPORT =====

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const ytdl = require('ytdl-core');
const app = express();

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));

// ===== IN-MEMORY STORAGE =====
let messages = [];
const users = new Map();

// ===== HEARTBEAT / ONLINE USERS =====
app.post('/heartbeat', (req, res) => {
  const { username, timestamp } = req.body;
  if (username) {
    users.set(username, { timestamp, username });
  }
  res.json({ success: true });
});

app.get('/users/online', (req, res) => {
  const now = Date.now();
  const onlineUsers = Array.from(users.values()).filter(
    user => (now - user.timestamp) < 60000 // 60 seconds
  );
  res.json(onlineUsers.map(u => u.username));
});

// ===== GET ALL MESSAGES =====
app.get('/messages', (req, res) => {
  res.json(messages);
});

// ===== POST MESSAGE =====
app.post('/messages', (req, res) => {
  try {
    const { username, text, image, videoUrl, timestamp } = req.body;

    if (!username) {
      return res.status(400).json({ success: false, error: 'Username required' });
    }

    if (!text && !image && !videoUrl) {
      return res.status(400).json({ success: false, error: 'Message content required' });
    }

    const message = {
      id: uuidv4(),
      username,
      text: text || null,
      image: image || null,
      videoUrl: videoUrl || null,
      timestamp: timestamp || Date.now()
    };

    messages.push(message);

    // Keep only last 500 messages
    if (messages.length > 500) {
      messages = messages.slice(-500);
    }

    res.json({ success: true, message });
  } catch (error) {
    console.error('Post error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== DELETE ALL MESSAGES =====
app.delete('/messages/clear', (req, res) => {
  messages = [];
  res.json({ success: true });
});

// ===== UPLOAD IMAGE =====
app.post('/upload', (req, res) => {
  try {
    // Image is already base64 in the message body
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ===== VIDEO DOWNLOAD ENDPOINT (YTDL-CORE) =====
app.get('/api/download-video', async (req, res) => {
  try {
    const url = req.query.url;
    
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    console.log(`📥 Processing video: ${url}`);

    // Validate YouTube URL
    if (!ytdl.validateURL(url)) {
      return res.status(400).json({ success: false, error: 'Invalid YouTube URL' });
    }

    // Get video info
    const info = await ytdl.getInfo(url);
    console.log(`✅ Video found: ${info.videoDetails.title}`);

    // Choose best video format
    // Try quality 18 (360p MP4) first
    let format = ytdl.chooseFormat(info.formats, { quality: '18' });
    
    if (!format || !format.url) {
      console.warn('⚠️ Quality 18 not available, trying 22...');
      // Try quality 22 (480p MP4)
      format = ytdl.chooseFormat(info.formats, { quality: '22' });
    }
    
    if (!format || !format.url) {
      console.warn('⚠️ Still no format, trying any...');
      // Try any format
      format = ytdl.chooseFormat(info.formats, { quality: 'highest' });
    }
    
    if (!format || !format.url) {
      return res.status(500).json({ success: false, error: 'No suitable video format found' });
    }

    console.log(`✅ Selected format: ${format.qualityLabel || 'unknown quality'}`);
    
    res.json({ 
      success: true, 
      url: format.url,
      title: info.videoDetails.title,
      quality: format.qualityLabel
    });

  } catch (error) {
    console.error('❌ Download error:', error.message);
    
    if (error.message.includes('Video unavailable')) {
      res.status(400).json({ success: false, error: 'Video unavailable' });
    } else if (error.message.includes('not available')) {
      res.status(400).json({ success: false, error: 'Video not available in your region' });
    } else if (error.message.includes('age-restricted')) {
      res.status(400).json({ success: false, error: 'Video is age-restricted' });
    } else if (error.message.includes('403')) {
      res.status(403).json({ success: false, error: 'Access denied - video is private or deleted' });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ status: 'online', messages: messages.length, users: users.size });
});

// ===== ROOT ROUTE =====
app.get('/', (req, res) => {
  res.json({ 
    status: 'Server running',
    messages: messages.length,
    onlineUsers: users.size,
    endpoints: [
      'GET /messages',
      'POST /messages',
      'DELETE /messages/clear',
      'GET /users/online',
      'POST /heartbeat',
      'GET /api/download-video?url=<youtube_url>',
      'GET /health'
    ]
  });
});

// ===== 404 HANDLER =====
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ success: false, error: 'Server error' });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ ytdl-core integrated`);
  console.log(`📥 Video download endpoint: /api/download-video?url=<url>`);
});

// Export for testing
module.exports = app;
