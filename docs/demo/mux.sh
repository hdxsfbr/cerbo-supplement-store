#!/usr/bin/env bash
# Assemble the demo: per-scene clips (screencast WebM or a still PNG) paced to each narration WAV,
# then concatenated. Output: docs/demo/out/${OUT_NAME}.mp4 (1920x1080, 30 fps,
# H.264 + AAC 48 kHz). Usage: ./mux.sh
set -euo pipefail
cd "$(dirname "$0")"
AUDIO_DIR="${AUDIO_DIR:-audio}"          # audio (Turbo) or audio-std (standard model)
OUT_NAME="${OUT_NAME:-cerbo-supplement-store-demo}"
mkdir -p out/seg
SCENES=(s01_intro s02_builder s03_portal_pay s04_audit s05_dashboard s06_under_hood s07_close)
declare -A STILL=([s01_intro]=/tmp/shot/slide-s01_title.png [s07_close]=/tmp/shot/slide-s07_close.png)
LEAD=0.35   # silence before each scene's narration starts
TAIL=0.45   # hold after narration ends
> out/concat.txt
for s in "${SCENES[@]}"; do
  wav="${AUDIO_DIR}/${s}_norm.wav"
  adur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav")
  total=$(python3 -c "print(round($adur + $LEAD + $TAIL, 3))")
  seg="out/seg/${OUT_NAME}-${s}.mp4"
  # audio: lead-in silence + narration, resampled to 48 kHz mono→stereo
  afilt="adelay=${LEAD}s:all=1,aresample=48000,apad=whole_dur=${total}"
  if [[ -n "${STILL[$s]:-}" ]]; then
    ffmpeg -y -hide_banner -loglevel error -loop 1 -framerate 30 -t "$total" -i "${STILL[$s]}" -i "$wav" \
      -filter_complex "[0:v]scale=1920:1080,format=yuv420p,fade=t=in:st=0:d=0.5[v];[1:a]${afilt}[a]" \
      -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -r 30 -c:a aac -b:a 192k -ac 2 -t "$total" "$seg"
  else
    webm="clips/${s}.webm"
    # screencast frames are variable-rate; normalise to 30 fps CFR, then freeze the last frame until `total`
    ffmpeg -y -hide_banner -loglevel error -i "$webm" -i "$wav" \
      -filter_complex "[0:v]fps=30,scale=1920:1080:flags=lanczos,format=yuv420p,tpad=stop_mode=clone:stop_duration=${total}[v];[1:a]${afilt}[a]" \
      -map "[v]" -map "[a]" -c:v libx264 -preset medium -crf 18 -r 30 -c:a aac -b:a 192k -ac 2 -t "$total" "$seg"
  fi
  printf "%-16s audio %6.2fs  → segment %6.2fs\n" "$s" "$adur" "$total"
  echo "file 'seg/${OUT_NAME}-${s}.mp4'" >> out/concat.txt
done
ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i out/concat.txt -c copy out/_joined.mp4
# gentle fade out at the very end, faststart for web playback
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 out/_joined.mp4)
ffmpeg -y -hide_banner -loglevel error -i out/_joined.mp4 \
  -vf "fade=t=out:st=$(python3 -c "print(round($dur-0.8,2))"):d=0.8" -af "afade=t=out:st=$(python3 -c "print(round($dur-0.8,2))"):d=0.8" \
  -c:v libx264 -preset medium -crf 18 -c:a aac -b:a 192k -movflags +faststart out/${OUT_NAME}.mp4
rm -f out/_joined.mp4
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate,codec_name -of default=nw=1 out/${OUT_NAME}.mp4
