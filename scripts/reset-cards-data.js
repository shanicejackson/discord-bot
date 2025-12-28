const fs = require('fs');
const path = require('path');
const readCards = require('../card-bot/readCards');
const supListener = require('../card-bot/supabase-listener');

(async () => {
  try {
    const cardsPath = path.resolve(__dirname, '..', 'card-bot', 'cards.json');
    const dbPath = path.resolve(__dirname, '..', 'card-bot', 'cards.db');
    const backupDir = path.resolve(__dirname, '..', 'card-bot', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    // Backup cards.json
    if (fs.existsSync(cardsPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(backupDir, `cards.json.bak-${ts}.json`);
      fs.copyFileSync(cardsPath, dest);
      console.log('Backed up cards.json to', dest);
    } else {
      console.log('No cards.json to backup');
    }

    // Backup DB if exists and then remove
    if (fs.existsSync(dbPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(backupDir, `cards.db.bak-${ts}.sqlite`);
      fs.copyFileSync(dbPath, dest);
      console.log('Backed up DB to', dest);
      fs.unlinkSync(dbPath);
      console.log('Removed DB at', dbPath);
    } else {
      console.log('No DB to backup/remove');
    }

    // Write an empty cards.json placeholder (so code can still read it)
    fs.writeFileSync(cardsPath, JSON.stringify([], null, 2), 'utf8');
    console.log('Wrote empty cards.json');

    // Fetch from Supabase and save to cards.json
    const data = await readCards(true);
    if (!data) {
      console.error('Failed to fetch from Supabase');
      process.exit(1);
    }
    console.log('Fetched and saved', data.length, 'cards from Supabase');

    // Update in-memory store via listener helper
    if (supListener && typeof supListener.fetchAndUpdate === 'function') {
      await supListener.fetchAndUpdate(true);
      console.log('Supabase listener in-memory refresh complete');
    }

    console.log('Reset complete');
  } catch (err) {
    console.error('reset failed', err);
    process.exit(1);
  }
})();
