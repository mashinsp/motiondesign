// Shared timeline: scene timing, geometry and the sound-event list.
// Loaded by the canvas page (window.TL) and by node (require) to export events.json.
(function (root) {
  const FPS = 60, W = 1080, H = 1920, DUR = 31.0;

  // ---------- math helpers ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const eoc = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const eoq = (x) => 1 - Math.pow(1 - clamp(x), 4);
  const eic = (x) => Math.pow(clamp(x), 3);
  const eio = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const eios = (x) => { x = clamp(x); return -(Math.cos(Math.PI * x) - 1) / 2; };
  const eoe = (x) => { x = clamp(x); return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); };
  // damped spring step response, t in seconds since start (0..inf) -> ~0..1 with light overshoot
  const spring = (t, f = 2.2, z = 0.55) => {
    if (t <= 0) return 0;
    const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  };
  // deterministic hash noise
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ---------- scene windows ----------
  const S = {
    chat: [0.0, 3.4],
    goal: [3.4, 6.7],
    plan: [6.7, 10.0],
    tools: [10.0, 13.3],
    memory: [13.3, 16.5],
    loop: [16.5, 20.2],
    collab: [20.2, 23.7],
    system: [23.7, 27.0],
    end: [27.0, DUR],
  };

  // ---------- geometry ----------
  const CX = 540, CY = 980;

  // Plan: goal node at top, four step pills down an S-path
  const PLAN_GOAL = [540, 560];
  const PLAN_NODES = [[372, 790], [708, 1000], [372, 1210], [708, 1420]];
  const PLAN_LABELS = ['Search', 'Compare', 'Draft', 'Verify'];
  // sampled path through goal + nodes (cubic segments with vertical tangents)
  function buildPlanPath() {
    const pts = [PLAN_GOAL, ...PLAN_NODES];
    const out = [];
    const marks = [0];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const dy = (y1 - y0) * 0.55;
      for (let k = (i === 0 ? 0 : 1); k <= 60; k++) {
        const u = k / 60, v = 1 - u;
        const x = v * v * v * x0 + 3 * v * v * u * x0 + 3 * v * u * u * x1 + u * u * u * x1;
        const y = v * v * v * y0 + 3 * v * v * u * (y0 + dy) + 3 * v * u * u * (y1 - dy) + u * u * u * y1;
        out.push([x, y]);
      }
      marks.push(out.length - 1);
    }
    const len = [0];
    for (let i = 1; i < out.length; i++) len.push(len[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    const total = len[len.length - 1];
    return { pts: out, len, total, nodeFrac: marks.map((m) => len[m] / total) };
  }
  const PLAN = buildPlanPath();
  const planDraw = (t) => eios(prog(t, 6.85, 8.55));        // fraction of path drawn

  // Tools: five tiles on a ring around the core
  const TOOL_R = 300;
  const TOOL_ANG = [-90, -18, 54, 126, 198].map((a) => a * Math.PI / 180);
  const TOOL_LAND = [10.05, 10.17, 10.29, 10.41, 10.53];
  const TOOL_PULSE = [11.0, 11.32, 11.64, 11.96, 12.28];     // pulse leaves core
  const PULSE_DUR = 0.26;
  const toolSpin = (t) => 0.22 * eios(prog(t, 9.9, 13.3));

  // Memory cards
  const CARD_IN = [13.5, 13.9, 14.3, 14.7];

  // Loop (light mode)
  const LOOP_R = 300, LOOP_CY = 1010;
  const LOOP_ANG = [-90, 30, 150].map((a) => a * Math.PI / 180);
  const LOOP_PILL_IN = [16.8, 17.02, 17.24];
  const loopTheta = (t) => -Math.PI / 2 + 2 * Math.PI * 2 * eio(prog(t, 17.85, 19.65));

  // Network (collaborate)
  const NET = [[540, 690], [812, 836], [826, 1124], [552, 1268], [276, 1130], [262, 842], [544, 980]];
  const NET_EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [6, 0], [6, 2], [6, 4], [6, 1], [6, 3], [6, 5]];
  const NET_SIG = [ // [edge, start, reverse]
    [6, 21.15, 0], [7, 21.4, 0], [1, 21.62, 0], [8, 21.85, 1], [4, 22.05, 0],
    [9, 22.25, 0], [2, 22.42, 1], [10, 22.6, 1], [5, 22.78, 0], [11, 22.95, 0],
  ];
  const SIG_DUR = 0.42;
  const netOut = (i) => 20.28 + i * 0.045;   // node launch times

  // Blob: main drop + satellites that pinch off and merge back
  const BLOB_C = [540, 960];
  const BLOB_SATS = [
    { a: -0.9, w: 0.45, r: 74, keys: [[24.0, 0], [24.65, 1], [25.35, 0.1], [25.95, 0.85], [26.3, 0]] },
    { a: 2.3, w: -0.38, r: 66, keys: [[24.2, 0], [24.95, 0.95], [25.7, 0.05], [26.3, 0]] },
    { a: 0.9, w: 0.3, r: 58, keys: [[24.5, 0], [25.25, 0.9], [26.3, 0]] },
  ];
  function satOut(s, t) {
    const k = s.keys;
    if (t <= k[0][0]) return k[0][1];
    for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1][0]) return lerp(k[i][1], k[i + 1][1], eios((t - k[i][0]) / (k[i + 1][0] - k[i][0])));
    return k[k.length - 1][1];
  }

  // ---------- events ----------
  // midi helpers: Db major pentatonic
  const PENT = [0, 2, 4, 7, 9];
  const pent = (i, base = 61) => base + PENT[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5);
  const panX = (x) => clamp((x - CX) / 540, -1, 1) * 0.7;

  const EV = [];
  const ev = (t, type, o = {}) => EV.push(Object.assign({ t: Math.round(t * FPS) / FPS, type, gain: 1, pan: 0 }, o));

  // chord changes (pad + bass)
  const CHORDS = [
    [0.0, 'Dbmaj9'], [3.4, 'Bbm9'], [6.7, 'Gbmaj9'], [10.0, 'Ebm11'], [13.3, 'Ab69'],
    [16.5, 'Gblyd'], [20.2, 'Bbm9hi'], [23.7, 'Gbmaj9'], [26.3, 'Absus'], [27.0, 'DbmajEnd'],
  ];

  // S1 chat
  ev(0.12, 'swell', { dur: 0.6, gain: 0.35, midi: pent(10) });
  ev(0.34, 'drop', { midi: pent(12), gain: 0.55 });
  ev(0.78, 'pop', { midi: pent(8), gain: 0.8 });
  ev(0.78, 'sub', { midi: 37, gain: 0.45, dur: 1.6 });
  [1.02, 1.18, 1.34, 1.56, 1.72, 1.88].forEach((t, i) => ev(t, 'tick', { midi: pent(15 + (i % 3)), gain: 0.28, pan: (i % 3 - 1) * 0.25 }));
  ev(2.08, 'glass', { midi: pent(12), gain: 0.7 });
  ev(2.12, 'glass', { midi: pent(14), gain: 0.4, pan: 0.3 });
  ev(2.55, 'tick', { midi: pent(17), gain: 0.18 });
  ev(2.80, 'tick', { midi: pent(17), gain: 0.15 });
  ev(3.0, 'reverse', { dur: 0.4, midi: pent(9), gain: 0.6 });
  // S2 goal
  ev(3.4, 'boom', { midi: 34, gain: 1.0 });
  ev(3.4, 'bell', { midi: pent(10), gain: 0.8 });
  [0, 1, 2].forEach((i) => ev(3.42 + i * 0.09, 'drop', { midi: pent(7 + i * 2), gain: 0.45, pan: (i - 1) * 0.35 }));
  [4.78, 4.88, 4.98, 5.08].forEach((t, i) => ev(t, 'click', { midi: pent(10 + i), gain: 0.55, pan: [-0.5, 0.5, 0.5, -0.5][i] }));
  ev(5.28, 'bell', { midi: pent(14), gain: 0.75 });
  ev(5.28, 'kalimba', { midi: pent(9), gain: 0.5 });
  ev(5.98, 'reverse', { dur: 0.42, midi: pent(11), gain: 0.45 });
  ev(6.42, 'whoosh', { dur: 0.45, gain: 0.55, pan: 0, dir: 1 });
  // S3 plan
  ev(6.75, 'glass', { midi: pent(12), gain: 0.5 });
  PLAN.nodeFrac.slice(1).forEach((f, i) => {
    // find time the drawn path reaches node i
    let tt = 6.85; while (planDraw(tt) < f - 1e-4 && tt < 9) tt += 1 / 600;
    ev(tt, 'kalimba', { midi: pent(5 + i * 1 + (i > 1 ? 1 : 0)), gain: 0.75, pan: panX(PLAN_NODES[i][0]) });
    ev(tt + 0.02, 'tick', { midi: pent(15 + i), gain: 0.2, pan: panX(PLAN_NODES[i][0]) });
  });
  [9.0, 9.1, 9.2, 9.3].forEach((t, i) => ev(t, 'harp', { midi: pent(10 + i), gain: 0.45, pan: panX(PLAN_NODES[i][0]) }));
  ev(9.42, 'whoosh', { dur: 0.6, gain: 0.6, dir: -1 });
  // S4 tools
  ev(9.95, 'sub', { midi: 39, gain: 0.55, dur: 1.4 });
  TOOL_LAND.forEach((t, i) => ev(t, 'harp', { midi: pent(7 + [0, 2, 1, 3, 4][i]), gain: 0.7, pan: Math.cos(TOOL_ANG[i]) * 0.6 }));
  TOOL_PULSE.forEach((t, i) => {
    ev(t, 'tick', { midi: pent(16), gain: 0.15, pan: 0 });
    ev(t + PULSE_DUR, 'glass', { midi: pent(10 + [0, 2, 1, 3, 4][i]), gain: 0.6, pan: Math.cos(TOOL_ANG[i]) * 0.7 });
  });
  ev(12.62, 'reverse', { dur: 0.6, midi: pent(12), gain: 0.5 });
  ev(12.9, 'whoosh', { dur: 0.5, gain: 0.5, dir: 1 });
  // S5 memory
  ev(13.3, 'pop', { midi: pent(5), gain: 0.6 });
  CARD_IN.forEach((t, i) => {
    ev(t + 0.16, 'thud', { midi: pent(0 + i), gain: 0.75 });
    ev(t + 0.18, 'kalimba', { midi: pent(10 + i), gain: 0.4, pan: 0.2 * (i % 2 ? 1 : -1) });
  });
  ev(15.1, 'glass', { midi: pent(14), gain: 0.35 });
  ev(15.72, 'reverse', { dur: 0.75, midi: pent(10), gain: 0.65 });
  ev(16.2, 'whoosh', { dur: 0.7, gain: 0.65, dir: 1 });
  // S6 loop (light)
  ev(16.5, 'boom', { midi: 30, gain: 0.7 });
  ev(16.5, 'bell', { midi: pent(12), gain: 0.6 });
  ev(16.52, 'shimmer', { dur: 1.2, gain: 0.35 });
  LOOP_PILL_IN.forEach((t, i) => ev(t + 0.05, 'pluck', { midi: pent(5 + i * 2), gain: 0.7, pan: Math.cos(LOOP_ANG[i]) * 0.6 }));
  // loop passes, computed from the same spark motion the renderer uses
  {
    let prev = loopTheta(17.85), k = 0;
    for (let tt = 17.85; tt <= 19.7; tt += 1 / 600) {
      const th = loopTheta(tt);
      for (let n = 0; n < 3; n++) {
        for (let rev = 0; rev < 3; rev++) {
          const target = LOOP_ANG[n] + rev * 2 * Math.PI;
          if (prev < target && th >= target) {
            ev(tt, 'bell', { midi: pent(9 + k), gain: 0.55, pan: Math.cos(LOOP_ANG[n]) * 0.6, node: n });
            k++;
          }
        }
      }
      prev = th;
    }
  }
  ev(19.55, 'reverse', { dur: 0.6, midi: pent(11), gain: 0.5 });
  ev(19.8, 'whoosh', { dur: 0.6, gain: 0.6, dir: -1 });
  // S7 collaborate
  ev(20.2, 'boom', { midi: 34, gain: 0.75 });
  NET.forEach((p, i) => ev(netOut(i) + 0.08, 'harp', { midi: pent(8 + i), gain: 0.4, pan: panX(p[0]) }));
  ev(20.75, 'string', { dur: 1.2, midi: pent(5), gain: 0.35 });
  NET_SIG.forEach(([e, t0, rev], i) => {
    const [a, b] = NET_EDGES[e]; const to = rev ? a : b;
    ev(t0 + SIG_DUR, 'drop', { midi: pent(9 + (to * 2) % 7), gain: 0.5, pan: panX(NET[to][0]) });
  });
  ev(23.05, 'reverse', { dur: 0.6, midi: pent(7), gain: 0.5 });
  // S8 system (blob)
  ev(23.7, 'sub', { midi: 30, gain: 0.7, dur: 2.0 });
  ev(23.72, 'bubble', { midi: pent(2), gain: 0.6 });
  // pinch-off / merge moments: satellite crosses the surface-tension distance
  BLOB_SATS.forEach((s, si) => {
    let prev = satOut(s, 24.0), n = 0;
    for (let tt = 24.0; tt < 26.3; tt += 1 / 600) {
      const f = satOut(s, tt), TH = 0.62;
      if ((prev < TH) !== (f < TH)) {
        const ang = s.a + s.w * (tt - 24);
        ev(tt, 'bubble', { midi: pent(4 + si * 2 + n), gain: f > prev ? 0.55 : 0.4, pan: Math.cos(ang) * 0.6, up: f > prev ? 1 : 0 });
        n++;
      }
      prev = f;
    }
  });
  ev(24.0, 'glass', { midi: pent(12), gain: 0.35 });
  ev(24.5, 'glass', { midi: pent(14), gain: 0.4 });
  ev(26.35, 'reverse', { dur: 0.65, midi: pent(10), gain: 0.75 });
  // S9 end
  ev(27.0, 'boom', { midi: 25, gain: 1.0 });
  ev(27.0, 'bell', { midi: pent(10), gain: 0.85 });
  ev(27.0, 'bell', { midi: pent(12), gain: 0.5, pan: -0.3 });
  ev(27.02, 'bell', { midi: pent(14), gain: 0.4, pan: 0.3 });
  [0, 1, 2, 3, 4, 5, 6].forEach((i) => ev(27.08 + i * 0.1, 'harp', { midi: pent(5 + i), gain: 0.4, pan: Math.sin(i) * 0.5 }));
  ev(27.95, 'glass', { midi: pent(15), gain: 0.5 });
  ev(28.15, 'shimmer', { dur: 1.6, gain: 0.3 });
  ev(28.55, 'kalimba', { midi: pent(12), gain: 0.4 });
  ev(28.62, 'kalimba', { midi: pent(14), gain: 0.3 });

  EV.sort((a, b) => a.t - b.t);

  const TL = {
    FPS, W, H, DUR, S, CX, CY, clamp, lerp, prog, eoc, eoq, eic, eio, eios, eoe, spring, hash,
    PLAN_GOAL, PLAN_NODES, PLAN_LABELS, PLAN, planDraw,
    TOOL_R, TOOL_ANG, TOOL_LAND, TOOL_PULSE, PULSE_DUR, toolSpin,
    CARD_IN, LOOP_R, LOOP_CY, LOOP_ANG, LOOP_PILL_IN, loopTheta,
    NET, NET_EDGES, NET_SIG, SIG_DUR, netOut, BLOB_C, BLOB_SATS, satOut,
    EVENTS: EV, CHORDS,
  };
  if (typeof module !== 'undefined') module.exports = TL; else root.TL = TL;
})(typeof window !== 'undefined' ? window : globalThis);
