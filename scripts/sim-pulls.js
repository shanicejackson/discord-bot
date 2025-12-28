const path = require('path');
const bot = require('../card-bot/index.js');

const N = parseInt(process.argv[2], 10) || 10000;
console.log(`Running ${N} simulated pulls...`);
const start = Date.now();
const counts = { total: 0, rarity: {}, ids: {} };
for (let i = 0; i < N; i++) {
  const c = bot.rollCard();
  const id = String(c && c.id ? c.id : 'none');
  const r = String(c && c.rarity ? c.rarity : '?').toUpperCase();
  counts.total++;
  counts.rarity[r] = (counts.rarity[r] || 0) + 1;
  counts.ids[id] = (counts.ids[id] || 0) + 1;
}
const duration = Date.now() - start;
console.log(`Done in ${duration}ms`);
console.log('Rarity distribution:');
Object.entries(counts.rarity).sort((a,b)=>b[1]-a[1]).forEach(([r,n]) => console.log(`  ${r}: ${n} (${((n/N)*100).toFixed(2)}%)`));

const unique = Object.keys(counts.ids).length;
console.log(`Unique card ids seen: ${unique}`);
console.log('Top 20 most frequent ids:');
Object.entries(counts.ids).sort((a,b)=>b[1]-a[1]).slice(0,20).forEach(([id,n]) => console.log(`  ${id}: ${n}`));

// Report how many commons from cards.json were seen
const cs = require('../card-bot/cardsStore');
const allCommons = cs.getCards().filter(c => String(c.rarity||'').toUpperCase().startsWith('C')).map(c=>String(c.id));
const seenCommons = allCommons.filter(id => counts.ids[id]);
console.log(`Commons total in DB: ${allCommons.length}, seen in simulation: ${seenCommons.length}`);
console.log('Commons not seen (first 50):', allCommons.filter(id => !counts.ids[id]).slice(0,50));
