// netlify/functions/signal.js
// Daily "Signal" tech brief: fetch RSS sources, rank items, summarize via LLM, and (optionally) persist by date.
//
// Env vars expected (matches your existing pattern):
// - LLM_API_KEY
// - LLM_MODEL (e.g., gpt-4o-mini or gpt-5-mini)
// - LLM_BASE_URL (e.g., https://api.openai.com/v1)
// - LLM_TIMEOUT_MS (optional, default 20000)
// - SIGNAL_DAYS (optional default days to return, default 14)
//
// Optional persistence (recommended):
// - If you install @netlify/blobs, this function will store daily results keyed by date.
//   npm i @netlify/blobs
//
// Notes:
// - Ranking is a pragmatic heuristic: source weight + recency + simple dedupe.
// - Summaries are short (Traditional Chinese) and based on RSS title/description.

const Parser = require("rss-parser");
const { getSupabase } = require("./_lib/supabase");

// Optional persistence
let getStore = null;
try {
  ({ getStore } = require("@netlify/blobs"));
} catch (_) {
  // No persistence available; will compute on demand.
}

const parser = new Parser({
  timeout: 15000,
  customFields: {
    item: ["content:encoded", "content", "dc:creator", "author"],
  },
});

const SOURCES = [
  // General / curated
  { name: "Hacker News", url: "https://hnrss.org/frontpage", weight: 1.0 },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", weight: 0.9 },
  { name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", weight: 0.9 },

  // Big tech engineering
  { name: "Google Developers Blog", url: "https://developers.googleblog.com/feeds/posts/default", weight: 0.95 },
  { name: "AWS Blog", url: "https://aws.amazon.com/blogs/aws/feed/", weight: 0.95 },
  { name: "Netflix TechBlog", url: "https://netflixtechblog.com/feed", weight: 0.95 },
  { name: "Meta Engineering", url: "https://engineering.fb.com/feed/", weight: 0.9 },
  { name: "Microsoft DevBlogs", url: "https://devblogs.microsoft.com/feed/", weight: 0.9 },

  // Infra / dev tools
  { name: "Cloudflare Blog", url: "https://blog.cloudflare.com/rss/", weight: 0.92 },
  { name: "Kubernetes Blog", url: "https://kubernetes.io/feed.xml", weight: 0.85 },
  { name: "GitHub Blog", url: "https://github.blog/feed/", weight: 0.85 },
  { name: "Stripe Blog", url: "https://stripe.com/blog/rss", weight: 0.82 },
];

function nowIso() {
  return new Date().toISOString();
}

function toDateISO(d = new Date()) {
  // YYYY-MM-DD in UTC
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

function safeText(x) {
  return String(x || "").replace(/\s+/g, " ").trim();
}

function guessPublishedISO(item) {
  const raw =
    item.isoDate ||
    item.pubDate ||
    item.published ||
    item.updated ||
    item.created ||
    null;

  if (!raw) return null;
  const t = new Date(raw);
  if (isNaN(t.getTime())) return null;
  return t.toISOString();
}

function normalizeUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  return s;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

function pickBestDescription(item) {
  return safeText(item.contentSnippet || item.summary || item.content || item["content:encoded"] || "");
}

async function fetchFeed(source) {
  const feed = await parser.parseURL(source.url);
  const items = (feed.items || []).map((it) => {
    const url = normalizeUrl(it.link);
    const publishedISO = guessPublishedISO(it) || null;

    return {
      title: safeText(it.title),
      url,
      source: source.name,
      sourceWeight: source.weight,
      domain: domainOf(url),
      publishedISO,
      description: pickBestDescription(it),
    };
  });

  return items;
}

function scoreItem(item, now = Date.now()) {
  const base = item.sourceWeight || 0.5;

  // Recency bonus: within 24h > 48h > older
  let recency = 0;
  if (item.publishedISO) {
    const ageHrs = (now - new Date(item.publishedISO).getTime()) / 3600000;
    if (ageHrs <= 24) recency = 0.35;
    else if (ageHrs <= 48) recency = 0.2;
    else if (ageHrs <= 96) recency = 0.08;
  }

  // Title length sanity (avoid ultra-short noise)
  const titleLen = (item.title || "").length;
  const titleQuality = titleLen >= 28 ? 0.08 : titleLen >= 16 ? 0.04 : 0;

  return base + recency + titleQuality;
}

function dedupe(items) {
  const seenUrl = new Set();
  const seenTitle = new Set();

  const out = [];
  for (const it of items) {
    const u = it.url || "";
    const t = (it.title || "").toLowerCase();

    if (u && seenUrl.has(u)) continue;
    if (t && seenTitle.has(t)) continue;

    if (u) seenUrl.add(u);
    if (t) seenTitle.add(t);

    out.push(it);
  }
  return out;
}

async function summarizeWithLLM(items) {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
  const model = process.env.LLM_MODEL || "gpt-4o-mini";
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 20000);

  if (!apiKey) {
    // No key: return empty summaries
    return items.map((it) => ({ ...it, summary: "" }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Summarize all three in one call (cheaper + consistent style)
    const promptItems = items.map((it, i) => {
      const desc = safeText(it.description).slice(0, 900);
      return [
        `#${i + 1}`,
        `Title: ${safeText(it.title)}`,
        `Source: ${safeText(it.source)}`,
        `URL: ${safeText(it.url)}`,
        `Snippet: ${desc}`,
      ].join("\n");
    });

    const userMsg = [
      "You are a concise tech editor.",
      "Please write Traditional Chinese (zh-Hant).",
      "For each item, output 1-2 sentences summary focusing on 'what happened' and 'why it matters'.",
      "Do not add extra items, do not include the URLs in the summary.",
      "Return JSON ONLY, in this schema:",
      `{ "summaries": [ { "index": 1, "summary": "..." }, { "index": 2, "summary": "..." }, { "index": 3, "summary": "..." } ] }`,
      "",
      promptItems.join("\n\n"),
    ].join("\n");

    const body = {
      model,
      messages: [
        { role: "system", content: "You produce strict JSON outputs only." },
        { role: "user", content: userMsg },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    };

    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[Signal] LLM error:", res.status, text);
      return items.map((it) => ({ ...it, summary: "" }));
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || "{}";

    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch (_) {
      parsed = null;
    }

    const summaries = Array.isArray(parsed?.summaries) ? parsed.summaries : [];
    const byIndex = new Map(summaries.map((s) => [Number(s.index), safeText(s.summary)]));

    return items.map((it, i) => ({
      ...it,
      summary: byIndex.get(i + 1) || "",
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function computeDailyTop3(dateISO) {
  // Pull last ~4 days to increase hit rate
  const horizonHrs = 96;
  const now = Date.now();

  const fetched = await Promise.allSettled(SOURCES.map((s) => fetchFeed(s)));

  let items = [];
  fetched.forEach((r) => {
    if (r.status === "fulfilled") items = items.concat(r.value);
    else console.warn("[Signal] feed failed:", r.reason?.message || r.reason);
  });

  items = dedupe(items);

  // Filter by recency (and valid url/title)
  items = items.filter((it) => it.title && it.url);

  items = items.filter((it) => {
    if (!it.publishedISO) return true; // keep if unknown
    const ageHrs = (now - new Date(it.publishedISO).getTime()) / 3600000;
    return ageHrs <= horizonHrs;
  });

  // Score + sort
  items.sort((a, b) => scoreItem(b, now) - scoreItem(a, now));

  // Pick top 3 with domain diversity (avoid 3 from same site)
  const picked = [];
  const usedDomains = new Set();

  for (const it of items) {
    const d = it.domain || "";
    if (d && usedDomains.has(d) && usedDomains.size < 3) continue;
    picked.push(it);
    if (d) usedDomains.add(d);
    if (picked.length >= 3) break;
  }

  const summarized = await summarizeWithLLM(picked);

  return {
    dateISO,
    dateLabel: null,
    items: summarized.map((it) => ({
      title: it.title,
      url: it.url,
      source: it.source,
      summary: it.summary,
    })),
  };
}

async function loadFromStore(store, key) {
  try {
    const v = await store.get(key, { type: "json" });
    return v || null;
  } catch (_) {
    return null;
  }
}

async function saveToStore(store, key, value) {
  try {
    await store.setJSON(key, value);
  } catch (e) {
    console.warn("[Signal] store set failed:", e?.message || e);
  }
}

exports.handler = async function (event) {
  try {
    const days = Math.max(1, Math.min(60, Number(event.queryStringParameters?.days || process.env.SIGNAL_DAYS || 14)));

    const supabase = getSupabase();

    const store = getStore ? getStore("signal") : null;

    // Build date list: today -> past (days-1)
    const dates = [];
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      dates.push(toDateISO(d));
    }

    const dayObjs = [];

    // Try to load from Supabase first (fast + durable), fallback to Blobs, then compute.
    const byDate = new Map();

    if (supabase) {
      const { data, error } = await supabase
        .from("signal_digests")
        .select("date, items")
        .in("date", dates);

      if (error) {
        console.error("[Signal] supabase read error", error);
      } else {
        (data || []).forEach((row) => {
          const dateISO = String(row.date);
          const payload = Array.isArray(row.items) ? { dateISO, items: row.items } : row.items;
          if (payload) byDate.set(dateISO, payload);
        });
      }
    }

    for (const dateISO of dates) {
      let day = null;

      day = byDate.get(dateISO) || null;

      const key = `day:${dateISO}`;

      if (!day && store) {
        day = await loadFromStore(store, key);
      }

      if (!day) {
        day = await computeDailyTop3(dateISO);

        if (supabase) {
          const { error } = await supabase
            .from("signal_digests")
            .upsert({ date: dateISO, items: day.items }, { onConflict: "date" });
          if (error) console.error("[Signal] supabase upsert error", error);
        }

        if (store) await saveToStore(store, key, day);
      }

      day.dateLabel = day.dateLabel || new Date(dateISO + "T00:00:00Z").toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      dayObjs.push(day);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: JSON.stringify({
        generatedAt: nowIso(),
        days: dayObjs,
        persistence: Boolean(store),
      }),
    };
  } catch (e) {
    console.error("[Signal] handler error:", e);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Signal failed", detail: String(e?.message || e) }),
    };
  }
};
