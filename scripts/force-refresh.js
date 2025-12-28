const path = require('path');
const supListener = require('../card-bot/supabase-listener');
const cardsStore = require('../card-bot/cardsStore');
const fs = require('fs');
(async () => {
  try {
    const cardsPath = path.resolve(__dirname, '..', 'card-bot', 'cards.json');
    const before = cardsStore.getCards() || [];
    const beforeIds = new Set(before.map(c => String(c.id || '').trim()));
    console.log('in-memory before count', before.length);

    // Force fetch and persist
    await supListener.fetchAndUpdate(true);

    const after = cardsStore.getCards() || [];
    const afterIds = new Set(after.map(c => String(c.id || '').trim()));
    console.log('in-memory after count', after.length);

    const added = [];
    for (const id of afterIds) if (!beforeIds.has(id)) added.push(id);
    const removed = [];
    for (const id of beforeIds) if (!afterIds.has(id)) removed.push(id);

    console.log('added count', added.length, 'removed count', removed.length);
    console.log('sample added (first 50):', added.slice(0,50));
    console.log('sample removed (first 50):', removed.slice(0,50));

    // Also show any entries with missing image_url
    const missingImages = after.filter(c => !c.image_url || !String(c.image_url).trim()).map(c => c.id).slice(0,50);
    console.log('entries with missing image_url (first 50):', missingImages);
  } catch (err) {
    console.error('force-refresh failed', err);
    process.exit(1);
  }
})();
