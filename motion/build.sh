#!/bin/bash
# Full deterministic build: events -> score -> frames (4 workers) -> H.264/AAC MP4.
set -e
cd "$(dirname "$0")"
FR=${FRAMES_DIR:-/tmp/agentic_frames}
OUT=../out
mkdir -p $OUT $FR
node render.js events events.json
python3 audio.py events.json $OUT/score.wav
TOTAL=$(node -e "const T=require('./timeline.js');console.log(Math.round(T.DUR*T.FPS))")
Q=$(( (TOTAL+3)/4 ))
for i in 0 1 2 3; do s=$((i*Q)); e=$(( (i+1)*Q < TOTAL ? (i+1)*Q : TOTAL )); node render.js frames $s $e $FR & done
wait
ffmpeg -y -v error -framerate 60 -i $FR/f%05d.png -i $OUT/score.wav \
  -vf "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos,format=yuv420p,noise=c0s=3:c0f=t" \
  -c:v libx264 -preset slow -crf 17 -maxrate 16M -bufsize 32M -profile:v high -level 4.2 -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 320k -ar 48000 -movflags +faststart -shortest $OUT/agentic_systems_sora.mp4
echo done: $OUT/agentic_systems_sora.mp4
