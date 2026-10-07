#!/bin/bash
# usage: sheet.sh <fmt> <out.png> <cols> t1 t2 ...   -> labelled contact sheet of stills
fmt=$1; out=$2; cols=$3; shift 3
d=$(mktemp -d); node "$(dirname "$0")/render.js" stills $fmt $d "$@" || exit 1
if [ "$fmt" = "916" ]; then sc="270:480"; else sc="480:270"; fi
i=0; for t in "$@"; do f=$(printf "%s/s_%.2f.png" $d $t); ffmpeg -v error -y -i $f -vf "scale=$sc,drawtext=text='$t':x=6:y=6:fontsize=18:fontcolor=yellow:box=1:boxcolor=black@0.5" $d/l_$(printf %03d $i).png; i=$((i+1)); done
rows=$(( (i+cols-1)/cols ))
ffmpeg -v error -y -framerate 1 -i $d/l_%03d.png -vf "tile=${cols}x${rows}:padding=4:color=gray" -frames:v 1 $out
rm -rf $d
