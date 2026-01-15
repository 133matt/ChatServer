// ===== server.js - CHATSERVER WITH YOUTUBE & FILE UPLOAD (YTDL UPDATED) =====
const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const ytdl = require('@distube/ytdl');
const fileUpload = require('express-fileupload');
require('dotenv').config();

// ===== CONFIGURE CLOUDINARY WITH INDIVIDUAL ENV VARIABLES =====
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

// ===== YOUTUBE DOWNLOAD ENDPOINT (WITH @distube/ytdl) =====
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

    // Step 1: Validate YouTube URL
    if (!ytdl.validateURL(youtubeUrl)) {
      console.error('❌ Invalid YouTube URL format');
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid YouTube URL format' 
      });
    }
    console.log('✅ URL validation passed');

    // Step 2: Get video info
    let info;
    try {
      info = await ytdl.getInfo(youtubeUrl);
    } catch (infoError) {
      console.error('❌ Failed to get video info:', infoError.message);
      return res.status(400).json({ 
        success: false, 
        error: `Cannot download video: ${infoError.message}. Video may be private, age-restricted, or unavailable.` 
      });
    }

    const videoTitle = info.videoDetails.title;
    const videoDuration = info.videoDetails.lengthSeconds;
    console.log(`📝 Video title: ${videoTitle}`);
    console.log(`⏱️  Duration: ${videoDuration} seconds`);

    // Step 3: Get available formats
    let formats;
    try {
      formats = ytdl.filterFormats(info.formats, 'audioandvideo');
      if (!formats || formats.length === 0) {
        console.error('❌ No formats with audio and video available');
        return res.status(400).json({ 
          success: false, 
          error: 'No suitable video format found (video may have restricted access)' 
        });
      }
    } catch (formatError) {
      console.error('❌ Failed to filter formats:', formatError.message);
      return res.status(400).json({ 
        success: false, 
        error: 'Failed to process video formats' 
      });
    }

    // Step 4: Select best format
    const format = formats.find(f => f.mimeType && f.mimeType.includes('video/mp4')) || formats[0];
    console.log(`🎬 Selected format: ${format.qualityLabel || 'best available'}`);
    console.log(`📊 Format size: ${format.contentLength ? (format.contentLength / 1024 / 1024).toFixed(2) + 'MB' : 'unknown'}`);

    // Step 5: Check file size limit (100MB max)
    if (format.contentLength && format.contentLength > 100 * 1024 * 1024) {
      console.error('❌ Video too large (>100MB)');
      return res.status(400).json({ 
        success: false, 
        error: 'Video too large (max 100MB)' 
      });
    }

    // Step 6: Create download stream
    let stream;
    try {
      stream = ytdl(youtubeUrl, { format });
      console.log('📥 Download stream created');
    } catch (streamError) {
      console.error('❌ Failed to create download stream:', streamError.message);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create download stream' 
      });
    }

    // Step 7: Upload to Cloudinary
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
        timeout: 60000
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

        // Step 8: Save to database
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

    // Handle stream errors
    stream.on('error', (error) => {
      console.error('❌ Download stream error:', error.message);
      uploadStream.destroy();
      return res.status(500).json({ 
        success: false, 
        error: `Download failed: ${error.message}` 
      });
    });

    // Pipe the stream to Cloudinary
    stream.pipe(uploadStream);
    console.log('📊 Streaming video to Cloudinary...');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ===== HEALTH CHECK ENDPOINT =====
app.get('/health-check', (req, res) => {
  const cloudinaryConfig = cloudinary.config();
  res.json({ 
    status: 'ok',
    message: 'Server is running',
    ytdlCore: typeof ytdl !== 'undefined' ? 'installed ✅' : 'missing ❌',
    cloudinary: cloudinaryConfig.cloud_name ? 'configured ✅' : 'not configured ❌',
    cloudinaryCloudName: cloudinaryConfig.cloud_name || 'not set',
    messagesCount: messages.length
  });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ YouTube download support enabled (@distube/ytdl)`);
  console.log(`✅ File upload support enabled`);
  
  const cloudinaryConfig = cloudinary.config();
  console.log(`📊 Cloudinary configured: ${cloudinaryConfig.cloud_name ? '✅ (' + cloudinaryConfig.cloud_name + ')' : '❌'}`);
  console.log(`📦 @distube/ytdl available: ${typeof ytdl !== 'undefined' ? '✅' : '❌'}`);
});

module.exports = app;
