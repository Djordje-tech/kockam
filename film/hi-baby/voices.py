"""Generate and process the teaser dialogue.
GIRL  = libritts sid 664, respeeded up -> 6-year-old, then a real phone chain.
DAD   = libritts sid 436, respeeded down -> 34, close-mic, groggy."""
import sys, os, warnings
warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from piper import PiperVoice
from piper.config import SynthesisConfig
import dsp
from dsp import SR

D = os.path.dirname(os.path.abspath(__file__)) + '/'
V = D + 'voices/'
OUT = D + 'stems/'
os.makedirs(OUT, exist_ok=True)

voice = PiperVoice.load(V + 'en-us-libritts-high.onnx', config_path=V + 'en-us-libritts-high.onnx.json')
PSR = voice.config.sample_rate           # 22050

GIRL_SID, GIRL_RATIO = 664, 1.14         # up: 6-year-old vocal tract
DAD_SID,  DAD_RATIO  = 436, 0.955        # down: bigger chest

def synth(text, sid, ls=1.0, ns=0.667, nw=0.8):
    sc = SynthesisConfig(speaker_id=sid, length_scale=ls, noise_scale=ns, noise_w_scale=nw)
    a = np.concatenate([c.audio_float_array for c in voice.synthesize(text, syn_config=sc)])
    return a.astype(np.float32)

def to48(x):
    return resample_poly(x, 480, PSR // 45).astype(np.float32) if PSR != SR else x

def up48(x):
    """22050 -> 48000"""
    return resample_poly(x, 320, 147).astype(np.float32)

def line(text, sid, ratio, ls=1.0, ns=0.667, nw=0.8):
    """Synthesize slower/faster so that after the vocal-tract respeed the
    delivery lands at the intended tempo."""
    a = synth(text, sid, ls=ls * ratio, ns=ns, nw=nw)
    a = up48(a)
    a = dsp.respeed(a, ratio)
    return dsp.trim_silence(dsp.norm(a, 0.95))

# ------------------------------------------------------------------ treatments
def mulaw(x, mu=255.0, bits=8):
    s = np.sign(x); a = np.minimum(np.abs(x), 1.0)
    y = s * np.log1p(mu * a) / np.log1p(mu)
    q = 2 ** (bits - 1)
    y = np.round(y * q) / q
    return (np.sign(y) * (np.expm1(np.abs(y) * np.log1p(mu)) / mu)).astype(np.float32)

def phone(x, grit=1.0, hiss=0.0035, dropouts=True, seed=3):
    """A voice arriving down a mobile line: band, handset resonance, AGC,
    8 kHz codec with mu-law quantisation, carrier hiss and micro-dropouts."""
    y = dsp.bp(x, 330, 3300, order=6)
    y = dsp.peaking(y, 1750, 1.1, 5.0)      # handset horn
    y = dsp.peaking(y,  850, 1.8, -3.5)     # scoop the body out
    y = dsp.peaking(y, 2600, 2.0, 2.5)      # intelligibility
    y = dsp.compress(y, -28, 7.0, 2, 55, makeup_db=10)   # network AGC
    # --- codec: 48k -> 8k -> 48k with mu-law quantisation
    lowr = resample_poly(y, 1, 6)
    lowr = mulaw(dsp.norm(lowr, 0.85), bits=8 if grit >= 1 else 9)
    y = resample_poly(lowr, 6, 1).astype(np.float32)[:len(x)]
    if len(y) < len(x): y = np.pad(y, (0, len(x) - len(y)))
    y = dsp.bp(y, 330, 3400, order=4)
    # --- carrier noise
    rng = np.random.default_rng(seed)
    n = dsp.bp(dsp.white(len(y), seed), 500, 3200, 2) * hiss
    y = y + n
    # --- micro dropouts (packet loss)
    if dropouts:
        g = np.ones(len(y), np.float32)
        for _ in range(max(1, len(y) // (SR // 2))):
            i = rng.integers(0, max(1, len(y) - 900))
            w = rng.integers(120, 700)
            g[i:i + w] *= rng.uniform(0.45, 0.8)
        k = np.hanning(129); k /= k.sum()
        g = np.convolve(g, k, 'same')
        y = y * g
    return dsp.norm(y.astype(np.float32), 0.9)

ROOM = dsp.make_ir(0.9, 0.16, lo=110, hi=6500, predelay_ms=6, seed=11)   # small bunk room

def close_mic(x, breath=0.35, seed=5):
    """Him: cardioid up close in a dark room. Proximity, a little air, barely wet.
    The air sits at roughly -32 dB and only above 2.5 kHz, so it reads as a warm
    body in front of a mic instead of tape hiss."""
    y = dsp.shelf(x, 190, 3.5, 'low')          # proximity effect
    y = dsp.peaking(y, 3100, 1.4, 2.0)         # presence
    y = dsp.lp(y, 11500, 2)                    # dynamic-mic top end
    y = dsp.compress(y, -26, 3.2, 8, 160, makeup_db=7)
    y = dsp.norm(y, 0.9)
    if breath > 0:                              # air riding the syllables
        env = dsp.envelope(y, 25, 220)
        env = env / (env.max() + 1e-9)
        b = dsp.bp(dsp.white(len(y), seed), 2500, 9000, 2) * env * breath * 0.030
        y = y + b
    y = dsp.convolve(y, ROOM, wet=0.14)
    return np.clip(y.astype(np.float32), -0.99, 0.99)

def breath_in(dur=0.45, seed=17, depth=1.0):
    """A discrete catch of breath -- worth more than any amount of continuous hiss."""
    L = int(dur * SR)
    n = dsp.bp(dsp.white(L, seed), 380, 3400, 2)
    body = dsp.lp(dsp.white(L, seed + 1), 700, 2) * 0.5
    e = dsp.adsr(L, dur * 0.55, dur * 0.12, 0, dur * 0.3, sus=0.85)
    y = (n + body) * e * 0.16 * depth
    return dsp.convolve(y.astype(np.float32), ROOM, wet=0.12)

def groan(x, glide=0.93, seed=23):
    """Take the hum and drag its pitch down across its length: waking up."""
    v = dsp.trim_silence(x)
    L = len(v)
    out = np.zeros(int(L / glide) + 8, np.float32)
    step = int(0.030 * SR)
    pos = 0
    for i in range(0, L - step, step):
        r = 1.0 - (1.0 - glide) * (i / max(1, L - step))
        g = dsp.respeed(v[i:i + step * 2], r)
        w = np.hanning(len(g)).astype(np.float32)
        n = min(len(g), len(out) - pos)
        if n > 0: out[pos:pos + n] += g[:n] * w[:n]
        pos += step
    return dsp.norm(out, 0.9)

def giggle(vowel, n_bursts=7, rate=5.4, seed=9):
    """Build a child's laugh out of one vowel: descending F0 contour, jitter,
    decaying amplitude, and an audible catch of breath at the end."""
    rng = np.random.default_rng(seed)
    v = dsp.trim_silence(vowel)
    core = v[:int(0.16 * SR)] if len(v) > int(0.16 * SR) else v
    total = int((n_bursts / rate + 0.55) * SR)
    out = np.zeros(total, np.float32)
    for i in range(n_bursts):
        t = i / rate + rng.uniform(-0.012, 0.012)
        ratio = 1.13 - 0.05 * (i / max(1, n_bursts - 1)) + rng.uniform(-0.02, 0.02)
        b = dsp.respeed(core, ratio)
        L = int(rng.uniform(0.070, 0.105) * SR)
        b = b[:L] if len(b) > L else np.pad(b, (0, L - len(b)))
        e = dsp.adsr(L, 0.006, 0.02, 0, 0.045, sus=0.75)
        amp = (0.55 + 0.45 * np.exp(-i / 2.6)) * rng.uniform(0.85, 1.0)
        h = dsp.bp(dsp.white(L, seed + i), 1200, 6000, 2) * 0.05 * e   # breath in each puff
        dsp.place(out, (b * e + h) * amp, t)
    # catch of breath at the tail
    L = int(0.34 * SR)
    inh = dsp.bp(dsp.white(L, seed + 40), 700, 4200, 2) * dsp.adsr(L, 0.16, 0.05, 0, 0.13, sus=0.8) * 0.16
    dsp.place(out, inh, n_bursts / rate + 0.06)
    return dsp.norm(out, 0.9)

# ------------------------------------------------------------------ the lines
print("synthesising...")
g_q  = line("Daddy?",        GIRL_SID, GIRL_RATIO, ls=1.08, ns=0.70, nw=0.90)
g_x  = line("Daddy!",        GIRL_SID, GIRL_RATIO, ls=0.92, ns=0.74, nw=0.95)
g_sa = line("Say it again.", GIRL_SID, GIRL_RATIO, ls=1.02, ns=0.70, nw=0.88)
g_ah = line("Ah.",           GIRL_SID, GIRL_RATIO, ls=1.10, ns=0.66, nw=0.80)

d_hb = line("Hi... baby.",   DAD_SID, DAD_RATIO, ls=1.42, ns=0.76, nw=0.95)
d_pr = line("I promise.",    DAD_SID, DAD_RATIO, ls=1.20, ns=0.72, nw=0.90)
d_mm = line("Mmm.",          DAD_SID, DAD_RATIO, ls=1.75, ns=0.80, nw=1.00)

laugh = giggle(g_ah)

raw = dict(g_q=g_q, g_x=g_x, g_sa=g_sa, d_hb=d_hb, d_pr=d_pr, d_mm=d_mm, laugh=laugh)
for k, a in raw.items():
    wavfile.write(OUT + f'raw_{k}.wav', SR, (a * 32767).astype(np.int16))

print("processing...")
stems = {}
stems['g_q']   = phone(g_q,  seed=3)
stems['g_x']   = phone(g_x,  seed=4)
stems['g_sa']  = phone(g_sa, seed=6)
stems['laugh'] = phone(laugh, hiss=0.0028, seed=8)
# the last "Daddy?" -- same take, but the line is wrong: narrower, colder, smeared
tail = dsp.bp(g_q, 420, 2400, order=6)
tail = dsp.convolve(tail, dsp.make_ir(2.4, 0.55, lo=200, hi=3000, predelay_ms=45, seed=21), wet=0.6)
stems['g_ghost'] = phone(dsp.norm(tail, 0.9), hiss=0.006, seed=13)

stems['d_hb'] = close_mic(d_hb, breath=0.45)
stems['d_pr'] = close_mic(d_pr, breath=0.30)
stems['d_mm'] = close_mic(groan(d_mm), breath=0.55)
stems['breath'] = breath_in(0.50)
stems['breath2'] = breath_in(0.38, seed=31, depth=0.8)

for k, a in stems.items():
    wavfile.write(OUT + f'{k}.wav', SR, (a * 32767).astype(np.int16))
    print(f"  {k:9s} {len(a)/SR:5.2f}s  peak {np.abs(a).max():.2f}")
print("OK")
