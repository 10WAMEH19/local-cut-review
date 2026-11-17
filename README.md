# Local Cut Review

README prose word count: 457 (excluding this count line and fenced commands).

My project explores how a creator can inspect and correct short cuts proposed by an editing assistant. I chose local intervals within footage, a general creator audience, an optional duration preference, and confirmation with independent restoration.

## Status and stack

- Implemented: local video import/playback, manual proposals, context preview, boundary adjustment, Keep/Restore, refresh persistence, JSON decisions and actual MP4 export. The original is retained.
- Planned: automatic visual/speech understanding and contextual relevance judgement. Imported videos receive manual review. Preserve notes are stored; interval-level Keep/Restore provides the implemented protection. Duration preferences do not force cuts.

Browser JavaScript handles review; Python's standard library serves local files and validates requests; FFmpeg trims/re-encodes video and audio. There is no external AI API or model in this version.

## Run

Use Python 3.10+ and FFmpeg:

```sh
python3 app.py
```

Open http://127.0.0.1:8766. Keep the terminal open; Ctrl+C stops the server. `Launch.command` runs the same command. If needed, use `python3 app.py --port 8767`.

If FFmpeg is not on PATH:

```sh
FFMPEG_PATH=/full/path/to/ffmpeg python3 app.py
```

This Mac has an ignored `local_config.json` pointing to an existing installation. Other computers must supply FFmpeg: https://ffmpeg.org/documentation.html.

## Inspect the interaction

Import a video, mark and confirm a manual range, then export a separate MP4. Restore returns the interval to the working edit.

## Development record

Lab 3 specified contextual judgement and local recovery; Lab 4 changed decision records without rendering video.

- `f3ba210` added actual media import/playback, per-interval review, and export.
- `f60c59e` clarified operation-specific confirmation messages, and added real HTTP round-trip and retained-frame checks.

Browser inspection also exposed a hidden-file-input styling issue, corrected during the initial build.

These are actual A2 commits, not reconstructed lab history. See `EVALUATION.md` for observed results and limits.

## Checks

```sh
python3 -m unittest discover -s tests -v
node --test tests/review.test.mjs
```

FFmpeg is required for export tests; Node.js is needed only for JavaScript tests. Safari checks covered cancellation, confirmation, restoration, persistence, import and export. Preview seeking is approximate; rendered outputs are checked for duration/audio, with sampled frame comparisons in tests. No participant study has been completed.

## Files and privacy

`app.py`, `media.py` and `web/` implement the app; `tests/` contains checks. The local submission report and working evidence are excluded from Git.

Media/exports stay in ignored `data/`; decisions stay in browser storage. Nothing is sent to an external AI service. Limits: one source per review, 512 MB imports and 80 cut ranges per export.

## AI assistance

I directed scope and interaction requirements through the earlier labs and this development. OpenAI Codex assisted coding, test execution, Safari walkthroughs and report drafting. My requests broadened the audience, removed a fixed duration limit and required content-level cuts with user correction. The checks above exposed interface issues that were corrected. Automatic inference remains planned; final student review is pending.
