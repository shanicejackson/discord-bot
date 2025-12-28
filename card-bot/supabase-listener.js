const supabase = require('./supabaseClient');
const readCards = require('./readCards');
const cardsStore = require('./cardsStore');

async function fetchAndUpdate(saveToFile = true) {
  const data = await readCards(saveToFile);
  if (Array.isArray(data)) {
    cardsStore.setCards(data, saveToFile);
    console.log('[supabase-listener] updated cards from Supabase (count=' + data.length + ')');
  } else {
    console.warn('[supabase-listener] readCards returned no data');
  }
}

function start() {
  const table = process.env.SUPABASE_TABLE || 'Photocards';
  // Use a server-side key (service role) for reliable subscriptions on server processes
  if (!process.env.SUPABASE_URL || !(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    console.warn('[supabase-listener] SUPABASE_URL or key missing — listener disabled');
    return;
  }

  try {
    // subscribe to all changes (INSERT/UPDATE/DELETE) on the table
    const channel = supabase.channel(`table-changes-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, async (payload) => {
        try {
          console.log('[supabase-listener] change detected:', payload.eventType || payload.type, payload.table || table);
          // On any change, re-fetch the table and update local state
          await fetchAndUpdate(true);
        } catch (err) {
          console.error('[supabase-listener] error handling payload:', err);
        }
      })
      .subscribe();

    console.log('[supabase-listener] subscribed to Supabase realtime for table', table);
  } catch (err) {
    console.error('[supabase-listener] failed to start listener:', err.message || err);
  }
}

module.exports = { start, fetchAndUpdate };
