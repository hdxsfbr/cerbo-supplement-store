# Demo video pipeline

Produces `out/cerbo-supplement-store-demo.mp4` (1920×1080, 30 fps, ~2:56): screen capture of the
live app narrated in Andre's cloned voice (Chatterbox Turbo, local GPU). Everything is scripted so
the video can be regenerated after UI changes.

1. **Narration** — one text file per scene in `narration/`. Generate audio (needs the `chatterbox`
   conda env and `~/code/chatterbox-play`, which holds the voice reference):
   ```bash
   python3 - <<'EOF'   # builds audio/batch.json from narration/*.txt (see git history for the snippet)
   EOF
   conda run -n chatterbox python ~/code/chatterbox-play/scripts/chatterbox_turbo_agent.py \
     --batch-json docs/demo/audio/batch.json --split sentence --silence-ms 300 --max-chars 280 \
     --device cuda --normalize --seed 7 --temperature 0.7
   ```
2. **Slides** — `slides/*.html` (title, under-the-hood, close), rendered to PNG with headless Chrome.
3. **Screen capture** — `record.mjs` drives the live site in headless Chrome, injects a visible
   cursor, and screencasts each scene for the length of its narration:
   `BASE=https://app-production-500d.up.railway.app node record.mjs` (`SCENES=s02_builder,…` to redo some).
4. **Assembly** — `./mux.sh` paces every clip/still to its WAV, concatenates, fades out.

Generated artefacts (`audio/*.wav`, `clips/`, `out/`) are gitignored; the scripts and narration are
the source of truth.
