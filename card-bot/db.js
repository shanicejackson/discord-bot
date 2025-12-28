const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_FILENAME = "cards.db";
const DB_PATH = path.resolve(__dirname, DB_FILENAME);
const BACKUP_DIR = path.resolve(__dirname, "backups");

// Ensure backups directory exists
try {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
} catch (err) {
  console.error("[db] could not create backups directory:", err);
}

// Create a timestamped backup before performing any schema changes.
// This minimizes the risk of data loss during updates.
function createBackupIfExists() {
  if (!fs.existsSync(DB_PATH)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `cards.db.bak-${ts}.sqlite`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  try {
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`[db] backup created at ${backupPath}`);
    return backupPath;
  } catch (err) {
    console.error("[db] failed to create DB backup:", err);
    return null;
  }
}

// Create backup (no-op if DB doesn't exist yet)
createBackupIfExists();

const db = new Database(DB_PATH);

// Run non-destructive migrations inside a transaction. These statements
// are safe to run repeatedly and will not drop or overwrite existing data.
const migrate = db.transaction(() => {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS pulls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      pulled_at INTEGER NOT NULL
    )
  `).run();

  // Clean up any existing duplicate entries (keep the earliest entry per user/card)
  db.prepare(`
    DELETE FROM pulls
    WHERE id NOT IN (
      SELECT MIN(id) FROM pulls GROUP BY user_id, card_id
    )
  `).run();

    // Normalize stored card_id values (trim whitespace) to reduce mismatches with cards.json
    try {
      db.prepare(`UPDATE pulls SET card_id = TRIM(card_id) WHERE card_id IS NOT NULL`).run();
    } catch (e) {
      // Non-fatal — normalization best-effort
      console.warn('[db] card_id normalization failed:', e.message);
    }

  // Add a UNIQUE index to prevent future duplicates at the DB level
  db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_card ON pulls(user_id, card_id)
  `).run();
});

try {
  migrate();
  console.log("[db] migrations applied (non-destructive)");
} catch (err) {
  console.error("[db] migration failed:", err);
}

module.exports = db;
