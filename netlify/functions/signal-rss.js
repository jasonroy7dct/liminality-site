// netlify/functions/signal-rss.js
// RSS feed for Signal digests.
// Returns application/rss+xml

const { getSupabase } = require("./_lib/supabase");

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toRfc2822(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toUTCString();
}

exports.handler = async function handler(event) {
  const supabase = getSupabase();
  if (!supabase) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Signal</title><description>Signal RSS is not configured.</description></channel></rss>`,
    };
  }

  const siteUrl = (process.env.SITE_URL || "").replace(/\/+$/, "");
  const baseLink = siteUrl || "";

  // Last 30 days
  const { data, error } = await supabase
    .from("signal_digests")
    .select("date, items, created_at")
    .order("date", { ascending: false })
    .limit(30);

  if (error) {
    console.error("[signal-rss] supabase error", error);
    return { statusCode: 500, body: "RSS error" };
  }

  const items = (data || []).flatMap((row) => {
    const dayItems = Array.isArray(row.items) ? row.items : row.items?.items || [];
    return (dayItems || []).map((it, idx) => {
      const title = it?.title || "(Untitled)";
      const link = it?.url || "";
      const desc = it?.summary || "";
      const guid = link || `${row.date}#${idx + 1}`;
      return { title, link, desc, guid, pubDate: toRfc2822(row.created_at) };
    });
  });

  const channelTitle = "Signal";
  const channelLink = baseLink ? `${baseLink}/signal` : "";
  const channelDesc = "Daily top 3 tech reads with short summaries.";

  const xmlItems = items
    .map(
      (it) => `
  <item>
    <title>${esc(it.title)}</title>
    ${it.link ? `<link>${esc(it.link)}</link>` : ""}
    <guid isPermaLink="${it.link ? "true" : "false"}">${esc(it.guid)}</guid>
    <pubDate>${esc(it.pubDate)}</pubDate>
    <description>${esc(it.desc)}</description>
  </item>`
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${esc(channelTitle)}</title>
  ${channelLink ? `<link>${esc(channelLink)}</link>` : ""}
  <description>${esc(channelDesc)}</description>
  <lastBuildDate>${esc(new Date().toUTCString())}</lastBuildDate>
  ${xmlItems}
</channel>
</rss>`;

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "max-age=300",
    },
    body: xml,
  };
};
