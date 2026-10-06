// Agentic Systems — deterministic canvas renderer. render(t) draws frame at time t (seconds).
/* global TL, LOGO */
(function () {
  const { W, H, CX, CY, clamp, lerp, prog, eoc, eoq, eic, eio, eios, eoe, spring, hash } = TL;
  const TAU = Math.PI * 2;

  // ---------- palette ----------
  const C = {
    cobalt: '#125BEB', logo: '#0050FF', cyan: '#9CD0FF', ice: '#EAF2FF', violet: '#569DF7',
    ink: '#00073A',
  };
  // brand background ramp (180deg)
  const BRAND = [[0.03, '#00073A'], [0.10, '#000B4D'], [0.20, '#001374'], [0.30, '#001D9E'], [0.40, '#012FC1'],
    [0.50, '#0B45D7'], [0.60, '#125BEB'], [0.70, '#337DF4'], [0.80, '#569DF7'], [0.90, '#7CB7F9'], [0.97, '#96C5F8']];
  const hex = (h) => h[0] === '#' ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] : h.match(/[\d.]+/g).slice(0, 3).map(Number);
  const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
  const mix = (h1, h2, k) => { const a = hex(h1), b = hex(h2); return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], k))).join(',')})`; };

  // ---------- canvases ----------
  const out = document.getElementById('c'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const scene = mk(W, H), X = scene.getContext('2d');
  const glow = mk(W / 2, H / 2), G = glow.getContext('2d');
  const b1 = mk(270, 480), B1 = b1.getContext('2d');
  const b2 = mk(135, 240), B2 = b2.getContext('2d');
  const b3 = mk(68, 120), B3 = b3.getContext('2d');
  const blobC = mk(W / 2, H / 2), BL = blobC.getContext('2d');
  const blobImg = BL.createImageData(W / 2, H / 2);
  const tmp = mk(W, H), TM = tmp.getContext('2d');

  // run a drawing fn on the main scene and on the emissive (glow) layer
  const both = (fn, ga = 1) => { fn(X, 1); G.save(); G.globalAlpha *= ga; fn(G, ga); G.restore(); };

  // ---------- typography ----------
  const SANS = (sz, wt = 300) => `${wt} ${sz}px "Inter Tight"`;
  const SERIF = (sz) => `italic 400 ${Math.round(sz * 1.2)}px "Instrument Serif"`;
  function splitWords(segs) {
    const ws = [];
    for (const [txt, st] of segs) txt.split(/(?<= )/).forEach((w) => w && ws.push([w, st]));
    return ws;
  }
  function keyFill(x, px, w, dark) {
    const g = x.createLinearGradient(px, 0, px + w, 0);
    if (dark) { g.addColorStop(0, '#2B5CFF'); g.addColorStop(1, '#6A4DF5'); }
    else { g.addColorStop(0, '#D6EAFF'); g.addColorStop(1, '#7CB7F9'); }
    return g;
  }
  // animated line: words blur/rise in with stagger, blur/rise out at tout
  function textLine(segs, cx, y, sz, tin, tout, t, o = {}) {
    if (t < tin - 0.01 || t > tout + 0.9) return;
    const x = X, ws = splitWords(segs);
    const widths = ws.map(([w, st]) => { x.font = st === 'i' ? SERIF(sz) : SANS(sz, o.wt || 300); return x.measureText(w).width; });
    const total = widths.reduce((a, b) => a + b, 0) - (ws.length ? x.measureText(' ').width * 0 : 0);
    let px = cx - total / 2;
    ws.forEach(([w, st], i) => {
      const a = tin + i * (o.stagger || 0.075);
      const e = eoc(prog(t, a, a + 0.6));
      const xo = tout + i * 0.035;
      const ex = eic(prog(t, xo, xo + 0.42));
      const al = e * (1 - ex) * (o.alpha ?? 1);
      if (al > 0.003) {
        x.save();
        x.globalAlpha = al;
        const bl = (1 - e) * 12 + ex * 12;
        if (bl > 0.25) x.filter = `blur(${bl.toFixed(2)}px)`;
        x.font = st === 'i' ? SERIF(sz) : SANS(sz, o.wt || 300);
        x.textBaseline = 'alphabetic';
        x.fillStyle = st === 'i' ? keyFill(x, px, widths[i], o.dark) : (o.color || 'rgba(238,243,255,0.95)');
        x.fillText(w, px, y + (1 - e) * 24 - ex * 18);
        x.restore();
      }
      px += widths[i];
    });
  }
  // static segmented text (used inside cards)
  function segText(x, segs, x0, y, sz, col, keyCol) {
    let px = x0;
    for (const [w, st] of splitWords(segs)) {
      x.font = st === 'i' ? SERIF(sz) : SANS(sz, 400);
      x.fillStyle = st === 'i' ? keyCol : col;
      x.fillText(w, px, y); px += x.measureText(w).width;
    }
  }

  // ---------- primitives ----------
  function circle(x, px, py, r) { x.beginPath(); x.arc(px, py, Math.max(0, r), 0, TAU); }
  function rrect(x, px, py, w, h, r) { r = Math.min(r, w / 2, h / 2); x.beginPath(); x.roundRect(px - w / 2, py - h / 2, w, h, Math.max(0, r)); }
  // soft glowing point: halo on scene, bright disc on emissive layer
  function glowDot(px, py, r, col, inten = 1, halo = 5) {
    if (inten <= 0.002 || r <= 0) return;
    const g = X.createRadialGradient(px, py, 0, px, py, r * halo);
    g.addColorStop(0, rgba('#FFFFFF', 0.95 * inten));
    g.addColorStop(0.12, rgba(col, 0.75 * inten));
    g.addColorStop(0.4, rgba(col, 0.16 * inten));
    g.addColorStop(1, rgba(col, 0));
    X.fillStyle = g; circle(X, px, py, r * halo); X.fill();
    X.fillStyle = rgba('#FFFFFF', inten); circle(X, px, py, r * 0.55); X.fill();
    G.fillStyle = rgba(col, inten); circle(G, px, py, r * 1.6); G.fill();
    G.fillStyle = rgba('#FFFFFF', inten); circle(G, px, py, r * 0.7); G.fill();
  }
  function strokeGrad(x, x0, y0, x1, y1, c0, c1, a = 1) {
    const g = x.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgba(c0, a)); g.addColorStop(1, rgba(c1, a)); return g;
  }

  // ---------- icons (unit box ~[-0.5,0.5]) ----------
  const ICON = {
    search(x) { x.beginPath(); x.arc(-0.08, -0.08, 0.27, 0, TAU); x.moveTo(0.12, 0.12); x.lineTo(0.36, 0.36); x.stroke(); },
    code(x) { x.beginPath(); x.moveTo(-0.16, -0.26); x.lineTo(-0.4, 0); x.lineTo(-0.16, 0.26); x.moveTo(0.16, -0.26); x.lineTo(0.4, 0); x.lineTo(0.16, 0.26); x.moveTo(0.07, -0.34); x.lineTo(-0.07, 0.34); x.stroke(); },
    db(x) { x.beginPath(); x.ellipse(0, -0.26, 0.32, 0.11, 0, 0, TAU); x.moveTo(-0.32, -0.26); x.lineTo(-0.32, 0.26); x.moveTo(0.32, -0.26); x.lineTo(0.32, 0.26); x.stroke(); x.beginPath(); x.ellipse(0, 0.26, 0.32, 0.11, 0, 0, Math.PI); x.stroke(); x.beginPath(); x.ellipse(0, 0, 0.32, 0.11, 0, 0, Math.PI); x.stroke(); },
    globe(x) { x.beginPath(); x.arc(0, 0, 0.36, 0, TAU); x.stroke(); x.beginPath(); x.ellipse(0, 0, 0.15, 0.36, 0, 0, TAU); x.moveTo(-0.36, 0); x.lineTo(0.36, 0); x.stroke(); },
    mail(x) { x.beginPath(); x.roundRect(-0.38, -0.27, 0.76, 0.54, 0.08); x.moveTo(-0.34, -0.22); x.lineTo(0, 0.06); x.lineTo(0.34, -0.22); x.stroke(); },
    bolt(x) { x.beginPath(); x.moveTo(0.08, -0.4); x.lineTo(-0.22, 0.06); x.lineTo(0.0, 0.06); x.lineTo(-0.08, 0.4); x.lineTo(0.22, -0.06); x.lineTo(0.0, -0.06); x.closePath(); x.stroke(); },
    eye(x) { x.beginPath(); x.moveTo(-0.42, 0); x.quadraticCurveTo(0, -0.42, 0.42, 0); x.quadraticCurveTo(0, 0.42, -0.42, 0); x.stroke(); x.beginPath(); x.arc(0, 0, 0.12, 0, TAU); x.stroke(); },
    sliders(x) { x.beginPath(); [-0.24, 0, 0.24].forEach((y) => { x.moveTo(-0.38, y); x.lineTo(0.38, y); }); x.stroke(); [[0.14, -0.24], [-0.18, 0], [0.04, 0.24]].forEach(([a, b]) => { x.beginPath(); x.arc(a, b, 0.075, 0, TAU); x.fill(); }); },
    check(x) { x.beginPath(); x.moveTo(-0.26, 0.0); x.lineTo(-0.07, 0.19); x.lineTo(0.28, -0.18); x.stroke(); },
    user(x) { x.beginPath(); x.arc(0, -0.12, 0.15, 0, TAU); x.stroke(); x.beginPath(); x.arc(0, 0.38, 0.3, Math.PI * 1.12, Math.PI * 1.88); x.stroke(); },
    folder(x) { x.beginPath(); x.moveTo(-0.38, -0.22); x.lineTo(-0.12, -0.22); x.lineTo(-0.04, -0.13); x.lineTo(0.38, -0.13); x.lineTo(0.38, 0.27); x.lineTo(-0.38, 0.27); x.closePath(); x.stroke(); },
    target(x) { x.beginPath(); x.arc(0, 0, 0.34, 0, TAU); x.stroke(); x.beginPath(); x.arc(0, 0, 0.12, 0, TAU); x.fill(); },
  };
  function icon(x, name, px, py, s, col, lw = 3.2, a = 1) {
    if (a <= 0.003) return;
    x.save(); x.translate(px, py); x.scale(s, s); x.globalAlpha *= a;
    x.strokeStyle = col; x.fillStyle = col; x.lineWidth = lw / s; x.lineCap = 'round'; x.lineJoin = 'round';
    ICON[name](x); x.restore();
  }

  // ---------- light-mode wipes ----------
  const lightR = (t) => 1180 * eio(prog(t, 16.18, 16.78));
  const darkR = (t) => 1180 * eio(prog(t, 19.82, 20.36));
  const WIPE_C = [540, 1000];
  // light coverage at a point (0 dark, 1 light), used for header colour
  function lightAt(px, py, t) {
    const d = Math.hypot(px - WIPE_C[0], py - WIPE_C[1]);
    const l = clamp((lightR(t) - d) / 40 + 0.5), k = clamp((darkR(t) - d) / 40 + 0.5);
    return l * (1 - k);
  }

  // ---------- background ----------
  function background(t) {
    const g = X.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#00041F'); g.addColorStop(0.25, '#00073A'); g.addColorStop(0.62, '#000B4D'); g.addColorStop(1, '#001374');
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    // the ramp continues below the frame: a soft royal-blue horizon
    const hz = X.createRadialGradient(540, H + 260, 0, 540, H + 260, 1100);
    hz.addColorStop(0, 'rgba(1,47,193,0.55)'); hz.addColorStop(0.5, 'rgba(0,29,158,0.18)'); hz.addColorStop(1, 'rgba(0,19,116,0)');
    X.fillStyle = hz; X.fillRect(0, 0, W, H);
    // slow royal nebula
    const nx = 540 + 120 * Math.sin(t * 0.21), ny = 980 + 160 * Math.cos(t * 0.17);
    const n = X.createRadialGradient(nx, ny, 0, nx, ny, 900);
    n.addColorStop(0, 'rgba(1,47,193,0.16)'); n.addColorStop(0.5, 'rgba(0,29,158,0.06)'); n.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = n; X.fillRect(0, 0, W, H);
    // dust
    for (let i = 0; i < 70; i++) {
      const sp = 6 + hash(i * 3.1) * 14;
      const px = (hash(i) * W + Math.sin(t * 0.2 + i) * 20 + W) % W;
      const py = ((hash(i * 7.7) * H - t * sp) % H + H) % H;
      const a = 0.05 + 0.12 * hash(i * 1.3) * (0.6 + 0.4 * Math.sin(t * (0.6 + hash(i) * 1.2) + i));
      X.fillStyle = `rgba(170,200,255,${a.toFixed(3)})`;
      circle(X, px, py, 0.8 + hash(i * 9.1) * 1.4); X.fill();
    }
  }
  function brandRamp(x, a = 1) {
    const g = x.createLinearGradient(0, 0, 0, H);
    for (const [o, c] of BRAND) g.addColorStop(o, c);
    x.save(); x.globalAlpha = a; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
  }
  function lightBackground(t) {
    brandRamp(X);
    const g = X.createRadialGradient(540, 1010, 0, 540, 1010, 620);
    g.addColorStop(0, 'rgba(150,197,248,0.28)'); g.addColorStop(1, 'rgba(150,197,248,0)');
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    const g2 = X.createRadialGradient(260 + 80 * Math.sin(t * 0.7), 700, 0, 260, 700, 560);
    g2.addColorStop(0, 'rgba(51,125,244,0.22)'); g2.addColorStop(1, 'rgba(51,125,244,0)');
    X.fillStyle = g2; X.fillRect(0, 0, W, H);
  }

  // ---------- header ----------
  function header(t) {
    const a = eoc(prog(t, 0.05, 0.9)) * (1 - eio(prog(t, 26.6, 27.1)));
    if (a <= 0.003) return;
    X.save();
    X.font = SANS(40, 300); X.textAlign = 'center';
    X.fillStyle = '#DCE8FF';
    X.globalAlpha = a * 0.8;
    X.fillText('Agentic systems aren’t just chatbots', 540, 232);
    X.restore();
  }

  // ======================================================================
  // S1 — chat bubble
  // ======================================================================
  function sChat(t) {
    if (t > 3.45) return;
    const cy = CY;
    // falling drop
    if (t < 0.36) {
      const a = eoc(prog(t, 0.08, 0.2));
      const y = lerp(820, cy, eic(prog(t, 0.12, 0.34)));
      glowDot(540, y, 7, C.cyan, a, 6);
    }
    // water ripples on landing
    for (let i = 0; i < 3; i++) {
      const p = prog(t, 0.34 + i * 0.12, 1.4 + i * 0.12);
      if (p <= 0 || p >= 1) continue;
      const rx = 30 + 260 * eoc(p), a = (1 - p) * 0.55;
      both((x) => { x.strokeStyle = rgba(C.cyan, a); x.lineWidth = 2; x.beginPath(); x.ellipse(540, cy + 6, rx, rx * 0.2, 0, 0, TAU); x.stroke(); }, 0.8);
    }
    // collapse progress
    const col = eic(prog(t, 3.0, 3.36));
    // bubble geometry
    const so = t - 0.78;
    if (so > 0) {
      let w = lerp(26, 520, spring(so, 1.5, 0.62)), h = lerp(26, 150, spring(so, 1.8, 0.6));
      if (t > 2.06) w += 90 * spring(t - 2.06, 1.6, 0.6);
      w = lerp(w, 22, col); h = lerp(h, 22, col);
      const bx = 540, by = cy;
      const tail = eoc(prog(t, 0.95, 1.25)) * (1 - col);
      const flash = t > 2.06 ? Math.exp(-(t - 2.06) / 0.35) : 0;
      // body
      X.save();
      const fg = X.createLinearGradient(bx, by - h / 2, bx, by + h / 2);
      fg.addColorStop(0, 'rgba(36,52,104,0.72)'); fg.addColorStop(1, 'rgba(14,20,44,0.78)');
      X.fillStyle = fg;
      rrect(X, bx, by, w, h, h / 2); X.fill();
      if (tail > 0) { X.beginPath(); X.moveTo(bx - w / 2 + h * 0.42, by + h / 2 - 2); X.lineTo(bx - w / 2 + h * 0.18 - 10 * tail, by + h / 2 + 26 * tail); X.lineTo(bx - w / 2 + h * 0.78, by + h / 2 - 2); X.closePath(); X.fill(); }
      X.restore();
      both((x, ga) => {
        x.lineWidth = 2;
        x.strokeStyle = strokeGrad(x, bx - w / 2, by, bx + w / 2, by, C.cyan, C.violet, 0.75 + 0.25 * flash);
        rrect(x, bx, by, w, h, h / 2); x.stroke();
      }, 0.55 + flash * 0.6);
      // top inner highlight
      X.strokeStyle = 'rgba(255,255,255,0.10)'; X.lineWidth = 1.5;
      rrect(X, 540, by + 1.5, w - 8, h - 6, h / 2); X.stroke();
      // typing dots
      const ta = eoc(prog(t, 0.95, 1.1)) * (1 - eoc(prog(t, 1.98, 2.1)));
      if (ta > 0) for (let i = 0; i < 3; i++) {
        let b = 0;
        for (const tp of [1.02, 1.56]) b += Math.exp(-Math.pow((t - (tp + i * 0.16)) / 0.075, 2));
        const dx = bx + (i - 1) * 40, dy = by - 16 * b;
        X.fillStyle = rgba('#DDE8FF', ta * (0.55 + 0.45 * b)); circle(X, dx, dy, 9); X.fill();
        G.fillStyle = rgba(C.cyan, ta * b * 0.9); circle(G, dx, dy, 12); G.fill();
      }
      // reply skeleton lines
      const l1 = eoc(prog(t, 2.08, 2.5)), l2 = eoc(prog(t, 2.18, 2.62));
      const la = 1 - eoc(prog(t, 2.92, 3.1));
      if (l1 > 0 && la > 0) {
        const x0 = bx - w / 2 + 56;
        X.fillStyle = rgba('#CFE0FF', 0.6 * la);
        rrect(X, x0 + 200 * l1, by - 22, 400 * l1, 18, 9); X.fill();
        X.fillStyle = rgba('#CFE0FF', 0.38 * la);
        rrect(X, x0 + 130 * l2, by + 22, 260 * l2, 18, 9); X.fill();
        // idle caret blinking — the bot is done, it waits
        const blink = Math.max(Math.exp(-Math.pow((t - 2.6) / 0.08, 4)), Math.exp(-Math.pow((t - 2.85) / 0.08, 4)));
        if (t > 2.5) { X.fillStyle = rgba(C.cyan, blink * la); X.fillRect(x0 + 272, by + 8, 4, 28); }
      }
      // collapsing seed dot
      if (col > 0) glowDot(540, cy, 9, C.cyan, col, 5 + 4 * col);
    }
    textLine([['A chatbot ', 's'], ['replies.', 'i']], 540, 740, 66, 1.05, 2.86, t);
  }

  // ======================================================================
  // S2 — goal target
  // ======================================================================
  const RINGS = [95, 175, 255];
  function sGoal(t) {
    if (t < 3.36 || t > 6.8) return;
    const cx = 540, cy = CY;
    const col = eic(prog(t, 6.0, 6.36));
    const fadeAux = 1 - eoc(prog(t, 5.92, 6.2));
    // flash at boom
    const fl = t >= 3.4 ? Math.exp(-(t - 3.4) / 0.45) : 0;
    if (fl > 0.01) {
      const g = X.createRadialGradient(cx, cy, 0, cx, cy, 520);
      g.addColorStop(0, rgba('#BFEFFF', 0.55 * fl)); g.addColorStop(0.3, rgba(C.cobalt, 0.22 * fl)); g.addColorStop(1, rgba(C.cobalt, 0));
      X.fillStyle = g; X.fillRect(0, 0, W, H);
      G.fillStyle = rgba('#FFFFFF', fl); circle(G, cx, cy, 40 + 60 * (1 - fl)); G.fill();
    }
    // rings
    RINGS.forEach((R, i) => {
      const r = R * spring(t - (3.42 + i * 0.09), 1.35, 0.62) * (1 - col);
      if (r <= 0.5) return;
      const a = (0.8 - i * 0.15) * (1 - col * 0.5);
      both((x) => {
        x.lineWidth = i === 0 ? 2.5 : 2;
        x.strokeStyle = strokeGrad(x, cx - r, cy - r, cx + r, cy + r, C.cyan, i === 2 ? C.violet : C.cobalt, a);
        if (i === 1) { x.setLineDash([r * 0.5, r * 0.18]); x.lineDashOffset = -t * 60; }
        circle(x, cx, cy, r); x.stroke(); x.setLineDash([]);
      }, 0.6);
    });
    // ticks on outer ring
    const ta = eoc(prog(t, 3.6, 4.0)) * fadeAux;
    if (ta > 0) {
      X.save(); X.translate(cx, cy); X.rotate(t * 0.12);
      for (let k = 0; k < 72; k++) {
        const big = k % 6 === 0, ang = k / 72 * TAU;
        const r0 = 272, r1 = r0 + (big ? 18 : 8);
        X.strokeStyle = rgba('#9FC4FF', ta * (big ? 0.55 : 0.25)); X.lineWidth = big ? 2 : 1.2;
        X.beginPath(); X.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0); X.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1); X.stroke();
      }
      X.restore();
    }
    // crosshair
    const ch = eoc(prog(t, 3.7, 4.15)) * fadeAux;
    if (ch > 0) both((x) => {
      x.strokeStyle = rgba(C.cyan, 0.55 * ch); x.lineWidth = 2;
      x.beginPath();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => { x.moveTo(cx + dx * 300, cy + dy * 300); x.lineTo(cx + dx * (300 + 70 * ch), cy + dy * (300 + 70 * ch)); });
      x.stroke();
    }, 0.5);
    // lock brackets
    const lockT = 5.28, lk = t >= lockT ? Math.exp(-(t - lockT) / 0.4) : 0;
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], k) => {
      const st = 4.66 + k * 0.1;
      const p = spring(t - st, 2.3, 0.55);
      const a = eoc(prog(t, st - 0.12, st + 0.05)) * fadeAux;
      if (a <= 0) return;
      const d = lerp(360, 150, p), L = 42;
      const px = cx + sx * d, py = cy + sy * d;
      both((x) => {
        x.strokeStyle = rgba(lk > 0.05 ? '#FFFFFF' : C.cyan, a * (0.8 + 0.2 * lk)); x.lineWidth = 3; x.lineCap = 'round';
        x.beginPath(); x.moveTo(px, py - sy * L); x.lineTo(px, py); x.lineTo(px - sx * L, py); x.stroke();
      }, 0.6 + lk);
    });
    // lock shockwave
    if (t > lockT && t < lockT + 0.9) {
      const p = prog(t, lockT, lockT + 0.9);
      both((x) => { x.strokeStyle = rgba('#CFF3FF', 0.7 * (1 - p)); x.lineWidth = 3 * (1 - p) + 0.5; circle(x, cx, cy, 14 + 220 * eoc(p)); x.stroke(); }, 0.8);
    }
    // core dot (moves up to plan goal at the end)
    const up = eio(prog(t, 6.38, 6.72));
    const py = lerp(cy, TL.PLAN_GOAL[1], up);
    const pulse = 1 + 0.15 * Math.sin(t * 5) + 0.6 * lk;
    glowDot(cx, py, 11 * pulse * (t < 3.4 ? 0.8 : 1), C.cyan, 1, 6);
    textLine([['An agent has a ', 's'], ['goal.', 'i']], 540, 1440, 66, 3.75, 5.9, t);
  }

  // ======================================================================
  // S3 + S4 — plan pills that become tool tiles
  // ======================================================================
  const TOOL_ICONS = ['search', 'code', 'db', 'globe', 'mail'];
  const toolPos = (k, t, rScale = 1) => {
    const a = TL.TOOL_ANG[k] + TL.toolSpin(t);
    return [CX + Math.cos(a) * TL.TOOL_R * rScale, CY + Math.sin(a) * TL.TOOL_R * rScale];
  };
  function sPlanTools(t) {
    if (t < 6.6 || t > 13.4) return;
    const P = TL.PLAN, drawn = TL.planDraw(t);
    const retract = eio(prog(t, 9.3, 9.7));
    // path
    if (drawn > 0 && retract < 1) {
      const i0 = Math.floor(retract * (P.pts.length - 1)), i1 = Math.floor(drawn * (P.pts.length - 1));
      if (i1 > i0) {
        both((x) => {
          x.lineWidth = 2.5; x.lineCap = 'round';
          const g = x.createLinearGradient(0, TL.PLAN_GOAL[1], 0, 1420);
          g.addColorStop(0, rgba(C.cyan, 0.85)); g.addColorStop(1, rgba(C.violet, 0.85));
          x.strokeStyle = g; x.beginPath();
          x.moveTo(...P.pts[i0]); for (let i = i0 + 1; i <= i1; i++) x.lineTo(...P.pts[i]); x.stroke();
        }, 0.6);
        if (drawn < 1) glowDot(...P.pts[i1], 6, C.cyan, 1, 6);
      }
    }
    // goal node -> core orb
    const toCore = eio(prog(t, 9.45, 9.98));
    const gx = 540, gy = lerp(TL.PLAN_GOAL[1], CY, toCore);
    const inS3 = t >= 6.7;
    if (inS3) {
      const gi = spring(t - 6.72, 2, 0.55);
      const ringA = (1 - toCore) * clamp(gi);
      both((x) => { x.strokeStyle = rgba(C.cyan, 0.7 * ringA); x.lineWidth = 2; circle(x, gx, gy, 34 * gi); x.stroke(); }, 0.5);
      // core orb grows in tools scene
      const coreR = lerp(11, 30, eoc(prog(t, 9.6, 10.2)));
      const spiralIn = eic(prog(t, 12.7, 13.22));
      const flash = t > 13.2 ? Math.exp(-(t - 13.2) / 0.12) : 0;
      const coreOut = 1 - eoc(prog(t, 13.24, 13.36));
      if (coreOut > 0) {
        if (toCore > 0.5) {
          const g = X.createRadialGradient(gx - coreR * 0.3, gy - coreR * 0.35, 0, gx, gy, coreR);
          g.addColorStop(0, '#FFFFFF'); g.addColorStop(0.35, '#9BE8FF'); g.addColorStop(1, '#1F5BFF');
          X.globalAlpha = coreOut; X.fillStyle = g; circle(X, gx, gy, coreR * (1 + 0.06 * Math.sin(t * 4))); X.fill(); X.globalAlpha = 1;
        }
        glowDot(gx, gy, (toCore > 0.5 ? coreR * 0.55 : 10) * (1 + spiralIn * 0.6 + flash), C.cyan, coreOut * (0.8 + 0.2 * Math.sin(t * 3)), 5);
      }
    }
    // spokes + orbit in tools scene
    const spA = eoc(prog(t, 10.5, 11.0)) * (1 - eoc(prog(t, 12.6, 12.85)));
    if (spA > 0) {
      X.save(); X.setLineDash([4, 10]); X.strokeStyle = rgba('#8FB4FF', 0.18 * spA); X.lineWidth = 1.5;
      circle(X, CX, CY, TL.TOOL_R); X.stroke(); X.restore();
      for (let k = 0; k < 5; k++) {
        const [tx, ty] = toolPos(k, t);
        X.strokeStyle = rgba('#8FB4FF', 0.16 * spA); X.lineWidth = 1.5;
        X.beginPath(); X.moveTo(CX, CY); X.lineTo(tx, ty); X.stroke();
        const p0 = TL.TOOL_PULSE[k], pp = prog(t, p0, p0 + TL.PULSE_DUR);
        if (pp > 0 && pp < 1) {
          const e = eios(pp), px = lerp(CX, tx, e), py = lerp(CY, ty, e);
          both((x) => {
            const g = x.createLinearGradient(lerp(CX, tx, Math.max(0, e - 0.35)), lerp(CY, ty, Math.max(0, e - 0.35)), px, py);
            g.addColorStop(0, rgba(C.cyan, 0)); g.addColorStop(1, rgba(C.cyan, 0.95));
            x.strokeStyle = g; x.lineWidth = 3; x.beginPath(); x.moveTo(lerp(CX, tx, Math.max(0, e - 0.35)), lerp(CY, ty, Math.max(0, e - 0.35))); x.lineTo(px, py); x.stroke();
          }, 0.8);
          glowDot(px, py, 5, C.cyan, 1, 5);
        }
      }
    }
    // pills / tiles
    const nodes = TL.PLAN_NODES;
    for (let k = 0; k < 5; k++) {
      let px, py, w, h, r, alpha, labelA, iconA, scale = 1, hi = 0, checked = 0;
      if (k < 4) {
        const reach = TL.PLAN.nodeFrac[k + 1];
        if (drawn < reach - 1e-4) continue;
        // time node was reached (approx via inverse search)
        let tr = 6.85; while (TL.planDraw(tr) < reach - 1e-4 && tr < 9) tr += 1 / 240;
        const sp = spring(t - tr, 2.0, 0.55);
        scale = lerp(0.55, 1, sp);
        alpha = clamp(sp * 1.6);
        checked = eoc(prog(t, 9.0 + k * 0.1, 9.14 + k * 0.1));
        const fs = 9.45 + k * 0.12, fe = 10.05 + k * 0.12, f = eio(prog(t, fs, fe));
        const [tx, ty] = toolPos(k, t);
        // curved flight: bend outwards
        const mx = lerp(nodes[k][0], tx, f), my = lerp(nodes[k][1], ty, f);
        const bend = Math.sin(f * Math.PI) * 90 * (k % 2 ? 1 : -1);
        px = mx + bend; py = my;
        w = lerp(300, 124, f); h = lerp(92, 124, f); r = lerp(46, 34, f);
        labelA = 1 - clamp(f * 2.5); iconA = clamp((f - 0.5) * 2);
        const land = spring(t - fe, 2.4, 0.45);
        if (f >= 1) scale = 1 + 0.08 * (1 - land) * Math.sin((t - fe) * 20) * Math.exp(-(t - fe) * 6);
      } else {
        const st = TL.TOOL_LAND[4] - 0.42;
        if (t < st) continue;
        const f = eoc(prog(t, st, TL.TOOL_LAND[4]));
        const [tx, ty] = toolPos(4, t);
        px = lerp(CX, tx, f); py = lerp(CY, ty, f);
        w = 124; h = 124; r = 34; labelA = 0; iconA = 1; alpha = clamp(f * 2); scale = lerp(0.3, 1, f);
      }
      // tools-scene pulse highlight
      const arr = TL.TOOL_PULSE[k] + TL.PULSE_DUR;
      if (t >= arr) hi = Math.exp(-(t - arr) / 0.45);
      // spiral into core
      const si = eic(prog(t, 12.7 + k * 0.03, 13.2 + k * 0.03));
      if (si > 0) {
        const a = TL.TOOL_ANG[k] + TL.toolSpin(t) + si * 1.6;
        const rr = TL.TOOL_R * (1 - si);
        px = CX + Math.cos(a) * rr; py = CY + Math.sin(a) * rr; scale *= 1 - si * 0.8; alpha *= 1 - eic(prog(si, 0.6, 1));
      }
      if (alpha <= 0.003) continue;
      X.save(); X.translate(px, py); X.scale(scale, scale); X.globalAlpha = alpha;
      const fg = X.createLinearGradient(0, -h / 2, 0, h / 2);
      fg.addColorStop(0, `rgba(${Math.round(lerp(34, 40, hi))},${Math.round(lerp(50, 90, hi))},${Math.round(lerp(100, 200, hi))},0.8)`);
      fg.addColorStop(1, 'rgba(12,18,40,0.85)');
      X.fillStyle = fg; rrect(X, 0, 0, w, h, r); X.fill();
      X.strokeStyle = strokeGrad(X, -w / 2, 0, w / 2, 0, C.cyan, C.violet, 0.6 + 0.4 * hi); X.lineWidth = 2; rrect(X, 0, 0, w, h, r); X.stroke();
      X.strokeStyle = 'rgba(255,255,255,0.09)'; X.lineWidth = 1.2; rrect(X, 0, 1.5, w - 6, h - 6, r); X.stroke();
      if (labelA > 0) {
        X.globalAlpha = alpha * labelA;
        // badge
        const bx = -w / 2 + 46;
        X.fillStyle = checked > 0 ? mix('#25335E', '#7FE0FF', checked) : '#25335E'; circle(X, bx, 0, 26); X.fill();
        if (checked > 0.02) icon(X, 'check', bx, 0, 34, '#06102A', 3.4, checked);
        X.fillStyle = rgba('#DDE8FF', 1 - checked); X.font = SANS(28, 400); X.textAlign = 'center'; X.textBaseline = 'middle';
        if (checked < 0.98) X.fillText(String(k + 1), bx, 1);
        X.textAlign = 'left'; X.fillStyle = 'rgba(236,242,255,0.95)'; X.font = SANS(36, 400);
        X.fillText(TL.PLAN_LABELS[k], bx + 44, 2);
      }
      if (iconA > 0) icon(X, TOOL_ICONS[k], 0, 0, 62, mix('#DDE8FF', '#FFFFFF', hi), 3.2, alpha * iconA);
      X.restore();
      // emissive rim
      G.save(); G.translate(px, py); G.scale(scale, scale); G.globalAlpha = alpha * (0.45 + 0.9 * hi);
      G.strokeStyle = strokeGrad(G, -w / 2, 0, w / 2, 0, C.cyan, C.violet, 1); G.lineWidth = 3; rrect(G, 0, 0, w, h, r); G.stroke();
      if (hi > 0.02) { G.globalAlpha = alpha * hi; icon(G, TOOL_ICONS[k], 0, 0, 62, C.cyan, 5, 1); }
      G.restore();
    }
    textLine([['It makes a ', 's'], ['plan.', 'i']], 540, 400, 66, 7.0, 9.25, t);
    textLine([['It uses ', 's'], ['tools.', 'i']], 540, 1460, 66, 10.45, 12.55, t);
  }

  // ======================================================================
  // S5 — memory cards
  // ======================================================================
  const CARDS = [
    { ic: 'user', tag: 'Preference', segs: [['Prefers ', 's'], ['concise ', 'i'], ['answers', 's']] },
    { ic: 'folder', tag: 'Context', segs: [['Project: Q4 ', 's'], ['launch', 'i']] },
    { ic: 'check', tag: 'Last action', segs: [['Drafted the ', 's'], ['email', 'i']] },
    { ic: 'db', tag: 'Tool result', segs: [['12 sources ', 's'], ['verified', 'i']] },
  ];
  function card(x, cd, w, h, glowOnly) {
    if (glowOnly) {
      const g = x.createLinearGradient(-w / 2, 0, w / 2, 0); g.addColorStop(0, '#125BEB'); g.addColorStop(1, '#569DF7');
      x.fillStyle = g; rrect(x, 0, 0, w, h, 30); x.fill(); return;
    }
    const g = x.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
    g.addColorStop(0, '#0B45D7'); g.addColorStop(0.55, '#125BEB'); g.addColorStop(1, '#4A92F6');
    x.fillStyle = g; rrect(x, 0, 0, w, h, 30); x.fill();
    const hl = x.createLinearGradient(0, -h / 2, 0, h / 2); hl.addColorStop(0, 'rgba(255,255,255,0.22)'); hl.addColorStop(0.45, 'rgba(255,255,255,0.02)'); hl.addColorStop(1, 'rgba(0,0,30,0.12)');
    x.fillStyle = hl; rrect(x, 0, 0, w, h, 30); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.28)'; x.lineWidth = 1.5; rrect(x, 0, 0, w - 2, h - 2, 29); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.16)'; circle(x, -w / 2 + 78, 0, 40); x.fill();
    icon(x, cd.ic, -w / 2 + 78, 0, 46, '#FFFFFF', 3);
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = SANS(25, 400); x.fillStyle = 'rgba(235,240,255,0.72)'; x.fillText(cd.tag.toUpperCase(), -w / 2 + 146, -18);
    segText(x, cd.segs, -w / 2 + 146, 30, 38, '#FFFFFF', '#E3F4FF');
  }
  function sMemory(t) {
    if (t < 13.25 || t > 16.4) return;
    const base = 1040, Wc = 660, Hc = 190;
    const comp = eic(prog(t, 15.7, 16.1));      // stack -> line
    const toDot = eic(prog(t, 16.05, 16.25));
    // order: back cards first
    const items = [];
    for (let i = 0; i < 4; i++) {
      const st = TL.CARD_IN[i];
      if (t < st) continue;
      let depth = 0;
      for (let j = i + 1; j < 4; j++) depth += clamp(spring(t - TL.CARD_IN[j], 1.6, 0.75));
      items.push({ i, depth, e: spring(t - st, 1.4, 0.72), a: eoc(prog(t, st, st + 0.25)) });
    }
    items.sort((a, b) => b.depth - a.depth);
    const geom = (it) => {
      const sc = Math.pow(0.9, it.depth) * lerp(1, 0.02, comp);
      const y = base - it.depth * 52 + (1 - it.e) * 560 + comp * it.depth * 52;
      const sy = sc * lerp(0.55, 1, clamp(it.e)) * lerp(1, 0.04, comp);
      return { sc, y, sy, a: it.a * (1 - toDot) };
    };
    // reflection of the settled front card, faded into the floor
    for (const it of items) {
      if (it.depth >= 0.5 || it.e < 0.6) continue;
      const g = geom(it), ry = g.y + Hc * g.sy + 16;
      TM.setTransform(1, 0, 0, 1, 0, 0); TM.globalCompositeOperation = 'source-over'; TM.globalAlpha = 1;
      TM.clearRect(0, ry - Hc, W, Hc * 2 + 20);
      TM.save(); TM.translate(540, ry); TM.scale(g.sc, -g.sy); card(TM, CARDS[it.i], Wc, Hc); TM.restore();
      const m = TM.createLinearGradient(0, ry - Hc * g.sy / 2, 0, ry + Hc * g.sy * 0.55);
      m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0)');
      TM.globalCompositeOperation = 'destination-in'; TM.fillStyle = m; TM.fillRect(0, ry - Hc, W, Hc * 2 + 20);
      TM.globalCompositeOperation = 'source-over';
      X.save(); X.globalAlpha = g.a * 0.16 * (1 - comp) * clamp((it.e - 0.6) * 2.5); X.drawImage(tmp, 0, 0); X.restore();
    }
    for (const it of items) {
      const g = geom(it);
      if (g.a <= 0.003) continue;
      X.save(); X.globalAlpha = g.a; X.translate(540, g.y); X.scale(g.sc, g.sy); card(X, CARDS[it.i], Wc, Hc);
      X.fillStyle = `rgba(4,8,22,${(0.2 * it.depth).toFixed(3)})`; rrect(X, 0, 0, Wc, Hc, 30); X.fill(); X.restore();
      G.save(); G.globalAlpha = g.a * 0.33 * (1 - 0.3 * it.depth); G.translate(540, g.y); G.scale(g.sc, g.sy); card(G, null, Wc, Hc, true); G.restore();
    }
    // collapse dot
    if (comp > 0.6) glowDot(540, lerp(base, 1000, toDot), 10, C.cyan, clamp((comp - 0.6) * 3) * (1 - eoc(prog(t, 16.6, 16.8))), 6 + 4 * toDot);
    textLine([['It ', 's'], ['remembers.', 'i']], 540, 700, 66, 13.65, 15.6, t);
  }

  // ======================================================================
  // S6 — loop (light mode)
  // ======================================================================
  const LOOP_LABELS = [['Act', 'bolt'], ['Observe', 'eye'], ['Adjust', 'sliders']];
  const LOOP_HITS = TL.EVENTS.filter((e) => e.type === 'bell' && e.node !== undefined);
  function sLoop(t) {
    const R = TL.LOOP_R, cy = TL.LOOP_CY;
    const shrink = eic(prog(t, 19.55, 19.92));
    const ringR = R * (1 - shrink);
    // ring draw-on
    const rd = eio(prog(t, 17.1, 17.75));
    if (rd > 0 && ringR > 1) {
      X.save(); X.lineWidth = 3; X.lineCap = 'round';
      const g = X.createLinearGradient(540 - R, cy - R, 540 + R, cy + R);
      g.addColorStop(0, 'rgba(234,242,255,0.55)'); g.addColorStop(1, 'rgba(234,242,255,0.35)');
      X.strokeStyle = g; X.beginPath(); X.arc(540, cy, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * rd); X.stroke();
      // arrowheads mid-arcs
      for (let n = 0; n < 3; n++) {
        const am = TL.LOOP_ANG[n] + Math.PI / 3, ap = clamp((rd * TAU - (am + Math.PI / 2)) / 0.3);
        if (ap <= 0) continue;
        const ax = 540 + Math.cos(am) * ringR, ay = cy + Math.sin(am) * ringR;
        X.save(); X.translate(ax, ay); X.rotate(am + Math.PI / 2); X.globalAlpha = ap * (1 - shrink);
        X.strokeStyle = 'rgba(234,242,255,0.65)'; X.lineWidth = 3; X.beginPath(); X.moveTo(-9, -9); X.lineTo(0, 0); X.lineTo(-9, 9); X.stroke(); X.restore();
      }
      X.restore();
    }
    // spark + trail
    const sparkA = eoc(prog(t, 17.7, 17.9)) * (1 - eoc(prog(t, 20.1, 20.3)));
    let sx = 540, sy = cy - ringR;
    if (sparkA > 0) {
      const th = TL.loopTheta(t);
      const rr = ringR;
      sx = 540 + Math.cos(th) * rr; sy = cy + Math.sin(th) * rr;
      const N = 26, span = 1.1 * clamp((t - 17.85) / 0.3) * (1 - shrink);
      for (let i = N; i >= 1; i--) {
        const a0 = th - span * (i / N), a1 = th - span * ((i - 1) / N);
        X.strokeStyle = `rgba(214,234,255,${(0.8 * (1 - i / N) * sparkA).toFixed(3)})`; X.lineWidth = 6 * (1 - i / N) + 1; X.lineCap = 'round';
        X.beginPath(); X.arc(540, cy, rr, a0, a1); X.stroke();
      }
      const g = X.createRadialGradient(sx, sy, 0, sx, sy, 60);
      g.addColorStop(0, `rgba(255,255,255,${sparkA})`); g.addColorStop(0.18, `rgba(190,224,255,${0.8 * sparkA})`); g.addColorStop(1, 'rgba(150,197,248,0)');
      X.fillStyle = g; circle(X, sx, sy, 60); X.fill();
      X.fillStyle = `rgba(255,255,255,${sparkA})`; circle(X, sx, sy, 6); X.fill();
      G.fillStyle = `rgba(200,230,255,${sparkA})`; circle(G, sx, sy, 16); G.fill();
    }
    // pills
    for (let n = 0; n < 3; n++) {
      const st = TL.LOOP_PILL_IN[n];
      if (t < st) continue;
      const sp = spring(t - st, 2.0, 0.55);
      const ang = TL.LOOP_ANG[n];
      const px = 540 + Math.cos(ang) * ringR, py = cy + Math.sin(ang) * ringR;
      let h = 0;
      for (const e of LOOP_HITS) if (e.node === n && t >= e.t) h = Math.max(h, Math.exp(-(t - e.t) / 0.42));
      const s = lerp(0.6, 1, sp) * (1 + 0.07 * h) * (1 - shrink);
      const a = clamp(sp * 1.5) * (1 - eoc(prog(shrink, 0.5, 1)));
      if (a <= 0.003) continue;
      const [label, ic] = LOOP_LABELS[n];
      X.save(); X.translate(px, py); X.scale(s, s); X.globalAlpha = a;
      X.font = SANS(36, 400);
      const tw = X.measureText(label).width, pw = tw + 128, ph = 86;
      X.shadowColor = `rgba(0,7,58,${0.35 + 0.2 * h})`; X.shadowBlur = 40 + 30 * h; X.shadowOffsetY = 14;
      X.fillStyle = C.ink; rrect(X, 0, 0, pw, ph, ph / 2); X.fill();
      X.shadowColor = 'transparent';
      if (h > 0.01) {
        const g = X.createLinearGradient(-pw / 2, 0, pw / 2, 0); g.addColorStop(0, `rgba(18,91,235,${h})`); g.addColorStop(1, `rgba(124,183,249,${h})`);
        X.fillStyle = g; rrect(X, 0, 0, pw, ph, ph / 2); X.fill();
      }
      X.strokeStyle = `rgba(255,255,255,${0.14 + 0.5 * h})`; X.lineWidth = 1.5; rrect(X, 0, 1, pw - 4, ph - 4, ph / 2); X.stroke();
      icon(X, ic, -pw / 2 + 50, 0, 40, mix('#7CB7F9', '#FFFFFF', h), 3.2);
      X.fillStyle = '#F2F5FF'; X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillText(label, -pw / 2 + 84, 2);
      X.restore();
    }
    textLine([['Then it ', 's'], ['loops.', 'i']], 540, cy + 24, 64, 17.35, 19.45, t);
    return [sx, sy];
  }

  // ======================================================================
  // S7 — collaborating agents  (+ metaball handoff)
  // ======================================================================
  const NODE_COL = [C.cyan, C.cobalt, C.violet, C.cyan, C.cobalt, C.violet, '#FFFFFF'];
  function netPos(i, t) {
    const [nx, ny] = TL.NET[i];
    const sp = spring(t - TL.netOut(i), 1.5, 0.62);
    const conv = eio(prog(t, 23.15 + i * 0.02, 23.72));
    let x = lerp(540, nx, sp) + 7 * Math.sin(t * 0.9 + i * 1.7);
    let y = lerp(CY, ny, sp) + 7 * Math.cos(t * 0.8 + i * 2.3);
    x = lerp(x, TL.BLOB_C[0], conv); y = lerp(y, TL.BLOB_C[1], conv);
    return [x, y];
  }
  function sCollab(t) {
    if (t < 19.8 || t > 23.9) return;
    const conv = eio(prog(t, 23.15, 23.72));
    const vecA = 1 - eoc(prog(t, 23.28, 23.5));
    // edges
    TL.NET_EDGES.forEach(([a, b], e) => {
      const d = eio(prog(t, 20.6 + e * 0.04, 21.15 + e * 0.04));
      if (d <= 0) return;
      const [ax, ay] = netPos(a, t), [bx, by] = netPos(b, t);
      const al = (b === 6 || a === 6 ? 0.22 : 0.32) * (1 - eoc(prog(t, 23.1, 23.35)));
      X.strokeStyle = strokeGrad(X, ax, ay, bx, by, NODE_COL[a] === '#FFFFFF' ? C.cyan : NODE_COL[a], NODE_COL[b] === '#FFFFFF' ? C.cyan : NODE_COL[b], al);
      X.lineWidth = 1.6; X.beginPath(); X.moveTo(ax, ay); X.lineTo(lerp(ax, bx, d), lerp(ay, by, d)); X.stroke();
    });
    // signals
    for (const [e, t0, rev] of TL.NET_SIG) {
      const p = prog(t, t0, t0 + TL.SIG_DUR);
      if (p <= 0 || p >= 1) continue;
      let [a, b] = TL.NET_EDGES[e]; if (rev) [a, b] = [b, a];
      const [ax, ay] = netPos(a, t), [bx, by] = netPos(b, t), u = eios(p);
      const px = lerp(ax, bx, u), py = lerp(ay, by, u), tu = Math.max(0, u - 0.25);
      both((x) => {
        const g = x.createLinearGradient(lerp(ax, bx, tu), lerp(ay, by, tu), px, py);
        g.addColorStop(0, rgba(C.cyan, 0)); g.addColorStop(1, rgba(C.cyan, 0.9));
        x.strokeStyle = g; x.lineWidth = 3; x.beginPath(); x.moveTo(lerp(ax, bx, tu), lerp(ay, by, tu)); x.lineTo(px, py); x.stroke();
      }, 0.8);
      glowDot(px, py, 5, C.cyan, 1, 5);
    }
    // nodes
    if (vecA > 0) for (let i = 0; i < 7; i++) {
      if (t < TL.netOut(i) - 0.02 && i !== 6) continue;
      const [x, y] = netPos(i, t);
      let pulse = 0;
      for (const [e, t0, rev] of TL.NET_SIG) {
        const [a, b] = TL.NET_EDGES[e]; const to = rev ? a : b; const ta = t0 + TL.SIG_DUR;
        if (to === i && t >= ta) pulse = Math.max(pulse, Math.exp(-(t - ta) / 0.4));
      }
      const col = NODE_COL[i] === '#FFFFFF' ? C.cyan : NODE_COL[i];
      const rA = eoc(prog(t, TL.netOut(i) + 0.1, TL.netOut(i) + 0.5)) * vecA * (1 - conv);
      both((g) => { g.strokeStyle = rgba(col, 0.6 * rA); g.lineWidth = 2; circle(g, x, y, 26 + 3 * Math.sin(t * 2 + i)); g.stroke(); }, 0.5);
      if (pulse > 0.02) both((g) => { g.strokeStyle = rgba(col, 0.8 * pulse * vecA); g.lineWidth = 2; circle(g, x, y, 26 + 46 * (1 - pulse)); g.stroke(); }, 0.8);
      glowDot(x, y, (i === 6 ? 12 : 9) * (1 + 0.5 * pulse), col, vecA * (t < 20.25 ? clamp((t - 19.9) * 4) : 1), 5);
    }
    textLine([['Agents ', 's'], ['collaborate.', 'i']], 540, 1480, 66, 20.75, 23.05, t);
  }

  // ======================================================================
  // S8 — liquid system (metaballs, shaded per pixel at half res)
  // ======================================================================
  function blobBalls(t) {
    const balls = [];
    const [bx, by] = TL.BLOB_C;
    // converging agent nodes become droplets
    if (t < 24.3) {
      for (let i = 0; i < 7; i++) {
        const [x, y] = netPos(i, t);
        const r = lerp(18, 54, eoc(prog(t, 23.2, 23.8))) * (1 - eoc(prog(t, 23.9, 24.3)));
        if (r > 0.5) balls.push([x, y, r]);
      }
    }
    const fin = eio(prog(t, 26.25, 26.8));
    const mainR = lerp(0, 150, eoc(prog(t, 23.45, 24.05))) * (1 + 0.04 * Math.sin(t * 2.1)) * lerp(1, 1.12, fin);
    if (mainR > 0.5) balls.push([bx + 10 * Math.sin(t * 1.3) * (1 - fin), by + 8 * Math.cos(t * 1.1) * (1 - fin), mainR]);
    for (const s of TL.BLOB_SATS) {
      const f = TL.satOut(s, t) * (1 - fin);
      const a = s.a + s.w * (t - 24);
      const d = 40 + 220 * f;
      const r = s.r * clamp((t - s.keys[0][0]) / 0.35) * lerp(1, 0.0, fin * 0.9);
      if (r > 0.5) balls.push([bx + Math.cos(a) * d, by + Math.sin(a) * d * 0.9, r]);
    }
    return balls;
  }
  function renderBlob(t, alpha) {
    const balls = blobBalls(t);
    if (!balls.length || alpha <= 0.003) return;
    const w = W / 2, h = H / 2, D = blobImg.data;
    D.fill(0);
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    const bs = balls.map(([x, y, r]) => [x / 2, y / 2, (r / 2) * (r / 2)]);
    for (const [x, y, r2] of bs) { const r = Math.sqrt(r2) * 1.9 + 40; x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); }
    x0 = Math.max(1, Math.floor(x0)); y0 = Math.max(1, Math.floor(y0)); x1 = Math.min(w - 2, Math.ceil(x1)); y1 = Math.min(h - 2, Math.ceil(y1));
    const bw = x1 - x0 + 3, bh = y1 - y0 + 3;
    const F = new Float32Array(bw * bh);
    for (let yy = 0; yy < bh; yy++) for (let xx = 0; xx < bw; xx++) {
      const px = x0 - 1 + xx, py = y0 - 1 + yy; let f = 0;
      for (const [bx, by, r2] of bs) { const dx = px - bx, dy = py - by; f += r2 / (dx * dx + dy * dy + 1e-3); }
      F[yy * bw + xx] = f;
    }
    // inflated-surface height: blurred coverage mask (one smooth pillow, no per-ball bumps)
    const M = new Float32Array(bw * bh), T2 = new Float32Array(bw * bh);
    for (let i = 0; i < M.length; i++) M[i] = clamp((F[i] - 0.9) / 0.2);
    const boxBlur = (src, dst, r, horiz) => {
      const n = horiz ? bw : bh, m = horiz ? bh : bw, inv = 1 / (2 * r + 1);
      for (let j = 0; j < m; j++) {
        let acc = 0; const idx = (i) => horiz ? j * bw + Math.min(n - 1, Math.max(0, i)) : Math.min(n - 1, Math.max(0, i)) * bw + j;
        for (let i = -r; i <= r; i++) acc += src[idx(i)];
        for (let i = 0; i < n; i++) { dst[horiz ? j * bw + i : i * bw + j] = acc * inv; acc += src[idx(i + r + 1)] - src[idx(i - r)]; }
      }
    };
    const Hm = new Float32Array(bw * bh); Hm.set(M);
    for (let it = 0; it < 3; it++) { boxBlur(Hm, T2, 14, true); boxBlur(T2, Hm, 14, false); }
    const Lx = -0.45, Ly = -0.62, Lz = 0.64;
    const Hx = Lx, Hy = Ly, Hz = Lz + 1, hn = Math.hypot(Hx, Hy, Hz);
    const [cx, cy] = [TL.BLOB_C[0] / 2, TL.BLOB_C[1] / 2];
    for (let yy = 1; yy < bh - 1; yy++) for (let xx = 1; xx < bw - 1; xx++) {
      const a = M[yy * bw + xx];
      if (a <= 0) continue;
      const hz = Hm[yy * bw + xx];
      const gx = (Hm[yy * bw + xx + 1] - Hm[yy * bw + xx - 1]) * 0.5 * 44;
      const gy = (Hm[(yy + 1) * bw + xx] - Hm[(yy - 1) * bw + xx]) * 0.5 * 44;
      let nx = -gx, ny = -gy, nz = 1; const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const dif = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
      const spec = 0.75 * Math.pow(Math.max(0, (nx * Hx + ny * Hy + nz * Hz) / hn), 24);
      const rim = Math.pow(1 - nz, 2.2);
      const px = x0 - 1 + xx, py = y0 - 1 + yy;
      const u = clamp(((px - cx) * 0.6 + (py - cy)) / 360 + 0.5);
      // base gradient cyan -> cobalt -> violet
      let r, g, b;
      if (u < 0.5) { const k = u / 0.5; r = lerp(150, 18, k); g = lerp(197, 91, k); b = lerp(248, 235, k); }
      else { const k = (u - 0.5) / 0.5; r = lerp(18, 1, k); g = lerp(91, 47, k); b = lerp(235, 193, k); }
      const sh = 0.32 + 0.78 * dif;
      const inner = 0.25 * Math.pow(hz, 3);
      r = r * sh + 110 * rim + 255 * spec * 0.85 + 60 * inner;
      g = g * sh + 180 * rim + 255 * spec * 0.85 + 90 * inner;
      b = b * sh + 255 * rim + 255 * spec * 0.85 + 120 * inner;
      const o = (py * w + px) * 4;
      D[o] = Math.min(255, r); D[o + 1] = Math.min(255, g); D[o + 2] = Math.min(255, b); D[o + 3] = 255 * a * alpha;
    }
    BL.clearRect(0, 0, w, h);
    BL.putImageData(blobImg, 0, 0, x0 - 1, y0 - 1, bw, bh);
    X.save(); X.imageSmoothingQuality = 'high'; X.drawImage(blobC, 0, 0, W, H); X.restore();
    G.save(); G.globalAlpha = 0.55; G.drawImage(blobC, 0, 0, W, H); G.restore();
  }
  function sSystem(t) {
    if (t < 23.2 || t > 27.05) return;
    const a = eoc(prog(t, 23.22, 23.45)) * (1 - eoc(prog(t, 26.82, 26.98)));
    renderBlob(t, a);
    textLine([['Not a chat.', 's']], 540, 1420, 66, 23.95, 26.25, t);
    textLine([['A ', 's'], ['system.', 'i']], 540, 1515, 66, 24.4, 26.3, t);
  }

  // ======================================================================
  // S9 — morph to logo, end card
  // ======================================================================
  const LOGO_H = 360, LOGO_C = [540, 900];
  const LP = LOGO.pts.map(([x, y]) => [LOGO_C[0] + x * LOGO_H, LOGO_C[1] + y * LOGO_H]);
  const NL = LP.length;
  let area = 0; for (let i = 0; i < NL; i++) { const [a, b] = LP[i], [c, d] = LP[(i + 1) % NL]; area += a * d - c * b; }
  const dir = Math.sign(area);
  const ang0 = Math.atan2(LP[0][1] - LOGO_C[1], LP[0][0] - LOGO_C[0]);
  function morphPts(k, cx, cy, R) {
    return LP.map(([x, y], i) => {
      const a = ang0 + dir * TAU * i / NL;
      return [lerp(cx + Math.cos(a) * R, x, k), lerp(cy + Math.sin(a) * R, y, k)];
    });
  }
  function pathPts(x, pts) { x.beginPath(); x.moveTo(...pts[0]); for (let i = 1; i < pts.length; i++) x.lineTo(...pts[i]); x.closePath(); }
  function sEnd(t) {
    if (t < 26.8) return;
    const m = eio(prog(t, 26.86, 27.42));
    const cxy = [lerp(TL.BLOB_C[0], LOGO_C[0], m), lerp(TL.BLOB_C[1], LOGO_C[1], m)];
    const R0 = 168 * lerp(1, 0.9, eic(prog(t, 26.8, 26.95)));
    const pts = morphPts(m, TL.BLOB_C[0], lerp(TL.BLOB_C[1], LOGO_C[1], 0), R0);
    const appear = eoc(prog(t, 26.82, 26.96));
    // flash at 27.0
    const fl = t >= 27.0 ? Math.exp(-(t - 27.0) / 0.5) : 0;
    if (fl > 0.01) {
      const g = X.createRadialGradient(540, 900, 0, 540, 900, 700);
      g.addColorStop(0, rgba('#9FD2FF', 0.45 * fl)); g.addColorStop(0.35, rgba(C.logo, 0.2 * fl)); g.addColorStop(1, rgba(C.logo, 0));
      X.fillStyle = g; X.fillRect(0, 0, W, H);
    }
    // sunrise into the brand ramp
    const sr = eio(prog(t, 27.05, 28.3));
    if (sr > 0) {
      // ramp rises from the bottom with a 600px feathered edge
      TM.setTransform(1, 0, 0, 1, 0, 0); TM.globalCompositeOperation = 'source-over'; TM.globalAlpha = 1;
      TM.clearRect(0, 0, W, H); brandRamp(TM);
      const edge = lerp(H + 600, -600, sr);
      const mk = TM.createLinearGradient(0, edge - 600, 0, edge);
      mk.addColorStop(0, 'rgba(0,0,0,0)'); mk.addColorStop(1, 'rgba(0,0,0,1)');
      TM.globalCompositeOperation = 'destination-in'; TM.fillStyle = mk; TM.fillRect(0, 0, W, H);
      TM.globalCompositeOperation = 'source-over';
      X.drawImage(tmp, 0, 0);
    }
    // horizon line
    const hz = eoc(prog(t, 28.25, 29.1));
    if (hz > 0) {
      const y = 1480, hw = 420 * hz;
      both((x) => {
        const g = x.createLinearGradient(540 - hw, 0, 540 + hw, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(540 - hw, y - 1, hw * 2, 2);
      }, 0.9);
      const gl = X.createRadialGradient(540, 1480, 0, 540, 1480, 380);
      gl.addColorStop(0, `rgba(214,234,255,${0.22 * hz})`); gl.addColorStop(1, 'rgba(214,234,255,0)');
      X.save(); X.translate(0, 1480); X.scale(1, 0.25); X.translate(0, -1480); X.fillStyle = gl; X.fillRect(0, 1100, W, 760); X.restore();
    }
    // ring
    const rg = eio(prog(t, 27.55, 28.4));
    if (rg > 0) both((x) => {
      x.strokeStyle = strokeGrad(x, 240, 600, 840, 1200, '#FFFFFF', '#D6EAFF', 0.4); x.lineWidth = 1.6;
      x.beginPath(); x.arc(540, 900, 292, -Math.PI / 2, -Math.PI / 2 + TAU * rg); x.stroke();
    }, 0.5);
    // logo body
    X.save(); X.globalAlpha = appear;
    const wm = eio(prog(t, 27.2, 28.1));   // mark turns white as the ramp rises
    const lg = X.createLinearGradient(540 - 150, 900 - 190, 540 + 150, 900 + 190);
    lg.addColorStop(0, mix(mix('#96C5F8', '#3F7BFF', m), '#FFFFFF', wm)); lg.addColorStop(0.5, mix(mix('#125BEB', '#0A56FF', m), '#FFFFFF', wm)); lg.addColorStop(1, mix(mix('#012FC1', '#0046E8', m), '#EAF3FF', wm));
    X.shadowColor = `rgba(0,7,58,${0.35 * wm})`; X.shadowBlur = 50; X.shadowOffsetY = 18;
    X.fillStyle = lg; pathPts(X, pts); X.fill();
    X.shadowColor = 'transparent';
    // soft inner sheen
    const sh = X.createLinearGradient(0, 720, 0, 1080);
    sh.addColorStop(0, `rgba(255,255,255,${0.16 * (1 - wm)})`); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, `rgba(0,0,40,${0.12 * (1 - wm) + 0.04})`);
    X.fillStyle = sh; X.fill();
    if (m < 1) { // keep the blob's glossy read while it is still round
      const gs = X.createRadialGradient(540 - 60, 960 - 70, 0, 540, 960, 200);
      gs.addColorStop(0, `rgba(220,238,255,${0.75 * (1 - m)})`); gs.addColorStop(0.45, `rgba(124,183,249,${0.35 * (1 - m)})`); gs.addColorStop(1, 'rgba(18,91,235,0)');
      X.fillStyle = gs; X.fill();
    }
    X.restore();
    G.save(); G.globalAlpha = appear * (0.3 * (1 - wm) + 0.6 * fl); G.fillStyle = C.logo; pathPts(G, pts); G.fill(); G.restore();
    // energy trace around the mark
    const tr = prog(t, 27.0, 28.0);
    if (tr > 0 && tr < 1) {
      const head = Math.floor(eio(tr) * NL * 1.0), tail = 140;
      for (const x of [X, G]) {
        x.save(); x.lineCap = 'round'; x.lineJoin = 'round';
        for (let s = 0; s < tail; s += 4) {
          const i0 = head - s - 4, i1 = head - s;
          if (i1 < 0) break;
          const a = (1 - s / tail) * (1 - eic(prog(tr, 0.85, 1)));
          x.strokeStyle = `rgba(200,235,255,${a.toFixed(3)})`; x.lineWidth = 3.5 * (1 - s / tail) + 0.8;
          x.beginPath(); x.moveTo(...LP[(Math.max(0, i0) + NL) % NL]);
          for (let i = Math.max(0, i0) + 1; i <= i1; i++) x.lineTo(...LP[i % NL]);
          x.stroke();
        }
        x.restore();
      }
      glowDot(...LP[head % NL], 7, C.cyan, 1 - eic(prog(tr, 0.85, 1)), 6);
    }
    // wordmark
    const wa = t - 28.05;
    if (wa > 0) {
      const txt = 'SORA SYSTEMS';
      X.save(); X.font = SANS(60, 400); X.letterSpacing = '17px'; X.textBaseline = 'alphabetic';
      const chars = [...txt]; const widths = chars.map((c) => X.measureText(c).width);
      const total = widths.reduce((a, b) => a + b, 0) - 17;
      let px = 540 - total / 2;
      chars.forEach((c, i) => {
        const dc = Math.abs(i - (chars.length - 1) / 2);
        const e = eoc(prog(wa, dc * 0.045, dc * 0.045 + 0.7));
        if (e > 0.003) {
          X.globalAlpha = e; const bl = (1 - e) * 10; X.filter = bl > 0.3 ? `blur(${bl.toFixed(1)}px)` : 'none';
          X.shadowColor = 'rgba(0,7,58,0.25)'; X.shadowBlur = 24; X.shadowOffsetY = 6;
          X.fillStyle = '#FFFFFF'; X.fillText(c, px, 1300 + (1 - e) * 16);
        }
        px += widths[i];
      });
      X.restore();
    }
    textLine([['business@sorasystems.tech', 's']], 540, 1378, 38, 28.5, 99, t, { alpha: 0.9, stagger: 0, wt: 400 });
  }

  // ======================================================================
  // compose one sample
  // ======================================================================
  function drawSample(t) {
    X.setTransform(1, 0, 0, 1, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.filter = 'none';
    G.setTransform(1, 0, 0, 1, 0, 0); G.globalCompositeOperation = 'source-over'; G.fillStyle = '#000'; G.fillRect(0, 0, W / 2, H / 2);
    G.setTransform(0.5, 0, 0, 0.5, 0, 0);
    background(t);
    sChat(t); sGoal(t); sPlanTools(t); sMemory(t);
    // light mode
    const lr = lightR(t), dr = darkR(t);
    if (lr > 0 && dr < 1180) {
      X.save(); X.beginPath(); X.arc(...WIPE_C, lr, 0, TAU);
      if (dr > 0) X.arc(...WIPE_C, dr, 0, TAU, true);
      X.clip();
      lightBackground(t);
      // hide glow layer inside the light area
      G.save(); G.beginPath(); G.arc(...WIPE_C, lr, 0, TAU); if (dr > 0) G.arc(...WIPE_C, dr, 0, TAU, true); G.fillStyle = '#000'; G.fill(); G.clip(); G.globalAlpha = 0.45;
      sLoop(t);
      G.restore();
      X.restore();
      // glowing wipe edges
      if (lr < 1180) both((x) => { x.strokeStyle = rgba('#96C5F8', 0.6 * (1 - lr / 1180)); x.lineWidth = 3; circle(x, ...WIPE_C, lr); x.stroke(); }, 1);
      if (dr > 0 && dr < 1180) both((x) => { x.strokeStyle = rgba('#96C5F8', 0.6 * (1 - dr / 1180)); x.lineWidth = 3; circle(x, ...WIPE_C, dr); x.stroke(); }, 1);
    }
    // spark that carries the dark wipe
    if (t > 19.6 && t < 20.4) {
      const k = eio(prog(t, 19.6, 19.95));
      const p = (19.6 <= t) ? [540, lerp(TL.LOOP_CY - TL.LOOP_R * 0, CY, 1)] : [540, CY];
      const th = TL.loopTheta(t), rr = TL.LOOP_R * (1 - eic(prog(t, 19.55, 19.92)));
      const sx = lerp(540 + Math.cos(th) * rr, 540, k), sy = lerp(TL.LOOP_CY + Math.sin(th) * rr, CY, k);
      glowDot(sx, sy, 10, C.cyan, eoc(prog(t, 19.75, 19.95)), 6);
    }
    sCollab(t); sSystem(t); sEnd(t);
    header(t);
    // bloom
    B1.filter = 'blur(2px)'; B1.clearRect(0, 0, 270, 480); B1.drawImage(glow, 0, 0, 270, 480);
    B2.filter = 'blur(3px)'; B2.clearRect(0, 0, 135, 240); B2.drawImage(b1, 0, 0, 135, 240);
    B3.filter = 'blur(3px)'; B3.clearRect(0, 0, 68, 120); B3.drawImage(b2, 0, 0, 68, 120);
    X.save(); X.setTransform(1, 0, 0, 1, 0, 0); X.globalCompositeOperation = 'lighter'; X.imageSmoothingQuality = 'high';
    X.globalAlpha = 0.28; X.drawImage(glow, 0, 0, W, H);
    X.globalAlpha = 0.55; X.drawImage(b1, 0, 0, W, H);
    X.globalAlpha = 0.6; X.drawImage(b2, 0, 0, W, H);
    X.globalAlpha = 0.65; X.drawImage(b3, 0, 0, W, H);
    X.restore();
    // vignette
    const v = X.createRadialGradient(540, 960, 500, 540, 960, 1250);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,4,31,0.32)');
    X.fillStyle = v; X.fillRect(0, 0, W, H);
  }

  // fast-motion windows get sub-frame motion blur
  const FAST = [[6.36, 6.76], [9.4, 10.6], [12.65, 13.32], [13.45, 15.0], [15.68, 16.3], [17.8, 20.0], [20.22, 20.8], [21.1, 23.45], [23.1, 23.8], [26.8, 28.05]];
  function samplesAt(t) { for (const [a, b] of FAST) if (t >= a && t <= b) return 6; return 1; }

  window.render = function (t) {
    const n = samplesAt(t), shutter = 0.5 / TL.FPS;
    if (n === 1) { drawSample(t); octx.globalAlpha = 1; octx.drawImage(scene, 0, 0); return; }
    for (let i = 0; i < n; i++) {
      drawSample(t + shutter * ((i + 0.5) / n - 0.5));
      octx.globalAlpha = 1 / (i + 1); octx.drawImage(scene, 0, 0);
    }
    octx.globalAlpha = 1;
  };
})();
