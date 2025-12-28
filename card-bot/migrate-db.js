#!/usr/bin/env node
/*
  migrate-db.js
  - Makes a timestamped backup of cards.db (in ./backups/)
  - Runs non-destructive migrations (CREATE TABLE IF NOT EXISTS, dedupe, CREATE UNIQUE INDEX IF NOT EXISTS)
  - Prints a summary of changes

  Usage: node migrate-db.js
*/
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_FILENAME = 'cards.db';
const DB_PATH = path.resolve(__dirname, DB_FILENAME);
const BACKUP_DIR = path.resolve(__dirname, 'backups');

function ensureBackupDir() {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (err) {
    console.error('[migrate] could not create backups dir:', err);
    process.exit(1);
  }
}

function createBackup() {
  if (!fs.existsSync(DB_PATH)) {
    console.log('[migrate] DB file does not exist, nothing to backup.');
    return null;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `cards.db.bak-${ts}.sqlite`;
  const backupPath = path.join(BACKUP_DIR, backupName);
  try {
    fs.copyFileSync(DB_PATH, backupPath);
    console.log(`[migrate] backup created at ${backupPath}`);
    return backupPath;
  } catch (err) {
    console.error('[migrate] failed to create backup:', err);
    process.exit(1);
  }
}

function runMigrations() {
  const db = new Database(DB_PATH);

  const before = (() => {
    try {
      return db.prepare('SELECT COUNT(*) AS c FROM pulls').get().c;
    } catch (e) {
      return 0;
    }
  })();

  const migrate = db.transaction(() => {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pulls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        pulled_at INTEGER NOT NULL
      )
    `).run();

    const del = db.prepare(`
      DELETE FROM pulls
      WHERE id NOT IN (
        SELECT MIN(id) FROM pulls GROUP BY user_id, card_id
      )
    `).run();

    db.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_card ON pulls(user_id, card_id)
    `).run();

    return del.changes || 0;
  });

  let deleted = 0;
  try {
    deleted = migrate();
  } catch (err) {
    console.error('[migrate] migration failed:', err);
    process.exit(1);
  }

  const after = db.prepare('SELECT COUNT(*) AS c FROM pulls').get().c;

  console.log(`[migrate] before: ${before} rows in pulls`);
  console.log(`[migrate] deleted duplicates: ${deleted}`);
  console.log(`[migrate] after: ${after} rows in pulls`);
  console.log('[migrate] migrations completed successfully.');
}

(function main() {
  ensureBackupDir();
  createBackup();
  runMigrations();
})();
