// netlify/functions/signal-subscribe.js
// POST { email }
// Stores subscriber in Supabase (recommended) and returns OK.

const crypto = require("crypto");
const { getSupabase } = require("./_lib/supabase");
const { sendEmail } = require("./_lib/email");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || "{}") || {};
  } catch (_) {
    payload = {};
  }

  const email = normalizeEmail(payload.email);
  if (!isValidEmail(email)) {
    return json(400, { error: "Invalid email" });
  }

  const supabase = getSupabase();
  if (!supabase) {
    // No DB configured: still succeed (site UI doesn't break), but warn.
    return json(200, { ok: true, note: "SUPABASE not configured" });
  }

  const token = crypto.randomBytes(24).toString("hex");

  // Upsert subscriber
  const { error } = await supabase
    .from("signal_subscribers")
    .upsert(
      {
        email,
        status: "active",
        unsubscribe_token: token,
        unsubscribed_at: null,
      },
      { onConflict: "email" }
    );

  if (error) {
    console.error("[signal-subscribe] supabase error", error);
    return json(500, { error: "Failed to subscribe" });
  }

  // Optional: send a quick confirmation email
  const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const unsubUrl = siteUrl ? `${siteUrl}/.netlify/functions/signal-unsubscribe?token=${token}` : "";

  try {
    await sendEmail({
      to: email,
      subject: "Subscribed to Signal",
      text: `You're subscribed to Signal.\n\nIf you want to unsubscribe: ${unsubUrl}`,
      html: `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.6;">
          <h2 style="margin:0 0 8px;">Signal subscription confirmed</h2>
          <p style="margin:0 0 12px;">You’ll receive the daily top 3 tech reads with short summaries.</p>
          ${unsubUrl ? `<p style="margin:0; font-size:12px; color:#666;">Unsubscribe: <a href="${unsubUrl}">${unsubUrl}</a></p>` : ""}
        </div>
      `,
    });
  } catch (e) {
    // Do not fail subscription if email delivery fails
    console.error("[signal-subscribe] email send failed", e);
  }

  return json(200, { ok: true });
};
