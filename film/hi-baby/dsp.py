"""Film-grade DSP helpers. Everything runs at SR=48000 mono float32 unless noted."""
import numpy as np
from scipy.signal import butter, sosfilt, sosfiltfilt, resample_poly, fftconvolve
from fractions import Fraction

SR = 48000

# ---------- filters ----------
def _sos(kind, cut, order=4, sr=SR):
    return butter(order, cut, btype=kind, fs=sr, output='sos')

def lp(x, f, order=4, sr=SR):  return sosfilt(_sos('low',  min(f, sr/2*0.98), order, sr), x)
def hp(x, f, order=4, sr=SR):  return sosfilt(_sos('high', max(f, 5),          order, sr), x)
def bp(x, lo, hi, order=4, sr=SR):
    return sosfilt(_sos('band', [max(lo,5), min(hi, sr/2*0.98)], order, sr), x)

def shelf(x, f, gain_db, kind='low', sr=SR):
    """First-order-ish shelf built from a split band."""
    g = 10 ** (gain_db / 20.0)
    if kind == 'low':
        low = sosfiltfilt(_sos('low', f, 2, sr), x)
        return x + (g - 1.0) * low
    high = sosfiltfilt(_sos('high', f, 2, sr), x)
    return x + (g - 1.0) * high

def peaking(x, f, q, gain_db, sr=SR):
    bw = f / max(q, 0.1)
    lo, hi = max(f - bw / 2, 5), min(f + bw / 2, sr / 2 * 0.98)
    band = sosfiltfilt(_sos('band', [lo, hi], 2, sr), x)
    return x + (10 ** (gain_db / 20.0) - 1.0) * band

# ---------- pitch / formant ----------
def respeed(x, ratio, sr=SR):
    """Resample by `ratio`: shifts pitch AND formants together (vocal-tract scaling).
    ratio>1 -> higher/smaller speaker, shorter. ratio<1 -> deeper/bigger, longer."""
    fr = Fraction(ratio).limit_denominator(600)
    return resample_poly(x, fr.denominator, fr.numerator).astype(np.float32)

# ---------- dynamics ----------
def envelope(x, atk_ms=5, rel_ms=80, sr=SR):
    """Vectorised peak follower: running max over the attack window, then a
    one-pole release. Behaves like a hardware detector without a per-sample loop."""
    from scipy.ndimage import maximum_filter1d
    from scipy.signal import lfilter
    ax = np.abs(x).astype(np.float64)
    w = max(1, int(sr * atk_ms / 1000.0))
    pk = maximum_filter1d(ax, size=w, mode='nearest')
    r = np.exp(-1.0 / max(1.0, sr * rel_ms / 1000.0))
    held = lfilter([1 - r], [1, -r], pk)
    return np.maximum(pk * 0.0, np.maximum(held, pk * 0.0) if False else np.maximum(held, 0.0))

def compress(x, thresh_db=-20, ratio=4.0, atk_ms=5, rel_ms=120, makeup_db=0.0, sr=SR):
    e = envelope(x, atk_ms, rel_ms, sr) + 1e-9
    edb = 20 * np.log10(e)
    over = np.maximum(0.0, edb - thresh_db)
    gr = -over * (1 - 1 / ratio)
    return x * 10 ** ((gr + makeup_db) / 20.0)

def limit(x, ceil=0.97, lookahead_ms=2.0, sr=SR):
    n = max(1, int(sr * lookahead_ms / 1000))
    pad = np.concatenate([x, np.zeros(n, x.dtype)])
    e = envelope(pad, 0.3, 60, sr)[n:] + 1e-9
    g = np.minimum(1.0, ceil / np.maximum(e, ceil))
    # smooth the gain so it does not distort
    k = np.hanning(n * 2 + 1); k /= k.sum()
    g = np.convolve(g, k, 'same')
    y = x * g
    return np.clip(y, -0.999, 0.999)

def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive) if drive > 0 else x

# ---------- noise ----------
def white(n, seed=None):
    rng = np.random.default_rng(seed)
    return rng.standard_normal(n).astype(np.float32)

def pink(n, seed=None):
    w = white(n * 2, seed)
    X = np.fft.rfft(w)
    f = np.arange(len(X)); f[0] = 1
    X /= np.sqrt(f)
    y = np.fft.irfft(X)[:n]
    return (y / (np.abs(y).max() + 1e-9)).astype(np.float32)

def brown(n, seed=None):
    y = np.cumsum(white(n, seed))
    y = y - np.linspace(y[0], y[-1], n)
    return (y / (np.abs(y).max() + 1e-9)).astype(np.float32)

# ---------- envelopes ----------
def adsr(n, a, d, s, r, sus=0.7, sr=SR):
    A, Dn, R = int(a*sr), int(d*sr), int(r*sr)
    S = max(0, n - A - Dn - R)
    parts = [np.linspace(0, 1, A, endpoint=False) if A else np.array([]),
             np.linspace(1, sus, Dn, endpoint=False) if Dn else np.array([]),
             np.full(S, sus),
             np.linspace(sus, 0, R) if R else np.array([])]
    e = np.concatenate(parts)
    return np.resize(e, n).astype(np.float32)

def expdecay(n, tau, sr=SR):
    return np.exp(-np.arange(n) / (tau * sr)).astype(np.float32)

def fade(x, fin=0.01, fout=0.01, sr=SR):
    y = x.copy()
    a, b = int(fin*sr), int(fout*sr)
    if a and a < len(y): y[:a] *= np.linspace(0, 1, a)
    if b and b < len(y): y[-b:] *= np.linspace(1, 0, b)
    return y

# ---------- reverb ----------
def make_ir(seconds, decay, sr=SR, lo=120, hi=9000, predelay_ms=8, seed=7, diffusion=0.9):
    """Synthetic room impulse: exponentially-decaying, band-limited, diffuse noise
    with a few early reflections. Sounds like a space, not a delay line."""
    n = int(seconds * sr)
    ir = white(n, seed) * np.exp(-np.arange(n) / (decay * sr))
    ir = bp(ir, lo, hi, 2, sr)
    # early reflections
    er = np.zeros(n, np.float32)
    rng = np.random.default_rng(seed + 1)
    for t, g in zip(rng.uniform(0.004, 0.075, 9), rng.uniform(0.15, 0.55, 9)):
        i = int(t * sr)
        if i < n: er[i] += g * rng.choice([-1, 1])
    ir = diffusion * ir + (1 - diffusion) * er
    pd = int(predelay_ms / 1000 * sr)
    ir = np.concatenate([np.zeros(pd, np.float32), ir])[:n]
    ir[0] = 0.0
    return (ir / (np.abs(ir).max() + 1e-9)).astype(np.float32)

def convolve(x, ir, wet=0.25):
    y = fftconvolve(x, ir)[:len(x)]
    m = np.abs(y).max() + 1e-9
    y = y / m * (np.abs(x).max() + 1e-9)
    return ((1 - wet) * x + wet * y).astype(np.float32)

# ---------- utility ----------
def norm(x, peak=0.9):
    m = np.abs(x).max() + 1e-12
    return (x / m * peak).astype(np.float32)

def db(x, d):
    return (x * 10 ** (d / 20.0)).astype(np.float32)

def place(bus, x, t, sr=SR, gain=1.0):
    """Mix x into bus starting at time t (seconds)."""
    i = int(t * sr)
    n = min(len(x), len(bus) - i)
    if n > 0 and i >= 0:
        bus[i:i+n] += x[:n] * gain
    return bus

def trim_silence(x, thresh=0.012, pad_ms=30, sr=SR):
    a = np.abs(x)
    idx = np.where(a > thresh)[0]
    if len(idx) == 0: return x
    p = int(pad_ms / 1000 * sr)
    return x[max(0, idx[0] - p): min(len(x), idx[-1] + p)]

def lufs_ish(x, sr=SR):
    """K-weighting approximation -> integrated loudness estimate."""
    y = shelf(x, 1500, 4.0, 'high', sr)
    y = hp(y, 60, 2, sr)
    ms = y.astype(np.float64) ** 2
    win = int(0.4 * sr); hop = int(0.1 * sr)
    blocks = [ms[i:i+win].mean() for i in range(0, max(1, len(ms) - win), hop)]
    blocks = [b for b in blocks if b > 0]
    if not blocks: return -70.0
    l = np.array([-0.691 + 10 * np.log10(b) for b in blocks])
    gated = l[l > l.max() - 20]
    return float(np.mean(gated)) if len(gated) else float(np.mean(l))
