DB migration & backup notes
===========================

Purpose
-------
This project includes a small migration and backup strategy to avoid accidental data loss when updating the database schema (for example, adding indexes or deduping rows).

Files
-----
- `migrate-db.js` — Manual script that:
  - copies `cards.db` to `backups/cards.db.bak-<timestamp>.sqlite`
  - runs non-destructive migrations: creates `pulls` table if missing, removes duplicate pulls (keeping earliest), and creates a UNIQUE index `idx_user_card` if missing.

- `db.js` — On startup the module now creates a timestamped backup (in `backups/`) and runs the same safe migrations inside a transaction. This avoids destructive operations and helps ensure your users' albums are preserved.

How to run the migration (recommended before any DB-changing release)
------------------------------------------------------------------
From the project root run:

```bash
node migrate-db.js
```

This will create a backup and apply the migrations. Check the console output for the backup path and a summary of rows before/after.

How to restore from a backup
----------------------------
If something goes wrong, stop the bot and replace the `cards.db` file with the desired backup file from the `backups/` folder. Example:

```bash
# stop the bot first, then
cp backups/cards.db.bak-2025-12-23T10-00-00-000Z.sqlite cards.db
# restart the bot
node index.js
```

Notes
-----
- The migration script and runtime `db.js` use non-destructive SQL (CREATE TABLE IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS) to be safe to run multiple times.
- Backups are timestamped and stored in `backups/`. Keep a periodic backup rotation if you have limited disk space.
- For complex schema changes (adding/removing columns, renames), prefer writing a targeted migration that copies data to a new table, verifies it, then switches over. Ask if you want a helper for that flow.
