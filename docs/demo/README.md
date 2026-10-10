# Demo video pipeline

Produces `out/cerbo-supplement-store-demo-v1.1.mp4` (1920×1080, 30 fps, ~4:17): screen capture of
the live app narrated in Andre's cloned voice (Chatterbox standard model, local GPU). Everything is
scripted so the video can be regenerated after UI changes.

Scenes: title slide · chart (sign in, Supplements tab, add two supplements, create order) · order
page (margin → price, live split, send) · patient portal (pay from Secure Messages: declined then
good, receipt, replay; request a refill) · the request on the chart → order → send · audit (ledger,
half-cent fee) · Orders / sales report (drop-ship note) · under-the-hood slide · close slide.

1. **Narration** — one text file per scene in `narration/`, one paragraph per thought:
   ```bash
   conda run -n chatterbox python docs/demo/tts_std.py docs/demo/narration docs/demo/audio-v11
   ```
   (needs the `chatterbox` conda env and `~/code/chatterbox-play`, which holds the voice reference).
2. **Slides** — `slides/*.html` → `slides/png/*.png`: `node slides.mjs`.
3. **Screen capture** — `record.mjs` drives the live site in headless Chrome, injects a visible
   cursor, and screencasts each scene for the length of its narration. It resets Zeus King's
   supplement list and open requests first, so it can be re-run.
   ```bash
   AUDIO_DIR=audio-v11 BASE=https://app-production-500d.up.railway.app node record.mjs
   DRY=1 BASE=http://localhost:5173 node record.mjs     # selector check without narration
   SCENES=s07_reporting AUDIO_DIR=audio-v11 node record.mjs   # re-record one scene (then mux + freeze again)
   ```
   The demo order is built so its total lands on a half cent (vitamin D at 60% margin → $10.00,
   total $42.00, fee 31.5¢ → 32¢) because the audit narration says so.
4. **Assembly** — `AUDIO_DIR=audio-v11 OUT_NAME=cerbo-supplement-store-demo-v1.1 ./mux.sh` paces
   every clip/still to its WAV, concatenates, fades out.
5. **Touch-up** — `OUT_NAME=… ./freeze.sh <scene> <from_s> <to_s>` holds a still frame over a
   window of one segment and reassembles (used to hide the unstyled flash of the page reload in
   the portal scene: `./freeze.sh s04_portal_pay 28.5 34.25`).

Generated artefacts (`audio*/*.wav`, `clips/`, `slides/png/`, `out/`) are gitignored; the scripts,
narration and slide HTML are the source of truth.
