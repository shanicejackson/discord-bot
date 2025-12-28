const fs = require('fs');
const path = require('path');
const db = require('../card-bot/db');
const cs = require('../card-bot/cardsStore');

function backupDb() {
  const src = path.resolve(__dirname, '..', 'card-bot', 'cards.db');
  if (!fs.existsSync(src)) return null;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.resolve(__dirname, '..', 'card-bot', 'backups', `cards.db.normalize-bak-${ts}.sqlite`);
  fs.copyFileSync(src, dest);
  return dest;
}

(async function main(){
  console.log('Backing up DB...');
  const bak = backupDb();
  if (bak) console.log('Backup created at', bak);

  console.log('Normalizing pulls.card_id (TRIM) ...');
  try {
    db.prepare("UPDATE pulls SET card_id = TRIM(card_id) WHERE card_id IS NOT NULL").run();
    console.log('Trim update executed.');
  } catch (e) {
    console.error('Failed to run trim update:', e.message);
    process.exit(1);
  }

  // Now report any card_ids that don't match cards.json
  const cards = cs.getCards();
  const cardIds = new Set((cards || []).map(c => String(c.id||'').trim().toLowerCase()));
  const rows = db.prepare('SELECT DISTINCT card_id FROM pulls').all().map(r=>r.card_id || '');
  const missing = rows.filter(id => !cardIds.has(String(id||'').trim().toLowerCase()));
  console.log('Distinct card_ids in pulls:', rows.length);
  console.log('Missing (not found in cards.json):', missing.length);
  if (missing.length>0) console.log(missing.slice(0,200));

  console.log('Report written to card-bot/backups/album-normalize-report.json');
  fs.writeFileSync(path.resolve(__dirname,'..','card-bot','backups','album-normalize-report.json'), JSON.stringify({distinctCardIds: rows.length, missingCount: missing.length, missingSample: missing.slice(0,200)}, null,2));
  console.log('Done.');
})();
