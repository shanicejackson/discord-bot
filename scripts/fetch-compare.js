const path = require('path');
const readCards = require('../card-bot/readCards');
const fs = require('fs');
(async () => {
  try {
    const cardsPath = path.resolve(__dirname, '..', 'card-bot', 'cards.json');
    const before = fs.existsSync(cardsPath) ? JSON.parse(fs.readFileSync(cardsPath,'utf8')||'[]') : [];
    const beforeIds = new Set(before.map(c => String(c.id || '').trim()));
    console.log('before count', before.length);

    const data = await readCards(true);
    if (!data) {
      console.error('fetch failed');
      process.exit(1);
    }

    const after = fs.existsSync(cardsPath) ? JSON.parse(fs.readFileSync(cardsPath,'utf8')||'[]') : [];
    const afterIds = new Set(after.map(c => String(c.id || '').trim()));
    console.log('after count', after.length);

    const added = [];
    for (const id of afterIds) if (!beforeIds.has(id)) added.push(id);
    const removed = [];
    for (const id of beforeIds) if (!afterIds.has(id)) removed.push(id);

    console.log('added count', added.length, 'removed count', removed.length);
    console.log('sample added (first 50):', added.slice(0,50));
    console.log('sample removed (first 50):', removed.slice(0,50));
  } catch (err) {
    console.error('error', err);
    process.exit(1);
  }
})();
