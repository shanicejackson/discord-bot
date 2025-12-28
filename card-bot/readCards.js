const supabase = require("./supabaseClient");
const fs = require("fs");
const path = require("path");

async function readCards(saveToFile = false) {
  const candidates = [
    process.env.SUPABASE_TABLE,
    'cards',
    'photocards',
    'Photocards',
    'PhotoCards',
    'photo_cards'
  ].filter(Boolean);

  let lastErr = null;
  for (const table of candidates) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        lastErr = error;
        continue;
      }

      console.log(`Fetched ${data.length} rows from Supabase table '${table}'.`);

      if (saveToFile) {
        const outPath = path.resolve(__dirname, 'cards.json');
        try {
          fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
          console.log(`[readCards] saved ${data.length} rows to ${outPath}`);
        } catch (err) {
          console.error('[readCards] failed to write cards.json:', err);
        }
      }

      return data;
    } catch (err) {
      lastErr = err;
    }
  }

  console.error('[readCards] failed to fetch from Supabase. Last error:', lastErr);
  return null;
}

// Export the function for programmatic use. When executed directly, run CLI behavior.
module.exports = readCards;

if (require.main === module) {
  (async () => {
    const saveFlag = process.argv.includes("--save") || process.argv.includes("-s");
    await readCards(saveFlag);
  })();
}
