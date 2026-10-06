#!/bin/bash
# usage: sheet.sh <out.png> <cols> t1 t2 ...   -> labelled contact sheet of stills
out=$1; cols=$2; shift 2
d=$(mktemp -d); node "$(dirname "$0")/render.js" stills $d "$@" || exit 1
i=0; for t in "$@"; do f=$(printf "%s/s_%.2f.png" $d $t); ffmpeg -v error -y -i $f -vf "scale=270:480,drawtext=text='$t':x=6:y=6:fontsize=18:fontcolor=yellow" $d/l_$(printf %03d $i).png; i=$((i+1)); done
n=$i; rows=$(( (n+cols-1)/cols ))
ffmpeg -v error -y -framerate 1 -i $d/l_%03d.png -vf "tile=${cols}x${rows}:padding=4:color=gray" -frames:v 1 $out
rm -rf $d
