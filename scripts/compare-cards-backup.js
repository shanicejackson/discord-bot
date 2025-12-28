const fs = require('fs');
const path = require('path');
const d = path.resolve('card-bot','backups');
const files = fs.readdirSync(d).filter(f => f.startsWith('cards.json.bak-')).sort().reverse();
if (files.length === 0) {
  console.log('no cards.json backups found');
  process.exit(0);
}
const latest = path.join(d, files[0]);
const cur = path.resolve('card-bot','cards.json');
const a = JSON.parse(fs.readFileSync(cur,'utf8')||'[]').map(c => String(c.id||'').trim());
const b = JSON.parse(fs.readFileSync(latest,'utf8')||'[]').map(c => String(c.id||'').trim());
const setA = new Set(a);
const setB = new Set(b);
const added = a.filter(id => !setB.has(id));
const removed = b.filter(id => !setA.has(id));
console.log('latest backup:', files[0]);
console.log('current count:', a.length, 'backup count:', b.length);
console.log('added count:', added.length, 'removed count:', removed.length);
if (added.length>0) console.log('sample added (first 50):', added.slice(0,50));
if (removed.length>0) console.log('sample removed (first 50):', removed.slice(0,50));
