# motiondesign

## Agentic Systems Aren't Just Chatbots — Sora Systems (30 s, 9:16)

`out/agentic_systems_sora.mp4` — 1080×1920, 60 fps, H.264 yuv420p BT.709, AAC 320 kbps, −14 LUFS.

Everything is code: visuals are a deterministic HTML Canvas renderer (every frame is a pure
function of time) driven by headless Chromium; the score is synthesized in numpy/scipy from the
event list exported by the same animation timeline, so every sound is frame-accurate.

| file | role |
|---|---|
| `motion/timeline.js` | scene timing, geometry and the sound-event list (shared by renderer and audio) |
| `motion/engine.js` | canvas renderer: scenes, bloom (low-res blur chain), motion blur (sub-frame accumulation) |
| `motion/index.html` | page that loads web fonts (Inter Tight, Instrument Serif) and the engine |
| `motion/render.js` | Playwright driver: `frames`, `stills`, `events` modes |
| `motion/audio.py` | pad, gliding bass, drops/kalimba/harp/glass/bells/plucks/whooshes/booms/reverse swells, reverb, loudness |
| `motion/logo_trace.py` | traces the Sora Systems mark into a vector contour (`logo.json` / `logo.js`) |
| `motion/sheet.sh` | contact sheets for review |
| `motion/build.sh` | full build |

Build: `pip install numpy scipy pyloudnorm`, `npm i playwright`, then `motion/build.sh`.

Scenes: chatbot *replies* → agent has a *goal* → makes a *plan* → uses *tools* → *remembers* →
(light mode) *loops* → agents *collaborate* → not a chat, a *system* → Sora Systems end card.
Key: D♭ major (I–vi–IV–ii–V movement), all effects tuned to D♭ major pentatonic.
