"""Procedural sound design for the HI, BABY teaser. Everything is synthesised --
no samples -- but every element is built the way the real thing behaves."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
import dsp
from dsp import SR, white, pink, brown, adsr, expdecay, fade, norm, db, place

def T(sec): return int(sec * SR)
def t_arr(sec): return np.arange(T(sec)) / SR

# ---------------------------------------------------------------- spaces
IR_ROOM   = dsp.make_ir(1.1, 0.18, lo=110, hi=7000, predelay_ms=6,  seed=11)  # bunk room
IR_HALL   = dsp.make_ir(3.2, 0.75, lo=60,  hi=6000, predelay_ms=28, seed=31)  # score hall
IR_VOID   = dsp.make_ir(5.5, 1.60, lo=40,  hi=4200, predelay_ms=55, seed=41)  # the big empty

# ---------------------------------------------------------------- ambience
def room_tone(dur, seed=101, level=1.0):
    """Forward base at night: generator hum, HVAC push, distant air."""
    n = T(dur); t = t_arr(dur)
    # diesel generator, well outside: 50 Hz and its odd harmonics, slowly wandering
    hum = np.zeros(n, np.float32)
    wob = 1.0 + 0.004 * np.sin(2*np.pi*0.07*t)
    for k, g in [(1, 1.0), (2, 0.28), (3, 0.16), (5, 0.07)]:
        hum += g * np.sin(2*np.pi*50*k*wob*t + k).astype(np.float32)
    hum = dsp.lp(hum, 320, 2) * 0.020
    # HVAC / wind against canvas
    air = dsp.bp(pink(n, seed), 90, 3800, 2) * 0.030
    air *= (1.0 + 0.22*np.sin(2*np.pi*0.045*t + 1.2)).astype(np.float32)
    # floor rumble
    rum = dsp.lp(brown(n, seed+1), 70, 2) * 0.055
    y = (hum + air + rum).astype(np.float32)
    return dsp.convolve(y, IR_ROOM, wet=0.18) * level

def dead_line(dur, seed=77, level=1.0):
    """An open call with nobody on it."""
    n = T(dur)
    y = dsp.bp(white(n, seed), 380, 3200, 2) * 0.030
    y += np.sin(2*np.pi*1000*t_arr(dur)).astype(np.float32) * 0.0016
    return fade(y.astype(np.float32), 0.05, 0.4) * level

# ---------------------------------------------------------------- the phone
def vibrate(buzzes=2, on=0.85, gap=0.42, seed=5, level=1.0):
    """A phone face-down on a plywood shelf. Motor + body rattling the board."""
    total = buzzes*on + (buzzes-1)*gap + 0.25
    n = T(total); out = np.zeros(n, np.float32)
    rng = np.random.default_rng(seed)
    for b in range(buzzes):
        L = T(on); t = np.arange(L)/SR
        # eccentric motor: ~172 Hz, spins up and down at the edges
        f = 172 * (1 - 0.10*np.exp(-t/0.05)) * (1 - 0.18*np.clip((t-(on-0.07))/0.07, 0, 1))
        ph = 2*np.pi*np.cumsum(f)/SR
        motor = (np.sin(ph) + 0.42*np.sin(2*ph) + 0.20*np.sin(3*ph)).astype(np.float32)
        motor = dsp.lp(motor, 900, 2) * 0.55
        # the board answering back: a rattle burst per motor revolution
        rattle = np.zeros(L, np.float32)
        for i in range(int(on*57)):
            p = int((i/57 + rng.uniform(-0.002, 0.002))*SR)
            if 0 <= p < L-800:
                cl = dsp.bp(white(800, seed+i+b*97), 1400, 6500, 2) * expdecay(800, 0.006)
                rattle[p:p+800] += cl * rng.uniform(0.5, 1.0)
        env = adsr(L, 0.012, 0.03, 0, 0.035, sus=0.9)
        seg = (motor + rattle*0.45) * env
        # plywood body resonance
        seg = dsp.peaking(seg, 210, 3.0, 5.0)
        seg = dsp.peaking(seg, 118, 4.0, 4.0)
        place(out, seg.astype(np.float32), b*(on+gap))
    out = dsp.convolve(out, IR_ROOM, wet=0.22)
    return norm(out, 0.85) * level

def ringtone(reps=3, muffled=0.0, seed=9, level=1.0):
    """A cold two-tone handset ring. `muffled` 0..1 buries it under bedding."""
    period, on = 1.55, 0.95
    total = reps*period
    out = np.zeros(T(total), np.float32)
    for r in range(reps):
        L = T(on); t = np.arange(L)/SR
        seg = np.zeros(L, np.float32)
        # two chirps per ring, a minor third apart
        for k, (f, t0) in enumerate([(1174.7, 0.0), (987.8, 0.30)]):
            LL = T(0.26); tt = np.arange(LL)/SR
            tone = (np.sin(2*np.pi*f*tt) + 0.33*np.sin(2*np.pi*f*2*tt)
                    + 0.12*np.sin(2*np.pi*f*3*tt)).astype(np.float32)
            tone *= adsr(LL, 0.004, 0.06, 0, 0.16, sus=0.55)
            i = T(t0)
            if i+LL <= L: seg[i:i+LL] += tone*0.5
        place(out, seg, r*period)
    if muffled > 0:
        out = dsp.lp(out, 1600 - 900*muffled, 4)
        out = dsp.shelf(out, 400, -6*muffled, 'high')
    out = dsp.convolve(out, IR_ROOM, wet=0.24)
    return norm(out, 0.8) * level

def pickup(seed=13, level=1.0):
    """Fumbling for it, thumb on glass, the line opening."""
    n = T(0.85); out = np.zeros(n, np.float32)
    rng = np.random.default_rng(seed)
    # hand across fabric then plastic sliding on wood
    for t0, lo, hi, g, d in [(0.00, 900, 6000, 0.30, 0.14), (0.13, 600, 4500, 0.22, 0.10)]:
        L = T(d); s = dsp.bp(white(L, seed+int(t0*100)), lo, hi, 2)
        s *= adsr(L, d*0.3, d*0.2, 0, d*0.5, sus=0.7) * g
        place(out, s.astype(np.float32), t0)
    # the tap
    L = T(0.05)
    click = dsp.bp(white(L, seed+7), 1800, 9000, 2) * expdecay(L, 0.0055) * 0.55
    click += (np.sin(2*np.pi*430*np.arange(L)/SR) * expdecay(L, 0.010) * 0.22).astype(np.float32)
    place(out, click.astype(np.float32), 0.34)
    # the line opens: a soft thump as the far side connects
    L = T(0.30)
    op = dsp.lp(white(L, seed+9), 700, 2) * expdecay(L, 0.05) * 0.16
    place(out, op.astype(np.float32), 0.40)
    out = dsp.convolve(out, IR_ROOM, wet=0.20)
    return norm(out, 0.8) * level

def sheets(dur=1.4, seed=21, level=1.0):
    """Someone moving under a poncho liner."""
    n = T(dur); out = np.zeros(n, np.float32)
    rng = np.random.default_rng(seed)
    for _ in range(int(dur*9)):
        t0 = rng.uniform(0, dur*0.9); d = rng.uniform(0.05, 0.19); L = T(d)
        s = dsp.bp(white(L, rng.integers(0, 99999)), rng.uniform(700, 1400), rng.uniform(4500, 8500), 2)
        s *= adsr(L, d*0.35, d*0.25, 0, d*0.4, sus=0.75) * rng.uniform(0.3, 1.0)
        place(out, s.astype(np.float32), t0)
    out = dsp.convolve(out, IR_ROOM, wet=0.18)
    return norm(out, 0.55) * level

def clock_tick(n_ticks=6, period=1.0, seed=33, level=1.0):
    out = np.zeros(T(n_ticks*period+0.4), np.float32)
    for i in range(n_ticks):
        L = T(0.035)
        c = dsp.bp(white(L, seed+i), 2200, 8000, 2) * expdecay(L, 0.004)
        c += (np.sin(2*np.pi*1600*np.arange(L)/SR)*expdecay(L, 0.006)*0.3).astype(np.float32)
        place(out, c.astype(np.float32)*(0.9 if i % 2 == 0 else 0.72), i*period)
    return norm(dsp.convolve(out, IR_ROOM, wet=0.25), 0.35) * level

# ---------------------------------------------------------------- score
def drone(dur, root=41.2, seed=55, level=1.0, dark=0.0):
    """The spine of the trailer: two detuned sub sines beating against each other
    plus a slow filtered pad. `dark` pulls the pad down and dirties it."""
    n = T(dur); t = t_arr(dur)
    sub = (np.sin(2*np.pi*root*t) + 0.85*np.sin(2*np.pi*(root*1.006)*t)).astype(np.float32)*0.5
    sub += (0.35*np.sin(2*np.pi*root*0.5*t)).astype(np.float32)
    # pad: saw stack two octaves up, swept by a slow LFO
    pad = np.zeros(n, np.float32)
    for mult, g, det in [(2, 1.0, 1.000), (2, 0.7, 1.004), (3, 0.45, 0.997), (4, 0.28, 1.002)]:
        f = root*mult*det
        ph = 2*np.pi*f*t
        pad += g*(2/np.pi*np.arctan(np.tan(ph/2)+1e-6)).astype(np.float32)
    pad = np.nan_to_num(pad)
    cutoff = 420 - 180*dark + 150*np.sin(2*np.pi*0.035*t)
    pad_f = np.zeros(n, np.float32)
    step = T(0.25)
    for i in range(0, n, step):
        c = float(np.clip(cutoff[min(i, n-1)], 90, 2000))
        pad_f[i:i+step] = dsp.lp(pad[i:i+step], c, 2)
    y = sub*0.75 + pad_f*0.16
    y *= (1.0 + 0.10*np.sin(2*np.pi*0.055*t + 0.7)).astype(np.float32)
    y = dsp.convolve(y.astype(np.float32), IR_HALL, wet=0.25)
    return fade(norm(y, 0.85), 1.2, 1.5) * level

def braam(dur=4.5, root=55.0, seed=61, level=1.0):
    """The horn hit. Sub, a detuned brass stack driven into saturation,
    a noise transient on the front, and a long tail in a big room."""
    n = T(dur); t = t_arr(dur)
    env = (np.minimum(1.0, t/0.045) * np.exp(-t/(dur*0.34))).astype(np.float32)
    sub = np.sin(2*np.pi*(root*0.5)*(1 - 0.10*np.exp(-t/0.10))*t).astype(np.float32)
    stack = np.zeros(n, np.float32)
    for mult, g, det in [(1, 1.0, 1.0), (1, 0.8, 1.005), (1.5, 0.55, 0.998),
                         (2, 0.5, 1.003), (3, 0.28, 1.0), (4, 0.16, 1.006)]:
        stack += g*np.sin(2*np.pi*root*mult*det*t + mult).astype(np.float32)
    stack = dsp.softclip(stack/3.0, 2.6)
    stack = dsp.lp(stack, 1500, 2)
    tr = dsp.bp(white(n, seed), 200, 5000, 2) * expdecay(n, 0.055) * 0.4
    y = (sub*1.0 + stack*0.65 + tr) * env
    y = dsp.convolve(y.astype(np.float32), IR_HALL, wet=0.42)
    return norm(y, 0.95) * level

def impact(dur=3.2, f0=52.0, seed=67, level=1.0):
    """A dry gut-punch: pitch-dropping sub with a click on the front."""
    n = T(dur); t = t_arr(dur)
    f = f0*(1 - 0.55*np.clip(t/0.28, 0, 1))
    ph = 2*np.pi*np.cumsum(f)/SR
    body = np.sin(ph).astype(np.float32)*np.exp(-t/0.55).astype(np.float32)
    cl = dsp.bp(white(n, seed), 900, 9000, 2)*expdecay(n, 0.008)*0.45
    knock = dsp.lp(white(n, seed+1), 260, 2)*expdecay(n, 0.045)*0.6
    y = body*1.0 + cl + knock
    y = dsp.convolve(y.astype(np.float32), IR_VOID, wet=0.30)
    return norm(y, 0.95)*level

def riser(dur=4.0, seed=71, level=1.0, to_silence=0.12):
    """Noise and a tone climbing together, with the tremolo speeding up.
    Ends in a hole so the hit has somewhere to land."""
    n = T(dur); t = t_arr(dur)
    p = (t/dur)**1.6
    # swept noise
    out = np.zeros(n, np.float32); step = T(0.05)
    for i in range(0, n, step):
        pp = float(p[min(i, n-1)])
        lo = 180 + 2600*pp; hi = lo + 400 + 3500*pp
        out[i:i+step] = dsp.bp(white(min(step, n-i), seed+i), lo, min(hi, 17000), 2)
    # rising tone
    f = 110*np.exp(p*2.5)
    tone = np.sin(2*np.pi*np.cumsum(f)/SR).astype(np.float32)*0.28
    # tremolo accelerating from 3 to 19 Hz
    lfo = 0.5+0.5*np.sin(2*np.pi*np.cumsum(3+16*p)/SR).astype(np.float32)
    y = (out*0.5 + tone) * (0.35+0.65*lfo) * (p**1.1).astype(np.float32)
    # sub swell underneath
    y += (np.sin(2*np.pi*38*t)*p**2*0.35).astype(np.float32)
    hole = T(to_silence)
    if hole < n: y[-hole:] *= np.linspace(1, 0, hole)**2
    y = dsp.convolve(y.astype(np.float32), IR_HALL, wet=0.22)
    return norm(y, 0.85)*level

def reverse_swell(dur=2.2, seed=73, level=1.0):
    n = T(dur)
    y = dsp.bp(white(n, seed), 300, 7000, 2)*expdecay(n, dur*0.28)
    y += (np.sin(2*np.pi*180*t_arr(dur))*expdecay(n, dur*0.22)*0.3).astype(np.float32)
    y = dsp.convolve(y.astype(np.float32), IR_HALL, wet=0.35)
    return norm(y[::-1].copy(), 0.7)*level

def heartbeat(beats=3, bpm=52, seed=79, level=1.0):
    period = 60.0/bpm
    out = np.zeros(T(beats*period+0.9), np.float32)
    for b in range(beats):
        for off, g, f in [(0.0, 1.0, 46.0), (0.165, 0.62, 40.0)]:
            L = T(0.5); t = np.arange(L)/SR
            ff = f*(1-0.35*np.clip(t/0.12, 0, 1))
            th = np.sin(2*np.pi*np.cumsum(ff)/SR).astype(np.float32)*np.exp(-t/0.075).astype(np.float32)
            th += dsp.lp(white(L, seed+b*4+int(off*10)), 180, 2)*expdecay(L, 0.030)*0.45
            place(out, th.astype(np.float32)*g, b*period+off)
    out = dsp.convolve(out, IR_VOID, wet=0.20)
    return norm(out, 0.8)*level

def tinnitus(dur=3.0, f=3950.0, level=1.0):
    n = T(dur); t = t_arr(dur)
    y = (np.sin(2*np.pi*f*t) + 0.4*np.sin(2*np.pi*f*1.5*t)).astype(np.float32)
    y *= np.exp(-t/(dur*0.42)).astype(np.float32)
    y *= (1+0.04*np.sin(2*np.pi*5.5*t)).astype(np.float32)
    return fade(norm(y, 0.5), 0.02, 0.5)*level

def felt_piano(freq=196.0, dur=5.0, seed=83, level=1.0):
    """One struck note on a felted upright: inharmonic partials, hammer knock,
    and the string noise that makes it sound played rather than generated."""
    n = T(dur); t = t_arr(dur)
    y = np.zeros(n, np.float32)
    B = 0.00042                                    # string inharmonicity
    for k in range(1, 15):
        fk = freq*k*np.sqrt(1+B*k*k)
        g = (1.0/k**1.35)*np.exp(-k/9.0)
        dec = dur*(0.42/(1+0.30*k))
        y += (g*np.sin(2*np.pi*fk*t + k*0.7)*np.exp(-t/dec)).astype(np.float32)
    ham = dsp.bp(white(n, seed), 900, 5200, 2)*expdecay(n, 0.012)*0.16   # felt hammer
    thud = dsp.lp(white(n, seed+1), 260, 2)*expdecay(n, 0.030)*0.10      # action noise
    y = y*0.55 + ham + thud
    y = dsp.lp(y, 7000, 2)
    y = dsp.convolve(y.astype(np.float32), IR_HALL, wet=0.30)
    return fade(norm(y, 0.85), 0.002, 0.6)*level

if __name__ == '__main__':
    from scipy.io import wavfile
    out = os.path.dirname(os.path.abspath(__file__))+'/sfx/'
    os.makedirs(out, exist_ok=True)
    bank = dict(room_tone=room_tone(6), vibrate=vibrate(2), ringtone=ringtone(3),
                pickup=pickup(), sheets=sheets(), clock=clock_tick(4),
                drone=drone(10), braam=braam(), impact=impact(), riser=riser(),
                rev=reverse_swell(), heart=heartbeat(3), tin=tinnitus(),
                piano=felt_piano(), dead=dead_line(3))
    for k, v in bank.items():
        wavfile.write(out+k+'.wav', SR, (np.clip(v, -1, 1)*32767).astype(np.int16))
        print(f"  {k:10s} {len(v)/SR:5.2f}s peak {np.abs(v).max():.2f} rms {np.sqrt((v**2).mean()):.3f}")
