#!/usr/bin/env node
/*
  scripts/sync-cards.js
  - Reads card-bot/cards.json and upserts rows into the Supabase table (default 'Photocards').
  - Uses the project's `card-bot/supabaseClient.js` so env keys from card-bot/.env are used.
*/
const fs = require('fs');
const path = require('path');
const supabase = require('../card-bot/supabaseClient');

(async function main(){
  const file = path.resolve(__dirname, '../card-bot/cards.json');
  if (!fs.existsSync(file)) {
    console.error('[sync-cards] cards.json not found at', file);
    process.exit(2);
  }

  let cards;
  try {
    cards = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('[sync-cards] failed to parse cards.json:', err.message || err);
    process.exit(1);
  }

  if (!Array.isArray(cards)) {
    console.error('[sync-cards] cards.json is not an array');
    process.exit(1);
  }

  const table = process.env.SUPABASE_TABLE || 'Photocards';
  console.log(`[sync-cards] upserting ${cards.length} rows into Supabase table '${table}'`);

  try {
    // Try upsert by id first (requires a unique or primary key on `id`)
    const { data, error } = await supabase.from(table).upsert(cards, { onConflict: 'id' });
    if (error) {
      // If the table doesn't have an index/PK on id, fall back to delete+insert for matching ids
      if (error.code === '42P10' || (error.message && error.message.includes('ON CONFLICT'))) {
        console.warn('[sync-cards] upsert not supported (no suitable constraint). Falling back to delete+insert for matching ids.');
        const ids = cards.map(c => c.id).filter(Boolean);
        if (ids.length === 0) {
          console.error('[sync-cards] no ids found to delete/insert');
          process.exit(1);
        }
        // delete existing rows with these ids, then insert fresh
        const delRes = await supabase.from(table).delete().in('id', ids);
        if (delRes.error) {
          console.error('[sync-cards] delete failed:', delRes.error);
          process.exit(1);
        }
        const ins = await supabase.from(table).insert(cards);
        if (ins.error) {
          console.error('[sync-cards] insert failed:', ins.error);
          process.exit(1);
        }
        console.log('[sync-cards] replace complete, inserted rows:', (ins.data && ins.data.length) || 0);
      } else {
        console.error('[sync-cards] Supabase error:', error);
        process.exit(1);
      }
    } else {
      console.log('[sync-cards] upsert complete, rows returned:', (data && data.length) || 0);
    }
  } catch (err) {
    console.error('[sync-cards] upsert failed:', err.message || err);
    process.exit(1);
  }
})();
