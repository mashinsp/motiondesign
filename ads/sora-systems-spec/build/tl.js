// SORA SYSTEMS spec ad — shared timeline (picture + sound). Format-independent.
// Loaded by the canvas page (window.TL) and by node (require) to export events.json.
(function (root) {
  const FPS = 60, BPM = 120;

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

  // ---------- beats (seconds) — reference timing ----------
  const T = {
    burst: 0.82, logoIn: 0.90, spiral: [1.60, 1.78], split: 1.80, spread: [1.84, 2.00], outline: [2.02, 2.10],
    fill: [2.12, 2.18], stretch: [2.18, 2.22], clockIn: 2.20, textIn: [2.22, 2.30],
    pushIn: [3.80, 3.94], pullOut: [4.82, 5.00], done: [5.90, 6.25, 6.60, 6.90], morning: 6.78,
    stack: [7.22, 7.78], check: [7.78, 8.40], btnIn: [8.36, 8.44], pointer: [8.80, 8.96], hover: [9.04, 9.12], click: 9.12,
    merge: [9.14, 9.40], comets: [9.36, 9.68], cut: 9.70, flare: 9.78, flash: 9.80, settle: [9.82, 10.10],
    blur: [10.70, 10.78], slide: [10.80, 11.00], spark: [10.84, 10.96], write: [11.06, 11.40], tagline: [11.40, 11.60],
    dissolve: [12.96, 13.06], pop: 13.06, dash: [13.10, 13.34], email: [13.38, 13.90], cta: [13.95, 14.20],
  };
  const DUR_ = 16.6;
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
  const TYPE_START = [2.30, 2.42, 2.36, 2.48], LINE_PAUSE = 0.06;
  CARDS.forEach((c, i) => {
    const chars = c.code.reduce((a, l) => a + l.trimStart().length, 0);
    const avail = T.done[i] - 0.12 - TYPE_START[i] - LINE_PAUSE * c.code.length;
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
    if (t >= T.morning) return 7 * 60;
    const tq = Math.floor(t / 0.15) * 0.15;   // ticks forward in bursts
    const m = lerp(-2, 419, eio(prog(tq, T.clockIn, T.morning - 0.05)));
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
  ev(0.0, 'ember', { dur: 0.8 });
  ev(0.45, 'swell', { dur: 0.37 });
  ev(T.burst, 'impact', { size: 1.0 });
  ev(T.burst, 'shock', { dur: 0.7 });
  ev(T.burst + 0.06, 'sparkle', { dur: 0.6, gain: 0.7 });
  ev(T.spiral[0], 'reverse', { dur: 0.2, gain: 0.6 });
  ev(T.split, 'impact', { size: 0.45 });
  ev(T.split + 0.02, 'whoosh', { dur: 0.3, pan: -0.5, gain: 0.7 });
  ev(T.split + 0.04, 'whoosh', { dur: 0.3, pan: 0.5, gain: 0.7 });
  [0, 1, 2, 3].forEach((i) => ev(1.98 + i * 0.015, 'tick', { pan: (i - 1.5) * 0.4, gain: 0.5 }));
  ev(T.outline[0], 'shimmer', { dur: 0.35, gain: 0.35 });
  [0, 1, 2, 3].forEach((i) => ev(T.fill[0] + i * 0.02, 'thunk', { pan: (i - 1.5) * 0.4, gain: 0.7 }));
  ev(T.clockIn, 'tick', { gain: 0.45 });
  CARDS.forEach((c, i) => c.lineT.forEach(([a, b]) => ev(b, 'type', { pan: (i - 1.5) * 0.35, gain: 0.3 })));
  ev(T.pushIn[0], 'cam', { dur: 0.3, gain: 0.75 });
  ev(T.pushIn[1], 'thud', { gain: 0.35 });
  ev(T.pullOut[0], 'cam', { dur: 0.25, gain: 0.65, dir: -1 });
  T.done.forEach((t, i) => { ev(t, 'pop', { pan: (i - 1.5) * 0.4, gain: 0.65 }); ev(t, 'tick', { pan: (i - 1.5) * 0.4, gain: 0.4 }); });
  ev(T.morning, 'chime', { gain: 0.85 });
  ev(T.stack[0], 'whoosh', { dur: 0.35, gain: 0.7 });
  ev(7.70, 'thud', { gain: 0.75 });
  ev(T.check[0], 'swipe', { dur: 0.62, gain: 0.8 });
  ev(T.check[1], 'impact', { size: 0.35 });
  ev(T.btnIn[0], 'pop', { gain: 0.55 });
  ev(T.pointer[0], 'glide', { dur: 0.2, gain: 0.35 });
  ev(T.hover[0], 'shimmer', { dur: 0.2, gain: 0.3 });
  ev(T.click, 'click', { gain: 1.0 });
  ev(T.click, 'impact', { size: 0.4 });
  ev(T.merge[0] + 0.02, 'reverse', { dur: 0.2, gain: 0.45 });
  [0, 1, 2, 3].forEach((k) => ev(T.comets[0] + k * 0.05, 'comet', { dur: 0.32, pan: -0.6 + k * 0.4, gain: 0.65, k }));
  ev(T.flare - 0.02, 'swell', { dur: 0.04, gain: 0.5 });
  ev(T.flash, 'impact', { size: 1.3 });
  ev(T.flash, 'shimmer', { dur: 1.6, gain: 0.7 });
  ev(T.slide[0], 'whoosh', { dur: 0.3, gain: 0.55 });
  ev(T.spark[0], 'comet', { dur: 0.16, gain: 0.5, pan: 0.5, k: 4 });
  'SoraSystems'.split('').forEach((_, i) => ev(T.write[0] + i * (T.write[1] - T.write[0]) / 11, 'tick', { gain: 0.22, pan: -0.3 + i * 0.06 }));
  ev(T.write[0], 'shimmer', { dur: 0.6, gain: 0.45 });
  ev(T.tagline[0], 'tick', { gain: 0.3 });
  ev(T.dissolve[0], 'reverse', { dur: 0.1, gain: 0.5 });
  ev(T.pop, 'pop', { gain: 0.6 });
  ev(T.dash[0], 'glide', { dur: 0.2, gain: 0.4 });
  for (let i = 0; i < 25; i += 2) ev(T.email[0] + i * (T.email[1] - T.email[0]) / 25, 'type', { gain: 0.25 });
  ev(T.email[0], 'shimmer', { dur: 0.6, gain: 0.35 });
  ev(T.cta[0], 'pop', { gain: 0.7 });
  ev(T.cta[0], 'sting', { gain: 0.8 });
  EV.sort((a, b) => a.t - b.t);

  const TL = {
    FPS, DUR: DUR_, BPM, T, CARDS, FOCUS_CARD, typed, clockMin, clockStr, cometPos,
    clamp, lerp, prog, eoc, eoq, eic, eio, eios, eoe, eie, spring, hash, EVENTS: EV,
  };
  if (typeof module !== 'undefined') module.exports = TL; else root.TL = TL;
})(typeof window !== 'undefined' ? window : globalThis);
