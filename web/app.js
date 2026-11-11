(function () {
  const STORAGE_KEY = "fomo_desk_app_token";
  const SALT = new TextEncoder().encode("fomo-desk-aes-v1");
  const INFO = new TextEncoder().encode("fomo-desk-data-v1");
  const POLL_MS = 15000;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let cryptoKey = null;
  let lastState = null;
  let lastChart = null;
  let lastActivity = null;
  let lastAccount = null;
  let lastSettings = null;
  let lastUpdate = null;
  let range = "LIVE";
  let retryS = 3;
  let retryTimer = null;
  let route = { name: "home" };

  const $ = (id) => document.getElementById(id);

  function dataBase() {
    const cfg = window.FOMO_DESK || {};
    const b = cfg.dataBase || (cfg.dataUrl ? String(cfg.dataUrl).replace(/[^/]+$/, "") : "");
    return b.endsWith("/") ? b : b + "/";
  }

  function readToken() {
    const hash = window.location.hash || "";
    const match = hash.match(/[#&?]t=([^&]+)/);
    if (match) {
      const token = decodeURIComponent(match[1]);
      try { localStorage.setItem(STORAGE_KEY, token); } catch (e) {}
      const cleaned = hash
        .replace(/([#&?]t=)[^&]*/g, "")
        .replace(/#&/, "#")
        .replace(/^#$/, "");
      history.replaceState(null, "", window.location.pathname + window.location.search + (cleaned || ""));
      return token;
    }
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  function b64urlToBytes(s) {
    const pad = "=".repeat((4 - (s.length % 4)) % 4);
    const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(token) {
    const material = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(token), "HKDF", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: SALT, info: INFO },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptBlob(blob) {
    const text = String(blob || "").trim();
    if (!text.startsWith("FD1:")) throw new Error("format");
    const raw = b64urlToBytes(text.slice(4));
    if (raw.length < 13) throw new Error("short");
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ct);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  async function fetchEnc(rel) {
    const url = dataBase() + rel + (rel.indexOf("?") >= 0 ? "&" : "?") + "t=" + Date.now();
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("http " + res.status);
    return decryptBlob(await res.text());
  }

  function usd(n, d) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    const digits = d == null ? 2 : d;
    return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  function tokenPrice(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "—";
    if (v >= 1) return usd(v, 2);
    if (v >= 0.01) return usd(v, 4);
    const dec = Math.min(12, Math.max(6, -Math.floor(Math.log10(v)) + 4));
    return usd(v, dec);
  }
  function fmtPct(n, signed) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    const s = (signed && v > 0 ? "+" : "") + v.toFixed(2) + "%";
    return s;
  }
  function timeShort(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  /* -------- odometer -------- */
  function renderOdometer(el, value) {
    const text = usd(value);
    el.setAttribute("aria-label", "Balance " + text);
    if (reduced) { el.textContent = text; return; }
    const chars = text.split("");
    const prev = el.dataset.prev || "";
    const first = !el.dataset.ready;
    if (first || prev.length !== text.length) {
      el.innerHTML = chars.map((ch) => colHtml(ch)).join("");
      el.dataset.ready = "1";
    }
    function apply(animate) {
      const cols = el.querySelectorAll(".digit-col");
      chars.forEach((ch, i) => {
        const col = cols[i];
        if (!col) return;
        if (!/[0-9]/.test(ch)) {
          col.className = "digit-col " + (ch === "." ? "dot" : "sym");
          col.innerHTML = escapeHtml(ch);
          return;
        }
        let strip = col.querySelector(".strip");
        if (!strip) { col.innerHTML = digitStrip(); strip = col.querySelector(".strip"); }
        const delay = animate ? (chars.length - 1 - i) * 30 : 0;
        strip.style.transition = animate ? "transform 600ms ease-out" : "none";
        strip.style.transitionDelay = delay + "ms";
        strip.style.transform = "translateY(" + (-parseInt(ch, 10)) + "em)";
      });
    }
    if (first) {
      apply(false);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { apply(true); });
      });
    } else if (prev !== text) {
      apply(true);
    }
    el.dataset.prev = text;
  }
  function colHtml(ch) {
    if (!/[0-9]/.test(ch)) return '<span class="digit-col ' + (ch === "." ? "dot" : "sym") + '">' + escapeHtml(ch) + "</span>";
    return '<span class="digit-col">' + digitStrip() + "</span>";
  }
  function digitStrip() {
    let s = '<span class="strip">';
    for (let i = 0; i <= 9; i += 1) s += "<span>" + i + "</span>";
    return s + "</span>";
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* -------- routing -------- */
  function parseRoute() {
    const h = (window.location.hash || "").replace(/^#/, "");
    const path = h.replace(/^t=[^&]*&?/, "").replace(/^\//, "");
    if (path.startsWith("coin/")) return { name: "coin", mint: decodeURIComponent(path.slice(5).split("&")[0]) };
    if (path.startsWith("audit/")) return { name: "auditor", mint: decodeURIComponent(path.slice(6).split("&")[0]) };
    if (path === "agents") return { name: "agents" };
    if (path === "activity") return { name: "activity" };
    if (path === "account") return { name: "account" };
    return { name: "home" };
  }
  function go(name, mint) {
    let hash = "#/";
    if (name === "agents") hash = "#/agents";
    else if (name === "activity") hash = "#/activity";
    else if (name === "account") hash = "#/account";
    else if (name === "coin" && mint) hash = "#/coin/" + encodeURIComponent(mint);
    else if (name === "auditor" && mint) hash = "#/audit/" + encodeURIComponent(mint);
    else hash = "#/";
    if (location.hash === hash) { route = parseRoute(); showView(); return; }
    location.hash = hash;
  }
  function showView() {
    route = parseRoute();
    const map = { home: "view-home", agents: "view-agents", activity: "view-activity", account: "view-account", coin: "view-coin", auditor: "view-auditor" };
    Object.keys(map).forEach((k) => {
      const el = $(map[k]);
      if (el) el.hidden = route.name !== k;
    });
    document.querySelectorAll(".tabbar .tab").forEach((b) => {
      b.classList.toggle("on", b.getAttribute("data-tab") === route.name || (route.name === "home" && b.getAttribute("data-tab") === "home"));
    });
    if (route.name === "coin") loadCoin(route.mint);
    if (route.name === "auditor") loadAudit(route.mint);
    if (route.name === "agents") renderAgentsTab();
    if (route.name === "activity") renderActivityList($("activity-list"), lastActivity && lastActivity.rows);
    if (route.name === "account") renderAccount();
    if (route.name === "home") renderHome();
  }

  /* -------- render home -------- */
  function renderHome() {
    const s = lastState;
    if (!s) return;
    renderOdometer($("odometer"), s.balance_usd);
    const badge = $("paper-badge");
    const paper = s.mode === "PAPER";
    badge.hidden = !paper;
    const lab = $("paper-label");
    lab.hidden = !paper;
    lab.textContent = s.label || (paper ? "Simulated PAPER balance" : "");
    const pct = Number(s.today_pct) || 0;
    const pEl = $("today-pct");
    pEl.textContent = fmtPct(pct, true);
    pEl.className = "today-pct" + (pct > 0 ? " up" : pct < 0 ? " down" : "");
    $("multiplier").textContent = (Number(s.multiplier) || 1).toFixed(2) + "×";
    $("agents-running").textContent = (s.agents_running != null ? s.agents_running : 5) + " running";
    $("bell-dot").hidden = !s.unread_pushes;
    const av = document.getElementById("btn-avatar");
    if (s.handle_letter) av.textContent = s.handle_letter;
    renderHomeChart();
    renderAgentCarousel(s.agents || {});
    const preview = (s.activity_preview && s.activity_preview.length)
      ? s.activity_preview
      : ((lastActivity && lastActivity.rows) || []).slice(0, 5);
    renderActivityList($("home-activity"), preview, true);
  }

  function renderHomeChart() {
    const canvas = $("home-chart");
    const empty = $("chart-empty");
    const pack = lastChart && lastChart.ranges ? lastChart.ranges[range] : null;
    const pts = (pack && pack.points) || [];
    const marks = (pack && pack.marks) || [];
    const start = lastState && lastState.night_start;
    const noTrades = !marks.length;
    empty.hidden = !(noTrades);
    DeskCharts.lineChart(canvas, { points: pts, marks: marks, start: start });
  }

  function renderAgentCarousel(agents) {
    const root = $("agent-carousel");
    const order = ["scanner", "auditor", "analyst", "executor", "risk"];
    const titles = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
    root.innerHTML = order.map((id) => agentCardHtml(id, titles[id], agents[id] || {})).join("");
  }

  function agentCardHtml(id, title, a) {
    let body = "";
    if (id === "scanner") {
      const n = a.pools != null ? a.pools : (a.count || 0);
      const head = n ? (n + " pools") : "Listening for graduations";
      const feed = (a.feed || []).slice(0, 6).map((r) => {
        const nm = escapeHtml(r.name || r.symbol || (r.mint || "").slice(0, 6));
        const reason = escapeHtml(r.reason || "");
        const cls = r.verdict === "pass" ? "pass" : "kill";
        const right = r.verdict === "pass" ? "→ auditor" : reason;
        return '<div class="feed-row ' + cls + '"><span class="fn">' + nm + '</span><span class="fr">' + right + "</span></div>";
      }).join("");
      body = '<div class="ac-head" style="color:#64d2ff">' + escapeHtml(head) + "</div><div class='agent-feed'>" + feed + "</div>";
    } else if (id === "auditor") {
      const taken = a.taken || 0;
      const rejected = a.rejected || 0;
      const strips = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
        const L = (a.layers || []).find((x) => x.n === n);
        let cls = "layer-strip";
        if (L && L.pass === true) cls += " ok";
        if (L && L.pass === false) cls += " no";
        return '<div class="' + cls + '"></div>';
      }).join("");
      const head = taken ? (taken + " taken apart") : "0 taken apart";
      const status = a.headline || "";
      body = '<div class="ac-head">' + escapeHtml(head) + '</div><div class="layer-grid">' + strips + "</div><div class='ac-name' style='margin-top:10px'>" + escapeHtml(status) + (rejected ? " · " + rejected + " rejected" : "") + "</div>";
    } else if (id === "analyst") {
      const score = a.score;
      const green = score != null && score >= (a.min_score || 70);
      body = '<div class="ac-head" style="color:#ffd60a">Scoring</div><div class="score-ring-wrap">' + scoreRing(score, green) + "</div>";
    } else if (id === "executor") {
      const trades = a.trades || 0;
      const head = trades + " trades";
      const label = a.size_label || "";
      const bar = a.bar_pct;
      const barHtml = bar == null ? "" : '<div class="exec-bar"><i style="width:' + Math.max(0, Math.min(100, bar)) + '%"></i></div>';
      const st = a.filled ? "✓ Filled" : (bar != null ? ("Executing... " + bar + "%") : "");
      body = '<div class="ac-head" style="color:#00d35a">' + escapeHtml(head) + '</div><div class="ac-name">' + escapeHtml(label) + "</div>" + barHtml + '<div class="ac-name">' + escapeHtml(st) + "</div>";
    } else {
      const head = a.headline || "Guarding";
      const stop = a.stop_pct != null ? a.stop_pct : 6;
      const trail = a.trail_pct != null ? a.trail_pct : 12;
      body = '<div class="ac-head" style="color:#ff6b9a">' + escapeHtml(head) + '</div><div class="risk-pills"><span class="pill-mono pill-stop">stop -' + escapeHtml(String(stop)) + '%</span><span class="pill-mono pill-trail">trail ' + escapeHtml(String(trail)) + "%</span></div>";
    }
    return '<article class="agent-card" data-agent="' + id + '"><div class="ac-name">' + title + "</div>" + body + "</article>";
  }

  function scoreRing(score, green) {
    const v = score == null ? 0 : Number(score);
    const r = 52, c = 2 * Math.PI * r;
    const dash = (Math.max(0, Math.min(100, v)) / 100) * c;
    const col = green ? "#00d35a" : "#ffd60a";
    const label = score == null ? "—" : String(Math.round(v));
    return '<svg width="140" height="140" viewBox="0 0 140 140"><circle cx="70" cy="70" r="' + r + '" fill="none" stroke="#2c2c2e" stroke-width="10"/><circle cx="70" cy="70" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="10" stroke-linecap="round" stroke-dasharray="' + dash + " " + c + '" transform="rotate(-90 70 70)"/><text x="70" y="76" text-anchor="middle" fill="#fff" font-size="28" font-weight="700" font-family="-apple-system,sans-serif">' + label + "</text></svg>";
  }

  function renderActivityList(root, rows, allowEmptyNote) {
    if (!root) return;
    if (!rows || !rows.length) {
      root.innerHTML = '<div class="empty-note">Nothing yet tonight</div>';
      return;
    }
    root.innerHTML = rows.map((r) => {
      const title = escapeHtml(r.title || "");
      const sub = escapeHtml(r.subtitle || "");
      const val = escapeHtml(r.value || "");
      const kind = r.kind || "";
      let dest = "";
      if ((kind === "bought" || kind === "sold" || kind === "stopped") && r.mint) dest = "coin:" + r.mint;
      else if (kind === "rejected" && r.mint) dest = "audit:" + r.mint;
      return '<button type="button" class="act-row" data-go="' + escapeHtml(dest) + '"><div class="act-main"><div class="act-title">' + title + '</div><div class="act-sub">' + sub + '</div></div><div class="act-value">' + val + "</div></button>";
    }).join("");
  }

  /* -------- agents tab -------- */
  function renderAgentsTab() {
    const root = $("agents-list");
    const s = lastState || {};
    const dec = s.decisions || {};
    const order = ["scanner", "auditor", "analyst", "executor", "risk"];
    const titles = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
    const openPos = s.open_positions || 0;
    root.innerHTML = order.map((id) => {
      const a = (s.agents && s.agents[id]) || {};
      const running = a.status !== "paused" && a.status !== "offline";
      const count = a.count != null ? a.count : 0;
      const locked = id === "risk" && openPos > 0;
      const rows = (dec[id] || a.decisions || []).slice(0, 20).map((d) => {
        const hrefMint = d.mint ? escapeHtml(d.mint) : "";
        const coin = escapeHtml(d.coin || d.symbol || d.name || (d.mint || "").slice(0, 6));
        const reason = escapeHtml(d.reason || d.verdict || "");
        const t = escapeHtml(timeShort(d.ts));
        return '<div class="dec-row"><span class="t">' + t + '</span><button type="button" class="c" data-go="coin:' + hrefMint + '">' + coin + '</button><span class="r">' + reason + "</span></div>";
      }).join("") || '<div class="empty-note" style="padding:8px 0">No decisions yet</div>';
      return '<article class="agent-full"><div class="af-top"><span class="dot' + (running ? "" : " off") + '"></span><div class="af-name">' + titles[id] + '</div><div class="af-count">' + count + ' today</div><div class="switch' + (running ? " on" : "") + '" aria-disabled="true" title="Pause in Telegram"><i></i></div>' + (locked ? '<span class="switch-lock">locked</span>' : "") + '</div><div class="af-decs">' + rows + '</div><button type="button" class="settings-link" data-go="account">Settings</button></article>';
    }).join("");
  }

  /* -------- account (read-only) -------- */
  function renderAccount() {
    const root = $("account-body");
    const a = lastAccount || {};
    const sets = (lastSettings && lastSettings.groups) || {};
    const mode = a.mode || (lastState && lastState.mode) || "PAPER";
    const handle = a.fomo_handle || "";
    const tg = a.telegram ? "Connected" : "Not connected";
    const profile = a.profile_url || "";
    const signup = a.signup_url || "";
    let html = "";
    html += '<div class="group"><div class="group-title">Trading</div><div class="rows">';
    html += '<div class="row disabled"><span class="k">Mode</span><span class="v">' + escapeHtml(mode) + "</span></div>";
    html += '<div class="row disabled"><span class="k">Stack</span><span class="v">' + escapeHtml(usd(a.stack)) + "</span></div>";
    html += "</div><p class='row-note'>Mode, stack and settings are changed in Telegram.</p></div>";
    html += '<div class="group"><div class="group-title">FOMO</div><div class="rows">';
    html += '<button type="button" class="row row-btn" data-open="' + escapeHtml(profile) + '"><span class="k">Your FOMO profile</span><span class="v">' + escapeHtml(handle ? "@" + handle : "Open") + "</span></button>";
    html += '<button type="button" class="row row-btn" id="btn-invite"><span class="k">Invite a friend</span><span class="v">Share</span></button>';
    html += "</div><p class='copied' id='invite-copied' hidden>Link copied</p></div>";
    html += '<div class="group"><div class="group-title">Telegram</div><div class="rows">';
    html += '<div class="row"><span class="k">Status</span><span class="v">' + escapeHtml(tg) + "</span></div>";
    html += '<div class="row disabled"><span class="k">Send test push</span><span class="v">Use Telegram</span></div>';
    html += "</div><p class='row-note'>Plan B has no web push. Pushes and commands go through Telegram only.</p></div>";
    const order = ["scanner", "auditor", "analyst", "executor", "risk", "desk"];
    const titles = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk", desk: "Desk" };
    order.forEach((g) => {
      const items = sets[g] || [];
      if (!items.length) return;
      html += '<div class="group" id="settings-' + g + '"><div class="group-title">' + titles[g] + "</div><div class='rows'>";
      items.forEach((it) => {
        const val = it.value == null ? "" : String(it.value);
        const isNum = typeof it.value === "number";
        html += '<div class="setting-line"><div class="sl"><span>' + escapeHtml(it.label || it.key) + "</span>";
        if (isNum) html += '<input type="number" value="' + escapeHtml(val) + '" disabled>';
        else html += "<span class='v'>" + escapeHtml(val) + "</span>";
        html += "</div>";
        if (isNum && it.min != null && it.max != null) {
          html += '<div class="range-hint">' + it.min + ' – ' + it.max + '</div>';
          html += '<input type="range" min="' + it.min + '" max="' + it.max + '" step="' + (it.step || "any") + '" value="' + escapeHtml(val) + '" disabled>';
        }
        html += "</div>";
      });
      html += "</div></div>";
    });
    root.innerHTML = html;
    const invite = $("btn-invite");
    if (invite) {
      invite.onclick = function () {
        if (!signup) return;
        if (navigator.share) {
          navigator.share({ url: signup }).catch(function () { copyText(signup); });
        } else {
          copyText(signup);
        }
      };
    }
  }
  function copyText(text) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(showCopied, showCopied);
    } else {
      showCopied();
    }
  }
  function showCopied() {
    const el = $("invite-copied");
    if (el) { el.hidden = false; }
  }

  /* -------- coin / audit -------- */
  async function loadCoin(mint) {
    const body = $("coin-body");
    body.innerHTML = '<div class="skel" style="height:80px;margin:12px 0"></div><div class="skel" style="height:220px"></div>';
    try {
      const data = await fetchEnc("coin/" + encodeURIComponent(mint) + ".json");
      renderCoin(data);
    } catch (e) {
      $("coin-title").textContent = "Coin";
      $("coin-sub").textContent = "";
      body.innerHTML = '<div class="empty-note">No coin data yet.</div>';
    }
  }
  function renderCoin(c) {
    $("coin-title").textContent = c.name || c.symbol || "Coin";
    $("coin-sub").textContent = [c.symbol, c.chain || "Solana", c.age].filter(Boolean).join(" · ");
    $("coin-badge").hidden = c.mode !== "PAPER";
    const sh = $("coin-shield");
    if (c.shield) { sh.hidden = false; sh.textContent = c.shield; } else sh.hidden = true;
    const chg = c.change_since_entry;
    const chgCls = chg > 0 ? "up" : chg < 0 ? "down" : "";
    const chgTxt = c.position && Number.isFinite(Number(chg))
      ? ((chg > 0 ? "▲ " : chg < 0 ? "▼ " : "") + fmtPct(chg, false) + " since entry")
      : "";
    const stats = c.stats || {};
    const holders = stats.holders == null || stats.holders === "" ? "n/a" : String(stats.holders);
    let posHtml = "";
    if (c.position) {
      posHtml += '<div class="pos-card"><h3>Your position · ' + escapeHtml(usd(c.position.size_usd)) + " in · Executor</h3></div>";
      posHtml += '<div class="exit-card"><h3>Exit</h3><div>Stop line ' + escapeHtml(usd(c.position.stop, 6)) + "</div>";
      if (c.position.trail != null) posHtml += "<div>Trail line " + escapeHtml(usd(c.position.trail, 6)) + "</div>";
      if (c.position.timeout_left) posHtml += "<div>Time left " + escapeHtml(c.position.timeout_left) + "</div></div>";
      else posHtml += "</div>";
    }
    const btnLabel = c.button || (c.position ? "Sell on FOMO" : "Buy on FOMO");
    const link = c.coin_url || "";
    $("coin-body").innerHTML =
      '<div class="price-big">' + escapeHtml(tokenPrice(c.price)) + '</div>' +
      (chgTxt ? '<div class="chg ' + chgCls + '">' + escapeHtml(chgTxt) + "</div>" : "") +
      '<div class="candle-wrap"><canvas id="coin-chart"></canvas></div>' +
      '<div class="stats">' +
        stat("Market cap", stats.market_cap) +
        stat("Liquidity", stats.liquidity) +
        stat("24h volume", stats.volume_h24) +
        '<div><div class="stat-k">Holders</div><div class="stat-val">' + escapeHtml(holders) + "</div></div>" +
      "</div>" + posHtml +
      (link ? '<a class="fomo-btn" id="coin-fomo" href="#">' + escapeHtml(btnLabel) + "</a>" : "");
    const cv = document.getElementById("coin-chart");
    if (cv) DeskCharts.candles(cv, { candles: c.candles || [], exitLine: c.exit_line });
    const btn = document.getElementById("coin-fomo");
    if (btn && link) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        window.location.href = link;
      });
    }
  }
  function stat(k, v) {
    const t = v == null || v === "" ? "n/a" : (typeof v === "number" ? usd(v) : String(v));
    return '<div><div class="stat-k">' + escapeHtml(k) + '</div><div class="stat-val">' + escapeHtml(t) + "</div></div>";
  }

  async function loadAudit(mint) {
    const body = $("audit-body");
    if (!mint) {
      $("audit-title").textContent = "Auditor";
      body.innerHTML = '<div class="empty-note">No coin taken apart yet</div>';
      return;
    }
    body.innerHTML = '<div class="skel" style="height:240px"></div>';
    try {
      const data = await fetchEnc("audit/" + encodeURIComponent(mint) + ".json");
      renderAudit(data);
    } catch (e) {
      $("audit-title").textContent = "Auditor";
      body.innerHTML = '<div class="empty-note">No coin taken apart yet</div>';
    }
  }
  function renderAudit(a) {
    $("audit-title").textContent = a.name || a.symbol || "Auditor";
    if (!a.layers || !a.layers.length) {
      $("audit-body").innerHTML = '<div class="empty-note">No coin taken apart yet</div>';
      return;
    }
    const names = ["Mint authority", "Freeze authority", "Dev wallet", "Top 10 holders", "Liquidity", "Pool age", "Bundled wallets", "Delegations"];
    const discs = names.map((nm, i) => {
      const L = a.layers.find((x) => x.n === i + 1) || {};
      let cls = "disc";
      if (L.pass === true) cls += " ok";
      if (L.pass === false) cls += " no";
      const val = L.value || (L.pass == null ? "not checked" : "");
      return '<div class="' + cls + '" data-layer="' + (i + 1) + '"><span class="beam"></span><span class="n">' + (i + 1) + '</span><span class="nm">' + escapeHtml(L.name || nm) + '</span><span class="vl">' + escapeHtml(val) + "</span></div>";
    }).join("");
    let status = "", sub = "";
    if (a.passed) {
      status = "Cleared · 8/8 parts";
      sub = a.size_label ? ("Sent to Executor · " + a.size_label) : "Sent to Executor";
    } else if (a.reason) {
      status = "Rejected · " + a.reason;
      sub = "Grok Bot won't buy " + (a.symbol || a.name || "this");
    }
    const link = a.coin_url || "";
    $("audit-body").innerHTML =
      '<div class="discs" id="discs">' + discs + "</div>" +
      '<div class="audit-status">' + escapeHtml(status) + "</div>" +
      '<div class="audit-sub">' + escapeHtml(sub) + "</div>" +
      '<div class="toggle-row"><span>Take apart before buying</span><div class="switch on" aria-disabled="true"><i></i></div></div>' +
      (link ? '<a class="fomo-btn" id="audit-fomo" href="#">Open on FOMO</a>' : "");
    const btn = document.getElementById("audit-fomo");
    if (btn && link) btn.addEventListener("click", function (ev) { ev.preventDefault(); window.location.href = link; });
    playBeam();
  }
  function playBeam() {
    const discs = Array.prototype.slice.call(document.querySelectorAll("#discs .disc"));
    if (reduced) return;
    let i = 0;
    function step() {
      if (i >= discs.length) return;
      const d = discs[i];
      d.classList.add("beam-on");
      setTimeout(function () {
        i += 1;
        setTimeout(step, 150);
      }, 350);
    }
    step();
  }

  /* -------- search / events -------- */
  function openSearch() {
    $("search-sheet").hidden = false;
    $("search-input").value = "";
    $("search-results").innerHTML = "";
    $("search-input").focus();
  }
  function closeSearch() { $("search-sheet").hidden = true; }
  function runSearch(q) {
    q = (q || "").trim().toLowerCase();
    const idx = (lastState && lastState.search_index) || [];
    const hits = !q ? [] : idx.filter((c) => {
      return [c.name, c.symbol, c.mint].some((x) => x && String(x).toLowerCase().indexOf(q) >= 0);
    }).slice(0, 20);
    $("search-results").innerHTML = hits.map((c) => {
      return '<button type="button" class="search-hit" data-go="coin:' + escapeHtml(c.mint) + '"><div>' + escapeHtml(c.name || c.symbol || c.mint) + '</div><div class="s">' + escapeHtml(c.symbol || "") + " · " + escapeHtml((c.mint || "").slice(0, 8)) + "</div></button>";
    }).join("") || (q ? '<div class="empty-note">No matches</div>' : "");
  }

  document.body.addEventListener("click", function (ev) {
    const tab = ev.target.closest(".tab");
    if (tab) { ev.preventDefault(); go(tab.getAttribute("data-tab")); return; }
    const back = ev.target.closest("[data-back]");
    if (back) { ev.preventDefault(); history.back(); return; }
    const goEl = ev.target.closest("[data-go]");
    if (goEl) {
      const g = goEl.getAttribute("data-go") || "";
      if (g === "account") go("account");
      else if (g.indexOf("coin:") === 0) go("coin", g.slice(5));
      else if (g.indexOf("audit:") === 0) go("auditor", g.slice(6));
      return;
    }
    const open = ev.target.closest("[data-open]");
    if (open) {
      const url = open.getAttribute("data-open");
      if (url) window.location.href = url;
    }
  });
  $("btn-avatar").addEventListener("click", function () { go("account"); });
  $("btn-see-all").addEventListener("click", function () { go("activity"); });
  $("btn-search").addEventListener("click", openSearch);
  $("search-close").addEventListener("click", closeSearch);
  $("search-input").addEventListener("input", function () { runSearch(this.value); });
  $("range-switch").addEventListener("click", function (ev) {
    const b = ev.target.closest("button[data-range]");
    if (!b) return;
    range = b.getAttribute("data-range");
    $("range-switch").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderHomeChart();
  });
  window.addEventListener("hashchange", showView);
  window.addEventListener("resize", function () {
    if (route.name === "home") renderHomeChart();
  });

  function showOffline(on, seconds) {
    const b = $("offline-banner");
    if (!on) { b.hidden = true; return; }
    const when = lastUpdate ? new Date(lastUpdate).toLocaleTimeString() : "—";
    b.hidden = false;
    b.textContent = "Desk offline · retrying in " + seconds + "s · last update " + when;
    if (!lastState) {
      const ar = $("agents-running");
      if (ar) ar.textContent = "—";
    }
  }

  async function poll() {
    if (!cryptoKey) return;
    try {
      const [state, chart, activity, account, settings] = await Promise.all([
        fetchEnc("state.json"),
        fetchEnc("chart.json"),
        fetchEnc("activity.json"),
        fetchEnc("account.json"),
        fetchEnc("settings.json"),
      ]);
      lastState = state;
      lastChart = chart;
      lastActivity = activity;
      lastAccount = account;
      lastSettings = settings;
      lastUpdate = state.updated_at || new Date().toISOString();
      retryS = 3;
      showOffline(false);
      showView();
      if (route.name === "coin" && route.mint) loadCoin(route.mint);
    } catch (e) {
      showOffline(true, retryS);
      if (lastState) showView();
      scheduleRetry();
    }
  }
  function scheduleRetry() {
    if (retryTimer) clearTimeout(retryTimer);
    const wait = retryS;
    retryTimer = setTimeout(function () {
      retryS = Math.min(30, retryS + 3);
      poll();
    }, wait * 1000);
  }

  async function start() {
    const token = readToken();
    if (!token) {
      showOffline(true, 0);
      $("offline-banner").textContent = "Open the private link from Telegram to unlock.";
      $("offline-banner").hidden = false;
      return;
    }
    try { cryptoKey = await deriveKey(token); }
    catch (e) {
      $("offline-banner").hidden = false;
      $("offline-banner").textContent = "Could not unlock this device.";
      return;
    }
    showView();
    await poll();
    setInterval(poll, POLL_MS);
  }

  start();
})();
