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
