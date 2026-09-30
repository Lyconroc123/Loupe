/* ==========================================================
   Loupe — app
   Plain JavaScript, no build step. State lives in S and the URL;
   saved items, additions and recents live in localStorage.
   ========================================================== */
(function () {
  "use strict";

  const DATA = window.LOUPE_DATA;
  const CFG = window.LOUPE_CONFIG || {};
  const CATS = DATA.categories;
  const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
  const PRICE = {
    oss: { label: "Open source", long: "Open source", note: "Code is public under an open license." },
    free: { label: "Free", long: "Free", note: "Free to use, but the source isn't open." },
    freemium: { label: "Freemium", long: "Freemium", note: "A useful free tier, with paid plans for more." },
    paid: { label: "Paid", long: "Paid", note: "Needs a purchase or subscription." },
  };
  const PRICE_WORDS = { oss: "open source oss free libre", free: "free", freemium: "freemium free tier", paid: "paid pro" };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  const store = {
    get(k, d) { try { const v = localStorage.getItem("loupe." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("loupe." + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("loupe." + k); } catch (e) {} },
    raw(k, v) { try { if (v === undefined) return localStorage.getItem("loupe." + k); if (v === null) localStorage.removeItem("loupe." + k); else localStorage.setItem("loupe." + k, v); } catch (e) { return null; } },
  };

  /* ---------- Data ---------- */
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function hostOf(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/$/, "");
      return u.hostname.replace(/^www\./, "") + (path.length > 1 ? path : "");
    } catch (e) { return url; }
  }
  const domainOf = (url) => { try { return new URL(url).hostname; } catch (e) { return ""; } };
  function hue(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }

  function prep(r) {
    r.host = hostOf(r.url);
    r._n = norm(r.name);
    r._words = r._n.split(/[^a-z0-9]+/).filter(Boolean);
    r._tags = r.tags.map(norm);
    r._desc = norm(r.desc);
    r._host = norm(r.host);
    r._cat = norm(CAT[r.cat] ? CAT[r.cat].name : "");
    r._price = PRICE_WORDS[r.price] || "";
    return r;
  }

  let saved = new Set(store.get("saved", []));
  let custom = store.get("custom", []).filter((r) => r && r.name && r.url && CAT[r.cat]);
  let recent = store.get("recent", []);
  const BASE = DATA.resources.map(prep);
  let ALL = [];
  let BY_ID = {};
  function rebuild() {
    ALL = BASE.concat(custom.map((r) => prep(Object.assign({}, r, { custom: true, tags: r.tags || [], featured: false, order: 999 }))));
    BY_ID = Object.fromEntries(ALL.map((r) => [r.id, r]));
    saved = new Set([...saved].filter((id) => BY_ID[id]));
  }
  rebuild();
  const byName = (n) => ALL.find((r) => r._n === norm(n));

  /* ---------- Search ---------- */
  function subseq(t, s) { let i = 0; for (const ch of s) { if (ch === t[i]) i++; if (i === t.length) return true; } return false; }
  function tokenScore(r, t) {
    let s = 0;
    if (r._n === t) s = 120;
    else if (r._n.startsWith(t)) s = 90;
    else if (r._words.some((w) => w.startsWith(t))) s = 70;
    else if (r._n.includes(t)) s = 55;
    if (r._tags.includes(t)) s = Math.max(s, 50);
    else if (r._tags.some((g) => g.startsWith(t))) s = Math.max(s, 36);
    if (r._host.includes(t)) s = Math.max(s, 40);
    if (r._cat.split(/[^a-z0-9]+/).some((w) => w.startsWith(t))) s = Math.max(s, 30);
    if (r._price.split(" ").includes(t)) s = Math.max(s, 22);
    if (!s && r._desc.includes(t)) s = 16;
    if (!s && t.length >= 4 && subseq(t, r._n)) s = 8;
    return s;
  }
  function score(r, tokens) {
    let total = 0;
    for (const t of tokens) {
      let s = tokenScore(r, t);
      if (!s && t.length > 3 && t.endsWith("s")) s = tokenScore(r, t.slice(0, -1));
      if (!s) return 0;
      total += s;
    }
    return total + (r.featured ? 4 : 0) + (saved.has(r.id) ? 2 : 0);
  }
  const tokenize = (q) => norm(q).split(/[\s,]+/).filter(Boolean);
  function search(list, q) {
    const tokens = tokenize(q);
    if (!tokens.length) return list;
    return list.map((r) => [r, score(r, tokens)]).filter((x) => x[1] > 0)
      .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name)).map((x) => x[0]);
  }
  function sortList(list) {
    const l = list.slice();
    if (S.sort === "az") return l.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return l.sort((a, b) => (b.featured - a.featured) || (a.order - b.order) || a.name.localeCompare(b.name));
  }

  /* ---------- State ---------- */
  const params = new URLSearchParams(location.search);
  const S = {
    q: params.get("q") || "",
    cat: (params.get("cat") && (CAT[params.get("cat")] || params.get("cat") === "saved")) ? params.get("cat") : "all",
    price: PRICE[params.get("price")] ? params.get("price") : "all",
    sort: store.get("sort", "featured") === "az" ? "az" : "featured",
    view: store.get("view", "grid") === "list" ? "list" : "grid",
  };
  function syncURL() {
    const p = new URLSearchParams();
    if (S.q) p.set("q", S.q);
    if (S.cat !== "all") p.set("cat", S.cat);
    if (S.price !== "all") p.set("price", S.price);
    const qs = p.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) {}
  }

  function currentList() {
    let list = ALL;
    if (S.cat === "saved") list = list.filter((r) => saved.has(r.id));
    else if (S.cat !== "all") list = list.filter((r) => r.cat === S.cat);
    if (S.price !== "all") list = list.filter((r) => r.price === S.price);
    return S.q.trim() ? search(list, S.q) : sortList(list);
  }

  /* ---------- Markup helpers ---------- */
  function fav(r) {
    const d = domainOf(r.url);
    return '<span class="fav" style="--h:' + hue(r.name) + '">' +
      '<span class="mono">' + esc(r.name.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase() || "•") + "</span>" +
      (d ? '<img class="fav-img" src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=64" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">' : "") +
      "</span>";
  }
  const priceTag = (r) => '<span class="price" data-p="' + r.price + '">' + PRICE[r.price].label + "</span>";

  function cardHTML(r, i) {
    const on = saved.has(r.id);
    return '<article class="card" data-id="' + esc(r.id) + '" style="--d:' + Math.min(i, 24) + '">' +
      '<a class="card-link" href="' + esc(r.url) + '" target="_blank" rel="noopener" aria-label="' + esc(r.name) + ', opens in a new tab"></a>' +
      '<div class="card-top">' + fav(r) + '<div class="card-name"><h4>' + esc(r.name) + '</h4><span class="host">' + esc(r.host) + "</span></div></div>" +
      '<p class="card-desc">' + esc(r.desc || "") + "</p>" +
      '<div class="card-foot">' + priceTag(r) + (r.custom ? '<span class="yours">Yours</span>' : "") +
      '<div class="tags">' + r.tags.slice(0, 2).map((t) => '<span class="tag">' + esc(t) + "</span>").join("") + "</div></div>" +
      '<div class="card-actions">' +
      '<button type="button" class="act act-info" data-act="info" aria-label="Details for ' + esc(r.name) + '" title="Details">' + icon("info", 17) + "</button>" +
      '<button type="button" class="act act-star" data-act="star" aria-pressed="' + on + '" aria-label="Save ' + esc(r.name) + '" title="Save">' + icon("star", 17) + "</button>" +
      "</div>" +
      '<span class="go" aria-hidden="true">' + icon("arrowUpRight", 16) + "</span>" +
      "</article>";
  }
  function rowHTML(r, i) {
    const on = saved.has(r.id);
    return '<div class="row card-row" data-id="' + esc(r.id) + '" style="--d:' + Math.min(i, 30) + '">' +
      '<a class="card-link" href="' + esc(r.url) + '" target="_blank" rel="noopener" aria-label="' + esc(r.name) + ', opens in a new tab"></a>' +
      fav(r) +
      '<div class="card-name"><h4>' + esc(r.name) + '</h4><span class="host">' + esc(r.host) + "</span></div>" +
      '<p class="card-desc">' + esc(r.desc || "") + "</p>" +
      priceTag(r) +
      '<div class="card-actions">' +
      '<button type="button" class="act act-info" data-act="info" aria-label="Details for ' + esc(r.name) + '">' + icon("info", 16) + "</button>" +
      '<button type="button" class="act act-star" data-act="star" aria-pressed="' + on + '" aria-label="Save ' + esc(r.name) + '">' + icon("star", 16) + "</button>" +
      "</div></div>";
  }
  const itemsHTML = (list, offset) => S.view === "list"
    ? list.map((r, i) => rowHTML(r, i + (offset || 0))).join("")
    : list.map((r, i) => cardHTML(r, i + (offset || 0))).join("");

  /* Favicon loading: fall back to a monogram when the icon is missing or tiny. */
  document.addEventListener("error", (e) => { if (e.target.classList && e.target.classList.contains("fav-img")) e.target.remove(); }, true);
  document.addEventListener("load", (e) => {
    const t = e.target;
    if (t.classList && t.classList.contains("fav-img") && t.naturalWidth < 17) t.remove();
  }, true);

  /* ---------- Rendering ---------- */
  const results = $("#results");
  const resultsTitle = $("#resultsTitle");
  const resultsSub = $("#resultsSub");
  let lastCols = 0;
  function gridCols() { const w = results.clientWidth || 1000; return Math.max(1, Math.floor((w + 12) / (264 + 12))); }

  function render() {
    const q = S.q.trim();
    const list = currentList();
    const n = list.length;
    const priceNote = S.price !== "all" ? " · " + PRICE[S.price].label.toLowerCase() + " only" : "";

    if (q) {
      resultsTitle.textContent = "Results for “" + q + "”";
      resultsSub.innerHTML = "<b>" + n + "</b> " + (n === 1 ? "match" : "matches") + (S.cat === "all" ? "" : S.cat === "saved" ? " in Saved" : " in " + esc(CAT[S.cat].name)) + priceNote;
    } else if (S.cat === "all") {
      resultsTitle.textContent = "Everything";
      resultsSub.innerHTML = "<b>" + n + "</b> tools across " + CATS.length + " categories" + priceNote + ". Type to search, or pick a category.";
    } else if (S.cat === "saved") {
      resultsTitle.textContent = "Saved";
      resultsSub.innerHTML = "<b>" + n + "</b> saved in this browser" + priceNote + ". Export them from the footer to keep a copy.";
    } else {
      resultsTitle.textContent = CAT[S.cat].name;
      resultsSub.innerHTML = esc(CAT[S.cat].blurb) + " <b>" + n + "</b> " + (n === 1 ? "tool" : "tools") + priceNote + ".";
    }

    if (!n) { results.innerHTML = emptyHTML(q); return; }

    if (!q && S.cat === "all") {
      const cols = (lastCols = gridCols());
      const per = S.view === "list" ? Infinity : Math.max(4, cols * 2);
      let html = S.view === "list" ? '<div class="list">' : "";
      let k = 0;
      for (const c of CATS) {
        const items = list.filter((r) => r.cat === c.id);
        if (!items.length) continue;
        if (S.view === "list") {
          html += '<div class="group-label">' + esc(c.name) + " · " + items.length + "</div>" + itemsHTML(items, k);
        } else {
          const shown = items.slice(0, per);
          html += '<section class="group" aria-labelledby="g-' + c.id + '">' +
            '<div class="group-head"><span class="group-icon">' + icon(c.icon, 17) + "</span>" +
            '<div><h3 id="g-' + c.id + '">' + esc(c.name) + "</h3><p>" + esc(c.blurb) + "</p></div>" +
            (items.length > shown.length ? '<button type="button" class="see-all" data-cat="' + c.id + '">See all ' + items.length + icon("chevronRight", 15) + "</button>" : "") +
            '</div><div class="grid">' + itemsHTML(shown, k) + "</div></section>";
        }
        k = Math.min(k + 4, 12);
      }
      results.innerHTML = html + (S.view === "list" ? "</div>" : "");
    } else {
      results.innerHTML = S.view === "list" ? '<div class="list">' + itemsHTML(list) + "</div>" : '<div class="grid">' + itemsHTML(list) + "</div>";
    }
  }

  function emptyHTML(q) {
    if (S.cat === "saved" && !q) {
      return '<div class="empty"><h3>Nothing saved yet</h3><p>Press the star on any tool to keep it here.</p>' +
        '<div class="row-btns"><button type="button" class="btn" data-go-cat="all">Browse everything</button></div></div>';
    }
    let btns = "";
    if (S.cat !== "all") btns += '<button type="button" class="btn" data-go-cat="all">Search every category</button>';
    if (S.price !== "all") btns += '<button type="button" class="btn" data-go-price="all">Any price</button>';
    btns += '<button type="button" class="btn" data-action="clear">Clear search</button>';
    btns += '<button type="button" class="btn btn-primary" data-action="add">Add it yourself</button>';
    return '<div class="empty"><h3>Nothing matches “' + esc(q) + '”</h3><p>Try a broader word, a tag like “svg” or “react”, or a different filter.</p><div class="row-btns">' + btns + "</div></div>";
  }

  /* ---------- Categories bar ---------- */
  const catsEl = $("#cats");
  const indicator = $("#catsIndicator");
  function renderCats() {
    const counts = {};
    ALL.forEach((r) => (counts[r.cat] = (counts[r.cat] || 0) + 1));
    const btn = (id, name, ic, n) => '<button type="button" class="cat" role="tab" data-cat="' + id + '" aria-selected="' + (S.cat === id) + '">' +
      icon(ic, 15) + "<span>" + esc(name) + '</span><span class="n">' + n + "</span></button>";
    let html = btn("all", "All", "compass", ALL.length);
    CATS.forEach((c) => (html += btn(c.id, c.name, c.icon, counts[c.id] || 0)));
    html += btn("saved", "Saved", "star", saved.size);
    $$(".cat", catsEl).forEach((b) => b.remove());
    catsEl.insertAdjacentHTML("beforeend", html);
    placeIndicator(false);
  }
  function placeIndicator(animate) {
    const b = $('.cat[data-cat="' + S.cat + '"]', catsEl);
    if (!b) return;
    if (!animate) indicator.style.transition = "none";
    indicator.style.width = b.offsetWidth + "px";
    indicator.style.transform = "translateX(" + b.offsetLeft + "px)";
    if (!animate) { indicator.offsetWidth; indicator.style.transition = ""; }
    const left = b.offsetLeft - catsEl.clientWidth / 2 + b.offsetWidth / 2;
    catsEl.scrollTo({ left, behavior: animate && !reduceMotion.matches ? "smooth" : "auto" });
  }
  function updateSavedCounts() {
    const n = saved.size;
    const nav = $("#savedCount");
    nav.textContent = n;
    nav.classList.remove("bump"); void nav.offsetWidth; nav.classList.add("bump");
    setTimeout(() => nav.classList.remove("bump"), 350);
    const c = $('.cat[data-cat="saved"] .n', catsEl);
    if (c) c.textContent = n;
    if (S.cat === "saved") placeIndicator(false);
  }

  function setCat(id, opts) {
    if (id === S.cat && !(opts && opts.force)) return;
    S.cat = id;
    $$(".cat", catsEl).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === id)));
    placeIndicator(true);
    render(); syncURL();
    if (!opts || opts.scroll !== false) scrollToResults();
  }
  function setPrice(p) {
    S.price = p;
    $$("#priceSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.price === p)));
    render(); syncURL();
  }
  function setView(v) {
    S.view = v; store.set("view", v);
    $$("#viewSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === v)));
    render();
  }
  function setQuery(q, opts) {
    S.q = q;
    const fi = $("#filterInput");
    if (fi.value !== q) fi.value = q;
    render(); syncURL();
    if (opts && opts.scroll) scrollToResults();
  }
  function scrollToResults() {
    const head = $("#browse");
    const top = head.getBoundingClientRect().top + window.scrollY - (toolbar.offsetHeight + navEl.offsetHeight) + 8;
    if (window.scrollY > top + 4 || opts_forceScroll) window.scrollTo({ top, behavior: reduceMotion.matches ? "auto" : "smooth" });
    opts_forceScroll = false;
  }
  let opts_forceScroll = false;

  /* ---------- Saved ---------- */
  function toggleSave(id, silent) {
    const r = BY_ID[id];
    if (!r) return;
    const on = !saved.has(id);
    if (on) saved.add(id); else saved.delete(id);
    store.set("saved", [...saved]);
    $$('[data-id="' + CSS.escape(id) + '"] .act-star, .sheet [data-act="star"][data-id="' + CSS.escape(id) + '"]').forEach((b) => {
      b.setAttribute("aria-pressed", String(on));
      if (on) { b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    });
    const sheetBtn = $('.sheet [data-act="star"]');
    if (sheetBtn && sheetBtn.dataset.id === id) sheetBtn.querySelector(".lbl").textContent = on ? "Saved" : "Save";
    updateSavedCounts();
    if (S.cat === "saved") render();
    if (!silent) toast(on ? "Saved " + r.name : "Removed " + r.name, { label: "Undo", run: () => toggleSave(id, true) });
  }

  function remember(id) {
    recent = [id].concat(recent.filter((x) => x !== id)).slice(0, 8);
    store.set("recent", recent);
  }
  function openSite(r) {
    remember(r.id);
    window.open(r.url, "_blank", "noopener");
  }

  /* ---------- Overlays ---------- */
  const stack = [];
  function openOverlay(el, focusEl) {
    clearTimeout(el._t);
    el.classList.remove("closing");
    el.hidden = false;
    if (!stack.some((s) => s.el === el)) stack.push({ el, prev: document.activeElement });
    document.documentElement.style.overflow = "hidden";
    const f = focusEl || $("input, button, a[href]", el);
    if (f) requestAnimationFrame(() => f.focus({ preventScroll: true }));
  }
  function closeOverlay(el) {
    const i = stack.findIndex((s) => s.el === el);
    if (i < 0) return;
    const prev = stack.splice(i, 1)[0].prev;
    el.classList.add("closing");
    el._t = setTimeout(() => { el.hidden = true; el.classList.remove("closing"); }, reduceMotion.matches ? 0 : 230);
    if (!stack.length) document.documentElement.style.overflow = "";
    if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
  }
  const topOverlay = () => (stack.length ? stack[stack.length - 1].el : null);
  $$(".overlay").forEach((o) => {
    o.addEventListener("mousedown", (e) => { if (e.target === o) o._down = true; });
    o.addEventListener("click", (e) => { if (e.target === o && o._down) closeOverlay(o); o._down = false; });
    o.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) closeOverlay(o); });
    o.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const f = $$('a[href], button:not([disabled]), input:not([type="hidden"]):not([hidden]), select, [tabindex]:not([tabindex="-1"])', o).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  });

  /* ---------- Detail sheet ---------- */
  const sheetOverlay = $("#sheetOverlay");
  const sheet = $("#sheet");
  function similarTo(r) {
    return ALL.filter((x) => x.id !== r.id && x.cat === r.cat)
      .map((x) => [x, x.tags.filter((t) => r.tags.includes(t)).length * 3 + (x.featured ? 1 : 0)])
      .sort((a, b) => b[1] - a[1] || a[0].order - b[0].order).slice(0, 4).map((x) => x[0]);
  }
  function openSheet(id) {
    const r = BY_ID[id];
    if (!r) return;
    const on = saved.has(r.id);
    const c = CAT[r.cat];
    const sim = similarTo(r);
    let suggest = "";
    const submit = CFG.submitUrl || (CFG.repo ? CFG.repo.replace(/\/$/, "") + "/issues/new" : "");
    if (r.custom && submit) {
      const body = "Name: " + r.name + "\nURL: " + r.url + "\nCategory: " + c.name + "\nPricing: " + PRICE[r.price].label + "\nDescription: " + (r.desc || "") + "\nTags: " + r.tags.join(", ");
      suggest = '<a class="btn" href="' + esc(submit + "?title=" + encodeURIComponent("Add " + r.name) + "&body=" + encodeURIComponent(body)) + '" target="_blank" rel="noopener">Suggest for everyone</a>';
    }
    sheet.innerHTML =
      '<button type="button" class="icon-btn sheet-close" data-close aria-label="Close">' + icon("x", 18) + "</button>" +
      '<div class="sh-head">' + fav(r) + '<div><h2 id="sheetTitle">' + esc(r.name) + '</h2><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.host) + "</a></div></div>" +
      (r.desc ? '<p class="sh-desc">' + esc(r.desc) + "</p>" : "") +
      '<div class="sh-actions">' +
      '<a class="btn btn-accent" data-open="' + esc(r.id) + '" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open ' + esc(r.name) + icon("arrowUpRight", 16) + "</a>" +
      '<button type="button" class="btn" data-act="star" data-id="' + esc(r.id) + '" aria-pressed="' + on + '">' + icon("star", 16) + '<span class="lbl">' + (on ? "Saved" : "Save") + "</span></button>" +
      '<button type="button" class="btn" data-act="copy" aria-label="Copy link" title="Copy link">' + icon("copy", 16) + "</button>" +
      "</div>" +
      '<dl class="sh-meta">' +
      "<dt>Category</dt><dd><button type=\"button\" class=\"linkish\" data-go-cat=\"" + c.id + "\">" + esc(c.name) + "</button></dd>" +
      "<dt>Pricing</dt><dd>" + priceTag(r) + '<span class="muted">' + PRICE[r.price].note + "</span></dd>" +
      (r.custom ? "<dt>Source</dt><dd>Added by you, stored in this browser</dd>" : "") +
      "</dl>" +
      (r.tags.length ? '<div><p class="sh-h">Tags</p><div class="sh-tags">' + r.tags.map((t) => '<button type="button" data-tag="' + esc(t) + '">' + esc(t) + "</button>").join("") + "</div></div>" : "") +
      (sim.length ? '<div><p class="sh-h">More in ' + esc(c.name) + '</p><div class="sh-similar">' + sim.map((x) => '<button type="button" data-sheet="' + esc(x.id) + '">' + fav(x) + "<div><strong>" + esc(x.name) + "</strong><span>" + esc(x.desc) + "</span></div></button>").join("") + "</div></div>" : "") +
      (r.custom || suggest ? '<div class="sh-actions">' + suggest + (r.custom ? '<button type="button" class="btn btn-danger" data-act="delete" data-id="' + esc(r.id) + '">' + icon("trash", 16) + '<span class="lbl">Delete</span></button>' : "") + "</div>" : "");
    sheet.scrollTop = 0;
    openOverlay(sheetOverlay, $(".btn-accent", sheet));
  }
  sheet.addEventListener("click", (e) => {
    const t = e.target;
    const open = t.closest("[data-open]");
    if (open) { remember(open.dataset.open); return; }
    const star = t.closest('[data-act="star"]');
    if (star) { toggleSave(star.dataset.id); return; }
    if (t.closest('[data-act="copy"]')) {
      const r = BY_ID[$('[data-act="star"]', sheet).dataset.id];
      copy(r.url, "Link copied");
      return;
    }
    const del = t.closest('[data-act="delete"]');
    if (del) {
      if (!del.dataset.armed) {
        del.dataset.armed = "1";
        del.querySelector(".lbl").textContent = "Press again to delete";
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.querySelector(".lbl").textContent = "Delete"; } }, 3000);
        return;
      }
      const id = del.dataset.id;
      const r = BY_ID[id];
      custom = custom.filter((x) => x.id !== id);
      store.set("custom", custom);
      saved.delete(id); store.set("saved", [...saved]);
      rebuild(); renderCats(); render(); updateSavedCounts();
      closeOverlay(sheetOverlay);
      toast("Deleted " + (r ? r.name : "resource"));
      return;
    }
    const tag = t.closest("[data-tag]");
    if (tag) { closeOverlay(sheetOverlay); setCat("all", { scroll: false }); opts_forceScroll = true; setQuery(tag.dataset.tag, { scroll: true }); return; }
    const gc = t.closest("[data-go-cat]");
    if (gc) { closeOverlay(sheetOverlay); opts_forceScroll = true; if (S.q) setQuery(""); setCat(gc.dataset.goCat, { force: true }); return; }
    const other = t.closest("[data-sheet]");
    if (other) { openSheet(other.dataset.sheet); }
  });

  /* ---------- Toasts & clipboard ---------- */
  function toast(msg, action) {
    const box = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = icon("check", 16) + "<span>" + esc(msg) + "</span>" + (action ? '<button type="button">' + esc(action.label) + "</button>" : "");
    if (action) el.querySelector("button").addEventListener("click", () => { action.run(); dismiss(); });
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    let tm = setTimeout(dismiss, 3400);
    el.addEventListener("mouseenter", () => clearTimeout(tm));
    el.addEventListener("mouseleave", () => (tm = setTimeout(dismiss, 1600)));
    function dismiss() { clearTimeout(tm); el.classList.add("out"); setTimeout(() => el.remove(), 260); }
  }
  function copy(text, msg) {
    const done = () => toast(msg || "Copied");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy this link: " + text); }
      ta.remove();
    }
  }

  /* ---------- Command palette ---------- */
  const palOverlay = $("#paletteOverlay");
  const palInput = $("#paletteInput");
  const palList = $("#paletteList");
  let palItems = [];
  let palIndex = 0;

  const COMMANDS = [
    { id: "saved", label: "Show saved", icon: "star", keys: "s", run: () => { opts_forceScroll = true; setCat("saved", { force: true }); } },
    { id: "add", label: "Add a resource", icon: "plus", keys: "n", run: () => openAdd() },
    { id: "random", label: "Surprise me", icon: "shuffle", keys: "r", run: () => randomPick() },
    { id: "theme", label: "Switch light and dark", icon: "moon", keys: "t", run: () => toggleTheme() },
    { id: "view", label: "Switch grid and list", icon: "list", keys: "g", run: () => setView(S.view === "grid" ? "list" : "grid") },
    { id: "export", label: "Export saved and added", icon: "download", run: () => exportData() },
    { id: "keys", label: "Keyboard shortcuts", icon: "keyboard", keys: "?", run: () => openOverlay($("#keysOverlay")) },
  ];

  function highlight(name, q) {
    const tokens = tokenize(q);
    const n = norm(name);
    for (const t of tokens) {
      const i = n.indexOf(t);
      if (i >= 0) return esc(name.slice(0, i)) + "<mark>" + esc(name.slice(i, i + t.length)) + "</mark>" + esc(name.slice(i + t.length));
    }
    return esc(name);
  }

  function renderPalette() {
    const q = palInput.value.trim();
    palItems = [];
    let html = "";
    const section = (label) => (html += '<li class="pl-label" role="presentation">' + label + "</li>");
    const add = (item, inner) => {
      const i = palItems.push(item) - 1;
      html += '<li class="opt" role="option" id="opt-' + i + '" data-i="' + i + '" aria-selected="false">' + inner + "</li>";
    };
    const resRow = (r) => add({ type: "res", r }, fav(r) + '<div class="o-main"><span class="o-name">' + highlight(r.name, q) + '</span><span class="o-desc">' + esc(r.desc) + '</span></div><span class="o-meta">' + esc(CAT[r.cat].name) + '</span><span class="o-enter">' + icon("enter", 15) + "</span>");
    const catRow = (c) => add({ type: "cat", c }, '<span class="glyph">' + icon(c.icon, 16) + '</span><div class="o-main"><span class="o-name">' + highlight(c.name, q) + '</span><span class="o-desc">' + esc(c.blurb) + '</span></div><span class="o-enter">' + icon("enter", 15) + "</span>");
    const cmdRow = (c) => add({ type: "cmd", c }, '<span class="glyph">' + icon(c.icon, 16) + '</span><div class="o-main"><span class="o-name">' + highlight(c.label, q) + "</span></div>" + (c.keys ? "<kbd>" + c.keys.toUpperCase() + "</kbd>" : "") + '<span class="o-enter">' + icon("enter", 15) + "</span>");

    if (!q) {
      const rec = recent.map((id) => BY_ID[id]).filter(Boolean).slice(0, 5);
      if (rec.length) { section("Recently opened"); rec.forEach(resRow); }
      section("Commands"); COMMANDS.forEach(cmdRow);
      section("Categories"); CATS.forEach(catRow);
    } else {
      const res = search(ALL, q).slice(0, 8);
      const cats = CATS.filter((c) => tokenize(q).every((t) => norm(c.name + " " + c.id).includes(t)));
      const cmds = COMMANDS.filter((c) => tokenize(q).every((t) => norm(c.label).includes(t)));
      if (res.length) { section("Tools"); res.forEach(resRow); }
      if (cats.length) { section("Categories"); cats.forEach(catRow); }
      if (cmds.length) { section("Commands"); cmds.forEach(cmdRow); }
      if (!palItems.length) html = '<li class="pl-empty">No tools, categories or commands match “' + esc(q) + "”.</li>";
    }
    palList.innerHTML = html;
    palIndex = 0;
    markPal();
  }
  function markPal(scroll) {
    $$(".opt", palList).forEach((o) => o.setAttribute("aria-selected", String(+o.dataset.i === palIndex)));
    const cur = $("#opt-" + palIndex, palList);
    palInput.setAttribute("aria-activedescendant", cur ? cur.id : "");
    if (cur && scroll) cur.scrollIntoView({ block: "nearest" });
  }
  function runPal(i, mode) {
    const it = palItems[i];
    if (!it) return;
    closeOverlay(palOverlay);
    if (it.type === "res") {
      if (mode === "details") openSheet(it.r.id);
      else openSite(it.r);
    } else if (it.type === "cat") { opts_forceScroll = true; if (S.q) setQuery(""); setCat(it.c.id, { force: true }); }
    else it.c.run();
  }
  function openPalette() {
    palInput.value = "";
    renderPalette();
    openOverlay(palOverlay, palInput);
  }
  palInput.addEventListener("input", renderPalette);
  palInput.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "ArrowDown") { e.preventDefault(); palIndex = (palIndex + 1) % Math.max(1, palItems.length); markPal(true); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palIndex = (palIndex - 1 + palItems.length) % Math.max(1, palItems.length); markPal(true); }
    else if (e.key === "Enter") { e.preventDefault(); runPal(palIndex, mod ? "details" : "open"); }
    else if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      const it = palItems[palIndex];
      if (it && it.type === "res") { toggleSave(it.r.id); renderPalette(); }
    }
  });
  palList.addEventListener("mousemove", (e) => {
    const o = e.target.closest(".opt");
    if (o && +o.dataset.i !== palIndex) { palIndex = +o.dataset.i; markPal(); }
  });
  palList.addEventListener("click", (e) => {
    const o = e.target.closest(".opt");
    if (o) runPal(+o.dataset.i, e.metaKey || e.ctrlKey ? "details" : "open");
  });

  /* ---------- Hero composer ---------- */
  const composer = $("#composer");
  const cInput = $("#composerInput");
  const cSend = $("#composerSend");
  const suggestEl = $("#suggest");
  let sugItems = [];
  let sugIndex = -1;

  const PHRASES = ["icons for a dashboard", "free fonts with character", "animated backgrounds", "shadcn components", "device mockups", "color palettes", "open-source analytics", "smooth scrolling"];
  let typer = { on: false, timer: 0 };
  function startTyper() {
    if (reduceMotion.matches) { cInput.placeholder = "Try “" + PHRASES[0] + "”"; return; }
    if (typer.on) return;
    typer.on = true;
    let p = 0, i = 0, dir = 1;
    const step = () => {
      if (!typer.on) return;
      const phrase = PHRASES[p];
      i += dir;
      cInput.placeholder = "Try “" + phrase.slice(0, i) + (dir > 0 && i >= phrase.length ? "”" : "");
      let wait = dir > 0 ? 42 + Math.random() * 40 : 18;
      if (dir > 0 && i >= phrase.length) { dir = -1; wait = 1900; }
      else if (dir < 0 && i <= 0) { dir = 1; p = (p + 1) % PHRASES.length; wait = 380; }
      typer.timer = setTimeout(step, wait);
    };
    typer.timer = setTimeout(step, 900);
  }
  function stopTyper(text) { typer.on = false; clearTimeout(typer.timer); cInput.placeholder = text || "Search tools, tags or categories"; }

  function renderSuggest() {
    const q = cInput.value.trim();
    cSend.disabled = !q;
    if (!q) { closeSuggest(); return; }
    const all = search(ALL, q);
    sugItems = all.slice(0, 5);
    let html = sugItems.map((r, i) => '<li class="opt" role="option" id="sug-' + i + '" data-i="' + i + '" aria-selected="false">' + fav(r) +
      '<div class="o-main"><span class="o-name">' + highlight(r.name, q) + '</span><span class="o-desc">' + esc(r.desc) + '</span></div><span class="o-meta">' + PRICE[r.price].label + "</span></li>").join("");
    html += '<li class="opt" role="option" id="sug-' + sugItems.length + '" data-i="' + sugItems.length + '" aria-selected="false"><span class="glyph">' + icon("search", 16) + '</span><div class="o-main"><span class="o-name">' +
      (all.length ? "See all " + all.length + " results" : "No direct matches. Search anyway") + '</span></div><span class="o-enter">' + icon("enter", 15) + "</span></li>";
    suggestEl.innerHTML = html;
    suggestEl.hidden = false;
    cInput.setAttribute("aria-expanded", "true");
    sugIndex = -1;
  }
  function closeSuggest() { suggestEl.hidden = true; cInput.setAttribute("aria-expanded", "false"); sugIndex = -1; }
  function markSug() {
    $$(".opt", suggestEl).forEach((o) => o.setAttribute("aria-selected", String(+o.dataset.i === sugIndex)));
    cInput.setAttribute("aria-activedescendant", sugIndex >= 0 ? "sug-" + sugIndex : "");
  }
  function submitComposer() {
    const q = cInput.value.trim();
    if (!q) return;
    closeSuggest();
    S.cat = "all";
    $$(".cat", catsEl).forEach((b) => b.setAttribute("aria-selected", String(b.dataset.cat === "all")));
    placeIndicator(true);
    opts_forceScroll = true;
    setQuery(q, { scroll: true });
    cInput.blur();
  }
  cInput.addEventListener("focus", () => { stopTyper(); if (cInput.value) renderSuggest(); });
  cInput.addEventListener("blur", () => { if (!cInput.value) startTyper(); setTimeout(() => { if (!composer.contains(document.activeElement)) closeSuggest(); }, 120); });
  cInput.addEventListener("input", renderSuggest);
  cInput.addEventListener("keydown", (e) => {
    if (suggestEl.hidden) return;
    const n = sugItems.length + 1;
    if (e.key === "ArrowDown") { e.preventDefault(); sugIndex = (sugIndex + 1) % n; markSug(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sugIndex = sugIndex <= 0 ? n - 1 : sugIndex - 1; markSug(); }
    else if (e.key === "Escape") { e.stopPropagation(); closeSuggest(); }
    else if (e.key === "Enter" && sugIndex >= 0 && sugIndex < sugItems.length) {
      e.preventDefault();
      const r = sugItems[sugIndex];
      if (e.metaKey || e.ctrlKey) openSheet(r.id); else openSite(r);
    }
  });
  suggestEl.addEventListener("mousedown", (e) => e.preventDefault());
  suggestEl.addEventListener("click", (e) => {
    const o = e.target.closest(".opt");
    if (!o) return;
    const i = +o.dataset.i;
    if (i < sugItems.length) openSheet(sugItems[i].id); else submitComposer();
  });
  composer.addEventListener("submit", (e) => { e.preventDefault(); submitComposer(); });
  document.addEventListener("click", (e) => { if (!composer.contains(e.target)) closeSuggest(); });

  const QUICK = ["shadcn", "icons", "shaders", "fonts", "mockups", "open source"];
  $("#quick").innerHTML = QUICK.map((q) => '<button type="button" data-q="' + esc(q) + '">' + esc(q) + "</button>").join("");
  $("#quick").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (!b) return;
    cInput.value = b.dataset.q; cSend.disabled = false;
    submitComposer();
  });

  /* ---------- Sky & theme ---------- */
  const hero = $("#hero");
  const navEl = $("#nav");
  const skySwitch = $("#skySwitch");
  const resolvedTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const defaultSky = () => (resolvedTheme() === "dark" ? "night" : "day");
  const P = window.LoupeSky.presets;
  skySwitch.innerHTML = Object.keys(P).map((k) => '<button type="button" role="radio" data-sky="' + k + '" aria-checked="false"><span class="dot" style="background:linear-gradient(160deg,' + P[k].top + "," + P[k].hor + ')"></span>' + P[k].label + "</button>").join("");
  const sky = window.LoupeSky.create($("#sky"), {
    preset: store.get("sky", null) && P[store.get("sky")] ? store.get("sky") : defaultSky(),
    onTone(tone, name) {
      hero.dataset.tone = tone; hero.dataset.sky = name; navEl.dataset.tone = tone;
      $$("button", skySwitch).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.sky === name)));
    },
  });
  skySwitch.addEventListener("click", (e) => {
    const b = e.target.closest("[data-sky]");
    if (!b) return;
    sky.set(b.dataset.sky);
    store.set("sky", b.dataset.sky);
  });
  skySwitch.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const keys = Object.keys(P);
    const i = keys.indexOf(sky.preset) + (e.key === "ArrowRight" ? 1 : -1);
    const k = keys[(i + keys.length) % keys.length];
    sky.set(k); store.set("sky", k);
    $('[data-sky="' + k + '"]', skySwitch).focus();
  });

  const themeBtn = $("#themeBtn");
  const paintThemeBtn = () => { themeBtn.innerHTML = icon(resolvedTheme() === "dark" ? "sun" : "moon", 18); };
  function toggleTheme(ev) {
    const next = resolvedTheme() === "dark" ? "light" : "dark";
    const apply = () => {
      document.documentElement.dataset.theme = next;
      store.raw("theme", next);
      store.del("sky");
      sky.set(next === "dark" ? "night" : "day");
      paintThemeBtn();
    };
    if (!document.startViewTransition || reduceMotion.matches) { apply(); return; }
    const x = ev && ev.clientX ? ev.clientX : window.innerWidth - 60;
    const y = ev && ev.clientY ? ev.clientY : 30;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = document.startViewTransition(apply);
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + r + "px at " + x + "px " + y + "px)"] },
        { duration: 650, easing: "cubic-bezier(0.32, 0.72, 0, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(() => {});
  }
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if (document.documentElement.dataset.theme) return;
    paintThemeBtn();
    if (!store.get("sky", null)) sky.set(defaultSky());
  });

  /* ---------- Add / import / export ---------- */
  const addOverlay = $("#addOverlay");
  const addForm = $("#addForm");
  $("#fCat").innerHTML = CATS.map((c) => '<option value="' + c.id + '">' + esc(c.name) + "</option>").join("");
  function openAdd() {
    addForm.reset();
    $("#addError").hidden = true;
    $$("[aria-invalid]", addForm).forEach((x) => x.removeAttribute("aria-invalid"));
    if (CAT[S.cat]) $("#fCat").value = S.cat;
    openOverlay(addOverlay, $("#fName"));
  }
  addForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = $("#addError");
    const name = $("#fName").value.trim();
    let url = $("#fUrl").value.trim();
    $$("[aria-invalid]", addForm).forEach((x) => x.removeAttribute("aria-invalid"));
    const fail = (msg, el) => { err.textContent = msg; err.hidden = false; el.setAttribute("aria-invalid", "true"); el.focus(); };
    if (!name) return fail("Give it a name so you can find it again.", $("#fName"));
    if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
    let parsed;
    try { parsed = new URL(url); } catch (x) { parsed = null; }
    if (!parsed || !parsed.hostname.includes(".")) return fail("That link doesn't look like a web address. Try something like https://example.com.", $("#fUrl"));
    const dupe = ALL.find((r) => r.host === hostOf(parsed.href));
    if (dupe) return fail(dupe.name + " is already in the index at that address.", $("#fUrl"));
    const r = {
      id: "custom:" + norm(name).replace(/[^a-z0-9]+/g, "-") + "-" + Date.now().toString(36),
      name, url: parsed.href, cat: $("#fCat").value, price: $("#fPrice").value,
      desc: $("#fDesc").value.trim(),
      tags: $("#fTags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 6),
      added: new Date().toISOString().slice(0, 10),
    };
    custom.push(r);
    store.set("custom", custom);
    rebuild(); renderCats(); render();
    closeOverlay(addOverlay);
    toast("Added " + name, { label: "View", run: () => openSheet(r.id) });
  });

  function exportData() {
    const data = { app: "loupe", version: 1, exported: new Date().toISOString(), saved: [...saved], custom };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "loupe-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Exported " + saved.size + " saved and " + custom.length + " added");
  }
  $("#importFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        const ids = new Set(custom.map((x) => x.id));
        const incoming = (d.custom || []).filter((x) => x && x.id && x.name && x.url && CAT[x.cat] && PRICE[x.price] && !ids.has(x.id));
        custom = custom.concat(incoming);
        store.set("custom", custom);
        rebuild();
        (d.saved || []).forEach((id) => { if (BY_ID[id]) saved.add(id); });
        store.set("saved", [...saved]);
        renderCats(); render(); updateSavedCounts();
        toast("Imported " + incoming.length + " added and " + (d.saved || []).length + " saved");
      } catch (x) { toast("That file isn't a Loupe export."); }
      e.target.value = "";
    };
    rd.readAsText(f);
  });

  function randomPick() {
    const pool = currentList().length ? currentList() : ALL;
    openSheet(pool[Math.floor(Math.random() * pool.length)].id);
  }

  /* ---------- Global actions ---------- */
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action]");
    if (a) {
      const act = a.dataset.action;
      if (act === "palette") openPalette();
      else if (act === "theme") toggleTheme(e);
      else if (act === "add") openAdd();
      else if (act === "random") randomPick();
      else if (act === "show-saved") { opts_forceScroll = true; if (S.q) setQuery(""); setCat("saved", { force: true }); }
      else if (act === "export") exportData();
      else if (act === "import") $("#importFile").click();
      else if (act === "shortcuts") openOverlay($("#keysOverlay"));
      else if (act === "clear") { setQuery(""); cInput.value = ""; cSend.disabled = true; }
      return;
    }
    const gc = e.target.closest("#results [data-go-cat]");
    if (gc) { setCat(gc.dataset.goCat, { force: true }); return; }
    const gp = e.target.closest("#results [data-go-price]");
    if (gp) setPrice(gp.dataset.goPrice);
  });

  results.addEventListener("click", (e) => {
    const see = e.target.closest(".see-all");
    if (see) { opts_forceScroll = true; setCat(see.dataset.cat); return; }
    const act = e.target.closest("[data-act]");
    const card = e.target.closest("[data-id]");
    if (act && card) {
      e.preventDefault();
      if (act.dataset.act === "star") toggleSave(card.dataset.id);
      else if (act.dataset.act === "info") openSheet(card.dataset.id);
      return;
    }
    const link = e.target.closest(".card-link");
    if (link && card) remember(card.dataset.id);
  });
  results.addEventListener("pointermove", (e) => {
    const c = e.target.closest(".card");
    if (!c) return;
    const b = c.getBoundingClientRect();
    c.style.setProperty("--mx", e.clientX - b.left + "px");
    c.style.setProperty("--my", e.clientY - b.top + "px");
  }, { passive: true });

  catsEl.addEventListener("click", (e) => {
    const b = e.target.closest(".cat");
    if (b) setCat(b.dataset.cat, { force: true });
  });
  catsEl.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const btns = $$(".cat", catsEl);
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    btns[(i + (e.key === "ArrowRight" ? 1 : -1) + btns.length) % btns.length].focus();
  });
  $("#priceSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-price]"); if (b) setPrice(b.dataset.price); });
  $("#viewSeg").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
  $("#sortSel").addEventListener("change", (e) => { S.sort = e.target.value; store.set("sort", S.sort); render(); });

  const filterInput = $("#filterInput");
  let fiT = 0;
  filterInput.addEventListener("input", () => { clearTimeout(fiT); fiT = setTimeout(() => setQuery(filterInput.value), 70); });
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); if (filterInput.value) setQuery(""); else filterInput.blur(); }
    if (e.key === "Enter") { e.preventDefault(); opts_forceScroll = true; scrollToResults(); }
  });
  filterInput.addEventListener("focus", () => {
    const top = toolbar.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.6) { opts_forceScroll = true; scrollToResults(); }
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (topOverlay() === palOverlay) closeOverlay(palOverlay); else openPalette();
      return;
    }
    if (e.key === "Escape") {
      const top = topOverlay();
      if (top) { e.preventDefault(); closeOverlay(top); return; }
    }
    const el = document.activeElement;
    const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
    if (typing || mod || e.altKey || topOverlay()) return;
    const k = e.key.toLowerCase();
    if (e.key === "/") { e.preventDefault(); filterInput.focus(); }
    else if (k === "s") { opts_forceScroll = true; if (S.q) setQuery(""); setCat("saved", { force: true }); }
    else if (k === "r") randomPick();
    else if (k === "t") toggleTheme();
    else if (k === "n") { e.preventDefault(); openAdd(); }
    else if (k === "g") setView(S.view === "grid" ? "list" : "grid");
    else if (e.key === "?") openOverlay($("#keysOverlay"));
  });

  /* ---------- Scroll state ---------- */
  const toolbar = $("#toolbar");
  let ticking = false;
  function onScroll() {
    ticking = false;
    navEl.classList.toggle("is-scrolled", window.scrollY > 16);
    const t = toolbar.getBoundingClientRect().top;
    toolbar.classList.toggle("is-stuck", t <= navEl.offsetHeight + 1);
  }
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  let rsT = 0;
  window.addEventListener("resize", () => {
    clearTimeout(rsT);
    rsT = setTimeout(() => { placeIndicator(false); if (!S.q && S.cat === "all" && S.view === "grid" && gridCols() !== lastCols) render(); }, 120);
  });

  /* ---------- Playbook ---------- */
  const STEPS = [
    { t: "Find inspiration", q: "Where does the look come from?", p: "Origin's sky-only hero, Apple's restraint and Raycast's command palette. Collect widely first, then narrow to three references that agree with each other.", tools: ["Pinterest", "Godly", "Mobbin", "Cosmos"] },
    { t: "Organise and label it", q: "How do you make a pile of links useful?", p: "Every entry carries a category, a price label and a few tags, so any question (“free”, “react”, “svg”) becomes a filter. Sorting a messy bookmark dump into that shape is a one-prompt job for Claude.", tools: ["Claude", "Are.na"] },
    { t: "Give the agent taste", q: "Which skills should the agent have?", p: "A design skill such as Impeccable hands a coding agent a vocabulary and a list of things never to do. This repo's <code>DESIGN.md</code> plays the same role for anyone who edits it next.", tools: ["Impeccable", "Claude"] },
    { t: "Make custom imagery", q: "Where do the visuals come from?", p: "The playbook animates a still image with an image-to-video model. Here the sky is rendered live in WebGL instead: no video file to download, no license to check, and it follows your theme. Try the sky switcher in the hero.", tools: ["Higgsfield", "Paper Shaders", "Unicorn Studio", "Unsplash"] },
    { t: "Borrow proven components", q: "Which patterns earn their place?", p: "The search composer, command palette, spotlight cards, detail sheet and toasts all follow patterns from open component libraries, rebuilt from scratch in plain JavaScript.", tools: ["21st.dev", "cmdk", "Sonner", "coss ui", "Aceternity UI"] },
    { t: "Iterate, don't one-shot", q: "How do you pick the final design?", p: "Build more than one version, check each at phone and desktop sizes, and keep what wins. The four skies are those versions, left in the product so you can compare them yourself.", tools: ["Responsively", "Figma"] },
    { t: "Write the prompt properly", q: "What goes into the prompt?", p: "A five-to-eight line aesthetic, a reference screenshot, the intent, and guardrails phrased as always and never. Ours opens with “calm, luminous, precise: a real sky above, a clean instrument below” and bans purple gradient heroes and emoji icons.", tools: ["v0", "Framer", "Realtime Colors"] },
  ];
  $("#pbSteps").innerHTML = STEPS.map((s) => {
    const chips = s.tools.map(byName).filter(Boolean).map((r) => {
      const d = domainOf(r.url);
      return '<button type="button" class="chip" data-sheet="' + esc(r.id) + '"><img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d) + '&sz=64" alt="" loading="lazy" referrerpolicy="no-referrer">' + esc(r.name) + "</button>";
    }).join("");
    return '<li class="pb-step"><h3>' + s.t + '</h3><p class="q">' + s.q + "</p><p>" + s.p + '</p><div class="pb-tools">' + chips + "</div></li>";
  }).join("");
  $("#pbSteps").addEventListener("click", (e) => { const c = e.target.closest("[data-sheet]"); if (c) openSheet(c.dataset.sheet); });
  $("#pbSteps").addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.style.visibility = "hidden"; }, true);

  /* ---------- Boot ---------- */
  $$("[data-i]").forEach((el) => (el.innerHTML = icon(el.dataset.i, 17)));
  $(".kbar-btn .i-wrap").innerHTML = icon("search", 16);
  $('.icon-btn[data-action="add"]').innerHTML = icon("plus", 18);
  $(".composer-icon").innerHTML = icon("search", 20);
  cSend.innerHTML = icon("arrowUp", 18);
  $(".ff-icon").innerHTML = icon("search", 15);
  $('#viewSeg [data-view="grid"]').innerHTML = icon("grid", 15);
  $('#viewSeg [data-view="list"]').innerHTML = icon("list", 15);
  $$(".icon-btn[data-close]").forEach((b) => (b.innerHTML = icon("x", 18)));
  $$(".kbd-mod").forEach((k) => (k.textContent = isMac ? "⌘" : "Ctrl"));
  if (CFG.repo) { const rl = $("#repoLink"); rl.href = CFG.repo; rl.innerHTML = icon("github", 18); rl.hidden = false; }
  $("#heroCount").textContent = BASE.length;
  $("#heroCats").textContent = CATS.length;
  $("#savedCount").textContent = saved.size;
  $("#sortSel").value = S.sort;
  $$("#priceSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.price === S.price)));
  $$("#viewSeg button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.view === S.view)));
  filterInput.value = S.q;
  paintThemeBtn();
  renderCats();
  render();
  onScroll();
  startTyper();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeIndicator(false));
})();
