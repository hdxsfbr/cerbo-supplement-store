# Demo video pipeline

Produces `out/cerbo-supplement-store-demo.mp4` (1920×1080, 30 fps, ~2:56): screen capture of the
live app narrated in Andre's cloned voice (Chatterbox Turbo, local GPU). Everything is scripted so
the video can be regenerated after UI changes.

1. **Narration** — one text file per scene in `narration/`, one paragraph per thought. Generate
   with the standard Chatterbox model, paragraph-chunked with clean joins (needs the `chatterbox`
   conda env and `~/code/chatterbox-play`, which holds the voice reference):
   ```bash
   conda run -n chatterbox python docs/demo/tts_std.py docs/demo/narration docs/demo/audio-std
   ```
   (Chatterbox Turbo was tried first via `chatterbox_turbo_agent.py`; the standard model's
   pronunciation was preferred.)
2. **Slides** — `slides/*.html` (title, under-the-hood, close), rendered to PNG with headless Chrome.
3. **Screen capture** — `record.mjs` drives the live site in headless Chrome, injects a visible
   cursor, and screencasts each scene for the length of its narration:
   `AUDIO_DIR=audio-std BASE=https://app-production-500d.up.railway.app node record.mjs`.
   The demo order is built so its total lands on a half cent (vitamin D at 60% margin → $10.00,
   total $42.00, fee 31.5¢ → 32¢) because the audit narration says so.
4. **Assembly** — `AUDIO_DIR=audio-std OUT_NAME=cerbo-supplement-store-demo-std ./mux.sh` paces
   every clip/still to its WAV, concatenates, fades out.

Generated artefacts (`audio*/*.wav`, `clips/`, `out/`) are gitignored; the scripts and narration are
the source of truth.
