// netlify/functions/_lib/supabase.js
// Server-side Supabase client (service role) for Signal.

let cached = null;

function getSupabase() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  // Lazy-load to keep local dev lightweight if Supabase is not used.
  // npm i @supabase/supabase-js
  const { createClient } = require("@supabase/supabase-js");

  cached = createClient(url, key, {
    auth: { persistSession: false },
  });

  return cached;
}

module.exports = { getSupabase };
