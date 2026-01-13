// ===== server.js (FIXED) =====
// Fixed: Missing 'multer' module error
// Added: DELETE /messages/clear endpoint for extension

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');  // ✅ FIX: Added missing import
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// ===== MIDDLEWARE =====
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ===== CLOUDINARY CONFIG =====
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'your_cloud_name',
    api_key: process.env.CLOUDINARY_API_KEY || 'your_api_key',
    api_secret: process.env.CLOUDINARY_API_SECRET || 'your_api_secret'
});

// ===== MULTER STORAGE CONFIG =====
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'chatroom_videos',
        resource_type: 'auto',
        format: 'mp4'
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// ===== IN-MEMORY DATABASE =====
let messages = [];

// ===== ROUTES =====

// GET all messages
app.get('/messages', (req, res) => {
    try {
        console.log(`📬 GET /messages → ${messages.length} messages`);
        res.json(messages);
    } catch (error) {
        console.error('❌ Error fetching messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST new message (text/image/video)
app.post('/messages', (req, res) => {
    try {
        const { username, text, image, videoUrl, timestamp } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        const message = {
            id: uuidv4(),
            username: username,
            text: text || null,
            image: image || null,
            videoUrl: videoUrl || null,
            timestamp: timestamp || Date.now()
        };

        messages.push(message);

        console.log(`✅ Message saved: ${username} - ${text ? text.substring(0, 30) : 'media'}`);
        res.json({ 
            success: true, 
            message: message,
            totalMessages: messages.length 
        });

    } catch (error) {
        console.error('❌ Error saving message:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST upload to Cloudinary
app.post('/upload', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        console.log(`✅ File uploaded: ${req.file.filename}`);
        console.log(`📹 Cloudinary URL: ${req.file.path}`);

        res.json({
            success: true,
            videoUrl: req.file.path,
            filename: req.file.filename,
            size: req.file.size
        });

    } catch (error) {
        console.error('❌ Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ===== NEW: DELETE all messages =====
// 🆕 Added for Chrome extension feature
app.delete('/messages/clear', (req, res) => {
    try {
        const deletedCount = messages.length;
        messages = []; // Clear all messages

        console.log(`🗑️ Cleared ${deletedCount} messages`);

        res.json({
            success: true,
            message: `Deleted ${deletedCount} messages`,
            deletedCount: deletedCount
        });

    } catch (error) {
        console.error('❌ Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        timestamp: new Date().toISOString(),
        messageCount: messages.length
    });
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
    console.error('❌ Server error:', err);
    res.status(500).json({ error: err.message });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║       🎉 Chat Server Running! 🎉         ║
║                                          ║
║  ✅ Port: ${PORT}                         ║
║  ✅ API: http://localhost:${PORT}/messages  ║
║  ✅ Health: http://localhost:${PORT}/health ║
║                                          ║
║  Endpoints:                              ║
║  • GET    /messages                      ║
║  • POST   /messages                      ║
║  • POST   /upload                        ║
║  • DELETE /messages/clear (NEW)          ║
║  • GET    /health                        ║
║                                          ║
╚══════════════════════════════════════════╝
    `);
});

module.exports = app;
