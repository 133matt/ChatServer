// ===== server.js - CHATSERVER WITH YOUTUBE.JS SUPPORT (FIXED) =====
const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const fileUpload = require('express-fileupload');
const { Innertube } = require('youtubei.js');
require('dotenv').config();

// ===== CONFIGURE CLOUDINARY =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dfkedoqtu',
  api_key: process.env.CLOUDINARY_API_KEY || '974623582669831',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'n5UMrnz2_7g2QZ4-axmkhcY0PA'
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload());

// Store messages in memory (replace with database for production)
let messages = [];

// ===== GET ALL MESSAGES =====
app.get('/messages', (req, res) => {
  res.json(messages);
});

// ===== POST NEW MESSAGE =====
app.post('/messages', (req, res) => {
  const { username, text, image, videoUrl, timestamp } = req.body;

  if (!username || (!text && !image && !videoUrl)) {
    return res.status(400).json({ success: false, error: 'Invalid message' });
  }

  const message = {
    id: Date.now().toString(),
    username,
    text: text || null,
    image: image || null,
    videoUrl: videoUrl || null,
    timestamp
  };

  messages.push(message);
  res.json({ success: true, id: message.id });
});

// ===== DELETE ALL MESSAGES =====
app.delete('/messages/clear', (req, res) => {
  messages = [];
  res.json({ success: true, message: 'All messages deleted' });
});

// ===== IMAGE/VIDEO UPLOAD TO CLOUDINARY =====
app.post('/upload', (req, res) => {
  if (!req.files || !req.files.file) {
    console.error('❌ No file provided in upload request');
    return res.status(400).json({ success: false, error: 'No file provided' });
  }

  const file = req.files.file;
  console.log(`📁 Uploading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);

  const uploadStream = cloudinary.uploader.upload_stream(
    {
      resource_type: 'auto',
      folder: 'chatroom-uploads',
      timeout: 60000
    },
    (error, result) => {
      if (error) {
        console.error('❌ Cloudinary upload error:', error);
        return res.status(500).json({ success: false, error: error.message });
      }

      console.log(`✅ File uploaded to Cloudinary: ${result.secure_url}`);
      res.json({ 
        success: true, 
        videoUrl: result.secure_url 
      });
    }
  );

  uploadStream.on('error', (error) => {
    console.error('❌ Upload stream error:', error);
    res.status(500).json({ success: false, error: error.message });
  });

  uploadStream.end(file.data);
});

// ===== HELPER: Extract Video ID from YouTube URL =====
function extractVideoId(youtubeUrl) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/
  ];
  
  for (const pattern of patterns) {
    const match = youtubeUrl.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return null;
}

// ===== YOUTUBE DOWNLOAD ENDPOINT (YOUTUBE.JS - FIXED) =====
app.post('/download-youtube', async (req, res) => {
  const { youtubeUrl, username, timestamp } = req.body;

  // Validation
  if (!youtubeUrl) {
    console.error('❌ No YouTube URL provided');
    return res.status(400).json({ 
      success: false, 
      error: 'YouTube URL is required' 
    });
  }

  if (!username || !timestamp) {
    console.error('❌ Missing username or timestamp');
    return res.status(400).json({ 
      success: false, 
      error: 'Username and timestamp required' 
    });
  }

  try {
    console.log(`🎥 [YouTube] Received request for: ${youtubeUrl}`);
    console.log(`👤 Username: ${username}`);

    // Step 1: Validate YouTube URL format
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//;
    if (!youtubeRegex.test(youtubeUrl)) {
      console.error('❌ Invalid YouTube URL format');
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid YouTube URL format' 
      });
    }
    console.log('✅ URL validation passed');

    // Step 2: Extract video ID from URL
    const videoId = extractVideoId(youtubeUrl);
    if (!videoId) {
      console.error('❌ Could not extract video ID from URL');
      return res.status(400).json({ 
        success: false, 
        error: 'Could not extract video ID from URL' 
      });
    }
    console.log(`✅ Video ID: ${videoId}`);

    // Step 3: Create Innertube instance
    console.log('🔌 Creating YouTube.js Innertube instance...');
    const yt = await Innertube.create({ gl: 'US', hl: 'en' });
    console.log('✅ Innertube instance created');

    // Step 4: Get video info
    console.log('📥 Fetching video information...');
    let info;
    try {
      info = await yt.getBasicInfo(videoId);
    } catch (infoError) {
      console.error('❌ Failed to get video info:', infoError.message);
      return res.status(400).json({ 
        success: false, 
        error: `Cannot download video: ${infoError.message}. Video may be private, age-restricted, or unavailable.` 
      });
    }

    const videoTitle = info.basic_info?.title || info.info?.title || 'YouTube Video';
    const videoDuration = info.basic_info?.duration || info.info?.duration || 'unknown';
    console.log(`📝 Video title: ${videoTitle}`);
    console.log(`⏱️  Duration: ${videoDuration}s`);

    // Step 5: Download video stream
    console.log('📥 Starting YouTube video download...');
    let stream;
    try {
      stream = await yt.download(videoId, {
        quality: '360p',
        type: 'video+audio'
      });
    } catch (downloadError) {
      console.error('❌ Failed to download video:', downloadError.message);
      return res.status(400).json({ 
        success: false, 
        error: `Download failed: ${downloadError.message}` 
      });
    }
    console.log('✅ Download stream created');

    // Step 6: Upload to Cloudinary
    console.log('☁️  Starting Cloudinary upload...');
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        public_id: `youtube-${Date.now()}`,
        folder: 'youtube-downloads',
        eager: [
          { width: 300, height: 300, crop: 'fill', format: 'jpg' }
        ],
        eager_async: true,
        timeout: 120000
      },
      async (error, result) => {
        if (error) {
          console.error('❌ Cloudinary upload error:', error);
          return res.status(500).json({ 
            success: false, 
            error: `Cloudinary upload failed: ${error.message}` 
          });
        }

        console.log(`✅ Video uploaded to Cloudinary: ${result.secure_url}`);

        // Step 7: Save to database
        try {
          const message = {
            id: Date.now().toString(),
            username,
            videoUrl: result.secure_url + '?quality=auto:good&fetch_format=mp4',
            timestamp,
            youtubeTitle: videoTitle,
            youtubeUrl: youtubeUrl
          };

          messages.push(message);
          console.log('✅ Message saved to database');

          return res.json({ 
            success: true,
            message: `✅ YouTube video processed: ${videoTitle}`,
            videoUrl: message.videoUrl,
            title: videoTitle
          });
        } catch (dbError) {
          console.error('❌ Database error:', dbError);
          return res.status(500).json({ 
            success: false, 
            error: `Failed to save video: ${dbError.message}` 
          });
        }
      }
    );

    // Handle upload stream errors
    uploadStream.on('error', (error) => {
      console.error('❌ Upload stream error:', error);
      res.status(500).json({ success: false, error: error.message });
    });

    // Pipe download stream to Cloudinary
    stream.pipe(uploadStream);
    console.log('📊 Piping video to Cloudinary...');

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: `Cannot download video: ${error.message}. Video may be private, age-restricted, or unavailable.` 
    });
  }
});

// ===== HEALTH CHECK ENDPOINT =====
app.get('/health-check', (req, res) => {
  const cloudinaryConfig = cloudinary.config();
  res.json({ 
    status: 'ok',
    message: 'Server is running',
    youtubejs: typeof Innertube !== 'undefined' ? 'loaded ✅' : 'missing ❌',
    cloudinary: cloudinaryConfig.cloud_name ? 'configured ✅' : 'not configured ❌',
    cloudinaryCloudName: cloudinaryConfig.cloud_name || 'not set',
    messagesCount: messages.length
  });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ YouTube download support enabled (YouTube.js)`);
  console.log(`✅ File upload support enabled`);
  
  const cloudinaryConfig = cloudinary.config();
  console.log(`📊 Cloudinary configured: ${cloudinaryConfig.cloud_name ? '✅ (' + cloudinaryConfig.cloud_name + ')' : '❌'}`);
  console.log(`📦 YouTube.js (youtubei.js) available: ${typeof Innertube !== 'undefined' ? '✅' : '❌'}`);
});

module.exports = app;
