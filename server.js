import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// CockroachDB Connection
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("connect", () => {
  console.log("✅ CockroachDB connected");
});

pool.on("error", (err) => {
  console.error("❌ CockroachDB error:", err);
});

// Create table if not exists
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(50) NOT NULL,
        text TEXT,
        image BYTEA,
        cloudinary_url TEXT,
        media_type VARCHAR(20),
        device VARCHAR(100),
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      
      CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_username ON messages(username);
    `);
    console.log("✅ Database tables initialized");
  } catch (err) {
    console.error("❌ DB init error:", err);
  }
}

initDB();

// ===== API ROUTES =====

// Health check
app.get("/", (req, res) => {
  res.json({ status: "✅ Chat server is online" });
});

// Get all messages (with limit)
app.get("/messages", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const result = await pool.query(
      `SELECT * FROM messages ORDER BY timestamp ASC LIMIT $1`,
      [limit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("❌ Get messages error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Get messages by username
app.get("/messages/user/:username", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM messages WHERE username ILIKE $1 ORDER BY timestamp DESC LIMIT 100`,
      [`%${req.params.username}%`]
    );

    res.json(result.rows.reverse());
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

    // Insert message
    const result = await pool.query(
      `INSERT INTO messages (username, text, image, cloudinary_url, media_type, device, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, text, cloudinary_url, media_type, device, timestamp`,
      [
        username.trim().substring(0, 50),
        text ? text.trim().substring(0, 5000) : null,
        image || null,
        cloudinaryUrl || null,
        mediaType || null,
        device || "Unknown",
        timestamp,
      ]
    );

    const savedMessage = result.rows[0];

    console.log(`✅ Message saved:`, {
      id: savedMessage.id,
      username: savedMessage.username,
      hasText: !!savedMessage.text,
      hasCloudinaryUrl: !!savedMessage.cloudinary_url,
      mediaType: savedMessage.media_type,
      timestamp: new Date(savedMessage.timestamp).toLocaleString(),
    });

    res.status(201).json(savedMessage);
  } catch (err) {
    console.error("❌ Post message error:", err);
    res.status(500).json({ error: "Failed to save message", details: err.message });
  }
});

// Delete message by ID
app.delete("/messages/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM messages WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    console.log(`✅ Message deleted:`, result.rows[0].id);
    res.json({ message: "Message deleted", id: result.rows[0].id });
  } catch (err) {
    console.error("❌ Delete message error:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// Delete all messages
app.delete("/messages", async (req, res) => {
  try {
    const adminKey = req.query.key;
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const result = await pool.query(`DELETE FROM messages`);

    console.log(`✅ All messages deleted`);
    res.json({ message: "All messages deleted", count: result.rowCount });
  } catch (err) {
    console.error("❌ Delete all messages error:", err);
    res.status(500).json({ error: "Failed to delete messages" });
  }
});

// Get stats
app.get("/stats", async (req, res) => {
  try {
    const countResult = await pool.query(`SELECT COUNT(*) as count FROM messages`);
    const usersResult = await pool.query(`SELECT DISTINCT username FROM messages`);
    const oldestResult = await pool.query(
      `SELECT timestamp FROM messages ORDER BY timestamp ASC LIMIT 1`
    );
    const newestResult = await pool.query(
      `SELECT timestamp FROM messages ORDER BY timestamp DESC LIMIT 1`
    );

    res.json({
      totalMessages: parseInt(countResult.rows[0].count),
      uniqueUsers: usersResult.rows.length,
      users: usersResult.rows.map((r) => r.username),
      oldestMessage: oldestResult.rows[0]?.timestamp,
      newestMessage: newestResult.rows[0]?.timestamp,
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
  │  Database: CockroachDB       │
  └─────────────────────────────┘
  `);
});
