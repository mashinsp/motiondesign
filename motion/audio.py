"""Synthesized score for the Agentic Systems film. Pure numpy/scipy, no samples.

Usage: python3 audio.py events.json out.wav
Reads the frame-accurate event list exported from the animation timeline and renders:
  - a warm additive pad in Db major with chord changes on the big transitions
  - a soft sub bass that glides between chord roots
  - one synthesized sound per visual event (drops, kalimba, harp, glass bells, plucks,
    whooshes, sub booms, reverse swells...) tuned to Db major pentatonic, with reverb
Master: -14 LUFS integrated, true peak below -1 dBFS, fades everywhere.
"""
import json, sys
import numpy as np
import scipy.signal as ss
import scipy.io.wavfile as wf
import pyloudnorm as pyln

SR = 48000
rng = np.random.default_rng(7)
ev_data = json.load(open(sys.argv[1]))
DUR = ev_data['dur']
N = int(DUR * SR)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env_ad(n, att, dec, sr=SR):
    """attack (s) then exponential decay with time-constant dec (s); click-free."""
    t = np.arange(n) / sr
    a = np.clip(t / max(att, 1e-4), 0, 1)
    a = np.sin(a * np.pi / 2) ** 2
    return a * np.exp(-np.maximum(t - att, 0) / dec)


def tail_fade(x, ms=8):
    k = min(len(x), int(SR * ms / 1000))
    if k > 1:
        x[-k:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    return x


def partials(f0, ratios, amps, decays, dur, att=0.002, detune=0.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for r, a, d in zip(ratios, amps, decays):
        f = f0 * r
        if f > SR * 0.45:
            continue
        ph = rng.uniform(0, 2 * np.pi)
        out += a * np.sin(2 * np.pi * f * t * (1 + detune * rng.uniform(-1, 1)) + ph) * env_ad(n, att, d)
    return tail_fade(out)


# ---------------------------------------------------------------- instruments
def s_glass(m, g):
    return g * 0.5 * partials(hz(m), [1, 2.32, 4.25, 6.63, 9.38], [1, .45, .22, .12, .05], [1.5, .8, .45, .25, .15], 2.6, att=0.0015)


def s_bell(m, g):
    f = hz(m)
    x = partials(f, [0.5, 1, 1.183, 1.506, 2.0, 2.74, 3.0, 4.07], [.25, 1, .3, .25, .5, .25, .15, .08],
                 [3.5, 3.0, 2.0, 1.6, 1.5, 0.9, .7, .45], 4.5, att=0.002)
    return g * 0.45 * x


def s_kalimba(m, g):
    f = hz(m)
    x = partials(f, [1, 2.0, 5.95, 9.2], [1, .08, .22, .06], [0.75, 0.3, 0.06, 0.03], 1.6, att=0.0012)
    return g * 0.6 * x


def s_harp(m, g):
    f = hz(m)
    ks = np.arange(1, 13)
    x = partials(f, ks, 1 / ks ** 1.25, 2.4 / ks ** 0.75, 3.0, att=0.0015)
    b, a = ss.butter(2, min(0.99, 6 * f / (SR / 2)))
    return g * 0.28 * ss.lfilter(b, a, x)


def s_pluck(m, g):  # warm wooden pluck (marimba-ish) for the light-mode pills
    f = hz(m)
    x = partials(f, [1, 3.93, 9.9], [1, .3, .06], [0.45, 0.08, 0.02], 1.0, att=0.0015)
    x += 0.3 * partials(f / 2, [1], [1], [0.25], 1.0, att=0.003)
    return g * 0.55 * x


def s_drop(m, g):  # water drop: fast upward chirp into a sine ping
    f = hz(m)
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    fr = f * (0.45 + 0.55 * (1 - np.exp(-t / 0.012)))
    ph = 2 * np.pi * np.cumsum(fr) / SR
    x = np.sin(ph) * env_ad(n, 0.0015, 0.09)
    x += 0.25 * np.sin(2 * ph) * env_ad(n, 0.0015, 0.04)
    return g * 0.55 * tail_fade(x)


def s_bubble(m, g, up=1):
    f = hz(m)
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    k = (1 - np.exp(-t / 0.035))
    fr = f * (0.5 + 0.9 * k) if up else f * (1.3 - 0.5 * k)
    ph = 2 * np.pi * np.cumsum(fr) / SR
    x = np.sin(ph) * env_ad(n, 0.004, 0.08)
    x2 = np.sin(ph * 1.5 + 1) * env_ad(n, 0.02, 0.05) * 0.3
    return g * 0.6 * tail_fade(x + x2)


def s_pop(m, g):
    x = s_drop(m, g)
    nz = rng.standard_normal(int(0.03 * SR)) * env_ad(int(0.03 * SR), 0.001, 0.006)
    b, a = ss.butter(2, [800 / (SR / 2), 3000 / (SR / 2)], 'band')
    x[:len(nz)] += g * 0.08 * ss.lfilter(b, a, nz)
    return x


def s_tick(m, g):
    f = hz(m)
    x = partials(f, [1, 2.76], [1, .3], [0.05, 0.02], 0.25, att=0.0008)
    nz = rng.standard_normal(len(x)) * env_ad(len(x), 0.0005, 0.004)
    b, a = ss.butter(2, [3000 / (SR / 2), 9000 / (SR / 2)], 'band')
    return g * 0.5 * (x + 0.15 * ss.lfilter(b, a, nz))


def s_click(m, g):  # lock-on bracket: crisp glass tick + tiny tone
    x = s_glass(m, g * 0.35)
    tk = s_tick(m, g * 0.8)
    x[:len(tk)] += tk
    return x


def s_thud(m, g):  # card landing: low marimba + soft felt thump
    f = hz(m - 24)
    x = partials(f, [1, 3.98], [1, .25], [0.35, 0.05], 0.9, att=0.003)
    n = int(0.4 * SR)
    t = np.arange(n) / SR
    sub = np.sin(2 * np.pi * np.cumsum(f * 0.5 * (1 + 1.2 * np.exp(-t / 0.03))) / SR) * env_ad(n, 0.002, 0.09)
    x[:n] += 0.6 * sub
    return g * 0.6 * tail_fade(x)


def s_sub(m, g, dur=1.5):
    f = hz(m)
    n = int((dur + 0.5) * SR)
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t) * env_ad(n, 0.04, dur * 0.5)
    return g * 0.5 * tail_fade(np.tanh(1.3 * x))


def s_boom(m, g):
    f = hz(m)
    n = int(3.0 * SR)
    t = np.arange(n) / SR
    fr = f * (1 + 1.6 * np.exp(-t / 0.05))
    x = np.sin(2 * np.pi * np.cumsum(fr) / SR) * env_ad(n, 0.003, 0.9)
    x = np.tanh(1.8 * x) / np.tanh(1.8)
    nz = rng.standard_normal(n) * env_ad(n, 0.002, 0.05)
    b, a = ss.butter(2, 180 / (SR / 2))
    x += 0.5 * ss.lfilter(b, a, nz)
    return g * 0.75 * tail_fade(x, 40)


def s_string(m, g, dur=1.2):  # soft bowed swell
    f = hz(m)
    n = int((dur + 0.8) * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for k in range(1, 9):
        for d in (-0.003, 0.003):
            x += (1 / k ** 1.5) * np.sin(2 * np.pi * f * k * (1 + d) * t + rng.uniform(0, 6))
    e = np.clip(t / (dur * 0.5), 0, 1) ** 2 * np.exp(-np.maximum(t - dur * 0.5, 0) / (dur * 0.4))
    b, a = ss.butter(2, 2200 / (SR / 2))
    return g * 0.08 * tail_fade(ss.lfilter(b, a, x * e), 60)


def svf_noise(dur, f0, f1, q=2.0):
    """noise through a sweeping state-variable bandpass (per-sample, click-free)."""
    n = int(dur * SR)
    nz = rng.standard_normal(n)
    fc = np.geomspace(f0, f1, n)
    fco = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR)
    lo = bp = 0.0
    out = np.empty(n)
    qi = 1 / q
    for i in range(n):
        hp = nz[i] - lo - qi * bp
        bp += fco[i] * hp
        lo += fco[i] * bp
        out[i] = bp
    return out


def s_whoosh(g, dur, d=1):
    f0, f1 = (250, 3200) if d > 0 else (3200, 300)
    x = svf_noise(dur, f0, f1, 1.6)
    n = len(x)
    t = np.linspace(0, 1, n)
    e = np.sin(np.pi * t ** 0.8) ** 2
    x = x * e
    x /= np.abs(x).max() + 1e-9
    pan = np.linspace(-0.6, 0.6, n) * d
    return g * 0.35 * x, pan


def s_reverse(m, g, dur):
    """reversed bell+glass with its reverb tail, swelling into t+dur."""
    tone = s_bell(m, 1.0)[: int(2.5 * SR)] + 0.6 * s_glass(m + 12, 1.0)[: int(2.5 * SR)]
    wet = ss.fftconvolve(tone, IR_M[: int(2.0 * SR)])[: int(2.5 * SR)]
    x = (0.4 * tone + wet)[::-1]
    L = int((dur + 0.15) * SR)
    x = x[-L:].copy()
    x *= np.sin(np.linspace(0, np.pi / 2, L)) ** 3
    x = tail_fade(x, 20)
    x /= np.abs(x).max() + 1e-9
    nz = svf_noise(dur + 0.15, 400, 5000, 1.2)
    nz *= np.linspace(0, 1, len(nz)) ** 3
    nz /= np.abs(nz).max() + 1e-9
    return g * 0.35 * (x + 0.35 * tail_fade(nz, 20))


def s_swell(m, g, dur):
    n = int((dur + 0.6) * SR)
    t = np.arange(n) / SR
    e = np.clip(t / dur, 0, 1) ** 2 * np.exp(-np.maximum(t - dur, 0) / 0.2)
    x = sum(np.sin(2 * np.pi * hz(m + k) * t + rng.uniform(0, 6)) * w for k, w in [(0, 1), (7, .5), (12, .3)])
    return g * 0.2 * tail_fade(x * e, 30)


def s_shimmer(g, dur):
    n = int((dur + 1.0) * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, m in enumerate([85, 87, 89, 92, 94, 97, 99, 101]):
        trem = 0.5 + 0.5 * np.sin(2 * np.pi * (5 + 3 * rng.uniform()) * t + rng.uniform(0, 6))
        x += np.sin(2 * np.pi * hz(m) * t + rng.uniform(0, 6)) * trem / (1 + i * 0.3)
    e = np.sin(np.pi * np.clip(t / (dur + 0.8), 0, 1)) ** 2
    return g * 0.05 * tail_fade(x * e, 30)


# ---------------------------------------------------------------- reverb
def make_ir(sec=3.4, seed=3):
    r = np.random.default_rng(seed)
    n = int(sec * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        nz = r.standard_normal(n)
        b, a = ss.butter(1, 5500 / (SR / 2))
        dark = ss.lfilter(b, a, nz)
        ir = dark * np.exp(-t / 0.85) + 0.35 * nz * np.exp(-t / 0.22)
        ir *= np.clip(t / 0.012, 0, 1)  # pre-delay softness
        for k in range(6):  # early reflections
            d = int(r.uniform(0.008, 0.06) * SR)
            ir[d] += r.uniform(0.3, 0.7) * (1 if ch else -1) ** k
        ir = tail_fade(ir, 300)
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack(out, 1)


IR = make_ir()
IR_M = IR.mean(1)

# ---------------------------------------------------------------- pad + bass
VOICING = {
    'Dbmaj9': (37, [49, 56, 60, 63, 65]),
    'Bbm9': (34, [49, 53, 56, 60, 61]),
    'Gbmaj9': (42, [53, 56, 58, 61, 65]),
    'Ebm11': (39, [51, 54, 58, 61, 68]),
    'Ab69': (44, [51, 53, 58, 60, 63]),
    'Gblyd': (42, [58, 60, 61, 65, 68, 70]),
    'Bbm9hi': (34, [56, 60, 61, 65, 68]),
    'Absus': (44, [51, 56, 58, 61, 63]),
    'DbmajEnd': (37, [56, 60, 61, 63, 65, 68, 72]),
}
CH = ev_data['chords']


def pad():
    t = np.arange(N) / SR
    L = np.zeros(N)
    R = np.zeros(N)
    for i, (t0, name) in enumerate(CH):
        t1 = CH[i + 1][0] if i + 1 < len(CH) else DUR + 1
        # crossfade envelope: 0.7 s in (starting slightly before), 1.0 s out
        e = np.clip((t - (t0 - 0.25)) / 0.7, 0, 1)
        e = np.sin(e * np.pi / 2) ** 2
        e *= np.where(t < t1, 1.0, np.exp(-(t - t1) / 0.45))
        if i == 0:
            e *= np.clip(t / 1.6, 0, 1) ** 2
        idx = e > 1e-4
        tt = t[idx]
        for j, m in enumerate(VOICING[name][1]):
            f = hz(m)
            for side, det in ((0, -0.0035), (1, 0.0035)):
                ph0 = rng.uniform(0, 6.28)
                vib = 1 + 0.0012 * np.sin(2 * np.pi * (0.17 + 0.05 * j) * tt + ph0)
                v = np.zeros(len(tt))
                for k, w in ((1, 1), (2, .38), (3, .16), (4, .08), (5, .04)):
                    v += w * np.sin(2 * np.pi * f * k * (1 + det) * vib * tt + ph0 * k)
                amp = (0.55 + 0.45 * np.sin(2 * np.pi * 0.11 * tt + j + side)) / (1 + 0.15 * j)
                (L if side == 0 else R)[idx] += v * amp * e[idx]
    b, a = ss.butter(2, 1900 / (SR / 2))
    out = np.stack([ss.lfilter(b, a, L), ss.lfilter(b, a, R)], 1)
    return out * 0.05


def bass():
    t = np.arange(N) / SR
    roots = np.array([hz(VOICING[n][0]) for _, n in CH])
    times = np.array([c[0] for c in CH])
    lf = np.log(np.full(N, roots[0]))
    for i in range(1, len(CH)):  # portamento glide into each new root
        k = np.clip((t - times[i]) / 0.38, 0, 1)
        k = k * k * (3 - 2 * k)
        lf = lf + (np.log(roots[i]) - np.log(roots[i - 1])) * k
    f = np.exp(lf)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.22 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)
    amp = np.clip(t / 2.0, 0, 1) ** 2 * (0.85 + 0.15 * np.sin(2 * np.pi * 0.2 * t))
    x = np.tanh(1.2 * x * amp) * 0.11
    b, a = ss.butter(2, 260 / (SR / 2))
    return ss.lfilter(b, a, x)


# ---------------------------------------------------------------- events
SEND = {'glass': .5, 'bell': .55, 'kalimba': .35, 'harp': .45, 'pluck': .3, 'drop': .4, 'bubble': .3, 'pop': .35,
        'tick': .3, 'click': .35, 'thud': .2, 'sub': 0.0, 'boom': .15, 'string': .5, 'whoosh': .35, 'reverse': .2,
        'swell': .5, 'shimmer': .6}


def render_events():
    dry = np.zeros((N + SR * 5, 2))
    send = np.zeros((N + SR * 5, 2))
    for e in ev_data['events']:
        typ, g, pan = e['type'], e.get('gain', 1), e.get('pan', 0)
        m = e.get('midi', 72)
        start = int(round(e['t'] * SR))
        pan_arr = None
        if typ == 'whoosh':
            x, pan_arr = s_whoosh(g, e.get('dur', 0.5), e.get('dir', 1))
            start -= int(len(x) * 0.55)  # the whoosh peaks on the visual move
        elif typ == 'reverse':
            x = s_reverse(m, g, e['dur'])
        elif typ == 'swell':
            x = s_swell(m, g, e['dur'])
        elif typ == 'shimmer':
            x = s_shimmer(g, e['dur'])
        elif typ == 'sub':
            x = s_sub(m, g, e.get('dur', 1.5))
        elif typ == 'string':
            x = s_string(m, g, e.get('dur', 1.2))
        elif typ == 'bubble':
            x = s_bubble(m, g, e.get('up', 1))
        else:
            x = {'glass': s_glass, 'bell': s_bell, 'kalimba': s_kalimba, 'harp': s_harp, 'pluck': s_pluck,
                 'drop': s_drop, 'pop': s_pop, 'tick': s_tick, 'click': s_click, 'thud': s_thud,
                 'boom': s_boom}[typ](m, g)
        start = max(0, start)
        x = x[: dry.shape[0] - start]
        p = pan_arr[: len(x)] if pan_arr is not None else np.full(len(x), pan)
        gl, gr = np.cos((p + 1) * np.pi / 4), np.sin((p + 1) * np.pi / 4)
        st = np.stack([x * gl, x * gr], 1) * np.sqrt(2)
        dry[start:start + len(x)] += st
        send[start:start + len(x)] += st * SEND[typ]
    return dry, send


def true_peak(x):
    up = ss.resample_poly(x, 4, 1, axis=0)
    return np.abs(up).max()


def limiter(x, ceiling, look=0.003, rel=0.12):
    """lookahead peak limiter on 4x-oversampled envelope."""
    env = np.abs(ss.resample_poly(x, 4, 1, axis=0)).max(1).reshape(-1, 4).max(1)[: len(x)]
    gain = np.minimum(1.0, ceiling / np.maximum(env, 1e-9))
    la = int(look * SR)
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    gmin = minimum_filter1d(gain, 2 * la + 1)
    a = np.exp(-1 / (rel * SR))
    sm = np.empty_like(gmin)
    g = 1.0
    for i in range(len(gmin)):  # instant attack (already look-ahead), smooth release
        g = gmin[i] if gmin[i] < g else a * g + (1 - a) * gmin[i]
        sm[i] = g
    sm = uniform_filter1d(sm, la)
    sm = np.minimum(sm, gmin)
    return x * sm[:, None]


def main():
    P = pad()
    B = bass()
    dry, send = render_events()
    music = P + np.stack([B, B], 1)
    music_send = P * 0.35
    wet_in = send[:N + SR * 4] + np.pad(music_send, ((0, SR * 4), (0, 0)))
    wet = np.stack([ss.fftconvolve(wet_in[:, c], IR[:, c])[: N] for c in range(2)], 1)
    mix = music + dry[:N] + 0.55 * wet
    # master: gentle highpass, slight air shelf, fades
    b, a = ss.butter(2, 28 / (SR / 2), 'high')
    mix = ss.lfilter(b, a, mix, axis=0)
    t = np.arange(N) / SR
    mix *= np.clip(t / 0.01, 0, 1)[:, None]
    fo = np.clip((DUR - t) / 1.6, 0, 1)
    mix *= (np.sin(fo * np.pi / 2) ** 2)[:, None]
    meter = pyln.Meter(SR)
    for it in range(4):
        lufs = meter.integrated_loudness(mix)
        mix *= 10 ** ((-14.0 - lufs) / 20)
        mix = limiter(mix, 10 ** (-1.3 / 20))
    lufs = meter.integrated_loudness(mix)
    tp = 20 * np.log10(true_peak(mix))
    print(f'integrated {lufs:.2f} LUFS, true peak {tp:.2f} dBTP, sample peak {20*np.log10(np.abs(mix).max()):.2f} dBFS')
    wf.write(sys.argv[2], SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))


if __name__ == '__main__':
    main()
