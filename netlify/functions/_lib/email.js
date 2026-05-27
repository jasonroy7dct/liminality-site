// netlify/functions/_lib/email.js
// Resend email helper for Signal.

function getResendClient() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  // npm i resend
  const { Resend } = require("resend");
  return new Resend(key);
}

async function sendEmail({ to, subject, html, text }) {
  const resend = getResendClient();
  const from = process.env.NEWSLETTER_FROM;
  if (!resend || !from) {
    return { ok: false, skipped: true };
  }

  const resp = await resend.emails.send({
    from,
    to,
    subject,
    html,
    text,
  });

  return { ok: true, resp };
}

module.exports = { sendEmail };
