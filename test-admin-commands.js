(async function(){
  const supabaseListener = require('./supabase-listener');
  const db = require('./db');
  const cardsStore = require('./cardsStore');
  const fs = require('fs');
  try {
    console.log('1) Refreshing cards from Supabase...');
    await supabaseListener.fetchAndUpdate(true);
    console.log('-> cards after refresh:', (cardsStore.getCards()||[]).length);
  } catch (e) {
    console.error('refresh failed', e);
  }

  try {
    console.log('2) Normalizing pulls.card_id (TRIM)');
    db.prepare("UPDATE pulls SET card_id = TRIM(card_id) WHERE card_id IS NOT NULL").run();
    console.log('-> trim executed');
  } catch (e) {
    console.error('normalize failed', e);
  }

  try {
    console.log('3) Checking for missing card IDs in album...');
    const rows = db.prepare('SELECT COUNT(*) AS c FROM pulls').get().c;
    const distinct = db.prepare('SELECT DISTINCT card_id FROM pulls').all().map(r=>String(r.card_id||'').trim()).filter(Boolean);
    const cards = cardsStore.getCards() || [];
    const cardIds = new Set(cards.map(c=>String(c.id||'').trim().toLowerCase()));
    const missing = distinct.filter(id=>!cardIds.has(String(id||'').trim().toLowerCase()));
    console.log('-> total pulls:', rows);
    console.log('-> distinct card_ids:', distinct.length);
    console.log('-> missing count:', missing.length);
    if (missing.length>0) console.log('-> sample missing:', missing.slice(0,50));
    fs.writeFileSync('backups/test-admin-report.json', JSON.stringify({pulls: rows, distinct: distinct.length, missingCount: missing.length, missingSample: missing.slice(0,200)}, null,2));
    console.log('Report written to backups/test-admin-report.json');
  } catch (e) {
    console.error('check failed', e);
  }

  process.exit(0);
})();
