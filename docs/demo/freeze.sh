#!/usr/bin/env bash
# Hold a still frame over a window of one scene segment (e.g. to hide a page reload's unstyled
# flash), then reassemble the final video from the segments as mux.sh does.
# Usage: AUDIO_DIR=audio-v11 OUT_NAME=… ./freeze.sh <scene> <from_s> <to_s>
set -euo pipefail
cd "$(dirname "$0")"
OUT_NAME="${OUT_NAME:-cerbo-supplement-store-demo}"
scene="$1"; from="$2"; to="$3"
seg="out/seg/${OUT_NAME}-${scene}.mp4"
hold=$(python3 -c "print(round($to - $from, 3))")
ffmpeg -y -hide_banner -loglevel error -i "$seg" \
  -filter_complex "[0:v]split=3[a][b][c];
    [a]trim=0:${from},setpts=PTS-STARTPTS[v1];
    [b]trim=${from}:$(python3 -c "print($from+0.04)"),setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${hold},trim=0:${hold},setpts=PTS-STARTPTS[v2];
    [c]trim=${to},setpts=PTS-STARTPTS[v3];
    [v1][v2][v3]concat=n=3:v=1:a=0,fps=30[v]" \
  -map "[v]" -map 0:a -c:v libx264 -preset medium -crf 18 -r 30 -c:a copy "${seg}.tmp.mp4"
mv "${seg}.tmp.mp4" "$seg"
echo "patched ${scene}: still frame ${from}s held until ${to}s"
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i out/concat.txt -c copy out/_joined.mp4
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 out/_joined.mp4)
ffmpeg -y -hide_banner -loglevel error -i out/_joined.mp4 \
  -vf "fade=t=out:st=$(python3 -c "print(round($dur-0.8,2))"):d=0.8" -af "afade=t=out:st=$(python3 -c "print(round($dur-0.8,2))"):d=0.8" \
  -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart "out/${OUT_NAME}.mp4"
rm -f out/_joined.mp4
ffprobe -v error -show_entries format=duration -of default=nw=1 "out/${OUT_NAME}.mp4"
