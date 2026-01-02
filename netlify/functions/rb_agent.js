// netlify/functions/rb_agent.js
// Rumination Breaker agent proxy v1.3 (Groq-ready, model optional)
//
// ENV in Netlify:
//   LLM_API_KEY        (recommended: your Groq API key)
//   GROQ_API_KEY       (optional alternative; used if LLM_API_KEY missing)
//   LLM_BASE_URL       (optional, default: https://api.openai.com/v1)
//   LLM_MODEL          (optional; if missing/empty uses DEFAULT_MODEL)
//   LLM_TIMEOUT_MS     (optional, default: 20000)
//   RB_RATE_LIMIT      (optional, default: 12)  // requests per 10 minutes per runtime instance
//   RB_ALLOW_MOCK      (optional, default: false)
//
// Behavior:
// - If RB_ALLOW_MOCK=false: any LLM failure returns error (no mock fallback).
// - If RB_ALLOW_MOCK=true: missing key / auth failure / timeout can fallback to mock output.
//
// Notes for Groq:
// - Set LLM_BASE_URL=https://api.groq.com/openai/v1
// - Provide key in LLM_API_KEY (or GROQ_API_KEY)
// - LLM_MODEL can be omitted; we default to a Groq-friendly model name.

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
// Groq supports OpenAI-compatible chat completions; choose a sane default if user omits model.
// You can change this if you prefer another Groq hosted model.
const DEFAULT_MODEL = "llama-3.1-8b-instant";

const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // key -> { count, windowStart }

function json(statusCode, obj, extraHeaders) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(obj),
  };
}

function clampText(s, maxLen) {
  const t = String(s || "");
  return t.length > maxLen ? t.slice(0, maxLen) : t;
}

function rateLimit(key) {
  const limit = Number(process.env.RB_RATE_LIMIT || "12");
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: limit - 1, limit };
  }

  if (entry.count >= limit) {
    return { ok: false, remaining: 0, limit };
  }

  entry.count += 1;
  hits.set(key, entry);
  return { ok: true, remaining: limit - entry.count, limit };
}

function validateParsed(obj) {
  const errors = [];
  const isStr = (v) => typeof v === "string";
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);
  const isArr = (v) => Array.isArray(v);

  const allowedPatterns = new Set([
    "comparison",
    "future_projection",
    "perfectionism",
    "uncertainty_loop",
    "identity_threat",
    "other",
  ]);
  const allowedTimeboxes = new Set([5, 10, 15, 20, 30]);
  const allowedLang = new Set(["zh-Hant", "en"]);

  if (!obj || typeof obj !== "object") errors.push("not object");

  if (!isStr(obj.pattern) || !allowedPatterns.has(obj.pattern)) errors.push("pattern invalid");
  if (!isStr(obj.name) || !obj.name.trim()) errors.push("name missing");
  if (!isStr(obj.language) || !allowedLang.has(obj.language)) errors.push("language invalid");
  if (!isArr(obj.evidence) || obj.evidence.length < 1 || obj.evidence.length > 3) errors.push("evidence invalid");
  if (!isStr(obj.reframe) || !obj.reframe.trim()) errors.push("reframe missing");
  if (!isStr(obj.followup_question) || !obj.followup_question.trim()) errors.push("followup_question missing");

  if (!obj.one_action || typeof obj.one_action !== "object") errors.push("one_action missing");
  if (obj.one_action) {
    if (!isStr(obj.one_action.task) || !obj.one_action.task.trim()) errors.push("one_action.task missing");
    if (!isNum(obj.one_action.timebox_min) || !allowedTimeboxes.has(obj.one_action.timebox_min)) {
      errors.push("one_action.timebox_min invalid");
    }
    if (!isStr(obj.one_action.definition_of_done) || !obj.one_action.definition_of_done.trim()) {
      errors.push("one_action.definition_of_done missing");
    }
  }

  if (obj.tags != null) {
    if (!isArr(obj.tags) || obj.tags.length > 5) errors.push("tags invalid");
    else for (const t of obj.tags) if (!isStr(t)) errors.push("tags invalid");
  }

  if (!isNum(obj.confidence) || obj.confidence < 0 || obj.confidence > 1) errors.push("confidence invalid");

  // Allow "meta" for debug/fallback info (optional).
  const allowedKeys = new Set([
    "pattern",
    "name",
    "language",
    "evidence",
    "reframe",
    "one_action",
    "followup_question",
    "tags",
    "confidence",
    "meta",
  ]);
  for (const k of Object.keys(obj)) if (!allowedKeys.has(k)) errors.push("unknown key: " + k);

  return errors;
}

function buildSystemPrompt() {
  return [
    "You are Rumination Breaker: a concise agent that helps a user stop unproductive mental loops.",
    "Goals:",
    "- Identify the loop pattern (choose from: comparison, future_projection, perfectionism, uncertainty_loop, identity_threat, other).",
    "- Name it in one line (no therapy talk, no fluff).",
    "- Produce exactly ONE doable action that fits in 10–20 minutes, with a crisp definition of done.",
    "- Provide a short reframe (max 2 sentences).",
    "- Ask exactly ONE follow-up question that forces narrowing.",
    "- Always include: language (zh-Hant or en) and confidence (0..1).",
    "Rules:",
    "- Do not moralize or lecture.",
    "- Do not propose multiple actions.",
    "- Output strict JSON only. No markdown, no extra text.",
  ].join("\n");
}

function buildUserPrompt(currentText, memories, language, strict) {
  const outLang =
    language === "auto"
      ? "match the user input language (prefer Traditional Chinese if Chinese). Output language must be zh-Hant or en."
      : `Output language must be ${language}.`;

  const mem = (Array.isArray(memories) ? memories : []).slice(0, 3);
  const memLines = mem.map((m, i) => {
    const date = m.ts || "";
    const summary = m.summary || "";
    const pattern = m.pattern || "unknown";
    const action = m.one_action && m.one_action.task ? m.one_action.task : "";
    return `#${i + 1} date=${date} pattern=${pattern} summary=${summary} action=${action}`;
  });

  return [
    "OUTPUT_LANGUAGE_INSTRUCTION:",
    outLang,
    "",
    "STRICT_MODE:",
    strict ? "true" : "false",
    "",
    "CURRENT_TEXT:",
    currentText,
    "",
    "SIMILAR_PAST_ENTRIES (max 3):",
    memLines.length ? memLines.join("\n") : "(none)",
    "",
    "Return JSON with this exact schema (keys required unless noted):",
    "{",
    '  "pattern": "comparison|future_projection|perfectionism|uncertainty_loop|identity_threat|other",',
    '  "name": "one-line name",',
    '  "language": "zh-Hant|en",',
    '  "evidence": ["1-3 short quotes from CURRENT_TEXT"],',
    '  "one_action": { "task": "...", "timebox_min": 15, "definition_of_done": "..." },',
    '  "reframe": "max 2 sentences",',
    '  "followup_question": "exactly one question",',
    '  "tags": ["optional", "up to 5 strings"],',
    '  "confidence": 0.0',
    "}",
  ].join("\n");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

function detectLang(currentText, preferred) {
  if (preferred === "zh-Hant" || preferred === "en") return preferred;
  const s = String(currentText || "");
  const hasCjk = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/.test(s);
  return hasCjk ? "zh-Hant" : "en";
}

function pickEvidence(currentText, maxN) {
  const s = String(currentText || "").trim();
  if (!s) return ["(empty)"];
  const parts = s
    .split(/[\n\r]+|[。！？!?]+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const out = [];
  for (const p of parts) {
    const q = p.length > 90 ? p.slice(0, 90) + "…" : p;
    out.push(q);
    if (out.length >= (maxN || 2)) break;
  }
  if (!out.length) out.push(s.length > 90 ? s.slice(0, 90) + "…" : s);
  return out;
}

function classifyPattern(text) {
  const s = String(text || "").toLowerCase();
  const has = (re) => re.test(s);

  if (has(/compare|comparison|比別人|比較|輸給|落後|不如/)) return "comparison";
  if (has(/future|tomorrow|next|will|會不會|將來|未來|以後|如果.*怎麼辦/)) return "future_projection";
  if (has(/perfect|perfection|一定要|做到最好|不能錯|超標準|完美/)) return "perfectionism";
  if (has(/uncertain|uncertainty|不知道|不確定|一直想|反覆想|卡住|怎麼選/)) return "uncertainty_loop";
  if (has(/identity|worth|我是不是|我很爛|沒用|價值|失敗者|不夠好/)) return "identity_threat";
  return "other";
}

function buildMockResult(currentText, languagePref, strict, reason) {
  const lang = detectLang(currentText, languagePref);
  const pattern = classifyPattern(currentText);
  const evidence = pickEvidence(currentText, 2);

  const nameByPattern = {
    comparison: { zh: "比較迴圈：把自己丟進別人的尺", en: "Comparison loop: measuring yourself by others" },
    future_projection: { zh: "未來投射：把不確定當成定案", en: "Future projection: treating uncertainty as certainty" },
    perfectionism: { zh: "完美主義：把『夠好』推到無限遠", en: "Perfectionism: pushing ‘good enough’ infinitely far" },
    uncertainty_loop: { zh: "不確定迴圈：想太多取代了決策", en: "Uncertainty loop: overthinking replaces deciding" },
    identity_threat: { zh: "自我價值威脅：把結果等同於你這個人", en: "Identity threat: equating outcomes with your worth" },
    other: { zh: "雜訊迴圈：腦內訊號沒有被收斂", en: "Noise loop: signals aren’t being narrowed" },
  };

  const actionByPattern = {
    comparison: {
      zh: { task: "寫下『我能控制的 3 件事』並選 1 件立刻做 10–15 分鐘", dod: "列出 3 件可控事項，並完成其中 1 件的小步驟" },
      en: { task: "List 3 controllables and do 1 for 10–15 minutes", dod: "3 controllables written; one small step completed" },
    },
    future_projection: {
      zh: { task: "把擔心拆成『最壞情境 / 最可能情境 / 下一步』各寫 1 句", dod: "三行完成，且下一步是今天能做的" },
      en: { task: "Write 1 line each: worst case / most likely / next step", dod: "3 lines written; next step is doable today" },
    },
    perfectionism: {
      zh: { task: "把目標改成『60% 版本』：寫下最小可交付並做 15 分鐘", dod: "產出最小可交付（草稿/列表/骨架）" },
      en: { task: "Define a 60% version and work on it for 15 minutes", dod: "A minimal deliverable exists (draft/list/skeleton)" },
    },
    uncertainty_loop: {
      zh: { task: "列出 2 個選項，各寫『做/不做的代價』各 1 句，然後做暫定選擇", dod: "寫完 4 句並圈選 1 個暫定選擇" },
      en: { task: "Two options: write 1 line cost of do/not-do each, then pick a provisional choice", dod: "4 lines written; one provisional choice selected" },
    },
    identity_threat: {
      zh: { task: "把『我＝結果』改寫成『我在練什麼技能』寫 3 句", dod: "三句完成且聚焦技能/行為" },
      en: { task: "Rewrite ‘I = outcome’ into 3 lines about the skill you’re practicing", dod: "3 lines written; each is skill/behavior-focused" },
    },
    other: {
      zh: { task: "腦內想法倒到紙上 3 分鐘，再圈出唯一要處理的 1 個問題", dod: "完成 dump 文字並圈出 1 句問題" },
      en: { task: "Brain dump for 3 minutes, then circle ONE problem to handle", dod: "A dump exists and one problem sentence is circled" },
    },
  };

  const key = lang === "zh-Hant" ? "zh" : "en";
  const a = actionByPattern[pattern][key];

  const reframe =
    lang === "zh-Hant"
      ? "你不需要一次解完所有不確定，你只要把下一步縮到可執行。先完成一個小步驟，噪音會下降。"
      : "You don’t need to solve all uncertainty at once; you only need an executable next step. Finish one small step and the noise drops.";

  const followup =
    lang === "zh-Hant"
      ? "如果你只能讓『今天』變好 5%，你要先改變哪一件最小的事？"
      : "If you could make today 5% better, what smallest thing would you change first?";

  const result = {
    pattern,
    name: nameByPattern[pattern][key],
    language: lang,
    evidence,
    one_action: {
      task: a.task,
      timebox_min: strict ? 15 : 15,
      definition_of_done: a.dod,
    },
    reframe,
    followup_question: followup,
    tags: ["mock", pattern],
    confidence: 0.55,
    meta: { mode: "mock", fallback_reason: reason || "mock_enabled" },
  };

  const errs = validateParsed(result);
  if (errs.length) {
    return {
      pattern: "other",
      name: lang === "zh-Hant" ? "雜訊迴圈：先收斂一個問題" : "Noise loop: narrow to one problem",
      language: lang,
      evidence: pickEvidence(currentText, 1),
      one_action: {
        task: lang === "zh-Hant" ? "寫下你現在最想解的一個問題句，然後列 1 個下一步" : "Write the one problem sentence and one next step",
        timebox_min: 15,
        definition_of_done: lang === "zh-Hant" ? "你有 1 句問題 + 1 個下一步" : "You have 1 problem sentence + 1 next step",
      },
      reframe: lang === "zh-Hant" ? "先把問題縮小到可做，其他先放下。" : "Shrink to a doable step; park the rest.",
      followup_question: lang === "zh-Hant" ? "你要先解哪一個最小問題？" : "Which smallest problem will you solve first?",
      tags: ["mock"],
      confidence: 0.4,
      meta: { mode: "mock_fallback", fallback_reason: reason || "validation_failed", errors: errs.slice(0, 5) },
    };
  }

  return result;
}

function isAuthFailure(status, bodyText) {
  if (status === 401) return true;
  const s = String(bodyText || "");
  return s.includes("invalid_api_key") || s.includes("Incorrect API key") || s.includes("authentication_error");
}

function getApiKey() {
  // Prefer LLM_API_KEY; fallback to GROQ_API_KEY for convenience.
  const k1 = process.env.LLM_API_KEY;
  if (k1 && String(k1).trim()) return String(k1).trim();
  const k2 = process.env.GROQ_API_KEY;
  if (k2 && String(k2).trim()) return String(k2).trim();
  return "";
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Soft rate limit per runtime instance
  const xff = event.headers && (event.headers["x-forwarded-for"] || event.headers["X-Forwarded-For"]);
  const xffFirst = xff ? String(xff).split(",")[0].trim() : "";
  const ip = (event.headers && (event.headers["x-nf-client-connection-ip"] || xffFirst)) || "unknown";
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return json(429, { error: "Rate limit exceeded. Try again later.", remaining: rl.remaining });
  }

  // Parse request payload
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // Prevent massive payloads
  if (event.body && event.body.length > 60_000) {
    return json(413, { error: "Payload too large" });
  }

  const currentText = clampText(payload.current_text, 4000);
  const language = clampText(payload.language, 20) || "auto";
  const strict = !!payload.strict;

  const rawMemories = Array.isArray(payload.top_memories) ? payload.top_memories.slice(0, 3) : [];
  const topMemories = rawMemories.map((m) => ({
    ts: clampText(m && m.ts, 40),
    summary: clampText(m && m.summary, 500),
    pattern: clampText(m && m.pattern, 40),
    one_action:
      m && m.one_action && typeof m.one_action === "object"
        ? {
            task: clampText(m.one_action.task, 200),
            timebox_min: Number(m.one_action.timebox_min || 15),
            definition_of_done: clampText(m.one_action.definition_of_done, 240),
          }
        : null,
  }));

  if (!currentText.trim()) {
    return json(400, { error: "current_text is required" });
  }

  const allowMock = String(process.env.RB_ALLOW_MOCK || "false").toLowerCase() === "true";
  const apiKey = getApiKey();

  // If key missing -> mock (if allowed) else error
  if (!apiKey) {
    if (!allowMock) {
      return json(500, { error: "Missing API key: set LLM_API_KEY (or GROQ_API_KEY). RB_ALLOW_MOCK=false so no fallback." });
    }
    const mock = buildMockResult(currentText, language, strict, "missing_api_key");
    return json(200, mock, {
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RB-Mode": "mock",
    });
  }

  const baseUrl = (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  // If LLM_MODEL is missing/empty -> use DEFAULT_MODEL
  const envModelRaw = process.env.LLM_MODEL;
  const model = envModelRaw && String(envModelRaw).trim() ? String(envModelRaw).trim() : DEFAULT_MODEL;
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS || "20000");

  const system = buildSystemPrompt();
  const user = buildUserPrompt(currentText, topMemories, language, strict);

  const reqBody = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: strict ? 0.0 : 0.2,
    response_format: { type: "json_object" },
  };

  try {
    const res = await fetchWithTimeout(
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(reqBody),
      },
      timeoutMs
    );

    const headers = {
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RB-Mode": "live",
      "X-LLM-BaseURL": baseUrl,
      "X-LLM-Model": model,
    };

    if (!res.ok) {
      const text = await res.text();

      // If auth fails and mock is allowed, fallback to mock.
      if (allowMock && isAuthFailure(res.status, text)) {
        const mock = buildMockResult(currentText, language, strict, "invalid_api_key");
        return json(200, mock, { ...headers, "X-RB-Mode": "mock" });
      }

      // If mock is disabled, return error as-is
      if (!allowMock) {
        return json(500, { error: "LLM request failed", status: res.status, detail: text.slice(0, 2000) }, headers);
      }

      // Other failures -> optionally mock
      const mock = buildMockResult(currentText, language, strict, "llm_failure");
      return json(200, mock, { ...headers, "X-RB-Mode": "mock" });
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      if (!allowMock) return json(500, { error: "Empty LLM response" }, headers);
      const mock = buildMockResult(currentText, language, strict, "empty_llm_response");
      return json(200, mock, { ...headers, "X-RB-Mode": "mock" });
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      if (!allowMock) return json(500, { error: "Model did not return valid JSON", raw: String(content).slice(0, 2000) }, headers);
      const mock = buildMockResult(currentText, language, strict, "invalid_json");
      return json(200, mock, { ...headers, "X-RB-Mode": "mock" });
    }

    const errors = validateParsed(parsed);
    if (errors.length) {
      if (!allowMock) return json(500, { error: "Model returned invalid schema", detail: errors.slice(0, 10), raw: parsed }, headers);
      const mock = buildMockResult(currentText, language, strict, "invalid_schema");
      return json(200, mock, { ...headers, "X-RB-Mode": "mock" });
    }

    parsed.meta = {
      mode: "live",
      provider: baseUrl.includes("groq.com") ? "groq" : "other",
      base_url: baseUrl,
      model,
      timestamp: new Date().toISOString()
    };

    return json(200, parsed, headers);
  } catch (err) {
    // Network/timeout error: optionally fallback to mock (only if allowed).
    if (allowMock) {
      const mock = buildMockResult(currentText, language, strict, "network_or_timeout");
      return json(200, mock, {
        "X-RateLimit-Remaining": String(rl.remaining),
        "X-RB-Mode": "mock",
        "X-LLM-BaseURL": (process.env.LLM_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, ""),
      });
    }
    return json(500, { error: "Server error", detail: String(err && err.message ? err.message : err) });
  }
};
