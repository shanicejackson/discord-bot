#!/usr/bin/env node
/**
 * scripts/add-card.js
 * Usage examples:
 *  node scripts/add-card.js --id pcNEW001 --name "New Card" --group "Group" --rarity R --image_url "https://..." [--created_at 2025-12-23T00:00:00Z]
 *  node scripts/add-card.js --dry-run --id ...   # print payload without sending
 */
const supabase = require('../card-bot/supabaseClient');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') {
      out.dryRun = true;
      continue;
    }
    if (a === '--help' || a === '-h') {
      out.help = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        const key = a.slice(2, eq);
        const val = a.slice(eq + 1);
        out[key] = val;
      } else {
        const key = a.slice(2);
        const val = argv[i + 1];
        if (val && !val.startsWith('--')) {
          out[key] = val;
          i++;
        } else {
          out[key] = true;
        }
      }
    }
  }
  return out;
}

function usage() {
  console.log('Usage: node scripts/add-card.js --id <id> --name <name> --group <group> --rarity <rarity> --image_url <url> [--created_at <iso>] [--dry-run]');
  console.log('Example: node scripts/add-card.js --id pcNEW001 --name "New Card" --group "Group" --rarity R --image_url "https://..."');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const required = ['id', 'name', 'group', 'rarity', 'image_url'];
  const missing = required.filter(k => !args[k]);
  if (missing.length > 0 && !args.dryRun) {
    console.error('Missing required fields:', missing.join(', '));
    usage();
    process.exit(2);
  }

  const payload = {
    id: args.id,
    name: args.name,
    group: args.group,
    rarity: args.rarity,
    image_url: args.image_url,
  };
  if (args.created_at) payload.created_at = args.created_at;

  if (args.dryRun) {
    console.log('[dry-run] payload:', JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  try {
    const table = process.env.SUPABASE_TABLE || 'Photocards';
    const { data, error } = await supabase.from(table).insert([payload]);
    if (error) {
      console.error('Supabase error:', error);
      process.exit(1);
    }
    console.log('Inserted:', data);
  } catch (err) {
    console.error('Insert failed:', err.message || err);
    process.exit(1);
  }
}

main();
