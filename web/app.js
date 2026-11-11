(function () {
  const STORAGE_KEY = "fomo_desk_app_token";
  const SALT = new TextEncoder().encode("fomo-desk-aes-v1");
  const INFO = new TextEncoder().encode("fomo-desk-data-v1");
  const POLL_MS = 15000;

  const els = {
    badge: document.getElementById("mode-badge"),
    balance: document.getElementById("balance"),
    caption: document.getElementById("caption"),
    updated: document.getElementById("updated"),
    status: document.getElementById("status"),
  };

  let cryptoKey = null;

  function setStatus(text, kind) {
    els.status.textContent = text || "";
    els.status.className = "status" + (kind ? " " + kind : "");
  }

  function readToken() {
    const hash = window.location.hash || "";
    const match = hash.match(/[#&]t=([^&]+)/);
    if (match) {
      const token = decodeURIComponent(match[1]);
      try { localStorage.setItem(STORAGE_KEY, token); } catch (e) {}
      history.replaceState(null, "", window.location.pathname + window.location.search);
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
      "raw",
      new TextEncoder().encode(token),
      "HKDF",
      false,
      ["deriveKey"]
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

  function formatUsd(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return "—";
    return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  function render(data) {
    if (data.mode) els.badge.textContent = String(data.mode);
    els.balance.textContent = formatUsd(data.balance_usd);
    els.caption.textContent = data.label || "";
    if (data.updated_at) {
      const d = new Date(data.updated_at);
      els.updated.textContent = "Updated " + (Number.isNaN(d.getTime()) ? data.updated_at : d.toLocaleString());
    } else {
      els.updated.textContent = "";
    }
    setStatus("");
  }

  async function poll() {
    const cfg = window.FOMO_DESK || {};
    if (!cfg.dataUrl) {
      setStatus("App config missing.", "err");
      return;
    }
    try {
      const res = await fetch(cfg.dataUrl + "?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("fetch " + res.status);
      const data = await decryptBlob(await res.text());
      render(data);
    } catch (e) {
      setStatus("Waiting for data…", "warn");
    }
  }

  async function start() {
    const token = readToken();
    if (!token) {
      setStatus("Open the private link from Telegram to unlock.", "err");
      return;
    }
    try {
      cryptoKey = await deriveKey(token);
    } catch (e) {
      setStatus("Could not unlock this device.", "err");
      return;
    }
    await poll();
    setInterval(poll, POLL_MS);
  }

  start();
})();
