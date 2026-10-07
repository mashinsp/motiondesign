# SORA SYSTEMS spec ad

| Step | Status | Files |
|---|---|---|
| 1. Brief | approved | `BRIEF.md`, `ref_analysis/` |
| 2. Assets | approved | `ASSETS.md`, `assets_in/` (+ `CREDITS.md`) |
| 4. Preview v1 (16:9) | feedback received | `out/SORA_preview_v1_16x9.mp4` |
| 4. Preview v2 (16:9) | **awaiting feedback** | `out/SORA_preview_v2_16x9.mp4`, `out/SORA_preview_v2_contact_sheet.jpg` |
| 5. Finals 16:9 + 9:16, stems | after approval | |

## Build (all code, deterministic)
- `build/tl.js`: beats, card copy, typing schedule, clock, comet paths, SFX event list (shared by picture and sound)
- `build/engine.js`: canvas renderer (`?fmt=169` or `?fmt=916`), bloom chain, sub-frame motion blur
- `build/render.js`: headless Chromium driver (`frames`, `stills`, `events`)
- `build/audio.py`: original music + placeholder SFX, stems by category, master −14 LUFS / −1 dBTP
- `build/sheet.sh`: contact sheets

```
cd build
node render.js events events.json && python3 audio.py events.json ../out/audio_v1
node render.js frames 169 0 1260 /tmp/frames      # 21 s × 60 fps (split across workers)
ffmpeg -framerate 60 -i /tmp/frames/f%05d.png -i ../out/audio_v1/mix.wav \
  -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,noise=c0s=3:c0f=t" \
  -c:v libx264 -crf 17 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -b:a 320k out.mp4
```

Preview v1 SFX are synthesized placeholders in the planned cue slots. They get swapped for files from the client's
*FOUR Editors Sound Effects* library before finals.
