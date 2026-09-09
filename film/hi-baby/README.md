# HI, BABY — teaser pipeline

Everything the teaser is made of, as code. Run the four stages in order and the
1080p/24 cut rebuilds from nothing: no sample libraries, no stock music, no
audio recorded anywhere else.

```
python3 voices.py     # dialogue  -> stems/
python3 sfx.py        # sound design bank (also importable)
python3 mix.py        # the cut   -> mix.wav + cards.json
python3 render.py     # picture   -> HI_BABY_teaser.mp4
```

## The story beats

07:11 in the morning, six thousand miles out. His phone goes off on the shelf.
She is six: *"Daddy? Daddy!"* He surfaces out of sleep — *"Hi... baby."* — and
she laughs. He is thirty-four, a Marine, deployed. He promises he will be home
for her birthday and she makes him say it twice. He does not come home. Eleven
days later, neither does she. And every morning at 7:11 the phone still rings,
and someone still answers.

## How the voices are made

`libritts-high` is a 904-speaker model, so the two performers were cast by
measurement rather than by ear: every fourth speaker was synthesised and its
median F0 estimated by autocorrelation (`scan.py` in the working directory).

| role | speaker | raw F0 | vocal-tract respeed | final F0 |
|------|---------|--------|---------------------|----------|
| her  | sid 664 | 269 Hz | x1.14 (up)          | ~300 Hz  |
| him  | sid 436 | 114 Hz | x0.955 (down)       | ~95 Hz   |

Resampling scales pitch *and* formants together, which is the physically honest
way to change the size of a speaker — a six-year-old is not an adult pitched up.
The synthesis length_scale is pre-divided by the same ratio so the delivery
still lands at the intended tempo.

Her side of the call then goes down an actual phone: 330 Hz-3.4 kHz band,
handset resonance at 1.75 kHz, network AGC, decimation to 8 kHz with 8-bit
mu-law quantisation, carrier hiss and packet-loss dropouts. That chain is also
what makes synthesised speech read as real — you are not hearing a voice, you
are hearing a voice through a phone.

His side never touches a filter like that: proximity shelf, presence lift, a
dynamic-mic top end, air at roughly -32 dB above 2.5 kHz, and a barely-wet
bunk-room convolution. He is in the room with you.

The laugh is built rather than spoken: one vowel, seven bursts at 5.4 Hz with a
descending F0 contour, per-burst jitter, decaying amplitude and a catch of
breath at the end.

## How the sound design is made

`sfx.py` is entirely procedural. The phone vibrating is an eccentric motor at
172 Hz plus a rattle burst per revolution, tuned to the resonance of the board
it sits on. The braam is a detuned brass stack driven into saturation over a
pitch-dropping sub. The felt piano has real string inharmonicity, a hammer
transient and action noise. Reverb is convolution against synthesised impulse
responses — a bunk room, a scoring hall, and one very large empty space.

## How the mix is cut

Trailer dynamics are a loudness curve, so `mix.py` states the curve it wants in
LUFS, measures what the mix actually does on a 400 ms window, and drives the
automation from the difference. That is `fit_arc`. The hit is the ceiling and
every quiet passage keeps the distance from it that the arc asked for.

Three things are deliberate and worth not "fixing":

- **The score gets out of the way for the call.** Down 20 dB from 17.6s to
  25.8s. The call is the only thing in the film that is just two people.
- **The loudest moment is the hole after the hit.** Everything gates to zero
  for 1.4 seconds under `HE DOES NOT COME HOME`; only the tinnitus survives.
- **It is not loudness-normalised.** Peak-referenced at -18 LUFS integrated
  with ~17 dB of range. A levelled trailer is a trailer with no scenes.

`cards.json` is written by `mix.py` and read by `render.py`, so picture and
sound are cut from one list and cannot drift.

## Picture

Black cards, cold blue-steel glow, film grain, vignette. The glow is driven by
the soundtrack's envelope and its low band separately, so the frame physically
swells on the braam and breathes with her voice over black during the call.
Type is Jost (letterspaced, variable weight axis); the title is Cormorant
Garamond.
