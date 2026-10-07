// SORA SYSTEMS spec ad — deterministic canvas renderer. window.render(t) draws the frame at t.
/* global TL, MARK_D */
(function () {
  const { T, CARDS, FOCUS_CARD, clamp, lerp, prog, eoc, eoq, eic, eio, eios, eoe, spring, hash } = TL;
  const TAU = Math.PI * 2;
  const FMT = new URLSearchParams(location.search).get('fmt') || '169';
  const V = FMT === '916';
  const W = V ? 1080 : 1920, H = V ? 1920 : 1080;

  // ---------- layout ----------
  const L = V ? {
    cardW: 450, cards: [[300, 720], [780, 720], [300, 1320], [780, 1320]], clockY: 330,
    stackC: [540, 880], stackS: 1.3, btnY: 1390, introMarkH: 170, cometBox: [430, 560],
    zoomMax: 1.15, horizonY: 960, horizonMarkH: 170, wordW: 960, lockCY: 930,
    endC: [540, 960], endR: [470, 330],
  } : {
    cardW: 380, cards: [[330, 590], [750, 590], [1170, 590], [1590, 590]], clockY: 215,
    stackC: [960, 490], stackS: 1.2, btnY: 855, introMarkH: 150, cometBox: [760, 360],
    zoomMax: 0.95, horizonY: 540, horizonMarkH: 150, wordW: 1080, lockCY: 520,
    endC: [960, 540], endR: [620, 300],
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
  const out = document.getElementById('c'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const scene = mk(W, H), X = scene.getContext('2d');
  const glow = mk(W / 2, H / 2), G = glow.getContext('2d');
  const b1 = mk(W / 8, H / 8), B1 = b1.getContext('2d');
  const b2 = mk(W / 16, H / 16), B2 = b2.getContext('2d');
  const b3 = mk(Math.round(W / 32), Math.round(H / 32)), B3 = b3.getContext('2d');
  const cardCv = CARDS.map(() => mk(1000, 1240));
  const wm = mk(W, Math.round(H * 0.45)), WM = wm.getContext('2d');
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
  function drawCard(i, t, R, flash) {
    const c = CARDS[i], cv = cardCv[i], x = cv.getContext('2d');
    const pw = Math.min(cv.width, Math.ceil(CW * R) + 2), ph = Math.min(cv.height, Math.ceil(CH * R) + 2);
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, pw + 2, ph + 2);
    x.setTransform(R, 0, 0, R, 0, 0);
    // body
    const bg = x.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, 'rgba(24,33,64,0.94)'); bg.addColorStop(1, 'rgba(9,14,34,0.96)');
    x.fillStyle = bg; rrect(x, 0, 0, CW, CH, 18); x.fill();
    const hl = x.createLinearGradient(0, 0, 0, 120);
    hl.addColorStop(0, 'rgba(255,255,255,0.06)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = hl; rrect(x, 0, 0, CW, CH, 18); x.fill();
    x.lineWidth = 1.2; x.strokeStyle = `rgba(255,255,255,${0.13 + 0.6 * flash})`; rrect(x, 0.6, 0.6, CW - 1.2, CH - 1.2, 18); x.stroke();
    // header
    drawMark(x, 31, 34, 17, '#FFFFFF');
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.font = INTER(11, 600); x.letterSpacing = '1.4px'; x.fillStyle = C.sky; x.fillText(c.service, 48, 39);
    x.letterSpacing = '0px';
    x.font = INTER(21, 600); x.fillStyle = '#F2F5FF'; x.fillText(c.title, 24, 72);
    // status
    const done = t >= T.chips[i];
    if (!done) {
      x.save(); x.translate(31, 97); x.rotate(t * 7); x.lineWidth = 1.8; x.strokeStyle = '#7CB7F9'; x.lineCap = 'round';
      x.beginPath(); x.arc(0, 0, 6, 0, Math.PI * 1.4); x.stroke(); x.restore();
      x.font = INTER(14, 400); x.fillStyle = '#8B97B5'; x.fillText(c.run, 46, 102);
    } else {
      const e = eoc(prog(t, T.chips[i], T.chips[i] + 0.25));
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
      const sp = spring(t - T.chips[i], 3.2, 0.5);
      x.font = INTER(12, 600);
      const label = `✓ ${c.chip}`, lw = x.measureText(label).width + 18;
      const cx = 356 - dw - aw - 8 - lw / 2, cy = fy - 4;
      x.save(); x.translate(cx, cy); x.scale(sp, sp);
      x.fillStyle = 'rgba(60,200,130,0.16)'; rrect(x, -lw / 2, -11, lw, 22, 11); x.fill();
      x.strokeStyle = 'rgba(91,214,154,0.6)'; x.lineWidth = 1; rrect(x, -lw / 2, -11, lw, 22, 11); x.stroke();
      x.fillStyle = '#7BE3AE'; x.textAlign = 'center'; x.fillText(label, 0, 4.5);
      x.restore();
    }
    x.textAlign = 'left';
    return { pw, ph, cursor };
  }

  // ======================================================================
  // world state
  // ======================================================================
  const STACK_ORDER = [FOCUS_CARD, 1, 3, 0];           // front → back
  function cardState(i, t) {
    const [cx, cy] = L.cards[i];
    const st = 3.0 + i * 0.06;
    if (t < st) return null;
    const e = spring(t - st, 1.7, 0.72);
    let x = cx, y = cy, s = 1, ux = lerp(0.18, 1, clamp(e)), uy = lerp(0.24, 1, e), a = clamp(e * 2.2);
    // stack
    const d = STACK_ORDER.indexOf(i);
    const k = eio(prog(t, T.stack[0] + d * 0.03, T.stack[1] - (3 - d) * 0.02));
    if (k > 0) {
      x = lerp(cx, L.stackC[0], k); y = lerp(cy, L.stackC[1] - d * 20 * L.stackS, k);
      s = lerp(1, L.stackS * Math.pow(0.955, d), k);
      a *= lerp(1, 1 - 0.2 * d, k);
    }
    // fly away after the click
    const aw = eic(prog(t, T.away[0], T.away[1]));
    if (aw > 0) { s *= 1 + 0.5 * aw; a *= 1 - aw; }
    return { x, y, s, ux, uy, a, d, k, blur: aw * 18 };
  }
  // camera push-in on the focus card during the time-lapse
  function cam(t) {
    const kin = eio(prog(t, T.pushIn[0], T.pushIn[1])), kout = eio(prog(t, T.pullOut[0], T.pullOut[1]));
    const hold = 0.06 * eios(prog(t, T.pushHold[0], T.pullOut[1]));
    const k = kin * (1 - kout);
    const z = 1 + (L.zoomMax + hold) * k;
    const f = [lerp(CX0, L.cards[FOCUS_CARD][0], k), lerp(CY0, L.cards[FOCUS_CARD][1], k)];
    return { z, f, k };
  }
  const toScreen = (p, c) => [(p[0] - c.f[0]) * c.z + CX0, (p[1] - c.f[1]) * c.z + CY0];

  // ======================================================================
  // background
  // ======================================================================
  function background(t) {
    const g = X.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#00020F'); g.addColorStop(0.5, '#00051F'); g.addColorStop(1, '#000733');
    X.fillStyle = g; X.fillRect(0, 0, W, H);
    // drifting brand glow
    const gx = CX0 + W * 0.18 * Math.sin(t * 0.23), gy = H * 0.72 + H * 0.06 * Math.cos(t * 0.31);
    const r = Math.max(W, H) * 0.75;
    const b = X.createRadialGradient(gx, gy, 0, gx, gy, r);
    b.addColorStop(0, 'rgba(0,48,253,0.17)'); b.addColorStop(0.4, 'rgba(11,69,215,0.07)'); b.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = b; X.fillRect(0, 0, W, H);
    const hx = W * 0.2 + W * 0.1 * Math.cos(t * 0.17), hy = H * 0.15;
    const b2g = X.createRadialGradient(hx, hy, 0, hx, hy, r * 0.6);
    b2g.addColorStop(0, 'rgba(70,90,220,0.06)'); b2g.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = b2g; X.fillRect(0, 0, W, H);
    // dust with depth
    for (let i = 0; i < 110; i++) {
      const z = 0.3 + hash(i * 2.1) * 0.7;
      const px = ((hash(i) * W + t * (6 + 14 * z) * (hash(i * 5.3) > 0.5 ? 1 : -1)) % W + W) % W;
      const py = ((hash(i * 7.7) * H - t * (8 + 22 * z)) % H + H) % H;
      const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + hash(i) * 2) + i);
      const a = (0.08 + 0.32 * z) * tw;
      const rr = 0.7 + 2.4 * z * z;
      X.fillStyle = `rgba(170,195,255,${a.toFixed(3)})`; circle(X, px, py, rr); X.fill();
      if (z > 0.85) { G.fillStyle = `rgba(120,160,255,${(a * 0.8).toFixed(3)})`; circle(G, px, py, rr * 2); G.fill(); }
    }
  }

  // ======================================================================
  // intro: ember → sun → flash → mark → split
  // ======================================================================
  function intro(t) {
    if (t > T.unfold[1] + 0.1) return;
    const cx = CX0, cy = CY0;
    // ember rise
    if (t < T.flash) {
      const u = eoc(prog(t, 0, 0.5));
      const ey = lerp(H * 0.8, cy, u);
      const fl = 0.75 + 0.25 * Math.sin(t * 53) * Math.sin(t * 31);
      const sw = eic(prog(t, T.swell[0], T.swell[1]));
      const R = lerp(5, 70 * (V ? 1.1 : 1), sw);
      glowDot(cx, ey, R * (sw > 0 ? 1 : fl), C.brand, 1, sw > 0 ? 4.5 : 7);
      // reflection on the "floor"
      const ra = (1 - u) * 0.5;
      if (ra > 0.01) { X.fillStyle = `rgba(80,120,255,${ra})`; X.beginPath(); X.ellipse(cx, H * 0.82, 26, 5, 0, 0, TAU); X.fill(); }
      if (sw > 0) {
        X.fillStyle = `rgba(255,255,255,${0.9 * sw})`; circle(X, cx, cy, R * 0.55); X.fill();
        for (const [m, al] of [[1.3, 0.75], [1.55, 0.45]]) {
          for (const x of [X, G]) { x.strokeStyle = `rgba(150,190,255,${al * sw})`; x.lineWidth = 2.5; circle(x, cx, cy, R * m); x.stroke(); }
        }
        const hz = X.createRadialGradient(cx, cy, 0, cx, cy, R * 6);
        hz.addColorStop(0, `rgba(0,48,253,${0.35 * sw})`); hz.addColorStop(1, 'rgba(0,48,253,0)');
        X.fillStyle = hz; X.fillRect(0, 0, W, H);
      }
    }
    // flash
    const ft = t - T.flash;
    if (ft >= 0 && ft < 1.0) {
      const a = Math.exp(-ft / 0.11);
      X.fillStyle = `rgba(215,228,255,${0.95 * a})`; X.fillRect(0, 0, W, H);
      const s = Math.exp(-ft / 0.38);
      for (const x of [X, G]) {
        const sg = x.createLinearGradient(0, cy - 90, 0, cy + 90);
        sg.addColorStop(0, 'rgba(120,160,255,0)'); sg.addColorStop(0.5, `rgba(235,242,255,${0.9 * s})`); sg.addColorStop(1, 'rgba(120,160,255,0)');
        x.fillStyle = sg; x.fillRect(0, cy - 90, W, 180);
        x.fillStyle = `rgba(255,255,255,${s})`; x.fillRect(0, cy - 2, W, 4);
      }
      const hz = X.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6);
      hz.addColorStop(0, `rgba(60,110,255,${0.55 * Math.exp(-ft / 0.6)})`); hz.addColorStop(1, 'rgba(0,48,253,0)');
      X.fillStyle = hz; X.fillRect(0, 0, W, H);
    }
    // shockwave rings + sparks
    const su = prog(t, T.shock[0], T.shock[1]);
    if (su > 0 && su < 1) {
      [0, 0.09].forEach((dl, j) => {
        const u = prog(t, T.shock[0] + dl, T.shock[1]);
        if (u <= 0) return;
        const r = lerp(60, Math.max(W, H) * 0.85, eoc(u));
        for (const x of [X, G]) { x.strokeStyle = `rgba(150,190,255,${(1 - u) * (0.75 - 0.3 * j)})`; x.lineWidth = lerp(7, 1, u); circle(x, cx, cy, r); x.stroke(); }
      });
      for (let i = 0; i < 80; i++) {
        const a = hash(i * 3.3) * TAU, v = 0.35 + hash(i * 1.7) * 0.75;
        const u = prog(t, T.shock[0], T.shock[0] + 0.7 + hash(i) * 0.3);
        if (u >= 1) continue;
        const d = Math.max(W, H) * 0.45 * v * eoc(u), len = 46 * (1 - u) * v;
        const x0 = cx + Math.cos(a) * d, y0 = cy + Math.sin(a) * d;
        for (const x of [X, G]) {
          x.strokeStyle = `rgba(${i % 3 ? '170,200,255' : '255,255,255'},${(1 - u) * 0.9})`; x.lineWidth = 2;
          x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 - Math.cos(a) * len, y0 - Math.sin(a) * len); x.stroke();
        }
      }
    }
    // suck: inward streaks
    const ku = prog(t, T.suck[0], T.suck[1]);
    if (ku > 0 && ku < 1) {
      for (let i = 0; i < 46; i++) {
        const a = hash(i * 9.1) * TAU, r0 = (0.25 + 0.3 * hash(i * 4.4)) * Math.max(W, H);
        const u = clamp(ku * 1.15 - hash(i * 2.2) * 0.15);
        const d = r0 * (1 - eic(u)), len = 60 * Math.sin(Math.PI * u);
        const x0 = cx + Math.cos(a) * d, y0 = cy + Math.sin(a) * d;
        for (const x of [X, G]) {
          x.strokeStyle = `rgba(190,215,255,${0.8 * Math.sin(Math.PI * u)})`; x.lineWidth = 1.8;
          x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + Math.cos(a) * len, y0 + Math.sin(a) * len); x.stroke();
        }
      }
    }
    // the mark: revealed in the flash, splits into four, folds into the cards
    if (t >= T.flash && t < T.unfold[0] + 0.2) {
      const pop = t >= T.suck[1] - 0.04 ? Math.exp(-(t - (T.suck[1] - 0.04)) / 0.12) : 0;
      const mh = L.introMarkH * lerp(1.18, 1, eoc(prog(t, T.flash, T.flash + 0.5))) * (1 + 0.1 * pop);
      const sp = prog(t, T.split[0], T.split[1]);
      const fade = 1 - eoc(prog(t, T.unfold[0], T.unfold[0] + 0.16));
      const gl = 0.55 + 0.45 * Math.exp(-(t - T.flash) / 0.6) + pop;
      if (sp <= 0) {
        drawMark(X, cx, cy, mh, '#F4F7FF');
        drawMark(G, cx, cy, mh, '#9CC2FF', gl);
      } else {
        for (let i = 0; i < 4; i++) {
          const u = eio(prog(t, T.split[0] + i * 0.03, T.split[1] - 0.02));
          const [tx, ty] = L.cards[i];
          const px = lerp(cx, tx, u), py = lerp(cy, ty, u), h = lerp(mh, mh * 0.62, u);
          const vel = Math.sin(Math.PI * u);
          if (vel > 0.05) { // chromatic smear
            X.save(); X.globalCompositeOperation = 'lighter';
            drawMark(X, px - 14 * vel * Math.sign(tx - cx), py, h, 'rgba(255,60,90,1)', 0.22 * vel);
            drawMark(X, px + 14 * vel * Math.sign(tx - cx), py, h, 'rgba(60,140,255,1)', 0.28 * vel);
            X.restore();
          }
          drawMark(X, px, py, h, '#F4F7FF', fade);
          drawMark(G, px, py, h, '#9CC2FF', 0.7 * fade);
        }
      }
    }
  }

  // ======================================================================
  // work: cards, clock, stack, check, button, cursor
  // ======================================================================
  function clockPill(t, c) {
    const a = eoc(prog(t, T.clockIn, T.clockIn + 0.3)) * (1 - eic(prog(t, T.away[0], T.away[1])));
    if (a <= 0.003) return;
    const lift = eio(prog(t, T.stack[0], T.stack[1])) * (V ? 0 : 118);
    const p = toScreen([CX0, L.clockY - 12 * (1 - a) - lift], c), z = c.z * (V ? 1.35 : 1.12);
    const m = TL.clockMin(t), txt = TL.clockStr(m);
    const seven = t >= T.seven ? Math.exp(-(t - T.seven) / 0.8) : 0;
    const steady = t >= T.seven ? 1 : 0;
    X.save(); X.translate(p[0], p[1]); X.scale(z, z); X.globalAlpha = a;
    X.font = INTER(17, 600); X.letterSpacing = '0.5px';
    const tw = X.measureText('00:00 AM').width, w = tw + 54, h = 38;
    X.fillStyle = 'rgba(16,24,52,0.85)'; rrect(X, -w / 2, -h / 2, w, h, h / 2); X.fill();
    X.strokeStyle = `rgba(${steady ? '124,183,249' : '255,255,255'},${0.16 + 0.5 * steady + 0.3 * seven})`; X.lineWidth = 1.2; rrect(X, -w / 2, -h / 2, w, h, h / 2); X.stroke();
    // moon → sun
    const ix = -w / 2 + 20;
    if (!steady) { X.fillStyle = '#C9D6FF'; circle(X, ix, 0, 7); X.fill(); X.fillStyle = 'rgba(16,24,52,1)'; circle(X, ix + 3.5, -2.5, 6); X.fill(); }
    else {
      X.fillStyle = '#FFE7A8'; circle(X, ix, 0, 4.5); X.fill(); X.strokeStyle = '#FFE7A8'; X.lineWidth = 1.5;
      for (let k = 0; k < 8; k++) { const an = k * TAU / 8; X.beginPath(); X.moveTo(ix + Math.cos(an) * 7, Math.sin(an) * 7); X.lineTo(ix + Math.cos(an) * 9.5, Math.sin(an) * 9.5); X.stroke(); }
    }
    X.fillStyle = '#EEF2FA'; X.textAlign = 'left'; X.textBaseline = 'middle'; X.fillText(txt, ix + 16, 1);
    X.restore();
    if (steady) {
      G.save(); G.translate(p[0], p[1]); G.scale(z, z); G.globalAlpha = a * (0.35 + 0.9 * seven);
      G.strokeStyle = '#7CB7F9'; G.lineWidth = 3; rrect(G, -w / 2, -h / 2, w, h, h / 2); G.stroke(); G.restore();
    }
  }
  function work(t) {
    if (t < T.unfold[0] || t > T.away[1] + 0.05) return;
    const c = cam(t);
    clockPill(t, c);
    // draw order: during the time-lapse left→right, in the stack back→front
    const states = CARDS.map((_, i) => [i, cardState(i, t)]).filter(([, s]) => s);
    const stacking = t > T.stack[0];
    states.sort((a, b) => stacking ? b[1].d - a[1].d : a[0] - b[0]);
    for (const [i, s] of states) {
      const flash = t >= T.chips[i] ? Math.exp(-(t - T.chips[i]) / 0.35) : 0;
      const sc = toScreen([s.x, s.y], c);
      const R = Math.min(2.5, CS * s.s * c.z);
      const { pw, ph, cursor } = drawCard(i, t, R, flash);
      const dw = CW * R * s.ux, dh = CH * R * s.uy;
      const dof = i === FOCUS_CARD ? 0 : c.k * 7;
      // shadow
      X.save(); X.globalAlpha = s.a * 0.55;
      const sh = X.createRadialGradient(sc[0], sc[1] + dh * 0.1, 0, sc[0], sc[1] + dh * 0.1, Math.max(dw, dh) * 0.75);
      sh.addColorStop(0, 'rgba(0,0,10,0.8)'); sh.addColorStop(1, 'rgba(0,0,10,0)');
      X.fillStyle = sh; X.fillRect(sc[0] - dw, sc[1] - dh, dw * 2, dh * 2); X.restore();
      X.save(); X.globalAlpha = s.a;
      if (dof + s.blur > 0.3) X.filter = `blur(${(dof + s.blur).toFixed(1)}px)`;
      X.drawImage(cardCv[i], 0, 0, pw, ph, sc[0] - dw / 2, sc[1] - dh / 2, dw * pw / (CW * R), dh * ph / (CH * R));
      X.restore();
      // emissive rim + typing comet
      G.save(); G.globalAlpha = s.a * (0.22 + 0.8 * flash);
      G.strokeStyle = flash > 0.05 ? '#C8F5DD' : '#5F86FF'; G.lineWidth = 2; rrect(G, sc[0] - dw / 2, sc[1] - dh / 2, dw, dh, 18 * R); G.stroke(); G.restore();
      if (cursor && s.a > 0.5 && t < T.seven) {
        const cxp = sc[0] - dw / 2 + cursor[0] * R * s.ux, cyp = sc[1] - dh / 2 + cursor[1] * R * s.uy;
        const tl = 46 * R;
        const tg = X.createLinearGradient(cxp - tl, 0, cxp, 0);
        tg.addColorStop(0, 'rgba(124,183,249,0)'); tg.addColorStop(1, 'rgba(230,240,255,0.9)');
        X.fillStyle = tg; X.fillRect(cxp - tl, cyp - 1.5 * R, tl, 3 * R);
        glowDot(cxp, cyp, 3.2 * R, '#7CB7F9', 0.95, 4);
      }
    }
    // checkmark over the stack
    const cu = prog(t, T.check[0], T.check[1]);
    const away = eic(prog(t, T.away[0], T.away[1]));
    if (cu > 0 && away < 1) {
      const S = L.stackS * (1 + 0.5 * away), [sx, sy] = L.stackC;
      const P = [[-118, 22], [-36, 104], [150, -118]].map(([a, b]) => [sx + a * S * CS, sy + b * S * CS]);
      const l1 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), l2 = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
      const d = eio(cu) * (l1 + l2);
      const pts = [P[0]];
      if (d <= l1) pts.push([lerp(P[0][0], P[1][0], d / l1), lerp(P[0][1], P[1][1], d / l1)]);
      else { pts.push(P[1]); const k = (d - l1) / l2; pts.push([lerp(P[1][0], P[2][0], k), lerp(P[1][1], P[2][1], k)]); }
      const tip = pts[pts.length - 1], done = cu >= 1 ? Math.exp(-(t - T.check[1]) / 0.4) : 0;
      for (const [x, lw, col] of [[X, 20, null], [G, 26, '#9CC2FF']]) {
        x.save(); x.globalAlpha = 1 - away; x.lineCap = 'round'; x.lineJoin = 'round'; x.lineWidth = lw * S * CS;
        if (col) x.strokeStyle = col; else { const g = x.createLinearGradient(P[0][0], P[2][1], P[2][0], P[0][1]); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#A9CCFF'); x.strokeStyle = g; }
        x.beginPath(); x.moveTo(...pts[0]); for (const q of pts.slice(1)) x.lineTo(...q); x.stroke(); x.restore();
      }
      if (cu < 1) glowDot(tip[0], tip[1], 9 * S * CS, '#9CC2FF', 1, 6);
      if (done > 0.01) glowDot(P[2][0], P[2][1], 12 * S * CS, '#9CC2FF', done, 8);
    }
    // "Approve all" button + cursor
    const bi = prog(t, T.btnIn[0], T.btnIn[1]);
    if (bi > 0 && away < 1) {
      const sp = spring(t - T.btnIn[0], 2.4, 0.55);
      const press = t >= T.click ? 1 - 0.06 * Math.exp(-(t - T.click) / 0.06) * Math.sin(Math.min(Math.PI, (t - T.click) * 30)) : 1;
      const bs = (V ? 1.4 : 1.2) * sp * press * (1 + 0.3 * away);
      const bx = L.stackC[0], by = L.btnY;
      X.save(); X.translate(bx, by); X.scale(bs, bs); X.globalAlpha = clamp(sp) * (1 - away);
      X.font = INTER(19, 600); const tw = X.measureText('Approve all').width, w = tw + 70, h = 54;
      const clicked = t >= T.click ? eoc(prog(t, T.click, T.click + 0.12)) : 0;
      X.shadowColor = 'rgba(0,10,60,0.6)'; X.shadowBlur = 30; X.shadowOffsetY = 10;
      X.fillStyle = clicked ? '#0030FD' : '#F2F5FF'; rrect(X, -w / 2, -h / 2, w, h, h / 2); X.fill();
      X.shadowColor = 'transparent';
      X.fillStyle = clicked ? '#FFFFFF' : '#0B1A4A'; X.textAlign = 'left'; X.textBaseline = 'middle';
      X.fillText('Approve all', -w / 2 + 26, 1);
      X.strokeStyle = clicked ? '#FFFFFF' : '#0030FD'; X.lineWidth = 2.2; X.lineCap = 'round'; X.lineJoin = 'round';
      const ax = w / 2 - 30; X.beginPath(); X.moveTo(ax - 7, 0); X.lineTo(ax + 7, 0); X.moveTo(ax + 1, -6); X.lineTo(ax + 7, 0); X.lineTo(ax + 1, 6); X.stroke();
      X.restore();
      // click ring
      if (t >= T.click) {
        const u = prog(t, T.click, T.click + 0.55);
        for (const x of [X, G]) {
          x.save(); x.translate(bx, by); x.scale(bs, bs);
          x.globalAlpha = (1 - u) * (1 - away); x.strokeStyle = x === G ? '#7CB7F9' : 'rgba(170,205,255,1)'; x.lineWidth = lerp(8, 1.5, u);
          const gw = (tw + 70) + 120 * eoc(u), gh = 54 + 60 * eoc(u);
          rrect(x, -gw / 2, -gh / 2, gw, gh, gh / 2); x.stroke(); x.restore();
        }
      }
      // cursor
      const cu2 = eio(prog(t, T.cursor[0], T.cursor[1]));
      if (cu2 > 0) {
        const px = lerp(W * 0.8, bx + 18, cu2), py = lerp(H * 1.08, by + 14, cu2);
        const ps = (V ? 1.5 : 1.15) * (t >= T.click ? 1 - 0.15 * Math.exp(-Math.pow((t - T.click - 0.04) / 0.06, 2)) : 1);
        X.save(); X.translate(px, py); X.scale(ps, ps); X.globalAlpha = 1 - away;
        X.beginPath(); X.moveTo(0, 0); X.lineTo(0, 26); X.lineTo(6.5, 20); X.lineTo(11, 30); X.lineTo(15, 28.5); X.lineTo(10.5, 18.5); X.lineTo(19, 18.5); X.closePath();
        X.fillStyle = '#FFFFFF'; X.fill(); X.strokeStyle = '#0B1230'; X.lineWidth = 1.6; X.stroke(); X.restore();
      }
    }
  }

  // ======================================================================
  // comets → silence → horizon → lockup → collapse → end card
  // ======================================================================
  function comets(t) {
    if (t < T.comets[0] || t > T.horizon + 0.02) return;
    const [sx, sy] = L.stackC, [bx, by] = L.cometBox;
    for (let k = 0; k < 4; k++) {
      const head = TL.cometPos(k, t);
      if (head[2] <= 0) continue;
      const N = 18, pts = [];
      for (let j = 0; j < N; j++) { const q = TL.cometPos(k, t - j * 0.012); if (q[2] > 0) pts.push([sx + q[0] * bx, sy + q[1] * by]); }
      for (const x of [X, G]) {
        x.lineCap = 'round';
        for (let j = 1; j < pts.length; j++) {
          const f = 1 - j / pts.length;
          x.strokeStyle = `rgba(${x === G ? '124,183,249' : '200,222,255'},${(0.85 * f).toFixed(3)})`; x.lineWidth = 7 * f + 0.5;
          x.beginPath(); x.moveTo(...pts[j - 1]); x.lineTo(...pts[j]); x.stroke();
        }
      }
      const [hx, hy] = [sx + head[0] * bx, sy + head[1] * by];
      glowDot(hx, hy, 8, '#7CB7F9', 1 - 0.3 * head[2], 5);
      drawMark(X, hx, hy, 24, '#FFFFFF', head[2] < 1 ? 1 : 0);
    }
    // converged mini mark
    const cv = prog(t, T.comets[1] - 0.05, T.comets[1] + 0.05);
    if (cv > 0) { drawMark(X, sx, sy, 30, '#FFFFFF', cv); drawMark(G, sx, sy, 30, '#9CC2FF', cv); }
  }
  function horizon(t) {
    if (t < T.horizon || t > T.end[0] + 0.5) return;
    const hy = L.horizonY, ft = t - T.horizon;
    const lockK = eio(prog(t, T.lockMark[0], T.lockMark[1]));
    const col = eic(prog(t, T.collapse[0], T.collapse[1]));
    const gone = 1 - eoc(prog(t, T.end[0], T.end[0] + 0.4));
    const sq = 1 - col * 0.985;
    X.save(); X.globalAlpha = gone; X.translate(0, hy); X.scale(1, sq); X.translate(0, -hy);
    // haze band: a wide soft ellipse sitting on the horizon
    X.save(); X.translate(CX0, hy); X.scale(1, 0.3);
    const band = X.createRadialGradient(0, 0, 0, 0, 0, W * 0.6);
    band.addColorStop(0, `rgba(70,120,255,${0.3 + 0.35 * Math.exp(-ft / 0.6)})`); band.addColorStop(0.4, 'rgba(11,69,215,0.13)'); band.addColorStop(1, 'rgba(0,20,120,0)');
    X.fillStyle = band; circle(X, 0, 0, W * 0.6); X.fill(); X.restore();
    const low = X.createLinearGradient(0, hy - 120, 0, H);
    low.addColorStop(0, 'rgba(30,80,230,0)'); low.addColorStop(0.25, 'rgba(30,80,230,0.12)'); low.addColorStop(1, 'rgba(10,30,120,0)');
    X.fillStyle = low; X.fillRect(0, hy - 120, W, H - hy + 120);
    X.restore();
    // flash + horizon line (fades as the lockup builds, flares again on the collapse)
    if (ft < 0.6) { X.fillStyle = `rgba(215,228,255,${0.5 * Math.exp(-ft / 0.09)})`; X.fillRect(0, 0, W, H); }
    const li = gone * ((0.3 + 0.7 * Math.exp(-ft / 0.45)) * (1 - 0.88 * lockK) + col * 1.1);
    if (li <= 0.003) return;
    for (const x of [X, G]) {
      const lg = x.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, 'rgba(160,195,255,0)'); lg.addColorStop(0.5, `rgba(240,246,255,${Math.min(1, li)})`); lg.addColorStop(1, 'rgba(160,195,255,0)');
      x.fillStyle = lg; x.fillRect(0, hy - 1.5, W, 3);
      x.save(); x.translate(CX0, hy); x.scale(1, 0.07);
      const vg = x.createRadialGradient(0, 0, 0, 0, 0, W * 0.55);
      vg.addColorStop(0, `rgba(170,205,255,${0.55 * Math.min(1, li)})`); vg.addColorStop(1, 'rgba(90,140,255,0)');
      x.fillStyle = vg; circle(x, 0, 0, W * 0.55); x.fill(); x.restore();
    }
  }
  function lockup(t) {
    if (t < T.horizon || t > T.end[0] + 0.05) return;
    const ft = t - T.horizon;
    const lockK = eio(prog(t, T.lockMark[0], T.lockMark[1]));
    const col = eic(prog(t, T.collapse[0], T.collapse[1]));
    const push = 1 + 0.035 * eios(prog(t, T.slogan[1], T.collapse[0]));
    const gc = [L.lockMarkC[0], (L.lockMarkC[1] + L.wordBase) / 2];
    X.save(); G.save();
    for (const x of [X, G]) {
      if (x === G) x.setTransform(0.5, 0, 0, 0.5, 0, 0);
      x.translate(0, L.horizonY); x.scale(1, 1 - col * 0.985); x.translate(0, -L.horizonY);
      x.translate(gc[0], gc[1]); x.scale(push, push); x.translate(-gc[0], -gc[1]);
    }
    // mark: on the horizon, then up into the lockup
    const mx = lerp(CX0, L.lockMarkC[0], lockK), my = lerp(L.horizonY, L.lockMarkC[1], lockK);
    const mh = lerp(L.horizonMarkH * lerp(1.12, 1, eoc(prog(ft, 0, 0.6))), L.lockMarkH, lockK);
    drawMark(X, mx, my, mh, '#FFFFFF');
    drawMark(G, mx, my, mh, '#0030FD', 0.7 * (1 - lockK) + 0.8 * Math.exp(-ft / 0.4) + 0.35);
    // wordmark: letters rise out of the baseline, then a light sweep
    const wt = t - T.word[0];
    if (wt > 0) {
      const txt = 'Sora Systems';
      WM.setTransform(1, 0, 0, 1, 0, 0); WM.clearRect(0, 0, wm.width, wm.height);
      WM.font = '900 200px "Archivo"'; WM.fontStretch = 'extra-condensed'; WM.letterSpacing = '0px';
      const w0 = WM.measureText(txt).width, fs = 200 * L.wordW / w0;
      WM.font = `900 ${fs.toFixed(2)}px "Archivo"`; WM.fontStretch = 'extra-condensed';
      const base = wm.height * 0.78, left = (W - L.wordW) / 2;
      const capH = fs * 0.72;
      const grad = WM.createLinearGradient(0, base - capH, 0, base + fs * 0.2);
      grad.addColorStop(0, '#FFFFFF'); grad.addColorStop(0.55, '#D4E6FC'); grad.addColorStop(0.85, '#96C5F8'); grad.addColorStop(1, '#569DF7');
      WM.save(); WM.beginPath(); WM.rect(0, 0, wm.width, base + fs * 0.24); WM.clip();
      let px = left;
      [...txt].forEach((ch, i) => {
        const cw = WM.measureText(ch).width;
        const e = eoq(prog(wt, i * 0.035, i * 0.035 + 0.5));
        if (e > 0) { WM.fillStyle = grad; WM.fillText(ch, px, base + (1 - e) * fs * 1.05); }
        px += cw;
      });
      WM.restore();
      // specular sweep(s)
      for (const [s0, s1, a] of [[0.25, 0.95, 0.85], [2.8, 3.6, 0.45]]) {
        const u = prog(wt, s0, s1);
        if (u <= 0 || u >= 1) continue;
        const sx = lerp(left - 300, left + L.wordW + 300, eios(u));
        WM.save(); WM.globalCompositeOperation = 'source-atop';
        const sg = WM.createLinearGradient(sx - 120, 0, sx + 120, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, `rgba(255,255,255,${a})`); sg.addColorStop(1, 'rgba(255,255,255,0)');
        WM.setTransform(1, 0, -0.35, 1, 0, 0); WM.fillStyle = sg; WM.fillRect(sx - 400, 0, 800, wm.height); WM.restore();
      }
      const oy = L.wordBase - base;
      X.drawImage(wm, 0, oy);
      G.globalAlpha = 0.18; G.drawImage(wm, 0, oy); G.globalAlpha = 1;
      // slogan: split left / right, sliding out from the centre
      const sl = prog(t, T.slogan[0], T.slogan[1]);
      if (sl > 0) {
        X.font = '400 100px "Open Sans"'; const ssz = 100 * L.sloganW / X.measureText('Intelligent technology').width;
        X.font = `400 ${ssz.toFixed(2)}px "Open Sans"`; X.textBaseline = 'alphabetic';
        [['Intelligent technology', 'left', left, 1], ['Built for real impact', 'right', left + L.wordW, -1]].forEach(([s, al, ax, dir], j) => {
          const e = eoc(prog(t, T.slogan[0] + j * 0.12, T.slogan[1] + j * 0.12));
          if (e <= 0) return;
          X.save(); X.globalAlpha = e; X.textAlign = al;
          const bl = (1 - e) * 8; if (bl > 0.3) X.filter = `blur(${bl.toFixed(1)}px)`;
          X.fillStyle = '#96C5F8'; X.fillText(s, ax + dir * 50 * (1 - e), L.sloganY); X.restore();
        });
      }
    }
    X.restore(); G.restore();
  }
  function endCard(t) {
    if (t < T.end[0] - 0.02) return;
    const u = t - T.end[0];
    const e = eoc(prog(u, 0, 0.7));
    const [cx, cy] = L.endC, [rx, ry] = L.endR;
    X.save(); X.translate(cx, cy); X.scale(1, ry / rx);
    const g = X.createRadialGradient(0, 0, 0, 0, 0, rx * lerp(0.2, 1, e));
    g.addColorStop(0, `rgba(150,197,248,${0.5 * e})`); g.addColorStop(0.45, `rgba(51,125,244,${0.22 * e})`); g.addColorStop(1, 'rgba(0,29,158,0)');
    X.fillStyle = g; circle(X, 0, 0, rx); X.fill(); X.restore();
    // line bloom
    const lb = Math.exp(-u / 0.25);
    for (const x of [X, G]) { x.fillStyle = `rgba(240,246,255,${lb})`; x.fillRect(cx - rx * (1 - 0.6 * e), cy - 1.5, rx * 2 * (1 - 0.6 * e), 3); }
    const ta = eoc(prog(u, 0.3, 0.9));
    if (ta > 0) {
      const mh = V ? 84 : 70;
      drawMark(X, cx, cy - (V ? 70 : 58), mh, '#FFFFFF', ta);
      drawMark(G, cx, cy - (V ? 70 : 58), mh, '#0030FD', 0.5 * ta);
      X.save(); X.globalAlpha = ta; const bl = (1 - ta) * 8; if (bl > 0.3) X.filter = `blur(${bl.toFixed(1)}px)`;
      X.font = INTER(V ? 44 : 40, 600); X.textAlign = 'center'; X.textBaseline = 'alphabetic'; X.fillStyle = '#F2F5FF';
      X.fillText('business@sorasystems.tech', cx, cy + (V ? 62 : 52) + (1 - ta) * 10);
      X.restore();
    }
  }

  // ======================================================================
  // compose
  // ======================================================================
  function drawSample(t) {
    X.setTransform(1, 0, 0, 1, 0, 0); X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'; X.filter = 'none';
    G.setTransform(1, 0, 0, 1, 0, 0); G.globalAlpha = 1; G.globalCompositeOperation = 'source-over'; G.fillStyle = '#000'; G.fillRect(0, 0, W / 2, H / 2);
    G.setTransform(0.5, 0, 0, 0.5, 0, 0);
    background(t);
    // the hush before the horizon hit
    const hush = eio(prog(t, T.silence[0] - 0.1, T.silence[1])) * (t < T.horizon ? 1 : 0);
    if (hush > 0) { X.fillStyle = `rgba(0,2,10,${0.75 * hush})`; X.fillRect(0, 0, W, H); }
    // the end card sits on a calmer stage
    const calm = eio(prog(t, T.collapse[0], T.end[0] + 0.2));
    if (calm > 0) { X.fillStyle = `rgba(1,4,16,${0.55 * calm})`; X.fillRect(0, 0, W, H); }
    intro(t); work(t); comets(t); horizon(t); lockup(t); endCard(t);
    // bloom
    B1.filter = 'blur(2px)'; B1.clearRect(0, 0, b1.width, b1.height); B1.drawImage(glow, 0, 0, b1.width, b1.height);
    B2.filter = 'blur(3px)'; B2.clearRect(0, 0, b2.width, b2.height); B2.drawImage(b1, 0, 0, b2.width, b2.height);
    B3.filter = 'blur(3px)'; B3.clearRect(0, 0, b3.width, b3.height); B3.drawImage(b2, 0, 0, b3.width, b3.height);
    X.save(); X.setTransform(1, 0, 0, 1, 0, 0); X.globalCompositeOperation = 'lighter'; X.imageSmoothingQuality = 'high';
    X.globalAlpha = 0.3; X.drawImage(glow, 0, 0, W, H);
    X.globalAlpha = 0.55; X.drawImage(b1, 0, 0, W, H);
    X.globalAlpha = 0.6; X.drawImage(b2, 0, 0, W, H);
    X.globalAlpha = 0.6; X.drawImage(b3, 0, 0, W, H);
    X.restore();
    // vignette
    const v = X.createRadialGradient(CX0, CY0, Math.min(W, H) * 0.4, CX0, CY0, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,2,12,0.5)');
    X.fillStyle = v; X.fillRect(0, 0, W, H);
  }

  const FAST = [[0.95, 1.95, 6], [1.95, 2.95, 6], [2.95, 3.45, 6], [3.45, 8.3, 3], [8.3, 8.95, 6], [8.95, 9.65, 6],
    [10.05, 10.8, 6], [10.8, 12.05, 8], [12.95, 13.8, 6], [17.45, 18.2, 6]];
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
