import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" })); // Increase limit since we're storing URLs now, not base64

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chat")
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

// Message Schema
const messageSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 5000,
    },
    // OLD: Base64 image stored in DB (removed for large videos)
    // image: String,
    
    // NEW: Cloudinary URL (for videos)
    cloudinaryUrl: {
      type: String,
      default: null,
    },
    
    // NEW: Media type indicator
    mediaType: {
      type: String,
      enum: ["cloudinary", "base64", null],
      default: null,
    },
    
    // Keep base64 for images only (smaller)
    image: {
      type: String,
      default: null,
    },
    
    timestamp: {
      type: Number,
      required: true,
      index: true,
    },
    device: {
      type: String,
      default: "Unknown",
    },
  },
  { timestamps: true }
);

// Create indexes for better query performance
messageSchema.index({ timestamp: -1 });
messageSchema.index({ username: 1 });

const Message = mongoose.model("Message", messageSchema);

// ===== API ROUTES =====

// Health check
app.get("/", (req, res) => {
  res.json({ status: "✅ Chat server is online" });
});

// Get all messages (with limit)
app.get("/messages", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500); // Max 500 messages
    const messages = await Message.find()
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    // Return in ascending order (oldest first)
    res.json(messages.reverse());
  } catch (err) {
    console.error("❌ Get messages error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Get messages by username
app.get("/messages/user/:username", async (req, res) => {
  try {
    const messages = await Message.find({
      username: { $regex: req.params.username, $options: "i" },
    })
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    res.json(messages.reverse());
  } catch (err) {
    console.error("❌ Get user messages error:", err);
    res.status(500).json({ error: "Failed to fetch user messages" });
  }
});

// Post new message
app.post("/messages", async (req, res) => {
  try {
    const { username, text, timestamp, image, cloudinaryUrl, mediaType, device } = req.body;

    // Validation
    if (!username || !timestamp) {
      return res.status(400).json({ error: "Username and timestamp required" });
    }

    if (!text && !image && !cloudinaryUrl) {
      return res.status(400).json({ error: "Message text or media required" });
    }

    // Check total data size
    let totalSize = 0;
    if (image) totalSize += image.length;
    if (cloudinaryUrl) totalSize += cloudinaryUrl.length;
    if (text) totalSize += text.length;

    // If using cloudinaryUrl, we're storing a small URL (~200 bytes)
    // If using base64, check it doesn't exceed limits
    if (image && image.length > 5000000) {
      // 5MB limit for base64 images only
      return res.status(413).json({
        error: "Image too large. Use Cloudinary for videos.",
      });
    }

    // Create new message
    const message = new Message({
      username: username.trim().substring(0, 50),
      text: text ? text.trim().substring(0, 5000) : "",
      timestamp,
      image: image || null, // Base64 for images only
      cloudinaryUrl: cloudinaryUrl || null, // Cloudinary URL for videos
      mediaType: mediaType || null, // "cloudinary" or "base64"
      device: device || "Unknown",
    });

    await message.save();

    console.log(`✅ Message saved:`, {
      username: message.username,
      hasText: !!message.text,
      hasImage: !!message.image,
      hasCloudinaryUrl: !!message.cloudinaryUrl,
      mediaType: message.mediaType,
      timestamp: new Date(message.timestamp).toLocaleString(),
    });

    res.status(201).json(message);
  } catch (err) {
    console.error("❌ Post message error:", err);
    res.status(500).json({ error: "Failed to save message", details: err.message });
  }
});

// Delete message by ID
app.delete("/messages/:id", async (req, res) => {
  try {
    const message = await Message.findByIdAndDelete(req.params.id);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    console.log(`✅ Message deleted:`, message._id);
    res.json({ message: "Message deleted", id: message._id });
  } catch (err) {
    console.error("❌ Delete message error:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// Delete all messages (admin only - be careful!)
app.delete("/messages", async (req, res) => {
  try {
    // Optional: Add password protection
    const adminKey = req.query.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const result = await Message.deleteMany({});

    console.log(`✅ All messages deleted:`, result.deletedCount);
    res.json({ message: "All messages deleted", count: result.deletedCount });
  } catch (err) {
    console.error("❌ Delete all messages error:", err);
    res.status(500).json({ error: "Failed to delete messages" });
  }
});

// Get message count
app.get("/stats", async (req, res) => {
  try {
    const count = await Message.countDocuments();
    const users = await Message.distinct("username");
    const oldestMessage = await Message.findOne().sort({ timestamp: 1 }).lean();
    const newestMessage = await Message.findOne().sort({ timestamp: -1 }).lean();

    res.json({
      totalMessages: count,
      uniqueUsers: users.length,
      users: users,
      oldestMessage: oldestMessage?.timestamp,
      newestMessage: newestMessage?.timestamp,
      serverTime: Date.now(),
    });
  } catch (err) {
    console.error("❌ Stats error:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ┌─────────────────────────────┐
  │  🚀 Chat Server Running      │
  │  Port: ${PORT}                   │
  │  Environment: ${process.env.NODE_ENV || "development"}  │
  └─────────────────────────────┘
  `);
});
