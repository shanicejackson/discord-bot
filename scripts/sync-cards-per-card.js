#!/usr/bin/env node
/**
 * scripts/sync-cards-per-card.js
 * Reads card-bot/cards.json and ensures each row exists in the Supabase table
 * by selecting by id and performing update or insert as appropriate.
 * This script logs per-row successes and failures to help debug permissions/schema issues.
 */
const fs = require('fs');
const path = require('path');
const supabase = require('../card-bot/supabaseClient');

async function sync() {
  const file = path.resolve(__dirname, '../card-bot/cards.json');
  if (!fs.existsSync(file)) {
    console.error('[sync-per-card] cards.json not found at', file);
    process.exit(2);
  }

  const cards = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(cards)) {
    console.error('[sync-per-card] cards.json is not an array');
    process.exit(1);
  }

  const table = process.env.SUPABASE_TABLE || 'Photocards';
  console.log(`[sync-per-card] syncing ${cards.length} cards to table '${table}'`);

  const summary = { inserted: 0, updated: 0, skipped: 0, failed: [] };

  for (const card of cards) {
    if (!card || !card.id) {
      summary.failed.push({ id: card && card.id, reason: 'missing id' });
      continue;
    }
    try {
      // Check existence
      const { data: existing, error: selErr } = await supabase.from(table).select('id').eq('id', card.id).limit(1);
      if (selErr) {
        summary.failed.push({ id: card.id, step: 'select', error: selErr });
        continue;
      }

      if (existing && existing.length > 0) {
        // Update
        const { data, error } = await supabase.from(table).update(card).eq('id', card.id);
        if (error) {
          summary.failed.push({ id: card.id, step: 'update', error });
          continue;
        }
        summary.updated++;
      } else {
        // Insert
        const { data, error } = await supabase.from(table).insert([card]);
        if (error) {
          summary.failed.push({ id: card.id, step: 'insert', error });
          continue;
        }
        summary.inserted++;
      }
    } catch (err) {
      summary.failed.push({ id: card.id, step: 'exception', error: err && err.message ? err.message : String(err) });
    }
  }

  console.log('[sync-per-card] summary:', { inserted: summary.inserted, updated: summary.updated, failed: summary.failed.length });
  if (summary.failed.length) console.log('[sync-per-card] failures:', JSON.stringify(summary.failed, null, 2));
}

sync().catch(err => {
  console.error('[sync-per-card] fatal', err);
  process.exit(1);
});
