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

  const VERSION = "1.0.4";
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

  if (elVersion) elVersion.textContent = "v" + VERSION;

  // Initial active state + optional initial hash scroll
  if (location.hash) {
    setActiveByHash(location.hash);
    requestAnimationFrame(() => navigateToHash(location.hash));
  } else {
    setActiveByHash("#rb-section-input");
  }  
})();
