import express from "express";
import cors from "cors";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// CockroachDB Connection Pool
const { Pool } = pg;

let pool;

try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  pool.on("connect", () => {
    console.log("✅ CockroachDB connected");
  });

  pool.on("error", (err) => {
    console.error("❌ CockroachDB error:", err);
  });
} catch (err) {
  console.error("❌ Failed to create pool:", err);
  process.exit(1);
}

// Initialize database
async function initDB() {
  let retries = 3;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      try {
        // Create table if not exists
        await client.query(`
          CREATE TABLE IF NOT EXISTS messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            username VARCHAR(50) NOT NULL,
            text TEXT,
            file_url VARCHAR(500),
            media_type VARCHAR(20),
            device VARCHAR(200),
            timestamp BIGINT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
          );
        `);

        // MIGRATE: Add missing columns if they don't exist
        try {
          await client.query(`
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_url VARCHAR(500);
          `);
          console.log("✅ Added file_url column");
        } catch (e) {
          if (!e.message.includes("already exists")) {
            console.log("ℹ file_url column already exists");
          }
        }

        try {
          await client.query(`
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_type VARCHAR(20);
          `);
          console.log("✅ Added media_type column");
        } catch (e) {
          if (!e.message.includes("already exists")) {
            console.log("ℹ media_type column already exists");
          }
        }

        try {
          await client.query(`
            ALTER TABLE messages ADD COLUMN IF NOT EXISTS device VARCHAR(200);
          `);
          console.log("✅ Added device column");
        } catch (e) {
          if (!e.message.includes("already exists")) {
            console.log("ℹ device column already exists");
          }
        }

        // Create indexes
        try {
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_timestamp ON messages(timestamp DESC);
          `);
        } catch (e) {
          // Index already exists - ignore
        }

        try {
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_username ON messages(username);
          `);
        } catch (e) {
          // Index already exists - ignore
        }

        console.log("✅ Database initialized and migrated");
        break;
      } finally {
        client.release();
      }
    } catch (err) {
      retries--;
      console.error(`❌ DB init error (${retries} retries left):`, err.message);
      if (retries === 0) {
        console.error("Failed to initialize database after 3 attempts");
        // Continue anyway - some columns might already exist
        break;
      } else {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }
}

initDB();

// ===== ROUTES =====

// Health check
app.get("/", (req, res) => {
  res.json({ status: "✅ Chat server is online" });
});

// Get messages
app.get("/messages", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    
    const result = await pool.query(
      `SELECT id, username, text, file_url, media_type, device, timestamp 
       FROM messages 
       ORDER BY timestamp ASC 
       LIMIT $1`,
      [limit]
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error("❌ Get messages error:", err);
    res.status(500).json({ 
      error: "Failed to fetch messages", 
      details: err.message,
      code: err.code 
    });
  }
});

// Post message
app.post("/messages", async (req, res) => {
  try {
    const { username, text, timestamp, fileUrl, mediaType, device } = req.body;

    // Validate
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Valid username required" });
    }

    if (!timestamp || typeof timestamp !== "number") {
      return res.status(400).json({ error: "Valid timestamp required" });
    }

    if (!text && !fileUrl) {
      return res.status(400).json({ error: "Message text or file URL required" });
    }

    // Sanitize inputs
    const cleanUsername = username.trim().substring(0, 50);
    const cleanText = text ? text.trim().substring(0, 5000) : null;
    const cleanFileUrl = fileUrl ? fileUrl.substring(0, 500) : null;
    const cleanMediaType = mediaType ? mediaType.substring(0, 20) : null;
    const cleanDevice = device ? device.substring(0, 200) : null;

    // Insert
    const result = await pool.query(
      `INSERT INTO messages (username, text, file_url, media_type, device, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, text, file_url, media_type, device, timestamp`,
      [cleanUsername, cleanText, cleanFileUrl, cleanMediaType, cleanDevice, timestamp]
    );

    if (!result.rows || result.rows.length === 0) {
      throw new Error("Failed to insert message");
    }

    console.log(`✅ Message saved from ${cleanUsername}`);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Post message error:", err);
    res.status(500).json({ 
      error: "Failed to save message", 
      details: err.message,
      code: err.code 
    });
  }
});

// Delete message
app.delete("/messages/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Message ID required" });
    }

    const result = await pool.query(
      `DELETE FROM messages WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: "Message not found" });
    }

    res.json({ message: "Deleted", id: result.rows[0].id });
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ 
    error: "Internal server error", 
    message: err.message,
    code: err.code 
  });
});

// Start
app.listen(PORT, () => {
  console.log(`
  ┌──────────────────────────┐
  │ 🚀 Chat Server Online   │
  │ Port: ${PORT}                │
  │ DB: CockroachDB          │
  │ Files: Supabase Storage  │
  └──────────────────────────┘
  `);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down gracefully...");
  await pool.end();
  process.exit(0);
});
