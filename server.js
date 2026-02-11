// ===== server.js - CHATSERVER USING SUPABASE =====
const express = require('express');
const cors = require('cors');
const cloudinary = require('cloudinary').v2;
const fileUpload = require('express-fileupload');
const ytdl = require('@distube/ytdl-core');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// ===== CONFIGURE CLOUDINARY =====
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dfkedoqtu',
  api_key: process.env.CLOUDINARY_API_KEY || '974623582669831',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'n5UMrnz2_7g2QZ4-axmkhcY0PA'
});

// ===== CONFIGURE SUPABASE =====
// Put these in your Render env vars for production:
const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://ftepqsnfnutrvhnnkwsj.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ0ZXBxc25mbnV0cnZobm5rd3NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3OTMwNjEsImV4cCI6MjA4NjM2OTA2MX0.-SsqZCnE8VoL7Zpdqvl9H8YB85h02lTOhGP2Iaxj4Cw';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(fileUpload());

// ===== GET ALL MESSAGES (FROM SUPABASE) =====
app.get('/messages', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('❌ Supabase select error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('❌ /messages error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== POST NEW MESSAGE (TO SUPABASE) =====
app.post('/messages', async (req, res) => {
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

  try {
    const { error } = await supabase.from('messages').insert([message]);

    if (error) {
      console.error('❌ Supabase insert error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, id: message.id });
  } catch (err) {
    console.error('❌ /messages insert error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== DELETE ALL MESSAGES (SUPABASE) =====
app.delete('/messages/clear', async (req, res) => {
  try {
    const { error } = await supabase.from('messages').delete().neq('id', '');

    if (error) {
      console.error('❌ Supabase delete error:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, message: 'All messages deleted' });
  } catch (err) {
    console.error('❌ /messages/clear error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ===== IMAGE/VIDEO UPLOAD TO CLOUDINARY =====
app.post('/upload', (req, res) => {
  if (!req.files || !req.files.file) {
    console.error('❌ No file provided in upload request');
    return res.status(400).json({ success: false, error: 'No file provided' });
  }

  const file = req.files.file;
  console.log(
    `📁 Uploading file: ${file.name} (${(file.size / 1024 / 1024).toFixed(
      2
    )}MB)`
  );

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

// ===== YOUTUBE DOWNLOAD ENDPOINT (@DISTUBE/YTDL-CORE + SUPABASE) =====
app.post('/download-youtube', async (req, res) => {
  const { youtubeUrl, username, timestamp } = req.body;

  if (!youtubeUrl) {
    console.error('❌ No YouTube URL provided');
    return res
      .status(400)
      .json({ success: false, error: 'YouTube URL is required' });
  }

  if (!username || !timestamp) {
    console.error('❌ Missing username or timestamp');
    return res
      .status(400)
      .json({ success: false, error: 'Username and timestamp required' });
  }

  try {
    console.log(`🎥 [YouTube] Received request for: ${youtubeUrl}`);
    console.log(`👤 Username: ${username}`);

    const youtubeRegex =
      /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//;
    if (!youtubeRegex.test(youtubeUrl)) {
      console.error('❌ Invalid YouTube URL format');
      return res
        .status(400)
        .json({ success: false, error: 'Invalid YouTube URL format' });
    }
    console.log('✅ URL validation passed');

    console.log('📥 Fetching video information...');
    let info;
    try {
      info = await ytdl.getInfo(youtubeUrl);
    } catch (infoError) {
      console.error('❌ Failed to get video info:', infoError.message);
      return res.status(400).json({
        success: false,
        error: `Cannot download video: ${infoError.message}. Video may be unavailable or require login.`
      });
    }

    const videoTitle = info.videoDetails?.title || 'YouTube Video';
    const videoDuration = info.videoDetails?.lengthSeconds || 'unknown';
    const videoId = info.videoDetails?.videoId || 'unknown';

    console.log(`📝 Video title: ${videoTitle}`);
    console.log(`⏱️  Duration: ${videoDuration}s`);
    console.log(`🎬 Video ID: ${videoId}`);

    console.log('📥 Starting YouTube video download...');
    let stream;
    try {
      stream = ytdl(youtubeUrl, {
        quality: 'highest',
        filter: 'audioandvideo'
      });
    } catch (downloadError) {
      console.error('❌ Failed to download video:', downloadError.message);
      return res.status(400).json({
        success: false,
        error: `Download failed: ${downloadError.message}`
      });
    }
    console.log('✅ Download stream created');

    console.log('☁️  Starting Cloudinary upload...');
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        public_id: `youtube-${Date.now()}`,
        folder: 'youtube-downloads',
        eager: [{ width: 300, height: 300, crop: 'fill', format: 'jpg' }],
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

        try {
          const message = {
            id: Date.now().toString(),
            username,
            videoUrl:
              result.secure_url + '?quality=auto:good&fetch_format=mp4',
            timestamp,
            youtubeTitle: videoTitle,
            youtubeUrl: youtubeUrl
          };

          const { error: dbError } = await supabase
            .from('messages')
            .insert([message]);

          if (dbError) {
            console.error('❌ Supabase insert error:', dbError.message);
            return res.status(500).json({
              success: false,
              error: `Failed to save video: ${dbError.message}`
            });
          }

          console.log('✅ Message saved to Supabase');

          return res.json({
            success: true,
            message: `✅ YouTube video processed: ${videoTitle}`,
            videoUrl: message.videoUrl,
            title: videoTitle
          });
        } catch (dbError) {
          console.error('❌ Database error:', dbError.message);
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

    stream.pipe(uploadStream);
    console.log('📊 Piping video to Cloudinary...');
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    return res.status(500).json({
      success: false,
      error: `Cannot download video: ${error.message}. Video may be unavailable or require login.`
    });
  }
});

// ===== HEALTH CHECK ENDPOINT =====
app.get('/health-check', async (req, res) => {
  const cloudinaryConfig = cloudinary.config();
  let messagesCount = 0;

  try {
    const { data, error } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true });

    if (!error && typeof data === 'undefined') {
      // count is in error or metadata for head queries; ignore exact count
      // fallback to 0
    }
  } catch {
    // ignore count errors in health check
  }

  res.json({
    status: 'ok',
    message: 'Server is running',
    ytdl: typeof ytdl !== 'undefined' ? 'loaded ✅' : 'missing ❌',
    cloudinary: cloudinaryConfig.cloud_name ? 'configured ✅' : 'not configured ❌',
    cloudinaryCloudName: cloudinaryConfig.cloud_name || 'not set',
    messagesCount
  });
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ YouTube download support enabled (@distube/ytdl-core)`);
  console.log(`✅ File upload support enabled`);

  const cloudinaryConfig = cloudinary.config();
  console.log(
    `📊 Cloudinary configured: ${
      cloudinaryConfig.cloud_name
        ? '✅ (' + cloudinaryConfig.cloud_name + ')'
        : '❌'
    }`
  );
  console.log(
    `📦 @distube/ytdl-core available: ${
      typeof ytdl !== 'undefined' ? '✅' : '❌'
    }`
  );
});

module.exports = app;
