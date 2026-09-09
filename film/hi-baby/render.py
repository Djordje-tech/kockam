"""Render the picture and marry it to the mix.

Black-card teaser: a drifting cold glow that breathes with the soundtrack,
film grain, vignette, and letterspaced type that fades rather than cuts."""
import sys, os, subprocess, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.io import wavfile
from scipy.ndimage import uniform_filter1d

D   = os.path.dirname(os.path.abspath(__file__)) + '/'
W, H, FPS = 1920, 1080, 24
DUR = 93.5
NF  = int(DUR * FPS)

F_SANS  = D + 'fonts2/Jost-var.ttf'          # variable, Weight axis
F_SERIF = D + 'fonts2/CormorantG-var.ttf'

CARDS = json.load(open(D + 'cards.json'))
TITLE_IDX = 15                                    # "HI, BABY"

# ------------------------------------------------------------------ type
def text_layer(lines, size, tracking, font_path, y_centre=0.5, alpha=1.0, weight=300):
    """Draw letterspaced, centred text into a float alpha mask."""
    font = ImageFont.truetype(font_path, size)
    try:
        font.set_variation_by_axes([weight])
    except Exception:
        pass
    img = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(img)
    lh = int(size * 1.85)
    total = lh * len(lines)
    y0 = int(H * y_centre - total / 2 + (lh - size) / 2)
    for li, line in enumerate(lines):
        widths = [d.textlength(ch, font=font) for ch in line]
        wtot = sum(widths) + tracking * max(0, len(line) - 1)
        x = (W - wtot) / 2
        y = y0 + li * lh
        for ch, cw in zip(line, widths):
            d.text((x, y), ch, font=font, fill=int(255 * alpha))
            x += cw + tracking
    return np.asarray(img, np.float32) / 255.0

print("laying out cards...")
layers = []
for i, (t0, dur, lines) in enumerate(CARDS):
    if i == TITLE_IDX:
        m = text_layer(lines, 118, 26, F_SERIF, 0.5, 1.0, weight=330)
    elif i == len(CARDS) - 1:
        m = text_layer(lines, 25, 13, F_SANS, 0.5, 0.72, weight=300)
    elif i == 0:
        m = text_layer(lines, 35, 17, F_SANS, 0.5, 0.88, weight=250)
    else:
        m = text_layer(lines, 39, 11, F_SANS, 0.5, 1.0, weight=320)
    layers.append((t0, dur, m))

# ------------------------------------------------------------------ background
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
cx, cy = W * 0.5, H * 0.62
def radial(sx, sy, ox=0.0, oy=0.0):
    r2 = ((xx - cx - ox) / sx) ** 2 + ((yy - cy - oy) / sy) ** 2
    return np.exp(-r2).astype(np.float32)

GLOW = radial(W * 0.42, H * 0.30) * 0.75 + radial(W * 0.78, H * 0.62) * 0.45
GLOW /= GLOW.max()
VIGN = 1.0 - 0.75 * np.clip((((xx - W/2)/(W*0.62))**2 + ((yy - H/2)/(H*0.66))**2), 0, 1) ** 1.25
VIGN = VIGN.astype(np.float32)
TINT = np.array([0.30, 0.46, 0.72], np.float32)   # cold blue-steel

# grain tiles at half res, upscaled -> chunky, filmic, cheap
rng = np.random.default_rng(4)
GRAIN = [rng.standard_normal((H // 2, W // 2)).astype(np.float32) for _ in range(14)]

# ------------------------------------------------------------------ audio drive
sr, aud = wavfile.read(D + 'mix.wav')
mono = aud.astype(np.float32).mean(1) / 32768.0
spf = sr / FPS
env = np.array([np.sqrt((mono[int(i*spf):int((i+1)*spf)] ** 2).mean() + 1e-12) for i in range(NF)])
env = uniform_filter1d(env, 5)
env = env / (np.percentile(env, 98) + 1e-9)
env = np.clip(env, 0, 1.6)

# low band drives the glow size, so the braam physically swells the frame
from scipy.signal import butter, sosfilt
low = sosfilt(butter(2, 200, 'low', fs=sr, output='sos'), mono)
lenv = np.array([np.sqrt((low[int(i*spf):int((i+1)*spf)] ** 2).mean() + 1e-12) for i in range(NF)])
lenv = uniform_filter1d(lenv, 4); lenv = np.clip(lenv / (np.percentile(lenv, 98) + 1e-9), 0, 1.5)

FLASHES = [(58.85, 0.55, 0.30), (85.35, 0.9, 0.22)]

# ------------------------------------------------------------------ encode
ff = subprocess.run(['python3','-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],
                    capture_output=True, text=True).stdout.strip()
out = D + 'HI_BABY_teaser.mp4'
cmd = [ff, '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS),
       '-i', 'pipe:', '-i', D + 'mix.wav',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
       '-x264-params', 'aq-mode=3:aq-strength=0.8:psy-rd=1.0:deblock=1,1',
       '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart',
       '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', out]
proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

print(f"rendering {NF} frames...")
for f in range(NF):
    t = f / FPS
    # --- glow, breathing with the mix
    amp = 0.16 + 0.58 * float(env[f]) + 0.34 * float(lenv[f])
    drift = 1.0 + 0.05 * np.sin(t * 0.11) 
    base = GLOW * (amp * 0.115 * drift)
    for ft, fa, fd in FLASHES:
        if 0 <= t - ft < fd:
            base = base + fa * np.exp(-(t - ft) / (fd * 0.30))
    frame = base[..., None] * TINT[None, None, :]
    frame += 0.008                                        # lift black off pure zero
    # --- type
    for t0, dur, mask in layers:
        if t0 - 0.9 <= t <= t0 + dur + 0.9:
            fin = np.clip((t - t0) / 0.85, 0, 1)
            fout = np.clip((t0 + dur - t) / 0.85, 0, 1)
            a = float(min(fin, fout) ** 1.4)
            if a > 0.002:
                frame += (mask * a * 1.0)[..., None]
    # --- grain + vignette
    g = GRAIN[f % len(GRAIN)]
    if f % 3 == 1: g = g[::-1]
    elif f % 3 == 2: g = g[:, ::-1]
    g = np.repeat(np.repeat(g, 2, 0), 2, 1)
    frame += g[..., None] * (0.010 + 0.013 * float(env[f]))
    frame *= VIGN[..., None]
    np.clip(frame, 0, 1, out=frame)
    frame = frame ** (1 / 1.06)                           # gentle lift in the shadows
    proc.stdin.write((frame * 255).astype(np.uint8).tobytes())
    if f % 240 == 0: print(f"  {f}/{NF}  t={t:5.1f}s", flush=True)

proc.stdin.close()
err = proc.stderr.read().decode()
rc = proc.wait()
print("ffmpeg rc", rc)
if rc != 0: print(err[-2500:])
else: print("wrote", out, os.path.getsize(out), "bytes")
