// ===== server.js - CHATSERVER WITH YOUTUBE & FILE UPLOAD (YT-DLP FIX) =====
const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const { execFile } = require('child_process');
const path = require('path');
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

// ===== YOUTUBE DOWNLOAD ENDPOINT (YT-DLP) =====
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
    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//;
    if (!youtubeRegex.test(youtubeUrl)) {
      console.error('❌ Invalid YouTube URL format');
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid YouTube URL format' 
      });
    }
    console.log('✅ URL validation passed');

    // Step 2: Download using yt-dlp command line
    console.log('📥 Starting yt-dlp download...');
    
    const downloadPromise = new Promise((resolve, reject) => {
      // Run yt-dlp to get video info and best format
      execFile('yt-dlp', [
        youtubeUrl,
        '-f', 'best[ext=mp4]/best',
        '-o', '-', // output to stdout
      ], {
        maxBuffer: 100 * 1024 * 1024, // 100MB buffer
        timeout: 120000 // 2 minute timeout
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ yt-dlp error:', stderr || error.message);
          reject(new Error(stderr || error.message));
        } else {
          resolve(stdout);
        }
      });
    });

    const videoStream = await downloadPromise;
    console.log(`✅ Video downloaded: ${(videoStream.length / 1024 / 1024).toFixed(2)}MB`);

    // Step 3: Upload to Cloudinary
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

        // Step 4: Save to database
        try {
          const message = {
            id: Date.now().toString(),
            username,
            videoUrl: result.secure_url + '?quality=auto:good&fetch_format=mp4',
            timestamp,
            youtubeUrl: youtubeUrl
          };

          messages.push(message);
          console.log('✅ Message saved to database');

          return res.json({ 
            success: true,
            message: `✅ YouTube video processed`,
            videoUrl: message.videoUrl,
            title: 'YouTube Video'
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

    uploadStream.on('error', (error) => {
      console.error('❌ Upload stream error:', error);
      res.status(500).json({ success: false, error: error.message });
    });

    // Write video stream to upload
    uploadStream.end(videoStream);
    console.log('📊 Uploading video to Cloudinary...');

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: `Cannot download video: ${error.message}. Video may be private, age-restricted, or unavailable.` 
    });
  }
});

// ===== HEALTH CHECK ENDPOINT =====
app.get('/health-check', async (req, res) => {
  const cloudinaryConfig = cloudinary.config();
  
  // Check if yt-dlp is available
  let ytdlpAvailable = false;
  try {
    await new Promise((resolve, reject) => {
      execFile('yt-dlp', ['--version'], { timeout: 5000 }, (error, stdout) => {
        if (!error) {
          console.log(`✅ yt-dlp version: ${stdout.trim()}`);
          ytdlpAvailable = true;
        }
        resolve();
      });
    });
  } catch (e) {
    console.log('⚠️ yt-dlp not available');
  }

  res.json({ 
    status: 'ok',
    message: 'Server is running',
    ytdlp: ytdlpAvailable ? 'installed ✅' : 'checking...',
    cloudinary: cloudinaryConfig.cloud_name ? 'configured ✅' : 'not configured ❌',
    cloudinaryCloudName: cloudinaryConfig.cloud_name || 'not set',
    messagesCount: messages.length
  });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ YouTube download support enabled (yt-dlp)`);
  console.log(`✅ File upload support enabled`);
  
  const cloudinaryConfig = cloudinary.config();
  console.log(`📊 Cloudinary configured: ${cloudinaryConfig.cloud_name ? '✅ (' + cloudinaryConfig.cloud_name + ')' : '❌'}`);
});

module.exports = app;
