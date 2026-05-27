// netlify/functions/signal-unsubscribe.js
// GET ?token=...
// Marks subscriber as unsubscribed in Supabase.

const { getSupabase } = require("./_lib/supabase");

exports.handler = async function handler(event) {
  const token = String(event.queryStringParameters?.token || "").trim();

  if (!token) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Missing token.",
    };
  }

  const supabase = getSupabase();
  if (!supabase) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Unsubscribe is not configured.",
    };
  }

  const { error } = await supabase
    .from("signal_subscribers")
    .update({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
    .eq("unsubscribe_token", token);

  if (error) {
    console.error("[signal-unsubscribe] supabase error", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Failed to unsubscribe.",
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: "You are unsubscribed.",
  };
};
