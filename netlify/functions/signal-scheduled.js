// netlify/functions/signal-scheduled.js
// Precompute today's Signal results on a schedule (see netlify.toml).
// This makes the Signal page load faster and ensures daily caching when @netlify/blobs is enabled.

const { handler: signalHandler } = require("./signal");
const { getSupabase } = require("./_lib/supabase");
const { sendEmail } = require("./_lib/email");

function safeText(x) {
  return String(x || "").replace(/\s+/g, " ").trim();
}

function toDateISO(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function renderDigestEmail({ dateISO, items, siteUrl }) {
  const title = `Signal · ${dateISO}`;
  const rows = (items || [])
    .map((it) => {
      const t = safeText(it.title);
      const u = safeText(it.url);
      const s = safeText(it.summary);
      return `
        <div style="margin:0 0 16px; padding:12px; border:1px solid rgba(0,0,0,0.12); border-radius:12px;">
          <div style="font-size:16px; font-weight:600; margin:0 0 6px;">
            <a href="${u}" style="color:#111827; text-decoration:none;">${t}</a>
          </div>
          <div style="font-size:14px; color:#374151; line-height:1.6;">${s}</div>
        </div>
      `;
    })
    .join("\n");

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.6; padding: 8px 0;">
      <h2 style="margin:0 0 6px;">${title}</h2>
      <p style="margin:0 0 16px; color:#6b7280;">Daily top 3 tech reads with short summaries.</p>
      ${rows}
      ${siteUrl ? `<p style="margin: 18px 0 0; font-size:12px; color:#6b7280;">Web view: <a href="${siteUrl}/signal">${siteUrl}/signal</a></p>` : ""}
    </div>
  `;

  const text = [`Signal · ${dateISO}`, "", ...(items || []).flatMap((it) => [
    `${safeText(it.title)}\n${safeText(it.url)}\n${safeText(it.summary)}`,
    "",
  ])].join("\n");

  return { subject: title, html, text };
}

exports.handler = async function (event, context) {
  // Force computation for just today (days=1)
  const e = {
    ...event,
    queryStringParameters: { ...(event?.queryStringParameters || {}), days: "1" },
  };

  const res = await signalHandler(e, context);

  let day = null;
  try {
    const payload = JSON.parse(res?.body || "{}") || {};
    day = Array.isArray(payload.days) ? payload.days[0] : null;
  } catch (_) {
    day = null;
  }

  // If Supabase + Resend are configured, send the daily email to active subscribers.
  const supabase = getSupabase();
  const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const dateISO = day?.dateISO || toDateISO(new Date());

  let mailed = 0;
  let mailSkipped = false;

  if (supabase && day?.items?.length) {
    const { data, error } = await supabase
      .from("signal_subscribers")
      .select("email, unsubscribe_token")
      .eq("status", "active")
      .limit(1000);

    if (error) {
      console.error("[signal-scheduled] subscriber read error", error);
    } else {
      const { subject, html, text } = renderDigestEmail({ dateISO, items: day.items, siteUrl });

      // Send one-by-one to keep it simple; if volume grows, batch it.
      for (const row of data || []) {
        const email = row.email;
        const token = row.unsubscribe_token;
        const unsub = siteUrl && token ? `${siteUrl}/.netlify/functions/signal-unsubscribe?token=${token}` : "";
        const htmlWithUnsub = unsub
          ? html + `<p style="margin:16px 0 0; font-size:12px; color:#6b7280;">Unsubscribe: <a href="${unsub}">${unsub}</a></p>`
          : html;
        const textWithUnsub = unsub ? `${text}\nUnsubscribe: ${unsub}` : text;

        try {
          const r = await sendEmail({ to: email, subject, html: htmlWithUnsub, text: textWithUnsub });
          if (r?.skipped) {
            mailSkipped = true;
            break;
          }
          mailed += 1;
        } catch (err) {
          console.error("[signal-scheduled] send error", email, err);
        }
      }
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      ok: true,
      note: "Signal scheduled run completed",
      upstream: {
        statusCode: res?.statusCode,
      },
      mail: {
        sent: mailed,
        skipped: mailSkipped,
      },
    }),
  };
};
