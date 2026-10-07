// SORA SYSTEMS spec ad — deterministic canvas renderer. window.render(t) draws the frame at t.
/* global TL, MARK_D */
(function () {
  const { T, CARDS, FOCUS_CARD, clamp, lerp, prog, eoc, eoq, eic, eio, eios, eoe, spring, hash } = TL;
  const TAU = Math.PI * 2;
  const FMT = new URLSearchParams(location.search).get('fmt') || '169';
  const V = FMT === '916';
  const W = V ? 1080 : 1920, H = V ? 1920 : 1080;
  const SS = +(new URLSearchParams(location.search).get('ss') || 1);   // 2 = 4K

  // ---------- layout ----------
  const L = V ? {
    cardW: 450, cards: [[300, 720], [780, 720], [300, 1320], [780, 1320]], clockY: 330, clockLift: 0,
    stackC: [540, 900], stackS: 1.45, btnY: 1420, introMarkH: 120, splitMarkH: 70, zoomMax: 1.68,
    markH: 130, lockCY: 900, lockMaxW: 940, lineY: 900, ctaGap: 110,
  } : {
    cardW: 380, cards: [[330, 560], [750, 560], [1170, 560], [1590, 560]], clockY: 200, clockLift: 95,
    stackC: [960, 525], stackS: 1.15, btnY: 880, introMarkH: 110, splitMarkH: 64, zoomMax: 3.3,
    markH: 215, lockCY: 505, lockMaxW: 1500, lineY: 500, ctaGap: 120,
  };
  { // lockup from the reference: mark 331 tall, mark bottom 220 above baseline, slogan 57 below (units of 1042 = wordmark width)
    const f = L.wordW / 1042;
    L.wordBase = Math.round(L.lockCY + 243 * f); L.lockMarkH = 331 * f;
    L.lockMarkC = [W / 2, L.wordBase - 220 * f - L.lockMarkH / 2]; L.sloganY = Math.round(L.wordBase + 58 * f); L.sloganW = 344 * f;
  }
  const CS = L.cardW / 380;            // card content scale (base card = 380 x 470)
  const CW = 380, CH = 470;
  const CX0 = W / 2, CY0 = H / 2;

  // ---------- colour ----------
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const rgba = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
  const C = { brand: '#0030FD', royal: '#0B45D7', sky: '#7CB7F9', pale: '#9CC2FF', ice: '#EEF2FA', green: '#5BD69A' };

  // ---------- canvases ----------
  const out = document.getElementById('c'); out.width = W * SS; out.height = H * SS;
  const octx = out.getContext('2d');
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const scene = mk(W * SS, H * SS), X = scene.getContext('2d');
  const glow = mk(W / 2, H / 2), G = glow.getContext('2d');
  const b1 = mk(W / 8, H / 8), B1 = b1.getContext('2d');
  const b2 = mk(W / 16, H / 16), B2 = b2.getContext('2d');
  const b3 = mk(Math.round(W / 32), Math.round(H / 32)), B3 = b3.getContext('2d');
  const cardCv = CARDS.map(() => mk(Math.ceil(1400 * SS), Math.ceil(1720 * SS)));
    const MARK = new Path2D(MARK_D);
  const MARK_BOX = { x: 265.09, y: 145.52, w: 547.27, h: 788.96 };

  // ---------- helpers ----------
  const circle = (x, px, py, r) => { x.beginPath(); x.arc(px, py, Math.max(0, r), 0, TAU); };
  const rrect = (x, px, py, w, h, r) => { x.beginPath(); x.roundRect(px, py, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); };
  function drawMark(x, cx, cy, h, fill, alpha = 1) {
    if (alpha <= 0.002 || h <= 0.5) return;
    const s = h / MARK_BOX.h;
    x.save(); x.globalAlpha *= alpha; x.translate(cx, cy); x.scale(s, s);
    x.translate(-(MARK_BOX.x + MARK_BOX.w / 2), -(MARK_BOX.y + MARK_BOX.h / 2));
    x.fillStyle = fill; x.fill(MARK); x.restore();
  }
  function glowDot(px, py, r, col, inten = 1, halo = 5) {
    if (inten <= 0.002) return;
    const g = X.createRadialGradient(px, py, 0, px, py, r * halo);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * inten})`); g.addColorStop(0.15, rgba(col, 0.7 * inten));
    g.addColorStop(0.45, rgba(col, 0.15 * inten)); g.addColorStop(1, rgba(col, 0));
    X.fillStyle = g; circle(X, px, py, r * halo); X.fill();
    G.fillStyle = rgba(col, inten); circle(G, px, py, r * 1.8); G.fill();
    G.fillStyle = `rgba(255,255,255,${inten})`; circle(G, px, py, r * 0.8); G.fill();
  }
  const INTER = (sz, wt = 500) => `${wt} ${sz}px "Inter"`;
  const MONO = (sz, wt = 400) => `${wt} ${sz}px "JetBrains Mono"`;

  // ---------- syntax highlight ----------
  const KW = new Set(['for', 'in', 'if', 'const', 'await', 'export', 'function', 'return', 'module', 'import', 'from', 'let', 'def', 'true', 'false']);
  const COL = { kw: '#C3A6FF', str: '#9EE6C1', num: '#F5C879', fn: '#7CC4FF', tag: '#7CB7F9', id: '#D5DCEB', p: '#8E9AB8', bool: '#F5C879' };
  function tokens(line) {
    const out = []; const re = /(\s+)|("[^"]*"?|'[^']*'?)|(\b\d+\b)|([A-Za-z_][\w]*)|(.)/g; let m;
    while ((m = re.exec(line))) {
      const s = m[0]; let c = 'p';
      if (m[1]) c = 'p'; else if (m[2]) c = 'str'; else if (m[3]) c = 'num';
      else if (m[4]) {
        const prev = line.slice(0, m.index).trimEnd(), next = line.slice(m.index + s.length);
        if (s === 'true' || s === 'false') c = 'bool';
        else if (KW.has(s)) c = 'kw';
        else if (/<\/?$/.test(prev)) c = 'tag';
        else if (/^\(/.test(next)) c = 'fn';
        else c = 'id';
      }
      out.push([s, c]);
    }
    return out;
  }
  const TOK = CARDS.map((c) => c.code.map(tokens));

  // ======================================================================
  // card content (drawn in base units 380 x 470 into its own canvas)
  // ======================================================================
  function cardBody(x, w, h, flash, R = 1) {
    const bg = x.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, 'rgba(4,14,78,0.86)'); bg.addColorStop(1, 'rgba(1,6,44,0.92)');
    x.fillStyle = bg; rrect(x, 0, 0, w, h, 18); x.fill();
    const hl = x.createLinearGradient(0, 0, 0, 120);
    hl.addColorStop(0, 'rgba(255,255,255,0.07)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = hl; rrect(x, 0, 0, w, h, 18); x.fill();
    x.lineWidth = 1.2; x.strokeStyle = `rgba(255,255,255,${0.16 + 0.75 * flash})`; rrect(x, 0.6, 0.6, w - 1.2, h - 1.2, 18); x.stroke();
  }
  function drawCard(i, t, R, flash, ta = 1) {
    const c = CARDS[i], cv = cardCv[i], x = cv.getContext('2d');
    const pw = Math.min(cv.width, Math.ceil(CW * R) + 2), ph = Math.min(cv.height, Math.ceil(CH * R) + 2);
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, pw + 2, ph + 2);
    x.setTransform(R, 0, 0, R, 0, 0);
    cardBody(x, CW, CH, flash);
    drawMark(x, 31, 34, 17, '#FFFFFF');
    x.globalAlpha = ta; x.translate(0, (1 - ta) * 8);
    // header
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = INTER(11, 600); x.letterSpacing = '1.4px'; x.fillStyle = C.sky; x.fillText(c.service, 48, 39);
    x.letterSpacing = '0px';
    x.font = INTER(21, 600); x.fillStyle = '#F2F5FF'; x.fillText(c.title, 24, 72);
    // status
    const done = t >= T.done[i];
    if (!done) {
      x.save(); x.translate(31, 97); x.rotate(t * 7); x.lineWidth = 1.8; x.strokeStyle = '#7CB7F9'; x.lineCap = 'round';
      x.beginPath(); x.arc(0, 0, 6, 0, Math.PI * 1.4); x.stroke(); x.restore();
      x.font = INTER(14, 400); x.fillStyle = '#8B97B5'; x.fillText(c.run, 46, 102);
    } else {
      const e = eoc(prog(t, T.done[i], T.done[i] + 0.2));
      x.fillStyle = `rgba(91,214,154,${e})`; circle(x, 31, 97, 7.5); x.fill();
      x.strokeStyle = '#06210F'; x.lineWidth = 2; x.lineCap = 'round'; x.beginPath(); x.moveTo(27.5, 97.5); x.lineTo(30.2, 100); x.lineTo(34.8, 94.5); x.stroke();
      x.font = INTER(14, 500); x.fillStyle = `rgba(158,230,193,${e})`; x.fillText(c.done, 46, 102);
    }
    // divider + progress
    const lastEnd = c.lineT[c.lineT.length - 1][1], firstStart = c.lineT[0][0];
    const p = prog(t, firstStart, lastEnd);
    x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(24, 120, 332, 1);
    if (p > 0) {
      const g = x.createLinearGradient(24, 0, 24 + 332 * p, 0);
      g.addColorStop(0, 'rgba(61,107,255,0.2)'); g.addColorStop(1, done ? 'rgba(91,214,154,0.9)' : 'rgba(124,183,249,0.95)');
      x.fillStyle = g; x.fillRect(24, 119.5, 332 * p, 2);
    }
    // code
    x.font = MONO(13.2); const chW = x.measureText('M').width;
    const y0 = 152, lh = 25;
    let active = -1, cursor = null;
    c.code.forEach((line, k) => {
      const [a, b] = c.lineT[k];
      if (t < a) return;
      const y = y0 + k * lh;
      const ind = line.length - line.trimStart().length;
      const n = ind + TL.typed(c, k, t);
      if (t < b + 0.06) { active = k; }
      x.fillStyle = '#46516F'; x.textAlign = 'right'; x.fillText(String(k + 1), 38, y); x.textAlign = 'left';
      let cx = 48, used = 0;
      for (const [s, cl] of TOK[i][k]) {
        if (used >= n) break;
        const part = s.slice(0, n - used);
        x.fillStyle = COL[cl]; x.fillText(part, cx, y);
        cx += part.length * chW; used += s.length;
      }
      if (t < b) cursor = [48 + n * chW, y - 4.5];
    });
    if (active >= 0 && !done) {
      x.fillStyle = 'rgba(80,120,255,0.07)'; x.fillRect(14, y0 + active * lh - 17, CW - 28, 23);
    }
    // footer
    const fy = CH - 26;
    x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(24, fy - 22, 332, 1);
    x.strokeStyle = '#6E7A98'; x.lineWidth = 1.2; x.strokeRect(25, fy - 10, 8, 11);
    x.font = MONO(12); x.fillStyle = '#6E7A98'; x.fillText(c.file, 40, fy);
    const dp = eoc(p);
    x.textAlign = 'right';
    const del = `−${Math.round(c.diff[1] * dp)}`, add = `+${Math.round(c.diff[0] * dp)}`;
    x.fillStyle = '#F07178'; x.fillText(del, 356, fy);
    const dw = x.measureText(del + ' ').width;
    x.fillStyle = '#5BD69A'; x.fillText(add, 356 - dw, fy);
    const aw = x.measureText(add + ' ').width;
    if (done) {
      const sp = spring(t - T.done[i], 3.2, 0.5);
      x.font = INTER(12, 600);
      const label = `✓ ${c.chip}`, lw = x.measureText(label).width + 18;
      const cx = 356 - dw - aw - 8 - lw / 2, cy = fy - 4;
      x.save(); x.translate(cx, cy); x.scale(sp, sp);
      x.fillStyle = 'rgba(60,200,130,0.16)'; rrect(x, -lw / 2, -11, lw, 22, 11); x.fill();
      x.strokeStyle = 'rgba(91,214,154,0.6)'; x.lineWidth = 1; rrect(x, -lw / 2, -11, lw, 22, 11); x.stroke();
      x.fillStyle = '#7BE3AE'; x.textAlign = 'center'; x.fillText(label, 0, 4.5);
      x.restore();
    }
    x.textAlign = 'left'; x.globalAlpha = 1;
    return { pw, ph, cursor };
  }


  // ======================================================================
  // background: brand gradient (darkened before the burst, flat navy at the hard cut)
  // ======================================================================
  const BRAND = [[0.03, '#010948'], [0.08, '#030C54'], [0.15, '#041871'], [0.2, '#061C84'], [0.25, '#07239A'], [0.3, '#082BAA'],
    [0.35, '#0837B9'], [0.4, '#0742C7'], [0.45, '#074ED3'], [0.5, '#0A59DC'], [0.55, '#0C65E4'], [0.6, '#0D71EC'], [0.65, '#2482EE'],
    [0.7, '#3C91F3'], [0.75, '#4FA3F6'], [0.8, '#64AEF5'], [0.85, '#78B9F7'], [0.9, '#8BC4F9'], [0.95, '#9ECEF7'], [0.99, '#ACD4F8']];
  function background(t) {
    const g = X.createLinearGradient(0, 0, 0, H);
    for (const [o, c] of BRAND) g.addColorStop(o, c);
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    // night before the burst: the ramp is mostly hidden, warming as the ember grows
    const night = t < T.burst ? lerp(0.9, 0.6, eio(prog(t, 0.3, 0.8))) : 0.6 * Math.exp(-(t - T.burst) / 0.25);
    if (night > 0.004) { X.fillStyle = `rgba(1,5,40,${night})`; X.fillRect(0, 0, W, H); }
    // soft light behind the action
    const gx = CX0 + W * 0.06 * Math.sin(t * 0.4), gy = H * 0.5;
    const r = Math.max(W, H) * 0.55;
    const b = X.createRadialGradient(gx, gy, 0, gx, gy, r);
    b.addColorStop(0, 'rgba(150,200,255,0.16)'); b.addColorStop(1, 'rgba(150,200,255,0)');
    X.fillStyle = b; X.fillRect(0, 0, W, H);
    // embers drifting up
    for (let i = 0; i < 90; i++) {
      const z = 0.3 + hash(i * 2.1) * 0.7;
      const px = ((hash(i) * W + Math.sin(t * 0.5 + i) * 18) % W + W) % W;
      const py = ((hash(i * 7.7) * H - t * (12 + 30 * z)) % H + H) % H;
      const a = (0.12 + 0.4 * z) * (0.55 + 0.45 * Math.sin(t * (0.8 + hash(i) * 2) + i));
      X.fillStyle = `rgba(225,238,255,${a.toFixed(3)})`; circle(X, px, py, 0.7 + 2 * z * z); X.fill();
    }
    // vignette in the deep navy of the ramp
    const v = X.createRadialGradient(CX0, CY0, Math.min(W, H) * 0.45, CX0, CY0, Math.max(W, H) * 0.8);
    v.addColorStop(0, 'rgba(1,9,72,0)'); v.addColorStop(1, 'rgba(1,9,72,0.38)');
    X.fillStyle = v; X.fillRect(0, 0, W, H);
  }

  // ======================================================================
  // 0.00–2.30 ignition, burst, logo, spiral, split, outlines → cards
  // ======================================================================
  const markW = (h) => h * MARK_BOX.w / MARK_BOX.h;
  function intro(t) {
    if (t > T.textIn[0] + 0.02) return;
    const cx = CX0, cy = CY0;
    if (t < T.burst + 0.02) {
      // ember: rises from 75% to centre, flickers, stretches, then becomes an orb
      const u = eio(prog(t, 0.04, 0.58));
      const ey = lerp(H * 0.75, cy, u);
      const grow = eoc(prog(t, 0.36, 0.62)), tight = eic(prog(t, 0.72, 0.8));
      const fl = 0.8 + 0.2 * Math.sin(t * 61) * Math.sin(t * 37);
      const R = lerp(lerp(5, 9, eoc(prog(t, 0.04, 0.1))), 42, grow) * fl * (1 - 0.15 * tight);
      const stretch = 1 + 0.9 * Math.exp(-Math.pow((t - 0.32) / 0.04, 2));
      X.save(); X.translate(cx, ey); X.scale(1 / Math.sqrt(stretch), stretch); X.rotate(0.15 * (stretch - 1));
      glowDot(0, 0, R, '#7CB7F9', 1, lerp(6, 4, grow)); X.restore();
      glowDot(cx, ey, R * 0.8, '#7CB7F9', 0.6, 4);
      if (grow > 0.3) { X.fillStyle = `rgba(255,255,250,${grow})`; circle(X, cx, ey, R * 0.6); X.fill(); }
      const ra = (1 - eoc(prog(t, 0.1, 0.4))) * clamp(t / 0.06);
      if (ra > 0.01) { X.fillStyle = `rgba(160,205,255,${0.45 * ra})`; X.beginPath(); X.ellipse(cx, H * 0.77, 34, 6, 0, 0, TAU); X.fill(); }
      for (let k = 0; k < 6; k++) { // sparks falling away
        const st = 0.12 + k * 0.04, p = prog(t, st, st + 0.3);
        if (p > 0 && p < 1) { X.fillStyle = `rgba(220,235,255,${(1 - p) * 0.8})`; circle(X, cx + (hash(k) - 0.5) * 30, lerp(H * 0.75, H * 0.75, 0) - lerp(0, -40, p) + (cy - H * 0.75) * u * 0, 1.6); X.fill(); }
      }
      // horizontal flare on the ember
      const hf = 0.4 + 0.6 * grow;
      for (const x of [X, G]) { const lg = x.createLinearGradient(cx - 160, 0, cx + 160, 0); lg.addColorStop(0, 'rgba(150,200,255,0)'); lg.addColorStop(0.5, `rgba(230,242,255,${0.6 * hf})`); lg.addColorStop(1, 'rgba(150,200,255,0)'); x.fillStyle = lg; x.fillRect(cx - 160, ey - 1, 320, 2); }
      // anticipation rings: appear, expand, then contract tightly before the burst
      [[0.66, 0], [0.74, 1]].forEach(([st, j]) => {
        const a = eoc(prog(t, st, st + 0.05));
        if (a <= 0) return;
        const rr = R * lerp(1.4, 2.4 + 0.6 * j, eoc(prog(t, st, 0.76))) * lerp(1, 0.55, tight);
        for (const x of [X, G]) { x.strokeStyle = `rgba(170,210,255,${0.9 * a})`; x.lineWidth = 2.4; circle(x, cx, ey, rr); x.stroke(); }
      });
    }
    // burst
    const bt = t - T.burst;
    if (bt >= 0 && bt < 1.0) {
      X.fillStyle = `rgba(235,244,255,${0.95 * Math.exp(-bt / 0.05)})`; X.fillRect(0, 0, W, H);
      const s = Math.exp(-bt / 0.3);
      for (const x of [X, G]) {
        const sg = x.createLinearGradient(0, cy - 60, 0, cy + 60);
        sg.addColorStop(0, 'rgba(150,200,255,0)'); sg.addColorStop(0.5, `rgba(240,248,255,${0.9 * s})`); sg.addColorStop(1, 'rgba(150,200,255,0)');
        x.fillStyle = sg; x.fillRect(0, cy - 60, W, 120);
        x.fillStyle = `rgba(255,255,255,${s})`; x.fillRect(0, cy - 1.5, W, 3);
      }
      // rings: three tight rings, a thick shockwave leaving the frame, a dimmer second wave
      [[0, 0.5, 9], [0.06, 0.3, 4], [0.1, 0.22, 3]].forEach(([dl, al, lw], j) => {
        const u = prog(t, T.burst + dl, T.burst + 0.48 + dl);
        if (u <= 0 || u >= 1) return;
        const rr = lerp(30, Math.max(W, H) * (0.9 - 0.2 * j), eoc(u));
        for (const x of [X, G]) { x.strokeStyle = `rgba(180,215,255,${al * 2 * (1 - u)})`; x.lineWidth = lw * (1 - 0.6 * u); circle(x, cx, cy, rr); x.stroke(); }
      });
      for (let i = 0; i < 60; i++) {
        const a = hash(i * 3.3) * TAU, v = 0.3 + hash(i * 1.7) * 0.8;
        const u = prog(t, T.logoIn, T.logoIn + 0.35 + hash(i) * 0.15);
        if (u <= 0 || u >= 1) continue;
        const d = Math.max(W, H) * 0.32 * v * eoc(u), len = 30 * (1 - u) * v + 4;
        const x0 = cx + Math.cos(a) * d, y0 = cy + Math.sin(a) * d;
        for (const x of [X, G]) { x.strokeStyle = `rgba(225,238,255,${0.9 * (1 - u)})`; x.lineWidth = 1.8; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 - Math.cos(a) * len, y0 - Math.sin(a) * len); x.stroke(); }
      }
    }
    // inward spiral sparks
    const sp = prog(t, T.spiral[0], T.spiral[1]);
    if (sp > 0 && sp < 1) {
      for (let i = 0; i < 18; i++) {
        const a0 = hash(i * 5.1) * TAU, r0 = (0.14 + 0.08 * hash(i * 2.9)) * Math.max(W, H);
        const u = eic(sp), r = r0 * (1 - u), a = a0 + 1.6 * u;
        for (const x of [X, G]) {
          x.strokeStyle = `rgba(225,238,255,${0.85 * Math.sin(Math.PI * sp)})`; x.lineWidth = 1.8; x.beginPath();
          x.arc(cx, cy, Math.max(1, r), a - 0.35, a); x.stroke();
        }
      }
    }
    // logo: born in the burst, holds with a glow pulse
    if (t >= T.logoIn && t < T.split) {
      const e = eoc(prog(t, T.logoIn, T.logoIn + 0.12));
      const h = L.introMarkH * lerp(0.7, 1, e) * (1 + 0.03 * Math.sin((t - T.logoIn) * 9));
      const pop = Math.exp(-Math.pow((t - (T.spiral[1] - 0.005)) / 0.03, 2));
      drawMark(X, cx, cy, h * (1 + 0.08 * pop), '#FFFFFF', e);
      drawMark(G, cx, cy, h * (1 + 0.08 * pop), '#CFE3FF', e * (0.7 + 0.6 * pop));
    }
    // split: blown-out orb → wide bar → logos travel out along a streak
    if (t >= T.split && t < T.textIn[0]) {
      const ob = 1 - eio(prog(t, T.split, T.spread[0] + 0.14));
      if (ob > 0.01) {
        const bar = eio(prog(t, T.split + 0.01, T.spread[0] + 0.06));
        X.save(); X.translate(cx, cy); X.scale(1 + 3.5 * bar, 1);
        glowDot(0, 0, 34, '#9CC2FF', ob, 3.5); X.restore();
        for (const x of [X, G]) { const lg = x.createLinearGradient(0, 0, W, 0); lg.addColorStop(0, 'rgba(160,205,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${ob})`); lg.addColorStop(1, 'rgba(160,205,255,0)'); x.fillStyle = lg; x.fillRect(0, cy - 2, W, 4); }
      }
      const u = eio(prog(t, T.spread[0], T.spread[1]));
      const trail = 1 - eio(prog(t, T.spread[1] - 0.15, T.outline[0] + 0.25));
      for (let i = 0; i < 4; i++) {
        const [tx, ty] = L.cards[i];
        const px = lerp(cx, tx, u), py = lerp(cy, ty, u);
        if (trail > 0.01 && t >= T.spread[0]) {
          for (const x of [X, G]) {
            const lg = x.createLinearGradient(cx, 0, px, 0); lg.addColorStop(0, 'rgba(160,205,255,0)'); lg.addColorStop(1, `rgba(235,245,255,${0.8 * trail})`);
            x.fillStyle = lg; x.fillRect(Math.min(cx, px), lerp(cy, ty, u) - 1.5, Math.abs(px - cx), 3);
          }
        }
        if (t < T.spread[0]) continue;
        cardMorph(i, t, px, py);
      }
    }
  }
  // outline square grows from the logo, fills with glass, logo flies to the corner, square stretches into the card
  function cardMorph(i, t, px, py) {
    const S = L.cardW, Hc = CH * CS;
    const [cx, cy] = L.cards[i];
    const o = eio(prog(t, T.outline[0], T.outline[1]));
    const f = eio(prog(t, T.fill[0], T.fill[1]));
    const st = eios(prog(t, T.stretch[0], T.stretch[1]));
    const mh0 = L.splitMarkH;
    const side = lerp(mh0 * 1.25, S, o);
    const w = side, h = lerp(side, Hc, st);
    const x0 = cx - w / 2, y0 = cy - h / 2;
    if (o > 0) {
      // glass fill
      if (f > 0) { X.save(); X.globalAlpha = f; X.translate(x0, y0); cardBody(X, w, h, 0); X.restore(); }
      // double glowing outline that softens to the card's thin rim
      const glowA = 1 - f;
      for (const [x, lw, off, al] of [[X, 2.2, 0, 1], [X, 1.4, 7 * (1 - o) + 4, 0.55], [G, 4, 0, 1]]) {
        x.save(); x.globalAlpha = al * (0.35 + 0.65 * glowA);
        x.strokeStyle = x === G ? '#BFDAFF' : 'rgba(230,240,255,1)'; x.lineWidth = lerp(lw, 1.2, f);
        rrect(x, x0 - off, y0 - off, w + off * 2, h + off * 2, 18 + off); x.stroke(); x.restore();
      }
    }
    // the logo: travels with the split, then shrinks, tilts and flies to the icon corner
    const icx = x0 + 31 * CS, icy = y0 + 34 * CS;
    const mx = lerp(px, icx, f), my = lerp(py, icy, f);
    const mh = lerp(mh0, 17 * CS, f);
    const tilt = Math.sin(Math.PI * f) * -0.35;
    const gl = (1 - f) * (t < T.outline[1] ? 1 : 0.6);
    X.save(); X.translate(mx, my); X.rotate(tilt); drawMark(X, 0, 0, mh, '#FFFFFF'); X.restore();
    G.save(); G.translate(mx, my); G.rotate(tilt); drawMark(G, 0, 0, mh, '#CFE3FF', gl); G.restore();
  }

  // ======================================================================
  // 2.22–9.40 cards, typing, whip push-in, finish, stack, check, button, merge
  // ======================================================================
  const STACK_ORDER = [FOCUS_CARD, 1, 3, 0];
  function cam(t) {
    const kin = spring(t - T.pushIn[0], 3.4, 0.62), kout = t >= T.pullOut[0] ? spring(t - T.pullOut[0], 3.8, 0.7) : 0;
    const k = t < T.pushIn[0] ? 0 : kin * (1 - kout);
    const z = 1 + (L.zoomMax - 1) * k + 0.02 * Math.sin(Math.max(0, t - 3.94) * 1.3) * k;
    const fc = [L.cards[FOCUS_CARD][0], L.cards[FOCUS_CARD][1] - 70 * CS];
    const kk = clamp(k, -0.2, 1.1);
    return { z, f: [lerp(CX0, fc[0], kk), lerp(CY0, fc[1], kk)], k: clamp(k) };
  }
  const toScreen = (p, c) => [(p[0] - c.f[0]) * c.z + CX0, (p[1] - c.f[1]) * c.z + CY0];
  function cardState(i, t) {
    const [cx, cy] = L.cards[i];
    let x = cx, y = cy, s = 1, rot = 0, a = 1;
    const d = STACK_ORDER.indexOf(i);
    const slide = eio(prog(t, T.stack[0], T.stack[0] + 0.24)), settle = eio(prog(t, T.stack[0] + 0.26, T.stack[1]));
    if (slide > 0) {
      const S = L.stackS, [sx, sy] = L.stackC;
      const tiltR = [0, -0.07, 0.06, -0.045][d], offX = [0, -26, 22, -12][d];
      x = lerp(cx, sx + offX * (1 - settle), slide);
      y = lerp(cy, sy - d * lerp(4, 11, settle) * S, slide);
      s = lerp(1, S * (d ? Math.pow(0.975, d) : 1), slide);
      rot = tiltR * slide * (1 - settle);
    }
    return { x, y, s, rot, a, d };
  }
  function work(t) {
    if (t < T.textIn[0] || t > T.merge[1] + 0.02) return;
    const c = cam(t);
    // clock pill
    const ca = eios(prog(t, T.clockIn, T.clockIn + 0.3)) * (1 - eoc(prog(t, T.merge[0], T.merge[0] + 0.15)));
    if (ca > 0.003) {
      const lift = eio(prog(t, T.stack[0], T.stack[1])) * L.clockLift;
      const p = toScreen([CX0, L.clockY - lift], c), z = c.z * (V ? 1.35 : 1.12);
      const txt = TL.clockStr(TL.clockMin(t)), morn = t >= T.morning ? eoc(prog(t, T.morning, T.morning + 0.15)) : 0;
      X.save(); X.translate(p[0], p[1]); X.scale(z, z); X.globalAlpha = ca;
      X.font = INTER(17, 600); const w = X.measureText('00:00 AM').width + 54, h = 38;
      X.fillStyle = 'rgba(1,9,60,0.85)'; rrect(X, -w / 2, -h / 2, w, h, h / 2); X.fill();
      X.strokeStyle = `rgba(${morn ? '255,214,140' : '255,255,255'},${0.2 + 0.7 * morn})`; X.lineWidth = 1.4; rrect(X, -w / 2, -h / 2, w, h, h / 2); X.stroke();
      const ix = -w / 2 + 20;
      if (!morn) { X.fillStyle = '#C9D6FF'; circle(X, ix, 0, 7); X.fill(); X.fillStyle = 'rgba(1,9,60,1)'; circle(X, ix + 3.5, -2.5, 6); X.fill(); }
      else { X.fillStyle = '#FFD68C'; circle(X, ix, 0, 4.5); X.fill(); X.strokeStyle = '#FFD68C'; X.lineWidth = 1.5; for (let k = 0; k < 8; k++) { const an = k * TAU / 8; X.beginPath(); X.moveTo(ix + Math.cos(an) * 7, Math.sin(an) * 7); X.lineTo(ix + Math.cos(an) * 9.5, Math.sin(an) * 9.5); X.stroke(); } }
      X.fillStyle = '#F2F5FF'; X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillText(txt, ix + 16, 1); X.restore();
      if (morn) { G.save(); G.translate(p[0], p[1]); G.scale(z, z); G.globalAlpha = ca * (0.8 + 0.6 * Math.exp(-(t - T.morning) / 0.5)); G.strokeStyle = '#FFD68C'; G.lineWidth = 5; rrect(G, -w / 2, -h / 2, w, h, h / 2); G.stroke(); G.restore(); }
    }
    const ta = eios(prog(t, T.textIn[0], T.textIn[1]));
    const stacking = t >= T.stack[0];
    const mg = prog(t, T.merge[0], T.merge[1]);
    const states = CARDS.map((_, i) => [i, cardState(i, t)]);
    states.sort((a, b) => stacking ? b[1].d - a[1].d : a[0] - b[0]);
    for (const [i, s] of states) {
      if (mg > 0 && i !== FOCUS_CARD && mg > 0.15) continue;   // back layers vanish as the merge starts
      const flash = t >= T.done[i] ? Math.exp(-(t - T.done[i]) / 0.25) : 0;
      const sc = toScreen([s.x, s.y], c);
      const R = Math.min(3.65, CS * s.s * c.z) * SS;
      const { pw, ph, cursor } = drawCard(i, t, R, flash, ta * (1 - eoc(prog(mg, 0.1, 0.6))));
      const dw = CW * R / SS, dh = CH * R / SS;
      const dof = i === FOCUS_CARD ? 0 : c.k * 6;
      X.save(); X.translate(sc[0], sc[1]); X.rotate(s.rot);
      X.globalAlpha = 0.5;
      const sh = X.createRadialGradient(0, dh * 0.08, 0, 0, dh * 0.08, Math.max(dw, dh) * 0.7);
      sh.addColorStop(0, 'rgba(0,4,40,0.7)'); sh.addColorStop(1, 'rgba(0,4,40,0)'); X.fillStyle = sh; X.fillRect(-dw, -dh, dw * 2, dh * 2);
      X.globalAlpha = mg > 0 ? lerp(1, 0.28, eoc(prog(mg, 0, 0.3))) * (1 + 0.6 * Math.sin(mg * 60) * (mg < 0.15 ? 1 : 0)) : 1;
      if (dof > 0.3) X.filter = `blur(${((dof) * SS).toFixed(1)}px)`;
      X.drawImage(cardCv[i], 0, 0, pw, ph, -dw / 2, -dh / 2, pw / SS, ph / SS);
      X.restore();
      // emissive rim; stack top-edge highlight; merge wireframe edge
      const hiTop = i === FOCUS_CARD ? Math.exp(-Math.pow((t - 7.63) / 0.04, 2)) : 0;
      G.save(); G.translate(sc[0], sc[1]); G.rotate(s.rot);
      G.globalAlpha = 0.18 + 0.85 * flash + (mg > 0 ? 0.7 * (1 - mg) : 0); G.strokeStyle = flash > 0.05 || mg > 0 ? '#FFFFFF' : '#7FA6FF'; G.lineWidth = 2.5;
      rrect(G, -dw / 2, -dh / 2, dw, dh, 18 * R / SS); G.stroke();
      if (hiTop > 0.01) { G.globalAlpha = hiTop; G.fillStyle = '#FFFFFF'; G.fillRect(-dw / 2 + 20, -dh / 2 - 2, dw - 40, 4); X.save(); X.translate(sc[0], sc[1]); X.globalAlpha = hiTop; X.fillStyle = '#FFFFFF'; X.fillRect(-dw / 2 + 20, -dh / 2 - 1, dw - 40, 2); X.restore(); }
      G.restore();
      if (mg > 0 && i === FOCUS_CARD) { // white-edged selection box shrinking to the top-left
        const k = eio(prog(t, T.merge[0] + 0.04, T.comets[0]));
        const bx0 = sc[0] - dw / 2 + 12, by0 = sc[1] - dh / 2 + 12;
        const bw = lerp(dw * 0.62, 34, k), bh = lerp(dh * 0.36, 34, k);
        for (const x of [X, G]) { x.strokeStyle = 'rgba(255,255,255,0.95)'; x.lineWidth = 2; x.strokeRect(bx0, by0, bw, bh); }
        X.fillStyle = 'rgba(200,225,255,0.12)'; X.fillRect(bx0, by0, bw, bh);
      }
      if (cursor && t < T.done[i] && ta > 0.9 && !stacking) {
        const Rs = R / SS, cxp = sc[0] - dw / 2 + cursor[0] * Rs, cyp = sc[1] - dh / 2 + cursor[1] * Rs;
        const tl = 46 * Rs;
        const tg = X.createLinearGradient(cxp - tl, 0, cxp, 0); tg.addColorStop(0, 'rgba(180,215,255,0)'); tg.addColorStop(1, 'rgba(245,250,255,0.95)');
        X.fillStyle = tg; X.fillRect(cxp - tl, cyp - 1.6 * Rs, tl, 3.2 * Rs);
        glowDot(cxp, cyp, 3.4 * Rs, '#CFE3FF', 1, 4);
      }
    }
    // checkmark: orb → short stroke → long stroke, left as a glowing outline
    const cu = prog(t, T.check[0], T.check[1]);
    if (cu > 0 && mg < 0.5) {
      const S = L.stackS * CS, [sx, sy] = L.stackC;
      const P = [[-120, 20], [-38, 104], [150, -150]].map(([a, b]) => [sx + a * S, sy + b * S]);
      const s1 = eoc(prog(t, 7.86, 8.0)), s2 = eio(prog(t, 8.02, T.check[1]));
      const pts = [P[0], [lerp(P[0][0], P[1][0], s1), lerp(P[0][1], P[1][1], s1)]];
      if (s2 > 0) pts.push([lerp(P[1][0], P[2][0], s2), lerp(P[1][1], P[2][1], s2)]);
      const tip = pts[pts.length - 1];
      const dim = 1 - 0.55 * eoc(prog(t, T.check[1], T.click)), fade = 1 - eoc(prog(mg, 0, 0.4));
      const path = (x) => { x.beginPath(); x.moveTo(...pts[0]); for (const q of pts.slice(1)) x.lineTo(...q); };
      X.save(); X.lineCap = 'round'; X.lineJoin = 'round'; X.globalAlpha = fade;
      X.lineWidth = 22 * S; X.strokeStyle = `rgba(240,248,255,${dim})`; path(X); X.stroke();
      X.lineWidth = 12 * S; X.strokeStyle = 'rgba(3,12,70,1)'; path(X); X.stroke(); X.restore();
      G.save(); G.lineCap = 'round'; G.lineJoin = 'round'; G.globalAlpha = dim * fade; G.lineWidth = 26 * S; G.strokeStyle = '#CFE3FF'; path(G); G.stroke(); G.restore();
      const head = t < T.check[1] ? 1 : Math.exp(-(t - T.check[1]) / 0.12);
      glowDot(tip[0], tip[1], 10 * S * (t < 7.86 ? eoc(prog(t, 7.78, 7.86)) : 1), '#CFE3FF', head * fade, 6);
    }
    // "Approve all" — brand pill, pointer, hover ring, click
    const bi = eoc(prog(t, T.btnIn[0], T.btnIn[1]));
    if (bi > 0) {
      const bx = L.stackC[0], by = L.btnY, gone = 1 - eoc(prog(t, T.merge[0] + 0.1, T.merge[1]));
      const press = t >= T.click ? 1 - 0.07 * Math.sin(Math.min(Math.PI, (t - T.click) * 26)) : 1;
      const bs = (V ? 1.4 : 1.2) * lerp(0.94, 1, bi) * press;
      X.save(); X.translate(bx, by); X.scale(bs, bs); X.globalAlpha = bi * gone;
      X.font = INTER(19, 600); const w = X.measureText('Approve all').width + 70, h = 54;
      X.shadowColor = 'rgba(0,6,50,0.5)'; X.shadowBlur = 26 * SS; X.shadowOffsetY = 8 * SS;
      X.fillStyle = '#080B0B'; rrect(X, -w / 2, -h / 2, w, h, h / 2); X.fill(); X.shadowColor = 'transparent';
      X.fillStyle = '#F2F5F2'; X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillText('Approve all', -w / 2 + 26, 1);
      X.strokeStyle = '#F2F5F2'; X.lineWidth = 2.2; X.lineCap = 'round'; X.lineJoin = 'round';
      const ax = w / 2 - 30; X.beginPath(); X.moveTo(ax - 7, 0); X.lineTo(ax + 7, 0); X.moveTo(ax + 1, -6); X.lineTo(ax + 7, 0); X.lineTo(ax + 1, 6); X.stroke();
      X.restore();
      const hv = eoc(prog(t, T.hover[0], T.hover[1])) * (t < T.click ? 1 : Math.exp(-(t - T.click) / 0.12)) * gone;
      if (hv > 0.01) {
        for (const x of [X, G]) {
          x.save(); x.translate(bx, by); x.scale(bs, bs); x.globalAlpha = hv;
          x.strokeStyle = x === G ? '#7FB0FF' : '#BFD8FF'; x.lineWidth = x === G ? 10 : 3;
          const gw = 1.0 * (X.measureText ? 0 : 0) + (166 + 70) * 1.0;
          rrect(x, -gw / 2 - 8, -35, gw + 16, 70, 35); x.stroke(); x.restore();
        }
        const ug = X.createRadialGradient(bx, by + 40, 0, bx, by + 40, 220);
        ug.addColorStop(0, `rgba(120,170,255,${0.45 * hv})`); ug.addColorStop(1, 'rgba(120,170,255,0)'); X.fillStyle = ug; X.fillRect(bx - 240, by - 60, 480, 240);
      }
      const pu = eio(prog(t, T.pointer[0], T.pointer[1]));
      if (pu > 0 && gone > 0.02) {
        const px = lerp(W * 0.8, bx + 26, pu), py = lerp(H * 1.04, by + 22, pu);
        if (pu < 1) { X.strokeStyle = `rgba(200,210,230,${0.35 * Math.sin(Math.PI * pu)})`; X.lineWidth = 3; X.beginPath(); X.moveTo(lerp(W * 0.8, px, 0.6), lerp(H * 1.04, py, 0.6)); X.lineTo(px, py); X.stroke(); }
        const ps = (V ? 1.5 : 1.15) * (t >= T.click - 0.03 ? 1 - 0.14 * Math.exp(-Math.pow((t - T.click) / 0.05, 2)) : 1);
        X.save(); X.translate(px, py); X.scale(ps, ps); X.globalAlpha = gone;
        X.beginPath(); X.moveTo(0, 0); X.lineTo(0, 26); X.lineTo(6.5, 20); X.lineTo(11, 30); X.lineTo(15, 28.5); X.lineTo(10.5, 18.5); X.lineTo(19, 18.5); X.closePath();
        X.fillStyle = '#FFFFFF'; X.fill(); X.strokeStyle = '#0B1230'; X.lineWidth = 1.6; X.stroke(); X.restore();
      }
    }
  }

  // ======================================================================
  // 9.36–9.80 comets, hard cut, flare
  // ======================================================================
  function cometOrigin() {
    const S = L.stackS * CS, [sx, sy] = L.stackC;
    return [sx - CW * S / 2 + 30, sy - CH * S / 2 + 30];
  }
  function cometAt(k, u) {
    const P0 = cometOrigin(), C = [CX0, CY0 - (V ? 80 : 40)];
    const sp = V ? [[-300, -560], [-80, -700], [140, -660], [330, -520]] : [[-430, -330], [-150, -440], [170, -420], [450, -300]];
    const Q = [C[0] + sp[k][0], C[1] + sp[k][1]];
    const v = 1 - u;
    return [v * v * P0[0] + 2 * v * u * Q[0] + u * u * C[0], v * v * P0[1] + 2 * v * u * Q[1] + u * u * C[1]];
  }
  function comets(t) {
    if (t < T.comets[0] || t >= T.cut) return;
    for (let k = 0; k < 4; k++) {
      const uf = (tt) => eio(prog(tt, T.comets[0] + k * 0.02, T.comets[1]));
      const u = uf(t);
      const pts = []; for (let j = 0; j < 16; j++) pts.push(cometAt(k, uf(t - j * 0.012)));
      for (const x of [X, G]) {
        x.lineCap = 'round';
        for (let j = 1; j < pts.length; j++) { const f = 1 - j / pts.length; x.strokeStyle = `rgba(${x === G ? '160,200,255' : '235,244,255'},${(0.9 * f).toFixed(3)})`; x.lineWidth = 6 * f + 0.6; x.beginPath(); x.moveTo(...pts[j - 1]); x.lineTo(...pts[j]); x.stroke(); }
      }
      const [hx, hy] = pts[0], hh = lerp(26, 14, eic(prog(t, 9.6, T.comets[1])));
      glowDot(hx, hy, 6, '#9CC2FF', 0.9, 4);
      drawMark(X, hx, hy, hh, '#FFFFFF');
    }
  }
  function cutAndReveal(t) {
    if (t < T.comets[1] - 0.001) return;
    const cx = CX0, cy = CY0;
    if (t < T.flash) { // hard cut to deep navy with a tiny cluster
      X.fillStyle = '#010948'; X.fillRect(0, 0, W, H);
      [[-7, -7], [7, -7], [-7, 7], [7, 7]].forEach(([a, b]) => { drawMark(X, cx + a, cy + b, 11, '#FFFFFF'); drawMark(G, cx + a, cy + b, 11, '#CFE3FF', 0.8); });
      const fl = eoc(prog(t, T.flare, T.flash));
      if (fl > 0) for (const x of [X, G]) { const lg = x.createLinearGradient(cx - 220 * fl, 0, cx + 220 * fl, 0); lg.addColorStop(0, 'rgba(200,225,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,1)'); lg.addColorStop(1, 'rgba(200,225,255,0)'); x.fillStyle = lg; x.fillRect(cx - 220 * fl, cy - 1.5, 440 * fl, 3); }
      return;
    }
    const ft = t - T.flash;
    // lens-flare ellipse that floods into haze, settling back onto the brand gradient
    const grow = eoc(prog(t, T.flash, T.settle[0] + 0.14)), settle = eio(prog(t, 9.96, T.settle[1] + 0.3));
    const rx = W * 0.4 * lerp(0.6, 1.25, grow), ry = lerp(26, H * 0.55, grow);
    const ia = lerp(1, 0.22, settle) * (1 - 0.4 * eoc(prog(t, T.settle[1], T.blur[0])));
    X.save(); X.translate(cx, cy); X.scale(1, ry / rx);
    const hg = X.createRadialGradient(0, 0, 0, 0, 0, rx);
    hg.addColorStop(0, `rgba(255,255,255,${ia})`); hg.addColorStop(0.35, `rgba(200,225,255,${0.7 * ia})`); hg.addColorStop(1, 'rgba(160,205,255,0)');
    X.fillStyle = hg; circle(X, 0, 0, rx); X.fill(); X.restore();
    const navy = 1 - eoc(prog(t, T.flash, T.settle[0] + 0.1));
    if (navy > 0.01) { X.fillStyle = `rgba(1,9,72,${navy})`; X.fillRect(0, 0, W, H); }
    // full-width streak on the centre line; thins, then recedes right as the logo slides
    const sl = eoc(prog(t, T.slide[0], T.slide[1]));
    const si = (0.35 + 0.65 * Math.exp(-ft / 0.35)) * (1 - eoc(prog(t, T.tagline[1], T.dissolve[0])));
    if (si > 0.01) for (const x of [X, G]) {
      const x0 = lerp(0, W * 0.5, sl);
      const lg = x.createLinearGradient(x0, 0, W, 0); lg.addColorStop(0, 'rgba(200,225,255,0)'); lg.addColorStop(0.5, `rgba(255,255,255,${si})`); lg.addColorStop(1, 'rgba(200,225,255,0)');
      x.fillStyle = lg; x.fillRect(x0, cy - 1.5, W - x0, 3);
    }
  }

  // ======================================================================
  // 9.96–13.06 logo → slide → spark writes "Sora Systems" → tagline → dissolve
  // ======================================================================
  let LK = null;
  function lockGeom() {
    if (LK) return LK;
    X.save(); X.font = '900 100px "Archivo"'; X.fontStretch = 'extra-condensed';
    const capR = X.measureText('S').actualBoundingBoxAscent / 100, w100 = X.measureText('Sora Systems').width; X.restore();
    let mh = L.markH, cap = mh * 0.72, fs = cap / capR, ww = w100 * fs / 100, mw = markW(mh), gap = mh * 0.3;
    let tot = mw + gap + ww;
    if (tot > L.lockMaxW) { const k = L.lockMaxW / tot; mh *= k; cap *= k; fs *= k; ww *= k; mw *= k; gap *= k; tot = L.lockMaxW; }
    const left = CX0 - tot / 2, cy = L.lockCY;
    LK = { mh, cap, fs, ww, mw, gap, tot, left, cy, markX: left + mw / 2, wordX: left + mw + gap, base: cy + cap / 2, tagY: cy + mh / 2 + mh * 0.36, tagFs: mh * 0.17 };
    return LK;
  }
  function lockup(t) {
    if (t < T.flash || t > T.dissolve[1] + 0.02) return;
    const g = lockGeom();
    const dis = eic(prog(t, T.dissolve[0], T.dissolve[1]));
    const blurAll = dis * 14 + 4 * Math.sin(Math.PI * prog(t, T.blur[0], T.blur[1]));
    const sl = eoc(prog(t, T.slide[0], T.slide[1]));
    const form = eoc(prog(t, 9.96, T.settle[1]));
    const mx = lerp(CX0, g.markX, sl), my = g.cy;
    const mh = g.mh * lerp(0.82, 1, form);
    X.save(); X.globalAlpha = 1 - dis; if (blurAll > 0.3) X.filter = `blur(${((blurAll) * SS).toFixed(1)}px)`;
    // dark glyph inside the flare, white mark forming around it
    if (form < 1) drawMark(X, mx, my, g.mh * 0.3, '#010948', 1 - form);
    drawMark(X, mx, my, mh, '#E8EDE9', form);
    X.restore();
    drawMark(G, mx, my, mh, '#CFE3FF', (0.25 + 0.6 * Math.exp(-(t - T.flash) / 0.4)) * form * (1 - dis));
    // golden spark from the right along the streak, then the writing head
    const sk = prog(t, T.spark[0], T.spark[1]);
    const wr = prog(t, T.write[0], T.write[1]);
    const headX = t < T.write[0] ? lerp(W * 0.86, g.wordX - 6, eoc(sk)) : lerp(g.wordX, g.wordX + g.ww, wr);
    const headY = t < T.write[0] ? lerp(CY0, g.cy, eoc(sk)) : g.cy;
    if (sk > 0 && wr < 1) glowDot(headX, headY, 7, '#CFE3FF', 1, 6);
    else if (wr >= 1) glowDot(g.wordX + g.ww, g.cy, 7, '#CFE3FF', Math.exp(-(t - T.write[1]) / 0.08), 6);
    if (wr > 0) {
      X.save(); X.globalAlpha = 1 - dis; if (blurAll > 0.3) X.filter = `blur(${((blurAll) * SS).toFixed(1)}px)`;
      X.beginPath(); X.rect(g.wordX - 10, g.cy - g.mh, headX - g.wordX + 10, g.mh * 2); X.clip();
      X.font = `900 ${g.fs.toFixed(2)}px "Archivo"`; X.fontStretch = 'extra-condensed'; X.textBaseline = 'alphabetic'; X.textAlign = 'left';
      X.fillStyle = '#F7FAFC'; X.fillText('Sora Systems', g.wordX, g.base);
      X.restore();
      // fresh letters glow behind the head
      G.save(); G.beginPath(); G.rect(headX - 90, g.cy - g.mh, 90, g.mh * 2); G.clip();
      G.font = `900 ${g.fs.toFixed(2)}px "Archivo"`; G.fontStretch = 'extra-condensed'; G.textBaseline = 'alphabetic';
      G.globalAlpha = (wr < 1 ? 0.8 : 0.8 * Math.exp(-(t - T.write[1]) / 0.15)) * (1 - dis); G.fillStyle = '#CFE3FF'; G.fillText('Sora Systems', g.wordX, g.base); G.restore();
    }
    // tagline: blur-in, split to the lockup edges (brand lockup)
    const tg = eoc(prog(t, T.tagline[0], T.tagline[1]));
    if (tg > 0) {
      X.save(); X.globalAlpha = tg * (1 - dis); const bl = (1 - tg) * 8 + blurAll; if (bl > 0.3) X.filter = `blur(${((bl) * SS).toFixed(1)}px)`;
      X.font = `500 ${g.tagFs.toFixed(1)}px "Inter"`; X.fillStyle = '#BADEF9'; X.textBaseline = 'alphabetic';
      X.textAlign = 'left'; X.fillText('Intelligent technology', g.left, g.tagY);
      X.textAlign = 'right'; X.fillText('Built for real impact', g.left + g.tot, g.tagY);
      X.restore();
    }
    // breathing glow band behind the lockup during the hold
    const band = prog(t, T.tagline[1], T.dissolve[0]) > 0 ? 0.12 + 0.03 * Math.sin((t - T.tagline[1]) * 2.4) : 0;
    if (band > 0) { X.save(); X.translate(CX0, g.cy); X.scale(1, 0.25); const bg = X.createRadialGradient(0, 0, 0, 0, 0, W * 0.5); bg.addColorStop(0, `rgba(220,235,255,${band * (1 - dis)})`); bg.addColorStop(1, 'rgba(220,235,255,0)'); X.globalCompositeOperation = 'lighter'; X.fillStyle = bg; circle(X, 0, 0, W * 0.5); X.fill(); X.restore(); }
  }

  // ======================================================================
  // 13.06 → end: spark → dash → line in an oval halo → email write-on → CTA
  // ======================================================================
  function endCard(t) {
    if (t < T.pop - 0.01) return;
    const g = lockGeom(), cy = L.lineY;
    const pop = prog(t, T.pop, T.pop + 0.04), dash = eoc(prog(t, T.dash[0], T.dash[0] + 0.06)), line = eio(prog(t, T.dash[0] + 0.06, T.dash[1]));
    const oval = eoc(prog(t, T.dash[0], T.dash[1]));
    X.save(); X.translate(CX0, cy); X.scale(1, 0.42);
    const og = X.createRadialGradient(0, 0, 0, 0, 0, W * (V ? 0.75 : 0.42));
    og.addColorStop(0, `rgba(235,242,255,${0.42 * oval})`); og.addColorStop(0.6, `rgba(210,228,255,${0.16 * oval})`); og.addColorStop(1, 'rgba(210,228,255,0)');
    X.fillStyle = og; circle(X, 0, 0, W * (V ? 0.75 : 0.42)); X.fill(); X.restore();
    const ew = prog(t, T.email[0], T.email[1]);
    X.font = INTER(V ? 50 : 54, 600); const tw = X.measureText('business@sorasystems.tech').width;
    const tx0 = CX0 - tw / 2;
    // the line: pops as a spark, stretches into a dash, settles thin; consumed from the left by the text
    const lw = lerp(lerp(0, 240, dash), tw + 80, line), lh = lerp(5, 2.2, line);
    const consumed = tw * eio(ew);
    if (t < T.dash[0]) glowDot(CX0, cy, 6 * (0.5 + pop), '#FFFFFF', 1, 5);
    else if (ew < 1) for (const x of [X, G]) { x.fillStyle = 'rgba(255,255,255,0.95)'; x.fillRect(Math.max(CX0 - lw / 2, tx0 + consumed), cy - lh / 2, CX0 + lw / 2 - Math.max(CX0 - lw / 2, tx0 + consumed), lh); }
    if (ew > 0) {
      X.save(); X.beginPath(); X.rect(tx0 - 4, cy - 60, consumed + 8, 120); X.clip();
      X.shadowColor = 'rgba(1,9,72,0.35)'; X.shadowBlur = 18 * SS; X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillStyle = '#FFFFFF';
      X.fillText('business@sorasystems.tech', tx0, cy + 2); X.restore();
      if (ew < 1) glowDot(tx0 + consumed, cy, 6, '#FFFFFF', 1, 5);
    }
    // CTA pill (brand style)
    const cs = spring(t - T.cta[0], 2.6, 0.6);
    if (t >= T.cta[0]) {
      X.save(); X.translate(CX0, cy + L.ctaGap); X.scale(lerp(0.85, 1, cs) * (V ? 1.35 : 1.4), lerp(0.85, 1, cs) * (V ? 1.35 : 1.4)); X.globalAlpha = clamp(cs * 1.4);
      X.font = INTER(24, 600); const w = X.measureText('Book a 15-min call').width + 96, h = 60;
      X.shadowColor = 'rgba(0,6,50,0.45)'; X.shadowBlur = 30 * SS; X.shadowOffsetY = 10 * SS;
      X.fillStyle = '#080B0B'; rrect(X, -w / 2, -h / 2, w, h, h / 2); X.fill(); X.shadowColor = 'transparent';
      X.fillStyle = '#F2F5F2'; X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillText('Book a 15-min call', -w / 2 + 32, 1);
      X.strokeStyle = '#F2F5F2'; X.lineWidth = 2.4; X.lineCap = 'round'; X.lineJoin = 'round';
      const ax = w / 2 - 36; X.beginPath(); X.moveTo(ax - 8, 0); X.lineTo(ax + 8, 0); X.moveTo(ax + 1, -7); X.lineTo(ax + 8, 0); X.lineTo(ax + 1, 7); X.stroke();
      X.restore();
    }
  }

  // ======================================================================
  // compose
  // ======================================================================
  function drawSample(t) {
    X.setTransform(SS, 0, 0, SS, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.filter = 'none';
    G.setTransform(1, 0, 0, 1, 0, 0); G.globalAlpha = 1; G.globalCompositeOperation = 'source-over'; G.fillStyle = '#000'; G.fillRect(0, 0, W / 2, H / 2);
    G.setTransform(0.5, 0, 0, 0.5, 0, 0);
    background(t);
    intro(t); work(t); comets(t); cutAndReveal(t); lockup(t); endCard(t);
    B1.filter = 'blur(2px)'; B1.clearRect(0, 0, b1.width, b1.height); B1.drawImage(glow, 0, 0, b1.width, b1.height);
    B2.filter = 'blur(3px)'; B2.clearRect(0, 0, b2.width, b2.height); B2.drawImage(b1, 0, 0, b2.width, b2.height);
    B3.filter = 'blur(3px)'; B3.clearRect(0, 0, b3.width, b3.height); B3.drawImage(b2, 0, 0, b3.width, b3.height);
    X.save(); X.setTransform(SS, 0, 0, SS, 0, 0); X.globalCompositeOperation = 'lighter'; X.imageSmoothingQuality = 'high';
    X.globalAlpha = 0.25; X.drawImage(glow, 0, 0, W, H);
    X.globalAlpha = 0.45; X.drawImage(b1, 0, 0, W, H);
    X.globalAlpha = 0.5; X.drawImage(b2, 0, 0, W, H);
    X.globalAlpha = 0.5; X.drawImage(b3, 0, 0, W, H);
    X.restore();
  }
  const FAST = [[0.8, 1.35, 6], [1.58, 2.24, 6], [2.3, 3.78, 2], [3.78, 4.02, 8], [4.8, 5.06, 8], [7.2, 7.8, 6], [7.84, 8.42, 4],
    [8.78, 8.98, 6], [9.1, 9.7, 6], [9.78, 10.12, 4], [10.68, 11.42, 6], [12.94, 13.4, 4], [13.36, 13.92, 3]];
  const samplesAt = (t) => { for (const [a, b, n] of FAST) if (t >= a && t < b) return n; return 1; };
  window.FMT = { W, H, V };
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
