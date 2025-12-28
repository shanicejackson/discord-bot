const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const { createClient } = require("@supabase/supabase-js");

// Prefer an anon key, but fall back to service role key if provided in .env
const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!process.env.SUPABASE_URL || !supabaseKey) {
  console.warn('[supabaseClient] SUPABASE_URL or key missing from .env — network requests will fail');
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  supabaseKey
);

module.exports = supabase;
