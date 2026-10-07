"""SORA SYSTEMS spec ad: original music (code) + placeholder SFX, stems and master.

Usage: python3 audio.py events.json outdir
Writes outdir/mix.wav (master, -14 LUFS / -1 dBTP) and outdir/stems/*.wav (float32):
  music_pad, music_bass, music_pulse, music_arp, music_risers,
  sfx_impacts, sfx_whooshes, sfx_ui, sfx_magic
Music: Eb minor, 120 BPM, clock-tick pulse through the time-lapse, hush before the
horizon hit, lift to Eb major on the brand reveal. SFX are synthesized placeholders in
the cue slots from the brief; they get swapped for the client's library files.
"""
import json, os, sys
import numpy as np
import scipy.signal as ss
import scipy.io.wavfile as wf
import pyloudnorm as pyln
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
rng = np.random.default_rng(11)
E = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
DUR = E['dur']
N = int(DUR * SR)
BEAT = 60 / E['bpm']
T = E['T']


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tvec(n):
    return np.arange(n) / SR


def env(n, att, dec):
    t = tvec(n)
    a = np.sin(np.clip(t / max(att, 1e-4), 0, 1) * np.pi / 2) ** 2
    return a * np.exp(-np.maximum(t - att, 0) / dec)


def fade(x, ms=6):
    k = min(len(x), int(SR * ms / 1000))
    if k > 1:
        x[:k] *= np.sin(np.linspace(0, np.pi / 2, k)) ** 2
        x[-k:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    return x


def bp(x, lo, hi, order=2):
    b, a = ss.butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], 'band')
    return ss.lfilter(b, a, x)


def lp(x, fc, order=2):
    b, a = ss.butter(order, min(fc, SR * 0.45) / (SR / 2))
    return ss.lfilter(b, a, x)


def hp(x, fc, order=2):
    b, a = ss.butter(order, fc / (SR / 2), 'high')
    return ss.lfilter(b, a, x)


def svf_sweep(n, f0, f1, q=1.6, noise=None):
    """noise through a sweeping state-variable bandpass (geometric sweep)."""
    nz = rng.standard_normal(n) if noise is None else noise
    fc = np.geomspace(f0, f1, n)
    g = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR)
    lo = b = 0.0
    out = np.empty(n)
    qi = 1 / q
    for i in range(n):
        h = nz[i] - lo - qi * b
        b += g[i] * h
        lo += g[i] * b
        out[i] = b
    return out


def norm(x):
    return x / (np.abs(x).max() + 1e-9)


def stereo(x, pan=0.0):
    p = np.full(len(x), pan) if np.isscalar(pan) else pan
    return np.stack([x * np.cos((p + 1) * np.pi / 4), x * np.sin((p + 1) * np.pi / 4)], 1) * np.sqrt(2)


def make_ir(sec=2.8, seed=5, dark=6000, decay=0.7):
    r = np.random.default_rng(seed)
    n = int(sec * SR)
    t = tvec(n)
    chans = []
    for _ in range(2):
        nz = r.standard_normal(n)
        ir = lp(nz, dark, 1) * np.exp(-t / decay) + 0.3 * nz * np.exp(-t / 0.15)
        ir *= np.clip(t / 0.01, 0, 1)
        ir[-2000:] *= np.linspace(1, 0, 2000)
        chans.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack(chans, 1)


IR = make_ir()
IR_BIG = make_ir(4.5, 9, 4500, 1.4)


def reverb(x, ir=IR):
    return np.stack([ss.fftconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)


class Bus:
    def __init__(self):
        self.x = np.zeros((N + SR * 6, 2))

    def add(self, t, sig, pan=0.0, gain=1.0):
        s = sig if sig.ndim == 2 else stereo(sig, pan)
        i = int(round(t * SR))
        if i < 0:
            s = s[-i:]
            i = 0
        s = s[: len(self.x) - i]
        self.x[i:i + len(s)] += s * gain

    def out(self):
        return self.x[:N]


# ===================================================================== MUSIC
CH = [  # (start, end, bass midi, chord midis)
    (1.0, 6.0, 39, [51, 54, 58, 61, 65]),        # Ebm9
    (6.0, 8.0, 35, [51, 54, 58, 59, 63]),        # Cbmaj7 (B)
    (8.0, 10.0, 44, [51, 56, 59, 63, 66]),       # Abm9
    (10.0, 11.75, 46, [51, 53, 56, 58, 61]),     # Bb7sus
    (12.0, 16.0, 39, [51, 55, 58, 62, 65, 70]),  # Ebmaj9 (lift)
    (16.0, 18.0, 44, [51, 56, 60, 63, 67]),      # Abmaj9/Eb
    (18.0, DUR, 39, [51, 55, 58, 62, 65, 70]),   # Ebmaj9
]


def pad_voice(f, n, bright):
    t = tvec(n)
    x = np.zeros(n)
    for det in (-0.004, 0.0, 0.004):
        ph = rng.uniform(0, 6.28)
        for k, w in ((1, 1), (2, 0.35 * bright), (3, 0.15 * bright), (4, 0.07 * bright), (5, 0.03 * bright)):
            x += w * np.sin(2 * np.pi * f * k * (1 + det) * t + ph * k)
    return x


def music():
    pad, bass, pulse, arp, ris = Bus(), Bus(), Bus(), Bus(), Bus()
    # --- pad
    for (a, b, bm, notes) in CH:
        lift = a >= 12.0
        n = int((b - a + 1.4) * SR)
        t = tvec(n)
        att = 0.5 if a > 1.0 else 0.9
        e = np.clip(t / att, 0, 1) ** 2 * np.where(t < b - a, 1.0, np.exp(-(t - (b - a)) / 0.35))
        if b == 11.75:  # hard stop into the hush
            e *= np.clip((11.75 - a - t) / 0.04 + 1, 0, 1) * (t < (11.75 - a + 0.04))
        L = np.zeros(n); R = np.zeros(n)
        for j, m in enumerate(notes):
            v = pad_voice(hz(m), n, 1.3 if lift else 0.8) * (1 / (1 + 0.12 * j))
            pn = (j / max(1, len(notes) - 1) - 0.5) * (0.9 if lift else 0.5)
            L += v * np.cos((pn + 1) * np.pi / 4); R += v * np.sin((pn + 1) * np.pi / 4)
        st = np.stack([L, R], 1) * e[:, None]
        cut = 3800 if lift else 1600
        st = np.stack([lp(st[:, 0], cut), lp(st[:, 1], cut)], 1)
        pad.add(a, st, gain=0.036 if lift else 0.03)
    # --- sub drone + bass
    for (a, b, bm, _) in CH:
        n = int((b - a + 0.6) * SR)
        t = tvec(n)
        e = np.clip(t / 0.3, 0, 1) * np.where(t < b - a, 1.0, np.exp(-(t - (b - a)) / 0.2))
        if b == 11.75:  # smooth 30 ms gate into the hush
            e *= np.clip((11.75 - a - t) / 0.03 + 1, 0, 1)
        sub = np.sin(2 * np.pi * hz(bm - 12) * t) * 0.6 + np.sin(2 * np.pi * hz(bm) * t) * 0.25
        bass.add(a, np.tanh(1.4 * sub * e) * 0.2)
    # 8th-note pumping bass through the work and the build (3.0 - 11.75)
    for k in range(int((11.75 - 3.0) / (BEAT / 2))):
        t0 = 3.0 + k * BEAT / 2
        bm = [c[2] for c in CH if c[0] <= t0 < c[1]][0]
        n = int(0.24 * SR)
        f = hz(bm)
        tt = tvec(n)
        x = (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(4 * np.pi * f * tt) + 0.15 * np.sin(6 * np.pi * f * tt))
        x *= env(n, 0.006, 0.09 if t0 < 8 else 0.12)
        bass.add(t0, fade(lp(x, 900)), gain=0.07 if t0 < 8 else 0.09)
    # --- kick on 1 and 3 (every beat pair), 3.0 - 11.5
    for k in range(int((11.6 - 3.0) / (2 * BEAT)) + 1):
        t0 = 3.0 + k * 2 * BEAT
        n = int(0.4 * SR)
        tt = tvec(n)
        fr = 48 * (1 + 2.2 * np.exp(-tt / 0.03))
        x = np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, 0.002, 0.12)
        pulse.add(t0, fade(np.tanh(2 * x)), gain=0.32)
    # --- clock-tick pulse (16ths, accents on beats) through the time-lapse, hats in the build
    for k in range(int((11.75 - 3.4) / (BEAT / 4))):
        t0 = 3.4 + k * BEAT / 4
        acc = k % 4 == 0
        n = int(0.05 * SR)
        nz = bp(rng.standard_normal(n), 3500, 11000) * env(n, 0.0005, 0.008 if not acc else 0.014)
        tone = np.sin(2 * np.pi * (2600 if acc else 3900) * tvec(n)) * env(n, 0.0005, 0.006)
        g = (0.10 if acc else 0.055) * (1.0 if t0 < 8.0 else 1.25)
        pulse.add(t0, fade(nz * 0.8 + tone * 0.5), pan=0.25 if k % 2 else -0.25, gain=g)
    # --- glassy arp: 8ths 3.5 - 11.75, filter opens towards 07:00 and through the build
    pat = [0, 3, 7, 10, 14, 10, 7, 3]
    for k in range(int((11.75 - 3.5) / (BEAT / 2))):
        t0 = 3.5 + k * BEAT / 2
        root = [c[3][0] for c in CH if c[0] <= t0 < c[1]][0] + 12
        chord = [c[3] for c in CH if c[0] <= t0 < c[1]][0]
        cand = sorted(set(m + 12 * o for m in chord for o in (0, 1)))
        m = cand[pat[k % 8] % len(cand)] + 12
        n = int(0.6 * SR)
        tt = tvec(n)
        mod = np.sin(2 * np.pi * hz(m) * 3.5 * tt) * 1.2 * np.exp(-tt / 0.08)
        x = np.sin(2 * np.pi * hz(m) * tt + mod) * env(n, 0.002, 0.22)
        open_ = np.clip((t0 - 3.5) / 4.5, 0, 1)
        x = lp(x, 1500 + 6000 * open_)
        arp.add(t0, fade(x), pan=0.45 * np.sin(k * 1.3), gain=0.05 + 0.03 * open_)
    # slow brand arp after the lift (quarters, Eb major pentatonic)
    for k, m in enumerate([75, 79, 82, 87, 86, 82, 79, 77, 75, 79, 82, 84]):
        t0 = 12.5 + k * BEAT
        if t0 > 17.4:
            break
        n = int(1.4 * SR)
        tt = tvec(n)
        x = (np.sin(2 * np.pi * hz(m) * tt) + 0.3 * np.sin(2 * np.pi * hz(m) * 2.76 * tt) * np.exp(-tt / 0.15)) * env(n, 0.003, 0.5)
        arp.add(t0, fade(x), pan=0.5 * np.sin(k), gain=0.045)
    # end motif
    for k, (m, dt) in enumerate([(70, 0.0), (75, 0.25), (79, 0.5), (82, 0.75)]):
        n = int(2.5 * SR)
        tt = tvec(n)
        x = (np.sin(2 * np.pi * hz(m) * tt) + 0.25 * np.sin(2 * np.pi * hz(m) * 2 * tt)) * env(n, 0.003, 0.9)
        arp.add(18.2 + dt, fade(x), pan=(k - 1.5) * 0.3, gain=0.05)
    # --- risers
    n = int(1.0 * SR)  # into the flash
    x = svf_sweep(n, 300, 6000, 1.2) * np.linspace(0, 1, n) ** 2.5
    ris.add(0.0, fade(norm(x)), gain=0.12)
    n = int(1.75 * SR)  # the build into the hush
    tt = tvec(n)
    x = norm(svf_sweep(n, 250, 9000, 1.4)) * np.linspace(0, 1, n) ** 2
    saw = sum(np.sin(2 * np.pi * hz(58) * k * (1 + 0.5 * (tt / tt[-1]) ** 2) * tt) / k for k in range(1, 8))
    x = x * 0.7 + lp(saw, 3000) * 0.15 * np.linspace(0, 1, n) ** 2
    x[-int(0.02 * SR):] *= np.linspace(1, 0, int(0.02 * SR))
    ris.add(10.0, x, gain=0.22)
    stems = {'music_pad': pad.out(), 'music_bass': bass.out(), 'music_pulse': pulse.out(), 'music_arp': arp.out(), 'music_risers': ris.out()}
    # send pad + arp to the big room
    stems['music_pad'] = stems['music_pad'] + 0.35 * reverb(stems['music_pad'], IR_BIG)
    stems['music_arp'] = 1.4 * (stems['music_arp'] + 0.5 * reverb(stems['music_arp'], IR_BIG))
    return stems


# ===================================================================== SFX (placeholders)
def s_impact(size):
    n = int((1.6 + 1.8 * size) * SR)
    t = tvec(n)
    fr = 42 * (1 + 2.5 * np.exp(-t / 0.05))
    boom = np.tanh(2 * np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, 0.002, 0.35 + 0.4 * size)) * 0.9
    body = lp(rng.standard_normal(n), 900) * env(n, 0.001, 0.06) * 1.6
    crack = bp(rng.standard_normal(n), 1500, 9000) * env(n, 0.0005, 0.02) * 0.8
    x = boom + body + crack * min(1, size)
    st = stereo(x)
    st = st + 0.5 * size * reverb(st, IR_BIG)
    return st * min(1.2, 0.7 + 0.4 * size)


def s_whoosh(dur, up=1, lo=300, hi=4000):
    n = int(dur * SR)
    f0, f1 = (lo, hi) if up > 0 else (hi, lo)
    x = svf_sweep(n, f0, f1, 1.5)
    e = np.sin(np.pi * np.linspace(0, 1, n) ** 0.7) ** 2
    return fade(norm(x * e))


def s_reverse(dur):
    n = int((dur + 0.1) * SR)
    tone = sum(np.sin(2 * np.pi * hz(m) * tvec(int(2 * SR))) for m in (63, 70, 75)) * env(int(2 * SR), 0.002, 0.5)
    wet = reverb(stereo(tone), IR_BIG)[:, 0]
    x = (0.3 * tone + wet)[::-1][-n:].copy()
    nz = svf_sweep(n, 400, 7000, 1.2) * np.linspace(0, 1, n) ** 3
    x = norm(x) * np.linspace(0, 1, n) ** 2 + 0.5 * norm(nz)
    x[-int(0.015 * SR):] *= np.linspace(1, 0, int(0.015 * SR))
    return x


def s_tick():
    n = int(0.06 * SR)
    x = np.sin(2 * np.pi * 3200 * tvec(n)) * env(n, 0.0004, 0.01) + bp(rng.standard_normal(n), 2500, 9000) * env(n, 0.0003, 0.004) * 0.6
    return fade(x)


def s_thunk():
    n = int(0.25 * SR)
    t = tvec(n)
    x = np.sin(2 * np.pi * 170 * (1 + 0.6 * np.exp(-t / 0.01)) * t) * env(n, 0.001, 0.05)
    x += bp(rng.standard_normal(n), 1200, 6000) * env(n, 0.0004, 0.006) * 0.5
    x += np.sin(2 * np.pi * 1760 * t) * env(n, 0.001, 0.04) * 0.15
    return fade(x)


def s_type():
    n = int(0.05 * SR)
    x = bp(rng.standard_normal(n), 1500, 7000) * env(n, 0.0004, 0.007) + np.sin(2 * np.pi * 900 * tvec(n)) * env(n, 0.0005, 0.008) * 0.3
    return fade(x)


def s_chime():
    n = int(2.5 * SR)
    t = tvec(n)
    x = np.zeros(n)
    for m, dt, g in ((82, 0.0, 1.0), (87, 0.09, 0.8)):
        k0 = int(dt * SR)
        for r, a, d in ((1, 1, 1.2), (2.0, 0.3, 0.6), (3.01, 0.12, 0.3)):
            x[k0:] += g * a * np.sin(2 * np.pi * hz(m) * r * t[: n - k0]) * env(n - k0, 0.002, d)
    return fade(x * 0.5)


def s_pop():
    n = int(0.12 * SR)
    t = tvec(n)
    fr = 500 * (1 + 1.5 * (1 - np.exp(-t / 0.015)))
    return fade(np.sin(2 * np.pi * np.cumsum(fr) / SR) * env(n, 0.001, 0.03))


def s_thud():
    n = int(0.5 * SR)
    t = tvec(n)
    x = np.sin(2 * np.pi * 65 * (1 + np.exp(-t / 0.02)) * t) * env(n, 0.002, 0.1) + lp(rng.standard_normal(n), 500) * env(n, 0.001, 0.03) * 0.8
    return fade(x)


def s_click():
    n = int(0.12 * SR)
    t = tvec(n)
    x = np.zeros(n)
    for dt, g in ((0.0, 1.0), (0.028, 0.6)):
        k = int(dt * SR)
        m = n - k
        x[k:] += g * (bp(rng.standard_normal(m), 2000, 10000) * env(m, 0.0002, 0.003) + np.sin(2 * np.pi * 1400 * t[:m]) * env(m, 0.0003, 0.006) * 0.6)
    return fade(x)


def s_sparkle(dur):
    n = int((dur + 0.6) * SR)
    x = np.zeros(n)
    k = 0
    while True:
        tt = (k / 40) ** 1.6 * dur
        if tt >= dur:
            break
        f = hz(rng.choice([87, 89, 91, 94, 96, 99, 101, 103]))
        i = int(tt * SR)
        m = int(0.25 * SR)
        seg = np.sin(2 * np.pi * f * tvec(m)) * env(m, 0.0008, 0.05)
        x[i:i + m] += seg[: n - i] * (1 - tt / dur)
        k += 1
    return fade(x)


def s_shimmer(dur):
    n = int((dur + 1.0) * SR)
    t = tvec(n)
    x = np.zeros(n)
    for i, m in enumerate([87, 91, 94, 98, 99, 103]):
        trem = 0.5 + 0.5 * np.sin(2 * np.pi * (6 + 2 * rng.uniform()) * t + rng.uniform(0, 6))
        x += np.sin(2 * np.pi * hz(m) * t + rng.uniform(0, 6)) * trem / (1 + 0.4 * i)
    e = np.sin(np.pi * np.clip(t / (dur + 0.8), 0, 1)) ** 1.5
    air = hp(rng.standard_normal(n), 6000) * 0.08
    return fade((x * 0.2 + air) * e, 30)


def s_ember(dur):
    n = int(dur * SR)
    x = hp(rng.standard_normal(n), 3000) * 0.05 * np.linspace(0.3, 1, n)
    for _ in range(14):
        i = int(rng.uniform(0, dur - 0.03) * SR)
        m = int(0.01 * SR)
        x[i:i + m] += bp(rng.standard_normal(m), 2000, 9000) * env(m, 0.0002, 0.002) * rng.uniform(0.3, 1)
    return fade(x)


def s_swell(dur):
    n = int((dur + 0.05) * SR)
    t = tvec(n)
    f = hz(63) * (1 + 0.5 * (t / t[-1]) ** 2)
    x = (np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.5 * np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR)) * (t / t[-1]) ** 2.5
    x[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return x * 0.6


def s_comet(dur, k):
    n = int(dur * SR)
    t = tvec(n)
    u = t / t[-1]
    f = hz(84 + 2 * k) * (1 + 0.25 * np.sin(np.pi * u) - 0.2 * u)
    whistle = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * u) ** 2 * 0.25
    return fade(norm(s_whoosh(dur, 1, 600, 6000)) * 0.8 + whistle)


def s_sting():
    n = int(3.0 * SR)
    t = tvec(n)
    boom = np.sin(2 * np.pi * 52 * (1 + 0.8 * np.exp(-t / 0.04)) * t) * env(n, 0.003, 0.4) * 0.6
    bell = sum(np.sin(2 * np.pi * hz(m) * t) * env(n, 0.003, 1.2) for m in (75, 79, 82)) * 0.18
    return fade(boom + bell, 40)


CAT = {'impact': 'impacts', 'shock': 'whooshes', 'whoosh': 'whooshes', 'cam': 'whooshes', 'swipe': 'whooshes',
       'comet': 'whooshes', 'glide': 'whooshes', 'reverse': 'magic', 'tick': 'ui', 'thunk': 'ui', 'type': 'ui',
       'chime': 'ui', 'pop': 'ui', 'thud': 'impacts', 'click': 'ui', 'sparkle': 'magic', 'shimmer': 'magic',
       'ember': 'magic', 'swell': 'magic', 'sting': 'magic'}


def sfx():
    buses = {k: Bus() for k in ('impacts', 'whooshes', 'ui', 'magic')}
    for e in E['events']:
        ty, t, g, pan = e['type'], e['t'], e.get('gain', 1), e.get('pan', 0)
        d = e.get('dur', 0.5)
        if ty == 'impact':
            x = s_impact(e.get('size', 1)); buses['impacts'].add(t, x, gain=0.2 * g); continue
        if ty in ('whoosh', 'shock', 'cam', 'swipe', 'glide', 'comet'):
            if ty == 'shock':
                x = s_whoosh(d, -1, 200, 5000); st = np.stack([x, lp(svf_sweep(len(x), 4000, 250, 1.5), 8000) * np.abs(x).max()], 1)
                buses['whooshes'].add(t, st * 0.3, gain=g); continue
            if ty == 'cam':
                x = s_whoosh(d, e.get('dir', 1), 150, 1600)
            elif ty == 'swipe':
                x = s_whoosh(d, 1, 900, 7000)
            elif ty == 'glide':
                x = s_whoosh(d, 1, 2000, 5000) * 0.4
            elif ty == 'comet':
                x = s_comet(d, e.get('k', 0))
            else:
                x = s_whoosh(d, 1)
            # the whoosh peaks on the visual move
            ps = np.linspace(pan - 0.4, pan + 0.4, len(x)) if ty in ('whoosh', 'comet') else pan
            buses['whooshes'].add(t - (0.45 * d if ty in ('whoosh', 'cam') else 0.1), stereo(x, ps), gain=0.45 * g); continue
        if ty == 'reverse':
            buses['magic'].add(t, s_reverse(d), pan=pan, gain=0.45 * g); continue
        fn = {'tick': s_tick, 'thunk': s_thunk, 'type': s_type, 'chime': s_chime, 'pop': s_pop, 'thud': s_thud, 'click': s_click,
              'sting': s_sting}
        if ty in fn:
            buses[CAT[ty]].add(t, fn[ty](), pan=pan, gain=0.5 * g); continue
        x = {'sparkle': lambda: s_sparkle(d), 'shimmer': lambda: s_shimmer(d), 'ember': lambda: s_ember(d), 'swell': lambda: s_swell(d)}[ty]()
        buses['magic'].add(t, x, pan=pan, gain=0.5 * g)
    st = {f'sfx_{k}': b.out() for k, b in buses.items()}
    st['sfx_ui'] = st['sfx_ui'] + 0.25 * reverb(st['sfx_ui'])
    st['sfx_magic'] = st['sfx_magic'] + 0.4 * reverb(st['sfx_magic'], IR_BIG)
    st['sfx_whooshes'] = st['sfx_whooshes'] + 0.2 * reverb(st['sfx_whooshes'])
    return st


def limiter(x, ceiling, look=0.003, rel=0.1):
    env_ = np.abs(ss.resample_poly(x, 4, 1, axis=0)).max(1).reshape(-1, 4).max(1)[: len(x)]
    gain = np.minimum(1.0, ceiling / np.maximum(env_, 1e-9))
    la = int(look * SR)
    gmin = minimum_filter1d(gain, 2 * la + 1)
    a = np.exp(-1 / (rel * SR))
    sm = np.empty_like(gmin)
    g = 1.0
    for i in range(len(gmin)):
        g = gmin[i] if gmin[i] < g else a * g + (1 - a) * gmin[i]
        sm[i] = g
    sm = np.minimum(uniform_filter1d(sm, la), gmin)
    return x * sm[:, None], sm


def main():
    os.makedirs(os.path.join(OUT, 'stems'), exist_ok=True)
    stems = {}
    stems.update(music())
    stems.update(sfx())
    t = tvec(N)
    tail = np.clip((DUR - t) / 0.6, 0, 1)[:, None]
    for k in stems:
        stems[k] = stems[k] * tail
    # balance: music bed under a dense, forward SFX layer (no VO)
    mix = sum(stems.values())
    b, a = ss.butter(2, 25 / (SR / 2), 'high')
    mix = ss.lfilter(b, a, mix, axis=0)
    meter = pyln.Meter(SR)
    gain = 10 ** ((-14.0 - meter.integrated_loudness(mix)) / 20)
    for _ in range(4):  # loudness after limiting converges on -14 LUFS
        master, sm = limiter(mix * gain, 10 ** (-1.2 / 20))
        gain *= 10 ** ((-14.0 - meter.integrated_loudness(master)) / 20)
    master, sm = limiter(mix * gain, 10 ** (-1.2 / 20))
    lufs = meter.integrated_loudness(master)
    tp = 20 * np.log10(np.abs(ss.resample_poly(master, 4, 1, axis=0)).max())
    gr = -20 * np.log10(sm.min())
    grdb = -20 * np.log10(sm)
    hot = [(round(i / SR, 2), round(float(grdb[i]), 1)) for i in np.argsort(grdb)[::-1][:: SR // 20][:6]]
    print(f'limiter: {100 * np.mean(grdb > 1):.1f}% of time >1 dB GR, {100 * np.mean(grdb > 3):.2f}% >3 dB; loudest moments {hot}')
    print(f'master {lufs:.2f} LUFS, true peak {tp:.2f} dBTP, max limiter GR {gr:.1f} dB')
    wf.write(os.path.join(OUT, 'mix.wav'), SR, (np.clip(master, -1, 1) * 32767).astype(np.int16))
    for k, v in stems.items():  # stems carry the same master gain (pre-limiter) so they sum to the mix
        wf.write(os.path.join(OUT, 'stems', f'{k}.wav'), SR, (v * gain).astype(np.float32))
        print(f'  {k:14s} {meter.integrated_loudness(v * gain) if np.abs(v).max() > 0 else -99:7.1f} LUFS')


if __name__ == '__main__':
    main()
