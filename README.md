# Local Cut Review

README prose word count: 652 (excluding this count line and fenced commands).

I built this project to explore how creators can check what an editing assistant rearranges or removes. The editor takes several videos, proposes an order and short cuts, and lets the creator inspect and change the result before exporting.

## Status and stack

- **Implemented** Batch import, lightweight source previews, local picture and speech analysis, AI sequencing and timed cut suggestions, continuous draft playback, editing controls and MP4 export from the originals.
- **Planned** More reliable fine-grained action and speech boundaries, broader codec testing and evaluation with creators.

Browser JavaScript manages the timeline and decisions. A local Python server coordinates FFmpeg, Whisper Base speech transcription and the Qwen3-VL 2B and 4B instruction models through Ollama. The 2B model describes groups of frames. The 4B model proposes the order and checks for redundant or unrelated intervals. Source files and model inference stay on the computer.

## Run on a Mac

The editor needs Python 3.9+ and FFmpeg with `libx264`, `zscale` and `tonemap` for the HDR path. Use FFmpeg on your PATH, set `FFMPEG_PATH` to the executable, or create a local `local_config.json` with an `ffmpeg` path. The setup script for Apple silicon uses Python 3.12+, downloads the local AI runtime and several gigabytes of model weights, and needs internet access for setup only. Run it with the editor stopped. It skips downloads when the runtime is already in place.

```sh
python3.12 setup_local_ai.py
python3 app.py
```

Open the address printed in the terminal, usually [http://127.0.0.1:8766](http://127.0.0.1:8766). If the port is busy, use `python3 app.py --port 8767`. Stop with `Ctrl+C`. Manual editing works with FFmpeg while the local AI models are unavailable.

[FFmpeg documentation](https://ffmpeg.org/documentation.html) · [Ollama Qwen3-VL models](https://ollama.com/library/qwen3-vl) · [whisper.cpp](https://github.com/ggml-org/whisper.cpp)

## Try the editor

1. Select several source files with **Import videos**. Wait for **Preview ready**. Remove an unwanted source with **Remove**. The original file stays on disk.
2. Add a goal and any content to preserve, if relevant. Select **Build AI rough cut** to analyze the sources. **Build rough-cut preview** plays the existing timeline.
3. Review the order and cut cards. Use **Watch with context** or **Watch comparison**, then keep, adjust or confirm a candidate. Use **Restore** on a confirmed cut. Confirm the rough cut before exporting outstanding AI edits.
4. Export at 720p, 1080p or 4K. The current output normalizes to 30 fps SDR. The browser's lighter preview does not determine export resolution.

## Development record

- `f3ba210` and `f60c59e` turned Lab 4 decision records into a working single-source editor. They introduced local playback, review, reversible cuts and an MP4 path checked against source frames and audio.
- The multi-source version addresses 4K playback stalls and the need to rearrange several recordings. It keeps the source files, prepares browser previews and uses originals for the export. It also adds source removal and comparison controls.
- In testing, an early model repeated the import order and sometimes gave a cut reason without a usable reference. The implementation separates visual observation from planning and constrains cut evidence to actual interval IDs. See [EVALUATION.md](EVALUATION.md) for checks, example results and limits.

## Verify and locate files

```sh
mkdir -p work
python3 -m unittest discover -s tests -v
node --test tests/review.test.mjs
```

`app.py`, `media.py`, `project_jobs.py` and `web/` run the editor. `local_analysis.py` and `speech_worker.py` run inference. `report/figures/` contains report diagrams. The submission report is kept locally. Personal footage, generated media, model weights and local settings are excluded from Git. Sources and exports stay in `data/`. Decisions stay in browser storage and can be downloaded as JSON.

## AI assistance

I set the project direction, recorded the evaluation clips, specified what the draft should preserve and tried the four-clip workflow. OpenAI Codex assisted implementation, model setup, test execution, diagram preparation and report drafting. I reviewed the revised workflow and the AI suggestions before approving this version. The engineering checks establish the tested behavior and leave general editing quality for future evaluation.
