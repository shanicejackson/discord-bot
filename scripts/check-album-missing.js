const db = require('../card-bot/db');
const cs = require('../card-bot/cardsStore');
const fs = require('fs');

const cards = cs.getCards();
const cardIds = new Set(cards.map(c => String(c.id || '').trim().toLowerCase()));
const pulls = db.prepare('SELECT id, user_id, card_id, pulled_at FROM pulls ORDER BY pulled_at DESC').all();
const missing = [];
for (const p of pulls) {
  const key = String(p.card_id || '').trim().toLowerCase();
  if (!cardIds.has(key)) missing.push(p);
}
console.log('pull rows:', pulls.length);
console.log('missing matches:', missing.length);
if (missing.length > 0) console.log(missing.slice(0, 50));

// Optionally write report
fs.writeFileSync('card-bot/backups/album-missing-report.json', JSON.stringify({pullsCount: pulls.length, missingCount: missing.length, missing: missing.slice(0,200)}, null, 2));
console.log('report written to card-bot/backups/album-missing-report.json');
