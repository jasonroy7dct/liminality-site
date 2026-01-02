/* main.js
   - Smooth page transitions (leave -> enter)
   - History API routing: /blog, /blog/:id, /podcast, /podcast/:id, /projects
   - Fixes:
     1) Nav click during transition could desync nav vs page (now queued)
     2) Refresh on "/" could show only nav + footer (now forces correct active page on boot)
   - Mobile:
     3) Mobile drawer navigation (hamburger -> sidebar), closes on navigation
*/

let ALL_BLOG_POSTS = [];
let currentEpisodes = [];

/* ---------------------------
   Utilities
---------------------------- */

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text ?? "");
  return div.innerHTML;
}

function normalizePath(pathname) {
  if (!pathname) return "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

/* ---------------------------
   Mobile drawer nav
---------------------------- */

function initMobileDrawerNav() {
  const drawer = document.getElementById("navDrawer");
  const toggle = document.querySelector(".nav-toggle");
  if (!drawer || !toggle) return;

  const html = document.documentElement;
  const body = document.body;

  function isOpen() {
    return drawer.classList.contains("is-open");
  }

  function openDrawer() {
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    html.classList.add("nav-open");
    body.classList.add("nav-open");
  }

  function closeDrawer() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    html.classList.remove("nav-open");
    body.classList.remove("nav-open");
  }

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    if (isOpen()) closeDrawer();
    else openDrawer();
  });

  document.addEventListener("click", (e) => {
    const closeEl = e.target.closest("[data-nav-close]");
    if (closeEl && isOpen()) {
      e.preventDefault();
      closeDrawer();
      return;
    }

    /* If user clicks a drawer link, close after routing triggers */
    const drawerLink = e.target.closest(".nav-drawer a[data-route]");
    if (drawerLink && isOpen()) {
      closeDrawer();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen()) closeDrawer();
  });

  /* Expose a safe closer for router hooks */
  window.__closeNavDrawer = closeDrawer;
    /* Auto-close drawer when viewport becomes desktop */
    function syncDrawerForDesktop() {
      if (window.innerWidth > 720 && isOpen()) {
        closeDrawer();
      }
    }
  
    window.addEventListener("resize", syncDrawerForDesktop);
    window.addEventListener("orientationchange", syncDrawerForDesktop);  
}

/* ---------------------------
   Pages
---------------------------- */

const pages = {
  home: document.getElementById("page-home"),
  blog: document.getElementById("page-blog"),
  post: document.getElementById("page-post"),
  podcast: document.getElementById("page-podcast"),
  episode: document.getElementById("page-episode"),
  projects: document.getElementById("page-projects"),
};

let activePageKey = "home";
let isTransitioning = false;

/* If user navigates during a transition, queue the latest navigation */
let pendingNav = null;

function getPageKeyByPath(pathname) {
  const p = normalizePath(pathname);

  if (p === "/") return "home";
  if (p === "/blog") return "blog";
  if (p.startsWith("/blog/")) return "post";
  if (p === "/podcast") return "podcast";
  if (p.startsWith("/podcast/")) return "episode";
  if (p === "/projects") return "projects";
  return "home";
}

function updateNavActiveByPath(pathname = window.location.pathname) {
  const path = normalizePath(pathname);
  const key = getPageKeyByPath(path);

  const links = document.querySelectorAll("a[data-route]");
  links.forEach((a) => {
    const routeRaw = a.getAttribute("data-route");
    if (!routeRaw) return;

    const route = normalizePath(routeRaw);
    let shouldActive = false;

    if (route === "/") shouldActive = key === "home";
    if (route === "/blog") shouldActive = key === "blog" || key === "post";
    if (route === "/podcast") shouldActive = key === "podcast" || key === "episode";
    if (route === "/projects") shouldActive = key === "projects";

    a.classList.toggle("active", shouldActive);
  });
}

/* Force correct DOM state without animation (used on boot) */
function setActivePageImmediate(nextKey) {
  const key = pages[nextKey] ? nextKey : "home";

  Object.entries(pages).forEach(([k, el]) => {
    if (!el) return;
    const isActive = k === key;

    el.classList.toggle("page--active", isActive);
    el.classList.remove("page--leaving");
    el.classList.remove("page--entering");
    el.setAttribute("aria-hidden", isActive ? "false" : "true");
  });

  activePageKey = key;
  updateNavActiveByPath();
}

/* Ensure only one page is active at a time */
function hardSyncActiveClasses(targetKey) {
  Object.entries(pages).forEach(([k, el]) => {
    if (!el) return;
    const shouldBeActive = k === targetKey;
    el.classList.toggle("page--active", shouldBeActive);
    if (!shouldBeActive) {
      el.classList.remove("page--leaving");
      el.classList.remove("page--entering");
      el.setAttribute("aria-hidden", "true");
    } else {
      el.setAttribute("aria-hidden", "false");
    }
  });
}

async function setActivePage(nextKey) {
  if (!pages[nextKey]) {
    updateNavActiveByPath();
    return;
  }

  if (isTransitioning) {
    pendingNav = { nextKey };
    return;
  }

  const prevKey = activePageKey;

  if (nextKey === prevKey) {
    /* Fix refresh-on-home edge case: ensure active class exists */
    hardSyncActiveClasses(nextKey);
    updateNavActiveByPath();
    return;
  }

  isTransitioning = true;

  const prev = pages[prevKey];
  const next = pages[nextKey];

  /* Leave */
  prev.classList.add("page--leaving");

  await new Promise((r) => setTimeout(r, 180));

  /* Switch */
  prev.classList.remove("page--active");
  prev.classList.remove("page--leaving");
  prev.setAttribute("aria-hidden", "true");

  next.classList.add("page--entering");
  next.classList.add("page--active");
  next.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      next.classList.remove("page--entering");
    });
  });

  activePageKey = nextKey;
  window.scrollTo({ top: 0, behavior: "auto" });

  updateNavActiveByPath();

  await new Promise((r) => setTimeout(r, 260));

  isTransitioning = false;

  if (pendingNav) {
    const { nextKey: queuedKey } = pendingNav;
    pendingNav = null;
    if (queuedKey && queuedKey !== activePageKey) {
      setActivePage(queuedKey);
    } else {
      hardSyncActiveClasses(activePageKey);
      updateNavActiveByPath();
    }
  }
}

/* ---------------------------
   Router
---------------------------- */

function parsePath(pathname) {
  const p = normalizePath(pathname);

  if (p === "/") return { page: "home" };
  if (p === "/blog") return { page: "blog" };
  if (p.startsWith("/blog/"))
    return { page: "post", id: decodeURIComponent(p.slice("/blog/".length)) };

  if (p === "/podcast") return { page: "podcast" };
  if (p.startsWith("/podcast/"))
    return { page: "episode", id: decodeURIComponent(p.slice("/podcast/".length)) };

  if (p === "/projects") return { page: "projects" };

  return { page: "home" };
}

function route(state) {
  if (!state || !state.page) state = parsePath(window.location.pathname);

  if (state.page === "home") {
    setActivePage("home");
    return;
  }

  if (state.page === "blog") {
    setActivePage("blog");
    return;
  }

  if (state.page === "post") {
    if (state.id) showBlogPost(state.id, { push: false });
    else setActivePage("blog");
    return;
  }

  if (state.page === "podcast") {
    setActivePage("podcast");
    return;
  }

  if (state.page === "episode") {
    if (state.id) showEpisodePage(state.id, { push: false });
    else setActivePage("podcast");
    return;
  }

  if (state.page === "projects") {
    setActivePage("projects");
    return;
  }

  setActivePage("home");
}

function navigateTo(url, state, { push = true } = {}) {
  const path = normalizePath(url);

  /* Close mobile drawer when navigation happens */
  if (typeof window.__closeNavDrawer === "function") window.__closeNavDrawer();

  /* If transition is running, queue navigation and update URL immediately to match intent */
  if (isTransitioning) {
    pendingNav = { nextKey: getPageKeyByPath(path) };

    updateNavActiveByPath(path);

    if (push) history.pushState(state, "", path);
    else history.replaceState(state, "", path);

    return;
  }

  updateNavActiveByPath(path);

  if (push) history.pushState(state, "", path);
  route(state);
}

window.addEventListener("popstate", (e) => {
  const state = e.state || parsePath(window.location.pathname);
  pendingNav = null;

  /* Close mobile drawer on back/forward */
  if (typeof window.__closeNavDrawer === "function") window.__closeNavDrawer();

  updateNavActiveByPath(window.location.pathname);
  route(state);
});

/* ---------------------------
   Blog
---------------------------- */

function renderBlogList(posts) {
  const grid = document.getElementById("blogGrid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!posts || posts.length === 0) {
    grid.innerHTML =
      '<p class="muted" style="text-align:center; padding: 1.5rem 0;">No posts yet.</p>';
    return;
  }

  let lastYear = null;

  posts.forEach((post) => {
    const rawDate = post.dateISO || post.date || "";
    const d = rawDate ? new Date(rawDate) : null;
    const year = d && !isNaN(d.getTime()) ? String(d.getFullYear()) : "";

    if (year && year !== lastYear) {
      const y = document.createElement("div");
      y.className = "blog-year";
      y.textContent = year;
      grid.appendChild(y);
      lastYear = year;
    }

    const row = document.createElement("div");
    row.className = "blog-row";
    row.setAttribute("role", "link");
    row.tabIndex = 0;

    row.innerHTML = `
      <span class="blog-row-title">${escapeHtml(post.title || "(Untitled)")}</span>
      <span class="blog-row-date">${escapeHtml(post.date || "")}</span>
    `;

    const go = () => {
      navigateTo(
        `/blog/${encodeURIComponent(post.id)}`,
        { page: "post", id: post.id },
        { push: true }
      );
    };

    row.addEventListener("click", go);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        go();
      }
    });

    grid.appendChild(row);
  });
}

function showBlogPost(postId, options = { push: true }) {
  const post = ALL_BLOG_POSTS.find((p) => p.id === postId);
  if (!post) {
    setActivePage("blog");
    return;
  }

  if (options.push) {
    history.pushState({ page: "post", id: postId }, "", `/blog/${encodeURIComponent(postId)}`);
  }

  const titleEl = document.getElementById("postTitle");
  const metaEl = document.getElementById("postMeta");
  const contentEl = document.getElementById("postContent");

  if (titleEl) titleEl.textContent = post.title || "(No title)";
  if (metaEl) metaEl.textContent = `Jason Hsieh · ${post.date || ""}`;

  if (contentEl) {
    const isMedium = post.source === "medium";
    const bodyHtml = isMedium
      ? `<div class="medium-article-body">${post.contentHtml}</div>`
      : post.contentHtml;
    contentEl.innerHTML = `${bodyHtml || "<p>(No content)</p>"}`;
  }

  setActivePage("post");
  updateNavActiveByPath();
}

/* ---------------------------
   Podcast
---------------------------- */

function getEpisodeById(id) {
  return currentEpisodes.find((ep) => String(ep.id) === String(id));
}

function renderRecentEpisodes(episodes = currentEpisodes) {
  const grid = document.getElementById("recentEpisodesGrid");
  if (!grid) return;

  grid.innerHTML = "";
  if (!episodes || episodes.length === 0) return;

  const latest = episodes.slice(0, 3);

  latest.forEach((ep) => {
    const card = document.createElement("div");
    card.className = "podcast-episode";
    card.tabIndex = 0;

    const desc = String(ep.description || "");
    const descPreview = desc.length > 90 ? desc.substring(0, 90) + "..." : desc;

    card.innerHTML = `
      <img src="${escapeHtml(ep.imageUrl || "")}" alt="${escapeHtml(ep.title || "")}" class="podcast-image" loading="lazy">
      <div class="podcast-content">
        <h3>${escapeHtml(ep.title || "")}</h3>
        <p class="episode-number">${escapeHtml(ep.date || "")} · ${escapeHtml(ep.duration || "")}</p>
        <p>${escapeHtml(descPreview)}</p>
      </div>
    `;

    const go = () => {
      navigateTo(
        `/podcast/${encodeURIComponent(ep.id)}`,
        { page: "episode", id: ep.id },
        { push: true }
      );
    };

    card.addEventListener("click", go);
    card.addEventListener("keypress", (e) => {
      if (e.key === "Enter") go();
    });

    grid.appendChild(card);
  });
}

function renderAllEpisodes(episodes = currentEpisodes) {
  const grid = document.getElementById("allEpisodesGrid");
  if (!grid) return;

  grid.innerHTML = "";
  if (!episodes || episodes.length === 0) return;

  episodes.forEach((ep) => {
    const card = document.createElement("div");
    card.className = "podcast-episode";
    card.tabIndex = 0;

    const desc = String(ep.description || "");
    const descPreview = desc.length > 90 ? desc.substring(0, 90) + "..." : desc;

    card.innerHTML = `
      <img src="${escapeHtml(ep.imageUrl || "")}" alt="${escapeHtml(ep.title || "")}" class="podcast-image" loading="lazy">
      <div class="podcast-content">
        <h3>${escapeHtml(ep.title || "")}</h3>
        <p class="episode-number">${escapeHtml(ep.date || "")} · ${escapeHtml(ep.duration || "")}</p>
        <p>${escapeHtml(descPreview)}</p>
      </div>
    `;

    const go = () => {
      navigateTo(
        `/podcast/${encodeURIComponent(ep.id)}`,
        { page: "episode", id: ep.id },
        { push: true }
      );
    };

    card.addEventListener("click", go);
    card.addEventListener("keypress", (e) => {
      if (e.key === "Enter") go();
    });

    grid.appendChild(card);
  });
}

function showEpisodePage(episodeId, options = { push: true }) {
  const episodeData = getEpisodeById(episodeId);
  if (!episodeData) {
    setActivePage("podcast");
    return;
  }

  if (options.push) {
    history.pushState(
      { page: "episode", id: episodeId },
      "",
      `/podcast/${encodeURIComponent(episodeId)}`
    );
  }

  const titleEl = document.getElementById("episodeTitle");
  const metaEl = document.getElementById("episodeMeta");
  const descEl = document.getElementById("episodeDescription");
  const embedEl = document.getElementById("spotifyEmbedContainer");
  const btn = document.getElementById("spotifyLinkBtn");

  if (titleEl) titleEl.textContent = episodeData.title || "";
  if (metaEl) metaEl.textContent = `${episodeData.date || ""} · ${episodeData.duration || ""}`;
  if (descEl) descEl.textContent = episodeData.description || "";

  if (embedEl) {
    embedEl.innerHTML = `
      <iframe
        style="border-radius:12px"
        src="${episodeData.spotifyEmbed}"
        width="100%"
        height="352"
        frameborder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"></iframe>
    `;
  }

  if (btn) {
    btn.onclick = () => window.open(episodeData.spotifyLink, "_blank", "noopener,noreferrer");
  }

  const episodePage = document.getElementById("page-episode");
  if (episodePage) episodePage.dataset.currentEpisode = episodeData.id;

  setActivePage("episode");
  updateNavActiveByPath();
}

/* ---------------------------
   Netlify Functions Fetch
---------------------------- */

async function fetchEpisodes() {
  try {
    const res = await fetch("/.netlify/functions/episodes");
    if (!res.ok) throw new Error("Failed to fetch episodes");
    const data = await res.json();
    return data.episodes || [];
  } catch (e) {
    console.error("[Spotify] episodes function failed:", e);
    return [];
  }
}

async function fetchMediumPosts() {
  try {
    const res = await fetch("/.netlify/functions/medium");
    if (!res.ok) throw new Error("Medium function failed");
    const data = await res.json();
    return data.posts || [];
  } catch (e) {
    console.error("[Medium] RSS function failed:", e);
    return [];
  }
}

/* ---------------------------
   Wiring
---------------------------- */

function initNavRouting() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-route]");
    if (!a) return;

    const routeRaw = a.getAttribute("data-route");
    if (!routeRaw) return;

    if (routeRaw.startsWith("http")) return;

    e.preventDefault();

    const route = normalizePath(routeRaw);
    const nextState = parsePath(route);

    navigateTo(route, nextState, { push: true });
  });

  const logo = document.querySelector(".logo[data-route]");
  if (logo) {
    logo.addEventListener("click", (e) => {
      e.preventDefault();
      navigateTo("/", { page: "home" }, { push: true });
    });
  }
}

function initBackButtons() {
  const postBackBtn = document.getElementById("postBackBtn");
  const episodeBackBtn = document.getElementById("episodeBackBtn");

  const safeBack = (fallbackUrl, fallbackState) => {
    if (window.history.length > 1) history.back();
    else navigateTo(fallbackUrl, fallbackState, { push: true });
  };

  if (postBackBtn)
    postBackBtn.addEventListener("click", () => safeBack("/blog", { page: "blog" }));
  if (episodeBackBtn)
    episodeBackBtn.addEventListener("click", () => safeBack("/podcast", { page: "podcast" }));
}

/* ---------------------------
   Mobile Drawer
---------------------------- */

function initMobileDrawer() {
  const menuBtn = document.getElementById("menuBtn");
  const drawer = document.getElementById("mobileDrawer");
  const overlay = document.getElementById("drawerOverlay");
  const closeBtn = document.getElementById("drawerCloseBtn");
  const drawerLinks = document.getElementById("drawerLinks");

  const sourceLinks = document.querySelector("nav .nav-links");

  if (!menuBtn || !drawer || !overlay || !closeBtn || !drawerLinks || !sourceLinks) return;

  // Clone nav links into drawer so desktop and mobile stay in sync
  drawerLinks.innerHTML = `<ul class="drawer-list">${sourceLinks.innerHTML}</ul>`;

  function openDrawer() {
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    menuBtn.setAttribute("aria-expanded", "true");
    document.documentElement.classList.add("no-scroll");
    document.body.classList.add("no-scroll");
  }

  function closeDrawer() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    menuBtn.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("no-scroll");
    document.body.classList.remove("no-scroll");
  }

  menuBtn.addEventListener("click", () => {
    const isOpen = drawer.classList.contains("is-open");
    if (isOpen) closeDrawer();
    else openDrawer();
  });

  overlay.addEventListener("click", closeDrawer);
  closeBtn.addEventListener("click", closeDrawer);

  // Close drawer when clicking any drawer link
  drawer.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-route]");
    if (!a) return;
    closeDrawer();
  });

  // Close on ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawer.classList.contains("is-open")) {
      closeDrawer();
    }
  });

  // Expose a safe close hook for route changes if needed
  window.__closeMobileDrawer = closeDrawer;
    /* Auto-close drawer when viewport becomes desktop */
    function syncMobileDrawerForDesktop() {
      if (window.innerWidth > 720 && drawer.classList.contains("is-open")) {
        closeDrawer();
      }
    }
  
    window.addEventListener("resize", syncMobileDrawerForDesktop);
    window.addEventListener("orientationchange", syncMobileDrawerForDesktop);  
}

/* ---------------------------
   Init
---------------------------- */

document.addEventListener("DOMContentLoaded", async () => {
  document.documentElement.classList.remove("booting");
  document.documentElement.removeAttribute("data-route");

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  initMobileDrawerNav();
  initNavRouting();
  initMobileDrawer();
  initBackButtons();

  const initial = parsePath(window.location.pathname);
  history.replaceState(initial, "", window.location.pathname);

  setActivePageImmediate(getPageKeyByPath(window.location.pathname));

  route(initial);
  updateNavActiveByPath();

  const localPosts = typeof BLOG_POSTS !== "undefined" ? BLOG_POSTS : [];
  const mediumPosts = await fetchMediumPosts();

  // Merge
  ALL_BLOG_POSTS = [...mediumPosts, ...localPosts];

    // De-dupe: if a local post points to a Medium URL that exists in Medium feed, drop the local one
    const mediumLinks = new Set(
      (mediumPosts || [])
        .map((p) => String(p.link || "").trim())
        .filter(Boolean)
    );
  
    ALL_BLOG_POSTS = ALL_BLOG_POSTS.filter((p) => {
      const mu = String(p.mediumUrl || "").trim();
      if (!mu) return true; // keep local-only posts
      if (p.source === "medium") return true; // keep real Medium posts
      return !mediumLinks.has(mu); // drop local duplicates
    });  

  // Sort (newest first)
  ALL_BLOG_POSTS.sort((a, b) => {
    const da = new Date(a.dateISO || a.date || 0).getTime();
    const db = new Date(b.dateISO || b.date || 0).getTime();
    return db - da;
  });

  renderBlogList(ALL_BLOG_POSTS);

  currentEpisodes = await fetchEpisodes();
  renderRecentEpisodes(currentEpisodes);
  renderAllEpisodes(currentEpisodes);

  hardSyncActiveClasses(activePageKey);
  updateNavActiveByPath();
});
