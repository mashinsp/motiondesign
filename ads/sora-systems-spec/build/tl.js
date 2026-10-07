// SORA SYSTEMS spec ad — shared timeline (picture + sound). Format-independent.
// Loaded by the canvas page (window.TL) and by node (require) to export events.json.
(function (root) {
  const FPS = 60, DUR = 21.0, BPM = 120;

  // ---------- math ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const eoc = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const eoq = (x) => 1 - Math.pow(1 - clamp(x), 5);
  const eic = (x) => Math.pow(clamp(x), 3);
  const eio = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const eios = (x) => { x = clamp(x); return -(Math.cos(Math.PI * x) - 1) / 2; };
  const eoe = (x) => { x = clamp(x); return x === 1 ? 1 : 1 - Math.pow(2, -10 * x); };
  const eie = (x) => { x = clamp(x); return x === 0 ? 0 : Math.pow(2, 10 * x - 10); };
  const spring = (t, f = 2.2, z = 0.55) => {
    if (t <= 0) return 0;
    const w = 2 * Math.PI * f, wd = w * Math.sqrt(1 - z * z);
    return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  };
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  // ---------- beats (seconds) ----------
  const T = {
    emberRise: [0.0, 0.5], swell: [0.5, 1.0], flash: 1.0, shock: [1.0, 2.0],
    suck: [2.0, 2.4], split: [2.4, 2.9], unfold: [3.0, 3.4], clockIn: 3.12,
    work: [3.4, 8.0], pushIn: [5.0, 5.8], pushHold: [5.8, 6.4], pullOut: [6.4, 7.0],
    seven: 8.0, chips: [8.02, 8.1, 8.18, 8.26], stack: [8.3, 8.9],
    check: [9.0, 9.6], btnIn: [10.0, 10.35], cursor: [10.08, 10.62], click: 10.75,
    away: [10.8, 11.1], comets: [10.9, 11.75], silence: [11.75, 12.0], horizon: 12.0,
    lockMark: [13.0, 13.6], word: [13.05, 13.7], slogan: [13.85, 14.5],
    collapse: [17.5, 18.0], end: [18.0, DUR],
  };

  // ---------- cards (one per service) ----------
  const CARDS = [
    {
      service: 'AI TRANSFORMATION', title: 'Automate operations', file: 'transform.py', lang: 'py',
      run: 'Mapping workflows…', done: 'Rollout plan ready', chip: '37 workflows', diff: [58, 0],
      code: [
        'workflows = audit(org.processes)',
        'for wf in workflows:',
        '    if wf.repetitive:',
        '        plan.add(automate(wf))',
        'plan.prioritize(by="impact")',
        'plan.rollout(phase="pilot")',
      ],
    },
    {
      service: 'CLOUD', title: 'Migrate to the cloud', file: 'main.tf', lang: 'tf',
      run: 'Provisioning infrastructure…', done: 'Deployed', chip: '3/3 healthy', diff: [24, 3],
      code: [
        'module "platform" {',
        '  source    = "./modules/k8s"',
        '  region    = "eu-central-1"',
        '  replicas  = 3',
        '  autoscale = true',
        '}',
      ],
    },
    {
      service: 'AGENTIC AI', title: 'Deploy support agent', file: 'agent.ts', lang: 'ts',
      run: 'Resolving tickets…', done: 'Inbox cleared', chip: '128 resolved', diff: [41, 2],
      code: [
        'const agent = createAgent({',
        '  tools: [crm, email, calendar],',
        "  memory: 'long-term',",
        "  guardrails: 'strict',",
        '})',
        "await agent.run('triage inbox')",
      ],
    },
    {
      service: 'CUSTOM SOFTWARE', title: 'Build client portal', file: 'Portal.tsx', lang: 'tsx',
      run: 'Writing components…', done: 'Tests passing', chip: '42/42 tests', diff: [86, 12],
      code: [
        'export function Portal({ user }) {',
        '  const { data } = useInvoices(user)',
        '  return (',
        '    <Dashboard>',
        '      <InvoiceTable rows={data} />',
        '    </Dashboard>',
        '  )',
        '}',
      ],
    },
  ];
  const FOCUS_CARD = 2; // push-in target + front of the stack

  // typing schedule: per card, per line [tStart, tEnd]
  const TYPE_START = [3.5, 3.62, 3.74, 3.86], TYPE_END = 7.55, LINE_PAUSE = 0.07;
  CARDS.forEach((c, i) => {
    const chars = c.code.reduce((a, l) => a + l.trimStart().length, 0);
    const avail = TYPE_END - TYPE_START[i] - LINE_PAUSE * c.code.length;
    const dt = avail / chars;
    let t = TYPE_START[i];
    c.lineT = c.code.map((l) => { const n = l.trimStart().length; const a = t; t += n * dt + LINE_PAUSE; return [a, a + n * dt]; });
  });
  // number of visible chars of line k at time t
  const typed = (c, k, t) => {
    const [a, b] = c.lineT[k], n = c.code[k].trimStart().length;
    return Math.floor(n * clamp((t - a) / (b - a)));
  };

  // clock: 23:58 -> 07:00, minutes since midnight (mod 1440)
  const clockMin = (t) => {
    if (t >= T.seven) return 7 * 60;
    const m = lerp(-2, 419, eio(prog(t, T.work[0], T.seven - 0.06)));
    return (Math.floor(m) + 1440) % 1440;
  };
  const clockStr = (m) => {
    const h24 = Math.floor(m / 60), mm = m % 60, ap = h24 >= 12 ? 'PM' : 'AM';
    const h12 = ((h24 + 11) % 12) + 1;
    return `${String(h12).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${ap}`;
  };

  // comets: unit-space paths around the stack centre (x,y in [-1,1] of a half-extent box)
  const COMETS = [0, 1, 2, 3].map((k) => ({ a0: -Math.PI / 2 + k * Math.PI / 2 + 0.4, dir: k % 2 ? -1 : 1, r: 0.92 - 0.06 * k }));
  const cometPos = (k, t) => {
    const c = COMETS[k], u = prog(t, T.comets[0] + k * 0.03, T.comets[1]);
    const r = c.r * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.9);
    const a = c.a0 + c.dir * 2.1 * Math.PI * eios(u);
    return [Math.cos(a) * r, Math.sin(a) * r, u];
  };

  // ---------- sound events (frame-accurate) ----------
  const EV = [];
  const ev = (t, type, o = {}) => EV.push(Object.assign({ t: Math.round(t * FPS) / FPS, type, gain: 1, pan: 0 }, o));
  ev(0.0, 'ember', { dur: 0.6 });
  ev(0.5, 'swell', { dur: 0.5 });
  ev(T.flash, 'impact', { size: 1.0 });
  ev(T.flash, 'shock', { dur: 0.9 });
  ev(T.flash + 0.04, 'sparkle', { dur: 0.9, gain: 0.7 });
  ev(T.suck[0], 'reverse', { dur: 0.4, gain: 0.7 });
  ev(2.4, 'whoosh', { dur: 0.35, pan: -0.5, gain: 0.8 });
  ev(2.52, 'whoosh', { dur: 0.35, pan: 0.5, gain: 0.8 });
  [0, 1, 2, 3].forEach((i) => ev(2.84 + i * 0.03, 'tick', { pan: (i - 1.5) * 0.4, gain: 0.5 }));
  [0, 1, 2, 3].forEach((i) => ev(3.06 + i * 0.06, 'thunk', { pan: (i - 1.5) * 0.4, gain: 0.8 }));
  ev(T.clockIn, 'tick', { gain: 0.45 });
  CARDS.forEach((c, i) => c.lineT.forEach(([a, b]) => ev(b, 'type', { pan: (i - 1.5) * 0.35, gain: 0.35 })));
  ev(T.pushIn[0], 'cam', { dur: 0.8, gain: 0.6 });
  ev(T.pullOut[0], 'cam', { dur: 0.6, gain: 0.5, dir: -1 });
  ev(T.seven, 'chime', { gain: 0.9 });
  T.chips.forEach((t, i) => ev(t, 'pop', { pan: (i - 1.5) * 0.4, gain: 0.6 }));
  ev(T.stack[0], 'whoosh', { dur: 0.5, gain: 0.7 });
  ev(T.stack[1] - 0.04, 'thud', { gain: 0.8 });
  ev(T.check[0], 'swipe', { dur: 0.6, gain: 0.8 });
  ev(T.check[1], 'impact', { size: 0.45 });
  ev(T.btnIn[0], 'pop', { gain: 0.6 });
  ev(T.cursor[0], 'glide', { dur: 0.55, gain: 0.35 });
  ev(T.click, 'click', { gain: 1.0 });
  ev(T.click, 'impact', { size: 0.4 });
  [0, 1, 2, 3].forEach((k) => ev(T.comets[0] + 0.05 + k * 0.09, 'comet', { dur: 0.6, pan: -0.6 + k * 0.4, gain: 0.7, k }));
  ev(T.silence[0] - 0.15, 'reverse', { dur: 0.3, gain: 0.8 });
  ev(T.horizon, 'impact', { size: 1.3 });
  ev(T.horizon, 'shimmer', { dur: 2.2, gain: 0.7 });
  ev(T.word[0], 'whoosh', { dur: 0.6, gain: 0.6 });
  ev(T.word[0] + 0.25, 'shimmer', { dur: 1.2, gain: 0.5 });
  [0, 1].forEach((i) => ev(T.slogan[0] + i * 0.18, 'tick', { gain: 0.25, pan: i ? 0.5 : -0.5 }));
  ev(T.collapse[0] + 0.05, 'reverse', { dur: 0.45, gain: 0.6 });
  ev(T.end[0], 'sting', { gain: 0.8 });
  EV.sort((a, b) => a.t - b.t);

  const TL = {
    FPS, DUR, BPM, T, CARDS, FOCUS_CARD, typed, clockMin, clockStr, cometPos,
    clamp, lerp, prog, eoc, eoq, eic, eio, eios, eoe, eie, spring, hash, EVENTS: EV,
  };
  if (typeof module !== 'undefined') module.exports = TL; else root.TL = TL;
})(typeof window !== 'undefined' ? window : globalThis);
