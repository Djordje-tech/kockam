"""Cut the teaser. One cue sheet, one mix, mastered stereo."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from scipy.io import wavfile
from scipy.ndimage import maximum_filter1d
import dsp, sfx
from dsp import SR, place, db, norm

D = os.path.dirname(os.path.abspath(__file__)) + '/'
DUR = 93.5
N = int(DUR * SR)

def load(name):
    sr, a = wavfile.read(D + 'stems/' + name + '.wav')
    return (a.astype(np.float32) / 32768.0)

V = {k: load(k) for k in ['g_q','g_x','g_sa','laugh','g_ghost','d_hb','d_pr','d_mm','breath','breath2']}

# ============================================================ CUE SHEET
# card text is rendered by the video pass; these are its in-points, kept here so
# picture and sound are cut from the same list and can never drift apart.
CARDS = [
    (  2.6, 3.3, ["0 7 : 1 1   A . M ."]),
    (  6.4, 3.2, ["SIX THOUSAND MILES FROM HOME"]),
    ( 10.2, 3.5, ["A PLACE HE IS NOT ALLOWED TO NAME"]),
    ( 14.9, 2.6, ["HIS PHONE RINGS"]),
    ( 26.4, 3.7, ["HE WILL PLAY THIS CALL", "FOUR HUNDRED TIMES"]),
    ( 30.8, 3.9, ["HE WILL NEVER HEAR IT", "THE SAME WAY TWICE"]),
    ( 35.4, 2.6, ["SHE IS SIX"]),
    ( 38.6, 2.6, ["HE IS THIRTY-FOUR"]),
    ( 41.8, 3.4, ["SHE IS NOT GETTING BETTER"]),
    ( 45.8, 4.0, ["HE PROMISES HE'LL BE HOME", "FOR HER BIRTHDAY"]),
    ( 50.4, 2.9, ["SHE MAKES HIM SAY IT TWICE"]),
    ( 58.9, 4.2, ["HE DOES NOT COME HOME"]),
    ( 64.8, 4.4, ["ELEVEN DAYS LATER,", "NEITHER DOES SHE"]),
    ( 73.4, 4.6, ["EVERY MORNING AT 7:11,", "THE PHONE STILL RINGS"]),
    ( 79.8, 3.2, ["SOMEONE STILL ANSWERS"]),
    ( 85.4, 4.2, ["HI, BABY"]),                       # title
    ( 90.2, 2.8, ["A FILM IN PROGRESS"]),
]
CALL_IN, CALL_OUT = 17.6, 25.8      # the drone gets out of the way here
CUT_TO_BLACK      = 85.0            # hard cut before the title

# ============================================================ BUSES
score  = np.zeros(N, np.float32)    # drone, hits, risers -> wide
amb    = np.zeros(N, np.float32)    # room, phone, foley  -> near
voice  = np.zeros(N, np.float32)    # dialogue            -> centre

# ---- ambience bed for the whole piece
place(amb, np.tile(sfx.room_tone(12, level=1.0), 9)[:N], 0.0, gain=0.70)

# ---- score
place(score, sfx.drone(30.0, root=41.2, level=0.15), 0.0)
place(score, sfx.drone(26.0, root=41.2, level=0.22, dark=0.35), 28.5)
place(score, sfx.drone(22.0, root=38.9, level=0.32, dark=0.75), 42.0)
place(score, sfx.felt_piano(196.0, 6.0, level=0.26), 25.9)
place(score, sfx.felt_piano(146.8, 6.0, level=0.20), 35.2)
place(score, sfx.reverse_swell(2.4, level=0.30), 41.0)
place(score, sfx.riser(4.2, level=0.72), 55.0)
place(score, sfx.braam(5.0, root=55.0, level=0.95), 58.85)
place(score, sfx.impact(3.4, f0=52.0, level=0.80), 58.85)
place(score, sfx.tinnitus(3.4, 3950, level=0.085), 63.3)
place(score, sfx.heartbeat(2, bpm=48, level=0.42), 64.4)
place(score, sfx.drone(14.0, root=36.7, level=0.20, dark=0.9), 71.0)
place(score, sfx.impact(6.0, f0=44.0, level=0.85), 85.35)   # the title lands
place(score, sfx.drone(9.0, root=41.2, level=0.17), 85.6)

# ---- the phone, first time
place(amb, sfx.vibrate(2, level=0.34), 14.30)
place(amb, sfx.ringtone(2, muffled=0.75, level=0.26), 16.20)
place(amb, sfx.sheets(1.5, level=0.34), 16.90)
place(amb, sfx.pickup(level=0.44), 17.80)
place(amb, sfx.dead_line(9.0, level=0.40), 18.30)
place(amb, sfx.clock_tick(4, 1.0, level=0.30), 2.9)

# ---- the call
place(voice, V['breath'],  18.55, gain=0.510)
place(voice, V['d_mm'],    19.05, gain=0.372)   # the groan of a man being woken
place(voice, V['g_q'],     20.15, gain=0.552)   # "Daddy?"
place(voice, V['g_x'],     21.05, gain=0.588)   # "Daddy!"
place(voice, V['breath2'], 21.75, gain=0.480)
place(voice, V['d_hb'],    22.20, gain=0.552)   # "Hi... baby."
place(voice, V['laugh'],   23.65, gain=0.528)

# ---- the promise
place(voice, V['g_sa'],    52.80, gain=0.528)   # "Say it again."
place(voice, V['d_pr'],    54.30, gain=0.540)   # "I promise."
place(amb,   sfx.dead_line(4.0, level=0.28), 52.3)

# ---- the phone, second time: same phone, wrong
warp = dsp.respeed(sfx.vibrate(2, level=0.70), 0.80)
warp = dsp.convolve(warp, sfx.IR_VOID, wet=0.45)
place(amb, warp[::-1][:int(0.35*SR)][::-1] * 0.0, 0.0)       # (no-op guard)
place(amb, warp, 72.60, gain=0.34)
place(amb, sfx.ringtone(2, muffled=0.15, level=0.28), 78.60)
place(amb, sfx.pickup(level=0.38), 82.30)
place(amb, sfx.dead_line(4.5, level=0.45), 82.70)
place(voice, V['g_ghost'], 83.35, gain=0.510)                  # "Daddy?"

# Dialogue is compressed the way dialogue always is: a spiky consonant must not
# be allowed to set the ceiling for the whole film and push the hits down.
voice = dsp.compress(voice, -30, 4.5, 4, 95, makeup_db=7.0)
voice = dsp.limit(voice, 0.42)

# ============================================================ AUTOMATION
t = np.arange(N) / SR

# The score steps aside for the call and then comes back. Breakpoint lists are
# used throughout rather than chained ramps -- a ramp that holds its end value
# for the rest of the timeline is exactly how a duck gets stuck on.
def curve(points):
    return np.interp(t, [p[0] for p in points], [p[1] for p in points]).astype(np.float32)

duck = curve([(0.0, 1.0), (CALL_IN - 1.2, 1.0), (CALL_IN, 0.10),
              (CALL_OUT, 0.10), (CALL_OUT + 1.8, 1.0), (DUR, 1.0)])
score *= duck

# hard silence after the hit -- the loudest thing in the film is the hole after it
gate = np.ones(N, np.float32)
g0, g1 = 62.95, 64.35
m = (t >= g0) & (t < g1)
gate[m] = 0.0
fadein = (t >= g1) & (t < g1 + 0.25)
gate[fadein] = np.interp(t[fadein], [g1, g1 + 0.25], [0.0, 1.0])
fadeout = (t >= g0 - 0.06) & (t < g0)
gate[fadeout] = np.interp(t[fadeout], [g0 - 0.06, g0], [1.0, 0.0])
amb *= gate
score_gate = gate.copy()
score_gate[(t >= 63.3) & (t < 66.8)] = 1.0        # tinnitus + heart survive the gate
score *= np.maximum(gate, np.where((t >= 63.3) & (t < 66.8), 1.0, 0.0))

# the beat of nothing before the title
hole = np.ones(N, np.float32)
h0, h1 = CUT_TO_BLACK, 85.32
m = (t >= h0) & (t < h1); hole[m] = 0.0
pre = (t >= h0 - 0.05) & (t < h0)
hole[pre] = np.interp(t[pre], [h0 - 0.05, h0], [1.0, 0.0])
amb *= hole; score *= hole; voice *= hole

# sidechain: dialogue always wins
venv = dsp.envelope(voice, 12, 320)
venv = venv / (venv.max() + 1e-9)
sc = 1.0 - 0.62 * np.clip(venv * 3.2, 0, 1)
sc = np.convolve(sc, np.hanning(2401) / np.hanning(2401).sum(), 'same').astype(np.float32)
score *= sc
amb *= (0.55 + 0.45 * sc)

# ============================================================ DYNAMIC ARC
# The emotional shape of a trailer is a loudness curve. Rather than guess two
# dozen fader values, state the curve you want in LUFS, measure what the mix
# actually does, and let the difference drive the automation.
ARC = [
    ( 0.0, -30), ( 1.5, -27), ( 4.0, -25), ( 8.0, -24), (12.0, -23),
    (14.3, -21), (16.5, -20), (18.0, -19),
    (19.0, -18), (25.5, -18),                     # the call: intimate, never loud
    (26.5, -22), (30.0, -22), (35.0, -22), (41.0, -22),
    (45.0, -21), (50.0, -20), (53.0, -19), (55.0, -18),
    (57.5, -14), (58.8,  -8), (60.5,  -8), (62.9, -12),   # the hit is the ceiling
    (63.2, -38), (64.3, -38),                     # the hole
    (64.8, -25), (68.0, -25), (71.0, -25),
    (73.0, -22), (77.0, -22), (79.5, -20), (83.0, -20), (84.8, -21),
    (85.1, -42), (85.3, -42),                     # a beat of nothing
    (85.6, -12), (88.0, -18), (91.0, -23), (93.5, -27),
]

def fit_arc(mono, arc, max_boost=8.0, max_cut=20.0, smooth_s=1.6):
    win, hop = int(0.4 * SR), int(0.1 * SR)
    centres, meas = [], []
    for i in range(0, max(1, len(mono) - win), hop):
        b = float((mono[i:i + win].astype(np.float64) ** 2).mean())
        centres.append((i + win / 2) / SR)
        meas.append(-0.691 + 10 * np.log10(b + 1e-12))
    centres = np.array(centres); meas = np.array(meas)
    tgt = np.interp(centres, [a for a, _ in arc], [b for _, b in arc])
    corr = np.clip(tgt - meas, -max_cut, max_boost)
    corr[meas < -50] = 0.0                        # never lift a silence
    k = max(3, int(smooth_s / 0.1) | 1)
    w = np.hanning(k); w /= w.sum()
    corr = np.convolve(np.pad(corr, (k, k), mode='edge'), w, 'same')[k:-k]
    g = np.interp(np.arange(len(mono)) / SR, centres, 10 ** (corr / 20.0)).astype(np.float32)
    return g

arc_gain = fit_arc((score + amb + voice), ARC)
score *= arc_gain; amb *= arc_gain; voice *= arc_gain

# ============================================================ STEREO + MASTER
IR_L = dsp.make_ir(2.8, 0.60, lo=70, hi=6500, predelay_ms=19, seed=201)
IR_R = dsp.make_ir(2.8, 0.60, lo=70, hi=6500, predelay_ms=23, seed=202)

def widen(x, wet=0.30):
    L = dsp.convolve(x, IR_L, wet=wet)
    R = dsp.convolve(x, IR_R, wet=wet)
    return L, R

sL, sR = widen(score, 0.34)
aL, aR = widen(amb,   0.20)
L = sL * 0.9 + aL + voice
R = sR * 0.9 + aR + voice

def master(x):
    """Glue only. A trailer that has been levelled is a trailer with no scenes."""
    y = dsp.hp(x, 26, 2)
    y = dsp.compress(y, -14, 1.6, 30, 300, makeup_db=1.2)
    y = dsp.shelf(y, 8000, 1.5, 'high')                      # air
    y = dsp.peaking(y, 320, 1.0, -1.2)                       # clear the mud
    return y

L, R = master(L), master(R)

# Peak-referenced first so the hit -- not a consonant -- owns the ceiling, then
# lifted to a sane delivery loudness with the limiter only touching the braams.
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = L / peak * 0.89, R / peak * 0.89
TARGET_I = -18.0
cur = dsp.lufs_ish((L + R) / 2)
lift = 10 ** ((TARGET_I - cur) / 20.0)
L, R = dsp.limit(L * lift, 0.95), dsp.limit(R * lift, 0.95)
fp = max(np.abs(L).max(), np.abs(R).max())
L, R = L / fp * 0.95, R / fp * 0.95

st = np.stack([L, R], 1)
wavfile.write(D + 'mix.wav', SR, (np.clip(st, -1, 1) * 32767).astype(np.int16))
print(f"mix: {DUR:.1f}s  LUFS~{dsp.lufs_ish((L+R)/2):.1f}  peak {np.abs(st).max():.3f}")
import json
json.dump([[a, b, c] for a, b, c in CARDS], open(D + 'cards.json', 'w'), indent=1)
print("cards:", len(CARDS))
