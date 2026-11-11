/* Hand-drawn canvas charts. No chart library. devicePixelRatio aware. */
(function (global) {
  const GREEN = "#00d35a";
  const ORANGE = "#ff9f0a";
  const MUTED = "rgba(235,235,245,0.3)";

  function ctx2d(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height, dpr };
  }

  function niceMinMax(values, pad) {
    let min = Math.min.apply(null, values);
    let max = Math.max.apply(null, values);
    if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1 };
    if (min === max) { min -= Math.abs(min) * 0.02 || 1; max += Math.abs(max) * 0.02 || 1; }
    const span = max - min;
    return { min: min - span * (pad || 0.08), max: max + span * (pad || 0.18) };
  }

  function lineChart(canvas, opt) {
    const { ctx, w, h } = ctx2d(canvas);
    ctx.clearRect(0, 0, w, h);
    const pts = opt.points || [];
    const marks = opt.marks || [];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!pts.length) {
      // dashed start line in empty state
      ctx.save();
      ctx.strokeStyle = MUTED;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      const y = h * 0.55;
      ctx.moveTo(16, y);
      ctx.lineTo(w - 16, y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const ys = pts.map((p) => p.v);
    const { min, max } = niceMinMax(ys);
    const left = 8, right = 8, top = 22, bottom = 8;
    const iw = w - left - right, ih = h - top - bottom;
    const xAt = (i) => left + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
    const yAt = (v) => top + ((max - v) / (max - min)) * ih;
    const startY = yAt(opt.start != null ? opt.start : pts[0].v);

    // dashed start
    ctx.save();
    ctx.strokeStyle = MUTED;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, startY);
    ctx.lineTo(w - right, startY);
    ctx.stroke();
    ctx.restore();

    // fill
    const grad = ctx.createLinearGradient(0, top, 0, h);
    grad.addColorStop(0, "rgba(0,211,90,0.28)");
    grad.addColorStop(1, "rgba(0,211,90,0.00)");
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xAt(i), y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(pts.length - 1), h - bottom);
    ctx.lineTo(xAt(0), h - bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xAt(i), y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = GREEN;
    ctx.lineWidth = 2;
    ctx.stroke();

    // marks, later ones move up a row
    const used = [];
    marks.forEach((m) => {
      if (m.i == null && m.t != null) {
        let best = 0, bd = Infinity;
        pts.forEach((p, i) => {
          const d = Math.abs((p.t || 0) - m.t);
          if (d < bd) { bd = d; best = i; }
        });
        m.i = best;
      }
      const i = Math.max(0, Math.min(pts.length - 1, m.i || 0));
      const x = xAt(i);
      const y0 = yAt(pts[i].v) - 6;
      let row = 0;
      const taken = used.filter((u) => Math.abs(u.x - x) < 54);
      while (taken.some((u) => u.row === row)) row += 1;
      used.push({ x, row });
      const y = y0 - row * 14;
      ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = m.color || "#0a84ff";
      ctx.globalAlpha = reduced ? 1 : 0.95;
      ctx.textAlign = "center";
      ctx.fillText(m.label, x, Math.max(11, y));
      ctx.globalAlpha = 1;
    });
  }

  function candles(canvas, opt) {
    const { ctx, w, h } = ctx2d(canvas);
    ctx.clearRect(0, 0, w, h);
    const bars = opt.candles || [];
    if (!bars.length) {
      ctx.fillStyle = MUTED;
      ctx.font = "13px -apple-system, sans-serif";
      ctx.fillText("No candles yet", 16, h / 2);
      return;
    }
    const padT = 8, padB = 36, padX = 8;
    const highs = bars.map((c) => c.h);
    const lows = bars.map((c) => c.l);
    const { min, max } = niceMinMax(highs.concat(lows), 0.06);
    const iw = w - padX * 2, ih = h - padT - padB;
    const slot = iw / bars.length;
    const yAt = (v) => padT + ((max - v) / (max - min)) * ih;
    const vols = bars.map((c) => Math.abs(c.v || 0));
    const vmax = Math.max.apply(null, vols.concat([1]));

    if (opt.exitLine != null) {
      const y = yAt(opt.exitLine);
      ctx.save();
      ctx.strokeStyle = ORANGE;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(w - padX, y);
      ctx.stroke();
      ctx.restore();
    }

    bars.forEach((c, i) => {
      const x = padX + slot * i + slot / 2;
      const up = c.c >= c.o;
      ctx.strokeStyle = ctx.fillStyle = up ? GREEN : "#ff453a";
      ctx.beginPath();
      ctx.moveTo(x, yAt(c.h));
      ctx.lineTo(x, yAt(c.l));
      ctx.stroke();
      const y1 = yAt(Math.max(c.o, c.c));
      const y2 = yAt(Math.min(c.o, c.c));
      const bw = Math.max(1.5, slot * 0.6);
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      const vh = (Math.abs(c.v || 0) / vmax) * (padB - 8);
      ctx.globalAlpha = 0.45;
      ctx.fillRect(x - bw / 2, h - 4 - vh, bw, vh);
      ctx.globalAlpha = 1;
    });
  }

  global.DeskCharts = { lineChart, candles };
})(window);
