/* Rumination Breaker MVP v1.0.4
   Fix: clicking Output sometimes jumps to History/Input (wrong scroll container)
   Strategy (final):
   - Your CSS scrolls on the document (window). Do NOT "detect scroller".
   - Use ONE navigateToHash() + ONE scrollToId() based on window.scrollY.
   - Keep IntersectionObserver ONLY for active highlight (root=null).
*/

(function () {
  const STORAGE_KEY = "rb_entries_v1";
  const THEME_KEY = "rb_theme_v1";
  const LANG_KEY = "rb_lang_v1";
  const DRAFT_KEY = "rb_draft_v1";
  const SIM_KEY = "rb_sim_mode_v1";
  const PAGE_SIZE_KEY = "rb_page_size_v1";
  const THREAD_BASE_KEY = "rb_thread_base_v1";
  const THREAD_LAST_KEY = "rb_thread_last_v1";
  const THREAD_CHAT_KEY = "rb_thread_chat_v1";

  const VERSION = "1.1.2";
  const COOLDOWN_MS = 3500;
  const MAX_CURRENT_TEXT_CHARS = 4000;
  const MAX_ENTRIES = 200;

  // Pagination state
  let page = 1;
  let pageSize = 10;

  // Selection + modal state
  const selectedIds = new Set();
  let modalEntryId = null;

  const $ = (id) => document.getElementById(id);

  const elInput = $("rb-input");
  const elCount = $("rb-count");
  const elRun = $("rb-run");
  const elSave = $("rb-save");
  const elSaveDone = $("rb-save-done");
  const elClear = $("rb-clear");
  const elStatus = $("rb-status");
  const elLang = $("rb-lang");
  const elPagePrev = $("rb-page-prev");
  const elPageNext = $("rb-page-next");
  const elPageInfo = $("rb-page-info");
  const elPageSize = $("rb-page-size");
  const elSimMode = $("rb-sim-mode");
  const elRedoStrict = $("rb-redo-strict");

  const elSelectPage = $("rb-select-page");
  const elClearSelection = $("rb-clear-selection");
  const elDeleteSelected = $("rb-delete-selected");
  const elDeleteFiltered = $("rb-delete-filtered");
  const elSelectionInfo = $("rb-selection-info");

  const elModal = $("rb-modal");
  const elModalBackdrop = $("rb-modal-backdrop");
  const elModalClose = $("rb-modal-close");
  const elModalTitle = $("rb-modal-title");
  const elModalMeta = $("rb-modal-meta");
  const elModalBody = $("rb-modal-body");
  const elModalCopy = $("rb-modal-copy");
  const elModalDelete = $("rb-modal-delete");

  const elMemories = $("rb-memories");
  const elOutput = $("rb-output");
  const elInsights = $("rb-insights");

  const elExport = $("rb-export");
  const elCopyAction = $("rb-copy-action");
  const elCopyFollowup = $("rb-copy-followup");
  const elCopyJson = $("rb-copy-json");
  const elImport = $("rb-import");
  const elWipe = $("rb-wipe");

  const elHistory = $("rb-history");
  const elSearch = $("rb-search");
  const elFilter = $("rb-filter");
  const elStatusFilter = $("rb-status-filter");
  const elSort = $("rb-sort");

  const elToast = $("rb-toast");
  const elBackdrop = $("rb-backdrop");

  const elKpiTotal = $("rb-kpi-total");
  const elKpiTop = $("rb-kpi-top");
  const elKpiLast = $("rb-kpi-last");
  const elKpiDone = $("rb-kpi-done");

  const elSidebarToggle = $("rb-sidebar-toggle");
  const elSidebarClose = $("rb-sidebar-close");

  const elColorPrimary = $("rb-color-primary");
  const elColorAccent = $("rb-color-accent");
  const elThemeReset = $("rb-theme-reset");

  const elVersion = $("rb-version");

  let lastRunAt = 0;
  let lastResult = null;
  let btnContinue = null;
  let btnThreadReset = null;
  let followPanel = null;
  let followLog = null;
  let followInput = null;
  let followSend = null;
  let followClose = null;

  const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "if", "then", "so", "to", "of", "in", "on", "for", "with", "as", "at", "by",
    "is", "am", "are", "was", "were", "be", "been", "being", "it", "this", "that", "these", "those",
    "i", "me", "my", "mine", "you", "your", "yours", "we", "our", "ours", "they", "their", "theirs",
    "do", "did", "does", "done", "have", "has", "had", "having", "not", "no", "yes", "just", "really", "very",
  ]);

  function nowIso() { return new Date().toISOString(); }

  function todayKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function isoToDayKey(iso) {
    try {
      const d = new Date(iso);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch { return ""; }
  }

  function formatDate(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      });
    } catch { return String(iso || ""); }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function toast(msg, kind) {
    if (!elToast) return;
    elToast.className = "toast show " + (kind || "success");
    elToast.textContent = msg;
    clearTimeout(elToast._t);
    elToast._t = setTimeout(() => {
      elToast.className = "toast";
      elToast.textContent = "";
    }, 2600);
  }

  function setStatus(msg, kind) {
    if (elStatus) elStatus.textContent = msg || "";
    if (msg) {
      if (kind === "warn") toast(msg, "warn");
      if (kind === "danger") toast(msg, "danger");
      if (kind === "info") toast(msg, "info");
    }
  }

  function setBusy(isBusy, msg) {
    if (elRun) elRun.disabled = !!isBusy;
    if (elRedoStrict) elRedoStrict.disabled = !!isBusy || !lastResult;
    if (elSave) elSave.disabled = !!isBusy || !lastResult;
    if (elSaveDone) elSaveDone.disabled = !!isBusy || !lastResult;
    if (msg) setStatus(msg);
  }

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function saveEntries(entries) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { }
  }

  function loadLang() {
    try { return localStorage.getItem(LANG_KEY) || "auto"; } catch { return "auto"; }
  }
  function saveLang(v) {
    try { localStorage.setItem(LANG_KEY, v || "auto"); } catch { }
  }

  function loadDraft() {
    try { return sessionStorage.getItem(DRAFT_KEY) || ""; } catch { return ""; }
  }
  function saveDraft(text) {
    try { sessionStorage.setItem(DRAFT_KEY, text || ""); } catch { }
  }

  /* ================================
     Thread state (inline follow-up)
     - Keeps a "base text" for the current loop and the last agent result.
     - Keeps a lightweight chat log for the current page session.
     ================================ */

  function loadThreadBase() {
    try { return sessionStorage.getItem(THREAD_BASE_KEY) || ""; } catch { return ""; }
  }
  function saveThreadBase(text) {
    try { sessionStorage.setItem(THREAD_BASE_KEY, text || ""); } catch { }
  }
  function loadThreadLast() {
    try {
      const raw = sessionStorage.getItem(THREAD_LAST_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function saveThreadLast(obj) {
    try { sessionStorage.setItem(THREAD_LAST_KEY, JSON.stringify(obj || null)); } catch { }
  }
  function loadThreadChat() {
    try {
      const raw = sessionStorage.getItem(THREAD_CHAT_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }
  function saveThreadChat(arr) {
    try { sessionStorage.setItem(THREAD_CHAT_KEY, JSON.stringify(Array.isArray(arr) ? arr : [])); } catch { }
  }
  function resetThreadState() {
    try { sessionStorage.removeItem(THREAD_BASE_KEY); } catch { }
    try { sessionStorage.removeItem(THREAD_LAST_KEY); } catch { }
    try { sessionStorage.removeItem(THREAD_CHAT_KEY); } catch { }
  }

  function summarizeAssistant(result) {
    try {
      const name = result?.name ? String(result.name).trim() : "";
      const reframe = result?.reframe ? String(result.reframe).trim() : "";
      const task = result?.one_action?.task ? String(result.one_action.task).trim() : "";
      const tb = result?.one_action?.timebox_min != null ? String(result.one_action.timebox_min) : "";
      const dod = result?.one_action?.definition_of_done ? String(result.one_action.definition_of_done).trim() : "";
      const lines = [];
      if (name) lines.push(name);
      if (reframe) lines.push(reframe);
      if (task) {
        lines.push("Next action: " + task + (tb ? ` (${tb} min)` : ""));
        if (dod) lines.push("Done when: " + dod);
      }
      return lines.join("\n").trim();
    } catch {
      return "";
    }
  }

  function buildContinuationText(baseText, prev, userUpdate) {
    const p = prev || {};
    const oa = p.one_action || {};
    const evidence = Array.isArray(p.evidence) ? p.evidence : [];

    const blocks = [];
    blocks.push("You are a Rumination Breaker coach. Continue the same loop based on the update below.");
    blocks.push("");
    blocks.push("[ORIGINAL TEXT]");
    blocks.push(String(baseText || "").trim());
    blocks.push("");
    blocks.push("[LAST RESULT]");
    blocks.push("pattern: " + String(p.pattern || ""));
    blocks.push("name: " + String(p.name || ""));
    if (evidence.length) blocks.push("evidence: " + evidence.map((x) => String(x)).join(" | "));
    blocks.push("reframe: " + String(p.reframe || ""));
    if (oa && (oa.task || oa.timebox_min || oa.definition_of_done)) {
      blocks.push("one_action: " + String(oa.task || ""));
      blocks.push("timebox_min: " + String(oa.timebox_min || ""));
      blocks.push("definition_of_done: " + String(oa.definition_of_done || ""));
    }
    blocks.push("followup_question: " + String(p.followup_question || ""));
    blocks.push("");
    blocks.push("[USER UPDATE]");
    blocks.push(String(userUpdate || "").trim());
    blocks.push("");
    blocks.push("Now return a NEW result in the SAME JSON schema as before. Prefer a smaller, more realistic next action if the user is stuck.");
    return blocks.join("\n");
  }

  function loadPageSize() {
    try {
      const v = localStorage.getItem(PAGE_SIZE_KEY);
      const n = Number(v || 10);
      return [10, 20, 50].includes(n) ? n : 10;
    } catch { return 10; }
  }
  function savePageSize(n) {
    try { localStorage.setItem(PAGE_SIZE_KEY, String(n)); } catch { }
  }

  function loadSimMode() {
    try { return localStorage.getItem(SIM_KEY) || "mixed"; } catch { return "mixed"; }
  }
  function saveSimMode(v) {
    try { localStorage.setItem(SIM_KEY, v || "mixed"); } catch { }
  }

  function normalizeText(s) {
    return (s || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[\u0000-\u001f]/g, " ")
      .replace(/[.,!?;:()\[\]{}<>"'`~@#$%^&*_+=|\\\/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isCjkChar(ch) {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    return (
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0xF900 && code <= 0xFAFF)
    );
  }

  function extractCjk(text) {
    const s = String(text || "");
    let out = "";
    for (const ch of s) out += isCjkChar(ch) ? ch : " ";
    return out.replace(/\s+/g, " ").trim();
  }

  function cjkBigrams(cjk) {
    const s = String(cjk || "").replace(/\s+/g, "");
    const grams = [];
    for (let i = 0; i < s.length - 1; i++) grams.push(s.slice(i, i + 2));
    if (!grams.length && s.length) grams.push(...s.split(""));
    return grams;
  }

  function tokenize(text, mode) {
    const raw = normalizeText(text);
    const m = mode || (elSimMode ? elSimMode.value : "mixed");
    const tokens = [];

    if (m === "mixed" || m === "zh") {
      const cjk = extractCjk(raw);
      if (cjk) tokens.push(...cjkBigrams(cjk));
    }

    if (m === "mixed" || m === "en") {
      const latin = raw
        .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]/g, " ")
        .split(" ")
        .filter(Boolean)
        .filter((w) => w.length > 1 && !STOPWORDS.has(w))
        .slice(0, 500);
      tokens.push(...latin);
    }

    return tokens.slice(0, 700);
  }

  function jaccard(aTokens, bTokens) {
    if (!aTokens.length || !bTokens.length) return 0;
    const a = new Set(aTokens);
    const b = new Set(bTokens);
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union ? inter / union : 0;
  }

  function topSimilarMemories(text, entries, k) {
    const mode = elSimMode ? elSimMode.value : "mixed";
    const q = tokenize(text, mode);
    const scored = entries
      .map((e) => ({ e, score: jaccard(q, tokenize(e.text || "", mode)) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return scored.map((x) => ({
      id: x.e.id,
      ts: x.e.ts,
      score: x.score,
      summary: x.e.summary || "(no summary yet)",
      pattern: x.e.pattern || "unknown",
      one_action: x.e.one_action || null,
    }));
  }

  function renderMemories(memories) {
    if (!elMemories) return;
    elMemories.innerHTML = "";
    if (!memories.length) {
      elMemories.innerHTML = '<p class="muted">No similar entries yet.</p>';
      return;
    }
    for (const m of memories) {
      const div = document.createElement("div");
      div.className = "mem";
      div.innerHTML = `
        <div class="meta">
          <span>${escapeHtml(formatDate(m.ts))}</span>
          <span>${Math.round(m.score * 100)}%</span>
        </div>
        <p class="sum">${escapeHtml(m.summary)}</p>
        <div class="badges">
          <span class="badge">${escapeHtml(m.pattern || "unknown")}</span>
          ${m.one_action?.task ? `<span class="badge">action: ${escapeHtml(m.one_action.task)}</span>` : ""}
        </div>
      `;
      elMemories.appendChild(div);
    }
  }

  function validateAgentResult(obj) {
    const errors = [];
    const isStr = (v) => typeof v === "string";
    const isNum = (v) => typeof v === "number" && Number.isFinite(v);
    const isArr = (v) => Array.isArray(v);

    if (!obj || typeof obj !== "object") errors.push("Response is not an object.");
    if (!isStr(obj.pattern) || !obj.pattern) errors.push("Missing pattern.");
    if (!isStr(obj.name) || !obj.name) errors.push("Missing name.");
    if (!isStr(obj.reframe) || !obj.reframe) errors.push("Missing reframe.");
    if (!isStr(obj.followup_question) || !obj.followup_question) errors.push("Missing followup_question.");
    if (!isArr(obj.evidence) || obj.evidence.length < 1) errors.push("Missing evidence array.");
    if (!obj.one_action || typeof obj.one_action !== "object") errors.push("Missing one_action.");
    if (obj.one_action) {
      if (!isStr(obj.one_action.task) || !obj.one_action.task) errors.push("one_action.task required.");
      if (!isNum(obj.one_action.timebox_min)) errors.push("one_action.timebox_min must be number.");
      if (!isStr(obj.one_action.definition_of_done) || !obj.one_action.definition_of_done) errors.push("one_action.definition_of_done required.");
    }
    if (obj.tags && !isArr(obj.tags)) errors.push("tags must be an array if present.");
    if (obj.language && !isStr(obj.language)) errors.push("language must be a string if present.");
    if (obj.confidence !== undefined && !isNum(obj.confidence)) errors.push("confidence must be a number if present.");

    return { ok: errors.length === 0, errors };
  }

  async function copyText(text, okMsg) {
    try {
      if (!text) throw new Error("Nothing to copy.");
      await navigator.clipboard.writeText(text);
      toast(okMsg || "Copied.", "success");
    } catch {
      try { window.prompt("Copy to clipboard:", String(text || "")); } catch { }
    }
  }

  function renderOutput(result) {
    if (!elOutput) return;

    if (!result) {
      elOutput.classList.add("empty");
      elOutput.innerHTML = '<p class="muted">Run the agent to see results here.</p>';
      if (elCopyAction) elCopyAction.disabled = true;
      if (elCopyFollowup) elCopyFollowup.disabled = true;
      if (elCopyJson) elCopyJson.disabled = true;
      return;
    }

    elOutput.classList.remove("empty");

    const evidence = Array.isArray(result.evidence) ? result.evidence : [];
    const action = result.one_action || {};

    const evidenceHtml = evidence.length
      ? "<ul>" + evidence.map((x) => "<li>" + escapeHtml(String(x)) + "</li>").join("") + "</ul>"
      : '<span class="muted">—</span>';

    elOutput.innerHTML = `
      <div class="kv">
        <div class="k">Pattern</div>
        <div class="v">${escapeHtml(result.pattern || "")}</div>

        <div class="k">Name it</div>
        <div class="v">${escapeHtml(result.name || "")}</div>

        <div class="k">Evidence</div>
        <div class="v">${evidenceHtml}</div>

        <div class="k">One action</div>
        <div class="v">
          <div><strong>${escapeHtml(action.task || "")}</strong></div>
          <div class="muted">Timebox: ${escapeHtml(String(action.timebox_min || ""))} min</div>
          <div class="muted">Done when: ${escapeHtml(action.definition_of_done || "")}</div>
        </div>

        <div class="k">Reframe</div>
        <div class="v">${escapeHtml(result.reframe || "")}</div>

        <div class="k">Follow-up</div>
        <div class="v">${escapeHtml(result.followup_question || "")}</div>
      </div>
    `;

    if (elCopyAction) elCopyAction.disabled = !(action && action.task);
    if (elCopyFollowup) elCopyFollowup.disabled = !(result && result.followup_question);
    if (elCopyJson) elCopyJson.disabled = !result;
  }

  function renderInsights(pattern) {
    if (!elInsights) return;
    if (!pattern || pattern === "unknown") {
      elInsights.textContent = "";
      return;
    }
    const entries = loadEntries().filter((e) => e.pattern === pattern);
    const count = entries.length;
    const last3 = entries
      .slice()
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))
      .slice(0, 3)
      .map((e) => formatDate(e.ts))
      .join(", ");

    elInsights.textContent = count ? `This pattern has appeared ${count} time(s). Recent: ${last3}` : "";
  }

  function computeTopPattern(entries) {
    const counts = new Map();
    for (const e of entries) {
      const p = e.pattern || "unknown";
      if (p === "unknown") continue;
      counts.set(p, (counts.get(p) || 0) + 1);
    }
    let best = null;
    for (const [k, v] of counts.entries()) if (!best || v > best.v) best = { k, v };
    return best ? `${best.k} (${best.v})` : "—";
  }

  function computeDoneToday(entries) {
    const key = todayKey();
    return entries.filter((e) => e.done_ts && isoToDayKey(e.done_ts) === key).length;
  }

  function renderKpis() {
    const entries = loadEntries();
    if (elKpiTotal) elKpiTotal.textContent = String(entries.length);
    if (elKpiTop) elKpiTop.textContent = computeTopPattern(entries);
    const lastRun = localStorage.getItem("rb_last_run_ts");
    if (elKpiLast) elKpiLast.textContent = lastRun ? formatDate(lastRun) : "—";
    if (elKpiDone) elKpiDone.textContent = String(computeDoneToday(entries));
  }

  function getStatusFilterValue() {
    return elStatusFilter ? (elStatusFilter.value || "all") : "all";
  }

  function setSelectionInfo() {
    const n = selectedIds.size;
    if (elSelectionInfo) elSelectionInfo.textContent = `${n} selected`;
    if (elClearSelection) elClearSelection.disabled = n === 0;
    if (elDeleteSelected) elDeleteSelected.disabled = n === 0;
  }

  function clearSelection() {
    selectedIds.clear();
    const boxes = Array.from(elHistory?.querySelectorAll("input.sel") || []);
    boxes.forEach((b) => (b.checked = false));
    setSelectionInfo();
  }

  function deleteEntriesByIds(ids) {
    const set = new Set(ids);
    const all = loadEntries();
    const next = all.filter((e) => !set.has(e.id));
    saveEntries(next);
  }

  function openModal(entry) {
    if (!elModal || !entry) return;
    modalEntryId = entry.id;

    if (elModalTitle) elModalTitle.textContent = entry.name || entry.pattern || "Entry";
    if (elModalMeta) {
      elModalMeta.textContent =
        `${formatDate(entry.ts)} · ${entry.pattern || "unknown"}` +
        (entry.done_ts ? " · done" : "") +
        (entry.pinned ? " · pinned" : "");
    }

    const parts = [];
    parts.push(`<p class="text"><strong>Current text</strong></p>`);
    parts.push(`<p class="text">${escapeHtml(entry.text || "")}</p>`);
    if (entry.evidence && Array.isArray(entry.evidence) && entry.evidence.length) {
      parts.push(`<p class="text"><strong>Evidence</strong></p>`);
      parts.push(`<ul class="text">${entry.evidence.map((x) => `<li>${escapeHtml(String(x))}</li>`).join("")}</ul>`);
    }
    if (entry.reframe) parts.push(`<p class="text"><strong>Reframe</strong> ${escapeHtml(entry.reframe)}</p>`);
    if (entry.one_action?.task) {
      parts.push(
        `<p class="text"><strong>One action</strong> ${escapeHtml(entry.one_action.task)}<br/>Timebox: ${escapeHtml(String(entry.one_action.timebox_min || ""))} min<br/>Done when: ${escapeHtml(entry.one_action.definition_of_done || "")}</p>`
      );
    }
    if (entry.followup_question) parts.push(`<p class="text"><strong>Follow-up</strong> ${escapeHtml(entry.followup_question)}</p>`);
    if (entry.tags && Array.isArray(entry.tags) && entry.tags.length) parts.push(`<p class="text"><strong>Tags</strong> ${escapeHtml(entry.tags.join(", "))}</p>`);
    if (typeof entry.confidence === "number") parts.push(`<p class="text"><strong>Confidence</strong> ${escapeHtml(entry.confidence.toFixed(2))}</p>`);

    if (elModalBody) elModalBody.innerHTML = parts.join("\n");
    elModal.classList.remove("hidden");
    elModal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
  }

  function closeModal() {
    if (!elModal) return;
    elModal.classList.add("hidden");
    elModal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    modalEntryId = null;
  }

  function applyPagination(items) {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (page > totalPages) page = totalPages;
    if (page < 1) page = 1;

    const start = (page - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);

    if (elPageInfo) elPageInfo.textContent = `Page ${page} / ${totalPages} · ${total} items`;
    if (elPagePrev) elPagePrev.disabled = page <= 1;
    if (elPageNext) elPageNext.disabled = page >= totalPages;

    return slice;
  }

  function renderHistory() {
    if (!elHistory) return;

    const q = normalizeText(elSearch?.value || "");
    const filter = elFilter?.value || "all";
    const statusFilter = getStatusFilterValue();
    const sort = elSort?.value || "newest";

    let entries = loadEntries();

    if (q) entries = entries.filter((e) => normalizeText(e.text || "").includes(q) || normalizeText(e.summary || "").includes(q));
    if (filter !== "all") entries = entries.filter((e) => (e.pattern || "") === filter);

    if (statusFilter === "pinned") entries = entries.filter((e) => !!e.pinned);
    else if (statusFilter === "done") entries = entries.filter((e) => !!e.done_ts);
    else if (statusFilter === "todo") entries = entries.filter((e) => !e.done_ts);

    // Pinned first, then date.
    entries.sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return sort === "oldest" ? (a.ts > b.ts ? 1 : -1) : (a.ts < b.ts ? 1 : -1);
    });

    elHistory.innerHTML = "";
    if (!entries.length) {
      elHistory.innerHTML = '<p class="muted">No saved entries.</p>';
      setSelectionInfo();
      return;
    }

    const paged = applyPagination(entries);

    for (const e of paged) {
      const div = document.createElement("div");
      div.className = "item" + (e.pinned ? " pinned" : "");
      const done = !!e.done_ts;

      div.innerHTML = `
        <div class="row2">
          <div class="itemhead">
            <p class="title">${escapeHtml(e.name || e.pattern || "entry")}</p>
            <div class="small">${escapeHtml(formatDate(e.ts))}</div>
          </div>

          <label class="selbox" title="Select">
            <input class="sel" type="checkbox" data-id="${escapeHtml(e.id)}" ${selectedIds.has(e.id) ? "checked" : ""} />
          </label>
        </div>

        <p class="text muted">${escapeHtml((e.text || "").slice(0, 160))}${(e.text || "").length > 160 ? "…" : ""}</p>

        <div class="badges">
          <span class="badge">${escapeHtml(e.pattern || "unknown")}</span>

          ${e.one_action?.task ? `<span class="badge badge-action" title="Saved action">${escapeHtml(e.one_action.task)}</span>` : ""}

          ${e.pinned ? `<span class="badge badge-pin" title="Status: pinned"><span class="dot"></span>Pinned</span>` : ""}
          ${done ? `<span class="badge badge-done" title="Status: done"><span class="dot"></span>Done</span>` : ""}

          <div class="actions" aria-label="Entry actions">
            <button class="btn small ghost viewbtn" data-id="${escapeHtml(e.id)}" type="button" title="Preview">
              <span class="ico" aria-hidden="true">▢</span>
              <span>Preview</span>
            </button>

            <button
              class="btn small ${e.pinned ? "soft" : "ghost"} pinbtn"
              data-id="${escapeHtml(e.id)}"
              type="button"
              title="${e.pinned ? "Unpin" : "Pin"}"
              aria-pressed="${e.pinned ? "true" : "false"}"
            >
              <span class="ico" aria-hidden="true">${e.pinned ? "★" : "☆"}</span>
              <span>${e.pinned ? "Unpin" : "Pin"}</span>
            </button>

            <button
              class="btn small ${done ? "ghost" : "soft"} donebtn"
              data-id="${escapeHtml(e.id)}"
              type="button"
              title="${done ? "Undo done" : "Mark done"}"
              aria-pressed="${done ? "true" : "false"}"
            >
              <span class="ico" aria-hidden="true">${done ? "↩" : "✓"}</span>
              <span>${done ? "Undo" : "Mark done"}</span>
            </button>

            <button class="btn small danger delbtn" data-id="${escapeHtml(e.id)}" type="button" title="Delete">
              <span class="ico" aria-hidden="true">×</span>
              <span>Delete</span>
            </button>
          </div>
        </div>
      `;
      elHistory.appendChild(div);
    }

    setSelectionInfo();
  }

  async function callAgent(currentText, memories, strict) {
    const payload = {
      current_text: currentText.slice(0, MAX_CURRENT_TEXT_CHARS),
      top_memories: (memories || []).map((m) => ({
        ts: m.ts,
        summary: m.summary,
        pattern: m.pattern,
        one_action: m.one_action,
      })),
      language: elLang ? (elLang.value || "auto") : "auto",
      strict: !!strict,
    };

    const res = await fetch("/.netlify/functions/rb_agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || "Agent call failed");
    }
    return await res.json();
  }

  function canRun() {
    const t = Date.now();
    return t - lastRunAt > COOLDOWN_MS;
  }

  function updateCount() {
    if (!elInput || !elCount) return;
    elCount.textContent = String((elInput.value || "").length);
  }

  function buildSummary(result) {
    try {
      const name = result?.name ? String(result.name) : "";
      const task = result?.one_action?.task ? String(result.one_action.task) : "";
      const base = (name && task) ? `${name} · ${task}` : (name || task || (result?.reframe ? String(result.reframe) : ""));
      const s = base.replace(/\s+/g, " ").trim();
      return s.length > 140 ? s.slice(0, 137) + "…" : s;
    } catch { return ""; }
  }

  function buildEntry(text, result, opts) {
    const id = "rb_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
    return {
      id,
      ts: nowIso(),
      text,
      pattern: result.pattern || "unknown",
      name: result.name || "",
      summary: buildSummary(result),
      evidence: Array.isArray(result.evidence) ? result.evidence : [],
      one_action: result.one_action || null,
      reframe: result.reframe || "",
      followup_question: result.followup_question || "",
      done_ts: opts?.done ? nowIso() : null,
      pinned: false,
      version: VERSION,
    };
  }

  function persistEntry(entry) {
    const entries = loadEntries();
    entries.push(entry);
    saveEntries(entries.slice(-MAX_ENTRIES));
  }

  /* ================================
     Drawer controls (single source)
     ================================ */

     let _scrollLockY = 0;
     let _scrollLocked = false;
     
     function lockBodyScroll() {
       if (_scrollLocked) return;
       _scrollLockY = window.scrollY || 0;
       _scrollLocked = true;
     
       document.body.style.position = "fixed";
       document.body.style.top = `-${_scrollLockY}px`;
       document.body.style.left = "0";
       document.body.style.right = "0";
       document.body.style.width = "100%";
       document.body.style.overflow = "hidden";
       document.body.style.touchAction = "none";
     }
     
     function unlockBodyScroll(restore) {
       if (!_scrollLocked) return;
     
       // Read stored y from top
       const top = document.body.style.top || "0px";
       const y = Math.abs(parseInt(top, 10)) || _scrollLockY || 0;
     
       document.body.style.position = "";
       document.body.style.top = "";
       document.body.style.left = "";
       document.body.style.right = "";
       document.body.style.width = "";
       document.body.style.overflow = "";
       document.body.style.touchAction = "";
     
       _scrollLocked = false;
     
       // Only restore when we are NOT navigating to a new target
       if (restore) {
         window.scrollTo({ top: y, behavior: "auto" });
       }
     }
     
     function openSidebar(open) {
       const sidebar = document.getElementById("rb-sidebar");
       const backdrop = document.getElementById("rb-backdrop");
     
       if (open) {
         lockBodyScroll();
         document.body.classList.add("sidebar-open");
         if (sidebar) sidebar.setAttribute("aria-hidden", "false");
         if (backdrop) backdrop.setAttribute("aria-hidden", "false");
       } else {
         const wasOpen = document.body.classList.contains("sidebar-open");
         document.body.classList.remove("sidebar-open");
         if (sidebar) sidebar.setAttribute("aria-hidden", "true");
         if (backdrop) backdrop.setAttribute("aria-hidden", "true");
     
         // Normal close (not navigation): restore scroll
         if (wasOpen) unlockBodyScroll(true);
       }
     }        

  if (elSidebarToggle) elSidebarToggle.addEventListener("click", () => {
    const open = document.body.classList.contains("sidebar-open");
    openSidebar(!open);
  });
  if (elSidebarClose) elSidebarClose.addEventListener("click", () => openSidebar(false));
  if (elBackdrop) elBackdrop.addEventListener("click", () => openSidebar(false));

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) openSidebar(false);
  });

  /* ================================
     Stable navigation (FINAL FIX)
     - Document scroll only (window)
     ================================ */

  const sideLinks = Array.from(document.querySelectorAll(".side-link"));
  const homeLinks = Array.from(document.querySelectorAll(".side-home"));

  function setActiveByHash(hash) {
    sideLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === hash));
  }

  function getHeaderOffsetPx() {
    const topbar = document.querySelector(".topbar");
    const h = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0;
    return h + 14;
  }

  function scrollToId(id, behavior) {
    const el = document.getElementById(id);
    if (!el) return;
  
    const offset = getHeaderOffsetPx();
    const y = window.scrollY + el.getBoundingClientRect().top - offset;
  
    window.scrollTo({
      top: Math.max(0, y),
      behavior: behavior || "auto", // default: auto (no jitter)
    });
  }  

  function navigateToHash(hash) {
    const id = String(hash || "").replace("#", "");
    if (!id) return;
  
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  
    const target = document.getElementById(id);
    if (!target) return;
  
    const wasSidebarOpen = document.body.classList.contains("sidebar-open");
  
    // Mark active immediately (no layout shift in main content)
    setActiveByHash("#" + id);
  
    // If drawer is open, compute target Y using the LOCKED scrollY (_scrollLockY)
    if (wasSidebarOpen) {
      // Close drawer visuals first (keep body fixed for now)
      document.body.classList.remove("sidebar-open");
      const sidebar = document.getElementById("rb-sidebar");
      const backdrop = document.getElementById("rb-backdrop");
      if (sidebar) sidebar.setAttribute("aria-hidden", "true");
      if (backdrop) backdrop.setAttribute("aria-hidden", "true");
  
      // Compute absolute target Y:
      // When body is fixed, window.scrollY is 0, but element rect is correct in viewport.
      const offset = getHeaderOffsetPx();
      const rectTop = target.getBoundingClientRect().top;
      const yTarget = Math.max(0, (_scrollLockY || 0) + rectTop - offset);
  
      // Next frame: unlock WITHOUT restoring, then jump directly to yTarget (single scroll)
      requestAnimationFrame(() => {
        unlockBodyScroll(false);
        window.scrollTo({ top: yTarget, behavior: "auto" });
  
        try { history.replaceState(null, "", "#" + id); } catch (_) {}
      });
  
      return;
    }
  
    // Drawer not open: normal navigation (single scroll)
    requestAnimationFrame(() => {
      const offset = getHeaderOffsetPx();
      const y = window.scrollY + target.getBoundingClientRect().top - offset;
      window.scrollTo({ top: Math.max(0, y), behavior: "auto" });
  
      try { history.replaceState(null, "", "#" + id); } catch (_) {}
    });
  }  

  sideLinks.forEach((a) => {
    a.addEventListener("click", (ev) => {
      const href = a.getAttribute("href") || "";
      if (!href.startsWith("#")) return;
      ev.preventDefault();
      navigateToHash(href);
    });
  });

  homeLinks.forEach((a) => {
    a.addEventListener("click", (ev) => {
      const href = a.getAttribute("href") || "#rb-top";
      if (!href.startsWith("#")) return;
      ev.preventDefault();
      navigateToHash(href);
    });
  });

  /* ================================
     Modal controls
     ================================ */

  if (elModalBackdrop) elModalBackdrop.addEventListener("click", closeModal);
  if (elModalClose) elModalClose.addEventListener("click", closeModal);

  if (elModalCopy) elModalCopy.addEventListener("click", async () => {
    if (!modalEntryId) return;
    const e = loadEntries().find((x) => x.id === modalEntryId);
    if (!e) return;
    await copyText(JSON.stringify(e, null, 2), "Copied entry JSON.");
  });

  if (elModalDelete) elModalDelete.addEventListener("click", () => {
    if (!modalEntryId) return;
    if (!confirm("Delete this entry?")) return;
    deleteEntriesByIds([modalEntryId]);
    selectedIds.delete(modalEntryId);
    closeModal();
    renderHistory();
    renderKpis();
    toast("Deleted.", "success");
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); openSidebar(false); }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      if (elRun && !elRun.disabled) elRun.click();
    }
  });

  // Enter-to-analyze on textarea
  // - Enter: trigger Analyze
  // - Shift+Enter: newline
  // - Avoid breaking IME composition (Chinese/Japanese input)
  if (elInput && elRun) {
    elInput.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== "Enter") return;
      if (e.shiftKey) return;
      if (elRun.disabled) return;

      e.preventDefault();
      elRun.click();
    });
  }

  /* ================================
     IntersectionObserver (active highlight only)
     - Root MUST be null because document scrolls
     ================================ */

  const sections = ["#rb-section-input", "#rb-section-output", "#rb-section-history"]
    .map((s) => document.querySelector(s))
    .filter(Boolean);

  if ("IntersectionObserver" in window && sections.length) {
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((x) => x.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible && visible.target && visible.target.id) {
          setActiveByHash("#" + visible.target.id);
        }
      },
      {
        root: null,
        threshold: [0.2, 0.45, 0.65],
        rootMargin: `-${getHeaderOffsetPx()}px 0px -60% 0px`,
      }
    );
    sections.forEach((s) => obs.observe(s));
  }

  /* ================================
     Theme
     ================================ */

  function applyTheme(theme) {
    const root = document.documentElement;
    if (!theme) return;
    if (theme.primary) root.style.setProperty("--primary", theme.primary);
    if (theme.primary2) root.style.setProperty("--primary-2", theme.primary2);
    if (theme.accent) root.style.setProperty("--accent", theme.accent);
  }

  function hexToRgb(hex) {
    const m = String(hex || "").trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const s = m[1];
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }

  function rgbToHex(r, g, b) {
    const to = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return "#" + to(r) + to(g) + to(b);
  }

  function darken(hex, amt) {
    const c = hexToRgb(hex);
    if (!c) return hex;
    return rgbToHex(c.r * (1 - amt), c.g * (1 - amt), c.b * (1 - amt));
  }

  function loadTheme() {
    try { const raw = localStorage.getItem(THEME_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  function saveTheme(theme) {
    try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch { }
  }

  function initThemeUi() {
    const theme = loadTheme();
    if (theme) {
      applyTheme(theme);
      if (elColorPrimary && theme.primary) elColorPrimary.value = theme.primary;
      if (elColorAccent && theme.accent) elColorAccent.value = theme.accent;
    }
    if (elColorPrimary) {
      elColorPrimary.addEventListener("input", () => {
        const p = elColorPrimary.value;
        const t = { primary: p, primary2: darken(p, 0.18), accent: elColorAccent ? elColorAccent.value : "#6366f1" };
        saveTheme(t);
        applyTheme(t);
        toast("Theme updated.", "success");
      });
    }
    if (elColorAccent) {
      elColorAccent.addEventListener("input", () => {
        const a = elColorAccent.value;
        const p = elColorPrimary ? elColorPrimary.value : "#2563eb";
        const t = { primary: p, primary2: darken(p, 0.18), accent: a };
        saveTheme(t);
        applyTheme(t);
        toast("Theme updated.", "success");
      });
    }
    if (elThemeReset) {
      elThemeReset.addEventListener("click", () => {
        localStorage.removeItem(THEME_KEY);
        document.documentElement.style.removeProperty("--primary");
        document.documentElement.style.removeProperty("--primary-2");
        document.documentElement.style.removeProperty("--accent");
        if (elColorPrimary) elColorPrimary.value = "#2563eb";
        if (elColorAccent) elColorAccent.value = "#6366f1";
        toast("Theme reset.", "success");
      });
    }
  }

  /* ================================
     Draft restore + init controls
     ================================ */

  if (elInput && !(elInput.value || "").trim()) {
    const d = loadDraft();
    if (d) { elInput.value = d; updateCount(); }
  }

  if (elLang) {
    elLang.value = loadLang();
    elLang.addEventListener("change", () => saveLang(elLang.value));
  }
  if (elSimMode) {
    elSimMode.value = loadSimMode();
    elSimMode.addEventListener("change", () => saveSimMode(elSimMode.value));
  }

  pageSize = loadPageSize();
  if (elPageSize) {
    elPageSize.value = String(pageSize);
    elPageSize.addEventListener("change", () => {
      pageSize = Number(elPageSize.value || 10) || 10;
      savePageSize(pageSize);
      page = 1;
      renderHistory();
    });
  }

  if (elInput) elInput.addEventListener("input", () => { updateCount(); saveDraft(elInput.value || ""); });

  /* ================================
     Quick-start chips
     ================================ */

  const CHIP_TEMPLATES = {
    career: "我一直在職涯上反覆想：下一步到底要怎麼選，會不會選錯，結果越想越卡。",
    money: "我一直在金錢上反覆想：未來會不會不夠，忍不住跟別人比較，焦慮停不下來。",
    relationship: "我一直在關係上反覆想：對方那句話到底什麼意思，我該怎麼回應，越想越亂。",
    health: "我一直在健康上反覆想：這些症狀是不是很嚴重，最壞情況是什麼，我有沒有做夠。",
    blank: "",
  };

  const chipsWrap = document.querySelector(".chips");
  if (chipsWrap && elInput) {
    chipsWrap.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (!t.classList.contains("chip")) return;
      const key = t.getAttribute("data-template") || "";
      if (!(key in CHIP_TEMPLATES)) return;
      elInput.value = CHIP_TEMPLATES[key] || "";
      saveDraft(elInput.value);
      updateCount();
      elInput.focus();
      toast(key === "blank" ? "Cleared." : "Template inserted.", "success");
    });
  }

  /* ================================
     Analyze + strict redo + save
     ================================ */

  if (elRun) elRun.addEventListener("click", async () => {
    const text = (elInput?.value || "").trim();
    if (!text) return setStatus("Paste something first.", "warn");
    if (!canRun()) return setStatus("Slow down—cooldown is active.", "warn");

    lastRunAt = Date.now();
    localStorage.setItem("rb_last_run_ts", nowIso());
    renderKpis();

    setBusy(true, "Finding similar past loops…");
    if (elRedoStrict) elRedoStrict.disabled = true;
    try {
      const entries = loadEntries();
      const memories = topSimilarMemories(text, entries, 3);
      renderMemories(memories);

      setStatus("Calling agent…");
      const result = await callAgent(text, memories, false);
      if (result && result.error) throw new Error(result.error);

      const v = validateAgentResult(result);
      if (!v.ok) throw new Error("Invalid agent response: " + v.errors.join(" "));

      lastResult = result;
      ensureFollowupUi();
      initThreadFromAnalyze(text, result);
      setFollowupEnabled(true);
      if (elRedoStrict) elRedoStrict.disabled = false;
      renderOutput(result);
      renderInsights(result.pattern);
      if (elSave) elSave.disabled = false;
      if (elSaveDone) elSaveDone.disabled = false;
      setStatus("Done.");
      toast("Analysis ready.", "success");
    } catch (err) {
      lastResult = null;
      renderOutput(null);
      renderInsights(null);
      setStatus("Error: " + (err?.message || String(err)), "danger");
    } finally {
      setBusy(false, "");
    }
  });

  if (elRedoStrict) elRedoStrict.addEventListener("click", async () => {
    const text = (elInput?.value || "").trim();
    if (!text) return toast("Type something first.", "warn");
    if (!canRun()) return setStatus("Slow down—cooldown is active.", "warn");

    lastRunAt = Date.now();
    setBusy(true, "Running (strict)…");
    try {
      const entries = loadEntries();
      const memories = topSimilarMemories(text, entries, 3);
      renderMemories(memories);

      const result = await callAgent(text, memories, true);
      if (result && result.error) throw new Error(result.error);

      const v = validateAgentResult(result);
      if (!v.ok) throw new Error("Invalid agent response: " + v.errors.join(" "));

      lastResult = result;
      ensureFollowupUi();
      initThreadFromAnalyze(text, result);
      setFollowupEnabled(true);
      renderOutput(result);
      renderInsights(result.pattern);
      toast("Strict redo complete.", "success");
    } catch (err) {
      setStatus("Error: " + (err?.message || String(err)), "danger");
    } finally {
      setBusy(false, "");
    }
  });

  if (elSave) elSave.addEventListener("click", () => {
    const text = (elInput?.value || "").trim();
    if (!text || !lastResult) return;
    persistEntry(buildEntry(text, lastResult, { done: false }));
    setStatus("Saved locally.");
    toast("Saved.", "success");
    elSave.disabled = true;
    if (elSaveDone) elSaveDone.disabled = true;
    renderHistory();
    renderKpis();
  });

  if (elSaveDone) elSaveDone.addEventListener("click", () => {
    const text = (elInput?.value || "").trim();
    if (!text || !lastResult) return;
    persistEntry(buildEntry(text, lastResult, { done: true }));
    setStatus("Saved and marked done.");
    toast("Saved + done.", "success");
    elSaveDone.disabled = true;
    if (elSave) elSave.disabled = true;
    renderHistory();
    renderKpis();
  });

  if (elClear) elClear.addEventListener("click", () => {
    if (elInput) elInput.value = "";
    saveDraft("");
    updateCount();
    setStatus("");
    lastResult = null;
    resetThreadState();
    ensureFollowupUi();
    setFollowupEnabled(false);
    if (followPanel) followPanel.classList.add("hidden");
    if (elSave) elSave.disabled = true;
    if (elSaveDone) elSaveDone.disabled = true;
    if (elRedoStrict) elRedoStrict.disabled = true;
    renderMemories([]);
    renderOutput(null);
    renderInsights(null);
    toast("Cleared.", "success");
  });

  /* ================================
     Export/Import/Wipe
     ================================ */

  if (elExport) elExport.addEventListener("click", () => {
    const entries = loadEntries();

    if (!entries || !entries.length) {
      toast("No entries to export.", "warn");
      return;
    }

    const jsonText = JSON.stringify(entries, null, 2);
    const blob = new Blob([jsonText], { type: "application/json;charset=utf-8" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rumination_history.json";
    a.rel = "noopener";

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1200);
    toast("Exported.", "success");
  });

  if (elImport) elImport.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error("Invalid file: expected an array of entries.");

      const existing = loadEntries();
      const byId = new Map(existing.map((e) => [e.id, e]));
      for (const e of imported) if (e && e.id && !byId.has(e.id)) byId.set(e.id, e);
      const merged = Array.from(byId.values()).sort((a, b) => (a.ts > b.ts ? 1 : -1)).slice(-MAX_ENTRIES);
      saveEntries(merged);

      toast(`Imported ${Math.max(0, merged.length - existing.length)}.`, "success");
      renderHistory();
      renderKpis();
    } catch (err) {
      setStatus("Import failed: " + (err?.message || String(err)), "danger");
    } finally {
      ev.target.value = "";
    }
  });

  if (elWipe) elWipe.addEventListener("click", () => {
    const ok = confirm("Wipe all local history? This cannot be undone.");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    lastResult = null;
    clearSelection();
    renderMemories([]);
    renderOutput(null);
    renderInsights(null);
    renderHistory();
    renderKpis();
    setStatus("Local history wiped.");
    toast("History wiped.", "danger");
  });

  /* ================================
     Copy buttons
     ================================ */

  if (elCopyAction) elCopyAction.addEventListener("click", () => {
    const a = lastResult && lastResult.one_action ? lastResult.one_action : null;
    const text = a ? `${a.task || ""}\nTimebox: ${a.timebox_min || ""} min\nDone when: ${a.definition_of_done || ""}`.trim() : "";
    copyText(text, "Action copied.");
  });
  if (elCopyFollowup) elCopyFollowup.addEventListener("click", () => {
    copyText(lastResult ? (lastResult.followup_question || "") : "", "Follow-up copied.");
  });
  if (elCopyJson) elCopyJson.addEventListener("click", () => {
    copyText(lastResult ? JSON.stringify(lastResult, null, 2) : "", "JSON copied.");
  });

  

  /* ================================
     Inline follow-up (chat-like continuation)
     - No prompt() dialogs.
     - The follow-up panel lives under the Output tools row.
     ================================ */

  function injectFollowupStyles() {
    if (document.getElementById("rb-followup-style")) return;
    const style = document.createElement("style");
    style.id = "rb-followup-style";
    style.textContent = `
      .rb-followup{ margin-top: 12px; }
      .rb-followup.hidden{ display: none; }
      .rb-followup-head{ display:flex; align-items:center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .rb-followup-title{ font-weight: 900; letter-spacing: -0.01em; }
      .rb-followup-sub{ font-size: 0.92rem; color: var(--muted); }
      .rb-chatlog{
        display:flex; flex-direction: column; gap: 10px;
        max-height: 380px; overflow:auto;
        padding: 8px 6px 8px 2px;
        scroll-behavior: smooth;
      }

      /* Chat rows */
      .rb-chatrow{ display:flex; flex-direction: column; gap: 4px; }
      .rb-chatrow.user{ align-items: flex-end; }
      .rb-chatrow.assistant{ align-items: flex-start; }
      .rb-chatmeta{ display:flex; gap: 8px; color: var(--muted2); font-size: 0.78rem; padding: 0 6px; }
      .rb-chatmeta .who{ font-weight: 700; color: var(--muted); }

      /* Bubbles */
      .rb-bubble{
        max-width: min(680px, 92%);
        border-radius: 18px;
        padding: 10px 12px;
        border: 1px solid var(--border);
        background: var(--panel-2);
        box-shadow: 0 1px 0 rgba(0,0,0,0.02);
      }
      .rb-chatrow.user .rb-bubble{
        background: color-mix(in srgb, var(--primary) 14%, var(--panel));
        border-color: color-mix(in srgb, var(--primary) 28%, var(--border));
      }
      .rb-chatrow.assistant .rb-bubble{
        background: var(--panel);
      }
      .rb-chattext{ white-space: pre-wrap; line-height: 1.55; }

      .rb-details summary{ cursor: pointer; }

      /* Compose */
      .rb-followup-compose{ display:flex; flex-direction: column; gap: 8px; margin-top: 12px; }
      .rb-followup-hint{ font-size: 0.86rem; color: var(--muted); }
      .rb-followup-actions{ display:flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
      .rb-followup-leftactions{ display:flex; gap: 10px; align-items:center; flex-wrap: wrap; }

      /* Assistant card inside bubble */
      .rb-card{ border: 1px solid var(--border); background: var(--panel); border-radius: 14px; padding: 10px 12px; }
      .rb-card-head{ display:flex; align-items:center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
      .rb-card-title{ font-weight: 900; letter-spacing: -0.01em; }
      .rb-card-section{ margin-top: 10px; }
      .rb-card-label{ font-size: 0.82rem; color: var(--muted2); margin-bottom: 6px; }
      .rb-card-text{ white-space: pre-wrap; line-height: 1.55; }
      .rb-card-list{ margin: 0; padding-left: 18px; }
      .rb-card-list li{ margin: 4px 0; }

      .rb-action{ border: 1px dashed var(--border); border-radius: 12px; padding: 10px; background: var(--panel-2); }
      .rb-action-task{ font-weight: 900; margin-bottom: 6px; }
      .rb-action-meta{ display:flex; gap: 8px; flex-wrap: wrap; align-items:center; }

      .rb-msg-actions{ display:flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; justify-content: flex-end; }
      .rb-msg-actions .btn{ padding: 6px 10px; }

      /* Typing indicator */
      .rb-typing{
        display:flex; align-items:center; gap: 8px;
        padding: 0 6px;
        color: var(--muted2);
        font-size: 0.82rem;
      }
      .rb-dots{ display:inline-flex; gap: 4px; }
      .rb-dots span{
        width: 6px; height: 6px;
        border-radius: 999px;
        background: var(--muted2);
        opacity: 0.35;
        animation: rbDot 1.2s infinite ease-in-out;
      }
      .rb-dots span:nth-child(2){ animation-delay: 0.15s; }
      .rb-dots span:nth-child(3){ animation-delay: 0.3s; }
      @keyframes rbDot{
        0%, 80%, 100%{ transform: translateY(0); opacity: 0.35; }
        40%{ transform: translateY(-2px); opacity: 0.9; }
      }

      @media (max-width: 560px){
        .rb-bubble{ max-width: 96%; }
      }
    `;
    document.head.appendChild(style);
  }

  function formatChatTs(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    } catch { return ""; }
  }

  
  function renderAssistantCardHtml(result) {
    const r = result || {};
    const evidence = Array.isArray(r.evidence) ? r.evidence : [];
    const oa = r.one_action || {};
    const evHtml = evidence.length
      ? "<ul class=\"rb-card-list\">" + evidence.map((x) => "<li>" + escapeHtml(String(x)) + "</li>").join("") + "</ul>"
      : "<div class=\"muted\">—</div>";

    const actionHtml = oa && (oa.task || oa.definition_of_done || oa.timebox_min != null)
      ? `
        <div class="rb-action">
          <div class="rb-action-task">${escapeHtml(String(oa.task || ""))}</div>
          <div class="rb-action-meta">
            <span class="badge">Timebox: ${escapeHtml(String(oa.timebox_min ?? ""))} min</span>
            <span class="badge">Done: ${escapeHtml(String(oa.definition_of_done || ""))}</span>
          </div>
        </div>
      `
      : "<div class=\"muted\">—</div>";

    // Note: action buttons are wired via event delegation on the chat log.
    return `
      <div class="rb-card">
        <div class="rb-card-head">
          <span class="badge">${escapeHtml(String(r.pattern || "unknown"))}</span>
          <span class="rb-card-title">${escapeHtml(String(r.name || ""))}</span>
        </div>

        <div class="rb-card-section">
          <div class="rb-card-label">Evidence</div>
          ${evHtml}
        </div>

        <div class="rb-card-section">
          <div class="rb-card-label">One action</div>
          ${actionHtml}
        </div>

        <div class="rb-card-section">
          <div class="rb-card-label">Reframe</div>
          <div class="rb-card-text">${escapeHtml(String(r.reframe || ""))}</div>
        </div>

        <div class="rb-card-section">
          <div class="rb-card-label">Follow-up</div>
          <div class="rb-card-text">${escapeHtml(String(r.followup_question || ""))}</div>
        </div>

        <div class="rb-msg-actions">
          <button type="button" class="btn small ghost" data-rb-act="copy_action">Copy action</button>
          <button type="button" class="btn small ghost" data-rb-act="copy_reframe">Copy reframe</button>
          <button type="button" class="btn small ghost" data-rb-act="copy_json">Copy JSON</button>
          <button type="button" class="btn small soft" data-rb-act="save">Save</button>
          <button type="button" class="btn small soft" data-rb-act="save_done">Save + done</button>
        </div>
      </div>
    `;
  }

  function renderUserTextHtml(text) {
    const t = String(text || "");
    if (t.length <= 520) return `<div class="rb-chattext">${escapeHtml(t)}</div>`;
    const head = escapeHtml(t.slice(0, 520) + "…");
    const full = escapeHtml(t);
    return `
      <details class="rb-details">
        <summary class="rb-chattext">${head}</summary>
        <div class="rb-chattext" style="margin-top:8px;">${full}</div>
      </details>
    `;
  }


  
  
  function renderThreadChat() {
    if (!followLog) return;
    const chat = loadThreadChat();

    if (!chat.length) {
      followLog.innerHTML = '<p class="muted">No follow-ups yet. Add an update below to continue.</p>';
      return;
    }

    followLog.innerHTML = chat.map((m, idx) => {
      const role = m.role === "user" ? "user" : "assistant";
      const who = role === "user" ? "You" : "Agent";
      const ts = m.ts ? formatChatTs(m.ts) : "";

      const meta = `<div class="rb-chatmeta"><span class="who">${escapeHtml(who)}</span><span>${escapeHtml(ts)}</span></div>`;

      if (role === "assistant" && m.typing) {
        return `
          <div class="rb-chatrow assistant">
            ${meta}
            <div class="rb-bubble">
              <div class="rb-typing"><span>Typing</span><span class="rb-dots"><span></span><span></span><span></span></span></div>
            </div>
          </div>
        `;
      }

      if (role === "assistant" && m.result && typeof m.result === "object") {
        return `
          <div class="rb-chatrow assistant" data-msg-idx="${idx}">
            ${meta}
            <div class="rb-bubble">
              ${renderAssistantCardHtml(m.result)}
            </div>
          </div>
        `;
      }

      const body = role === "user" ? renderUserTextHtml(m.text || "") : `<div class="rb-chattext">${escapeHtml(String(m.text || ""))}</div>`;
      return `
        <div class="rb-chatrow ${role}" data-msg-idx="${idx}">
          ${meta}
          <div class="rb-bubble">
            ${body}
          </div>
        </div>
      `;
    }).join("");

    // Auto-scroll to bottom
    followLog.scrollTop = followLog.scrollHeight;
  }

  function appendThreadMsg(role, text, resultObj) {
    const chat = loadThreadChat();
    const msg = {
      role: role === "user" ? "user" : "assistant",
      ts: nowIso(),
      text: String(text || "").trim(),
    };
  
    if (msg.role === "assistant" && resultObj && typeof resultObj === "object") {
      msg.result = resultObj;
      // Keep a readable fallback text for export/debug
      if (!msg.text) msg.text = summarizeAssistant(resultObj) || "";
    }
  
    chat.push(msg);
    saveThreadChat(chat);
    renderThreadChat();
  }  

  
  function initThreadFromAnalyze(baseText, result) {
    const base = String(baseText || "").trim();
    if (!base) return;
    saveThreadBase(base);
    saveThreadLast(result || null);

    // Fresh chat for this base text
    const chat = [];
    chat.push({ role: "user", ts: nowIso(), text: base });
    chat.push({ role: "assistant", ts: nowIso(), text: summarizeAssistant(result || {}) || "(no summary)", result: result || null });
    saveThreadChat(chat);
    renderThreadChat();
  }


  function setFollowupEnabled(enabled) {
    if (btnContinue) btnContinue.disabled = !enabled;
    if (btnThreadReset) btnThreadReset.disabled = false;
    if (followSend) followSend.disabled = !enabled;
    if (followInput) followInput.disabled = !enabled;
  }

  
  function showTypingIndicator(show) {
    const chat = loadThreadChat();
    const hasTyping = chat.length && chat[chat.length - 1] && chat[chat.length - 1].typing;
    if (show) {
      if (!hasTyping) {
        chat.push({ role: "assistant", ts: nowIso(), text: "", typing: true });
        saveThreadChat(chat);
        renderThreadChat();
      }
    } else {
      if (hasTyping) {
        chat.pop();
        saveThreadChat(chat);
        renderThreadChat();
      }
    }
  }

  function getLastAssistantResult() {
    const chat = loadThreadChat();
    for (let i = chat.length - 1; i >= 0; i--) {
      const m = chat[i];
      if (m && m.role === "assistant" && m.result) return m.result;
    }
    return lastResult;
  }

function ensureFollowupUi() {
    injectFollowupStyles();

    const tools = document.querySelector(".outtools");
    if (!tools) return;

    // Continue button
    if (!btnContinue) {
      btnContinue = document.createElement("button");
      btnContinue.id = "rb-continue";
      btnContinue.type = "button";
      btnContinue.className = "btn small soft";
      btnContinue.textContent = "Continue";
      btnContinue.disabled = true;
      tools.appendChild(btnContinue);
    }

    // Reset thread button
    if (!btnThreadReset) {
      btnThreadReset = document.createElement("button");
      btnThreadReset.id = "rb-thread-reset";
      btnThreadReset.type = "button";
      btnThreadReset.className = "btn small ghost";
      btnThreadReset.textContent = "Reset thread";
      btnThreadReset.title = "Start a fresh loop from the next Analyze";
      tools.appendChild(btnThreadReset);
    }

    // Follow-up panel (card)
    if (!followPanel) {
      followPanel = document.createElement("div");
      followPanel.className = "card rb-followup hidden";
      followPanel.innerHTML = `
        <div class="rb-followup-head">
          <div>
            <div class="rb-followup-title">Follow-up</div>
            <div class="rb-followup-sub">Add updates and continue the same loop (multi-turn).</div>
          </div>
          <div class="row" style="gap:10px; flex-wrap:nowrap;">
            <button type="button" class="btn small ghost" id="rb-followup-close">Close</button>
          </div>
        </div>

        <div class="rb-chatlog" id="rb-chatlog"></div>

        <div class="rb-followup-compose">
          <div class="rb-followup-hint">Enter to send · Shift+Enter for a new line</div>
          <textarea id="rb-followup-input" class="textarea" rows="3"
            placeholder="Type your update…"></textarea>
          <div class="rb-followup-actions">
            <button type="button" class="btn small soft" id="rb-followup-send">Send update</button>
          </div>
        </div>
      `;

      // Insert right after the tools row
      tools.insertAdjacentElement("afterend", followPanel);

      followLog = followPanel.querySelector("#rb-chatlog");
      followInput = followPanel.querySelector("#rb-followup-input");
      followSend = followPanel.querySelector("#rb-followup-send");
      followClose = followPanel.querySelector("#rb-followup-close");

      // Chat action buttons (event delegation)
      if (followLog && !followLog._wired) {
        followLog._wired = true;
        followLog.addEventListener("click", async (ev) => {
          const t = ev.target;
          if (!(t instanceof Element)) return;
          const btn = t.closest("button[data-rb-act]");
          if (!btn) return;

          const act = btn.getAttribute("data-rb-act") || "";
          const row = btn.closest("[data-msg-idx]");
          const msgIdx = row ? Number(row.getAttribute("data-msg-idx")) : NaN;

          const chat = loadThreadChat();
          const msg = Number.isFinite(msgIdx) ? chat[msgIdx] : null;
          const result = (msg && msg.result) ? msg.result : getLastAssistantResult();

          if (!result) return toast("No agent result found for this message.", "warn");

          if (act === "copy_action") {
            const a = result.one_action || {};
            const txt = `${a.task || ""}\nTimebox: ${a.timebox_min ?? ""} min\nDone when: ${a.definition_of_done || ""}`.trim();
            return copyText(txt, "Action copied.");
          }

          if (act === "copy_reframe") {
            return copyText(String(result.reframe || ""), "Reframe copied.");
          }

          if (act === "copy_json") {
            return copyText(JSON.stringify(result, null, 2), "JSON copied.");
          }

          if (act === "save" || act === "save_done") {
            const base = loadThreadBase() || (elInput ? (elInput.value || "").trim() : "");
            if (!base) return toast("No base text found.", "warn");
            persistEntry(buildEntry(base, result, { done: act === "save_done" }));
            renderHistory();
            renderKpis();
            return toast(act === "save_done" ? "Saved + done." : "Saved.", "success");
          }
        });
      }

      if (followClose) {
        followClose.addEventListener("click", () => {
          followPanel.classList.add("hidden");
        });
      }

      if (followInput) {
        followInput.addEventListener("keydown", (e) => {
          if (e.isComposing || e.keyCode === 229) return;
          if (e.key !== "Enter") return;
          if (e.shiftKey) return; // newline
          e.preventDefault();
          if (followSend && !followSend.disabled) followSend.click();
        });
      }

      if (followSend) {
        followSend.addEventListener("click", async () => {
          if (!lastResult) return toast("Run Analyze first.", "warn");
          const base = loadThreadBase() || (elInput ? (elInput.value || "").trim() : "");
          if (!base) return toast("Paste something first.", "warn");

          const updateText = (followInput ? String(followInput.value || "").trim() : "");
          if (!updateText) return toast("Type an update first.", "warn");

          if (!canRun()) return setStatus("Slow down—cooldown is active.", "warn");

          // Persist user update to chat immediately
          appendThreadMsg("user", updateText);
          showTypingIndicator(true);

          // Clear input early
          if (followInput) followInput.value = "";

          lastRunAt = Date.now();
          setBusy(true, "Continuing the same loop…");

          try {
            const entries = loadEntries();
            const memories = topSimilarMemories(base, entries, 3);
            renderMemories(memories);

            const composed = buildContinuationText(base, lastResult, updateText);

            setStatus("Calling agent…");
            const result = await callAgent(composed, memories, false);
            if (result && result.error) throw new Error(result.error);

            const v = validateAgentResult(result);
            if (!v.ok) throw new Error("Invalid agent response: " + v.errors.join(" "));

            lastResult = result;
            saveThreadBase(base);
            saveThreadLast(result);

            renderOutput(result);
            renderInsights(result.pattern);

            showTypingIndicator(false);
            appendThreadMsg("assistant", "", result);
            toast("Continued.", "success");
            setStatus("Done.");
          } catch (err) {
            showTypingIndicator(false);
            appendThreadMsg("assistant", "Error: " + (err?.message || String(err)));
            setStatus("Error: " + (err?.message || String(err)), "danger");
          } finally {
            showTypingIndicator(false);
            setBusy(false, "");
          }
        });
      }
    }

    // Wire buttons (once)
    if (!btnContinue._wired) {
      btnContinue._wired = true;
      btnContinue.addEventListener("click", () => {
        if (!followPanel) return;
        followPanel.classList.toggle("hidden");
        renderThreadChat();
        setTimeout(() => { if (followInput) followInput.focus(); }, 0);
      });
    }

    if (!btnThreadReset._wired) {
      btnThreadReset._wired = true;
      btnThreadReset.addEventListener("click", () => {
        resetThreadState();
        renderThreadChat();
        if (followPanel) followPanel.classList.add("hidden");
        toast("Thread reset. Next Analyze starts fresh.", "success");
        setFollowupEnabled(!!lastResult);
      });
    }

    // Restore chat if any
    renderThreadChat();
  }
/* ================================
     History actions (delegation)
     ================================ */

  if (elHistory) {
    elHistory.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;

      const btn = t.closest("button");
      if (btn) {
        const id = btn.getAttribute("data-id");
        if (!id) return;

        if (btn.classList.contains("viewbtn")) {
          const e = loadEntries().find((x) => x.id === id);
          if (e) openModal(e);
          return;
        }

        if (btn.classList.contains("delbtn")) {
          if (!confirm("Delete this entry?")) return;
          deleteEntriesByIds([id]);
          selectedIds.delete(id);
          renderHistory();
          renderKpis();
          toast("Deleted.", "success");
          return;
        }

        if (btn.classList.contains("pinbtn")) {
          const entries = loadEntries();
          const idx = entries.findIndex((e) => e.id === id);
          if (idx === -1) return;
          entries[idx].pinned = !entries[idx].pinned;
          saveEntries(entries);
          renderHistory();
          renderKpis();
          toast(entries[idx].pinned ? "Pinned." : "Unpinned.", "success");
          return;
        }

        if (btn.classList.contains("donebtn")) {
          const entries = loadEntries();
          const idx = entries.findIndex((e) => e.id === id);
          if (idx === -1) return;
          entries[idx].done_ts = entries[idx].done_ts ? null : nowIso();
          saveEntries(entries);
          renderHistory();
          renderKpis();
          toast(entries[idx].done_ts ? "Marked done." : "Undone.", "success");
          return;
        }

        return;
      }

      if (t.closest('input, label, a, select, textarea, .selbox, .actions')) return;

      const item = t.closest(".item");
      if (!item) return;

      const cb = item.querySelector('input.sel[data-id]');
      const id = cb ? cb.getAttribute("data-id") : null;
      if (!id) return;

      const e = loadEntries().find((x) => x.id === id);
      if (e) openModal(e);
    });

    elHistory.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!(t instanceof Element)) return;
      if (!t.classList.contains("sel")) return;
      const id = t.getAttribute("data-id");
      if (!id) return;
      if (t.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      setSelectionInfo();
    });
  }

  /* ================================
     Bulk actions
     ================================ */

  if (elSelectPage) elSelectPage.addEventListener("click", () => {
    const boxes = Array.from(elHistory?.querySelectorAll("input.sel") || []);
    boxes.forEach((b) => {
      b.checked = true;
      const id = b.getAttribute("data-id");
      if (id) selectedIds.add(id);
    });
    setSelectionInfo();
  });

  if (elClearSelection) elClearSelection.addEventListener("click", clearSelection);

  if (elDeleteSelected) elDeleteSelected.addEventListener("click", () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} selected entries?`)) return;
    deleteEntriesByIds(ids);
    clearSelection();
    page = 1;
    renderHistory();
    renderKpis();
    toast("Deleted selected.", "success");
  });

  if (elDeleteFiltered) elDeleteFiltered.addEventListener("click", () => {
    const q = normalizeText(elSearch?.value || "");
    const filter = elFilter?.value || "all";
    const statusFilter = getStatusFilterValue();

    let entries = loadEntries();
    if (q) entries = entries.filter((e) => normalizeText(e.text || "").includes(q) || normalizeText(e.summary || "").includes(q));
    if (filter !== "all") entries = entries.filter((e) => (e.pattern || "") === filter);
    if (statusFilter === "pinned") entries = entries.filter((e) => !!e.pinned);
    else if (statusFilter === "done") entries = entries.filter((e) => !!e.done_ts);
    else if (statusFilter === "todo") entries = entries.filter((e) => !e.done_ts);

    if (!entries.length) return toast("Nothing to delete.", "info");
    if (!confirm(`Delete ALL filtered entries (${entries.length})?`)) return;

    deleteEntriesByIds(entries.map((e) => e.id));
    clearSelection();
    page = 1;
    renderHistory();
    renderKpis();
    toast("Deleted filtered.", "success");
  });

  /* ================================
     Pagination + filters
     ================================ */

  if (elPagePrev) elPagePrev.addEventListener("click", () => { page = Math.max(1, page - 1); renderHistory(); });
  if (elPageNext) elPageNext.addEventListener("click", () => { page = page + 1; renderHistory(); });

  if (elSearch) elSearch.addEventListener("input", () => { page = 1; renderHistory(); });
  if (elFilter) elFilter.addEventListener("change", () => { page = 1; renderHistory(); });
  if (elStatusFilter) elStatusFilter.addEventListener("change", () => { page = 1; renderHistory(); });
  if (elSort) elSort.addEventListener("change", () => { page = 1; renderHistory(); });

  /* ================================
     Initial render
     ================================ */

  updateCount();
  renderMemories([]);
  renderOutput(null);
  renderInsights(null);
  renderHistory();
  renderKpis();

  initThemeUi();
  ensureFollowupUi();
  setFollowupEnabled(false);

  if (elVersion) elVersion.textContent = "v" + VERSION;

  // Initial active state + optional initial hash scroll
  if (location.hash) {
    setActiveByHash(location.hash);
    requestAnimationFrame(() => navigateToHash(location.hash));
  } else {
    setActiveByHash("#rb-section-input");
  }  
})();
