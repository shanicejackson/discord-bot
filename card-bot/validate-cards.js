#!/usr/bin/env node
/**
 * validate-cards.js
 * - Validates the presence and shape of `cards.json`.
 * - Checks that required fields exist: id, name, file, rarity
 * - For local file paths (not http/https), checks file existence
 * - Prints a summary and list of problems
 */
const fs = require('fs');
const path = require('path');

const CARDS_PATH = path.resolve(__dirname, 'cards.json');

function isUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

function validateCard(card, index) {
  const problems = [];
  if (!card) {
    problems.push('card is null/undefined');
    return problems;
  }
  if (card.id === undefined || card.id === null || String(card.id).trim() === '') problems.push('missing id');
  if (!card.name || String(card.name).trim() === '') problems.push('missing name');
  if (!card.rarity || String(card.rarity).trim() === '') problems.push('missing rarity');
  // support multiple image field names returned by Supabase
  const fileVal = card.file || card.image_url || card.image || '';
  if (!fileVal || String(fileVal).trim() === '') {
    problems.push('missing file/image_url');
  } else {
    const f = String(fileVal).trim();
    if (!isUrl(f)) {
      // local path: check existence relative to repo
      const p = path.resolve(__dirname, f);
      if (!fs.existsSync(p)) problems.push(`local file not found: ${f}`);
    } else {
      // remote URL: we won't fetch, just check format
    }
  }
  return problems;
}

function main() {
  if (!fs.existsSync(CARDS_PATH)) {
    console.error(`[validate] ${CARDS_PATH} not found.`);
    console.log('Run `node readCards.js --save` to fetch from Supabase (requires SUPABASE env vars).');
    process.exit(2);
  }

  let cards;
  try {
    cards = JSON.parse(fs.readFileSync(CARDS_PATH, 'utf8'));
  } catch (err) {
    console.error('[validate] failed to parse cards.json:', err.message);
    process.exit(1);
  }

  if (!Array.isArray(cards)) {
    console.error('[validate] cards.json is not an array');
    process.exit(1);
  }

  const problems = [];
  cards.forEach((c, i) => {
    const p = validateCard(c, i);
    if (p.length > 0) problems.push({ index: i, id: c && c.id, problems: p });
  });

  console.log(`[validate] checked ${cards.length} cards.`);
  if (problems.length === 0) {
    console.log('[validate] OK — no problems found.');
    process.exit(0);
  }

  console.warn(`[validate] found ${problems.length} card(s) with issues:`);
  problems.forEach((r) => {
    console.log(`- index=${r.index} id=${r.id || '<missing>'}`);
    r.problems.forEach((pp) => console.log(`   • ${pp}`));
  });
  process.exit(3);
}

main();
