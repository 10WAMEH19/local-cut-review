"""Local media operations. Model suggestions never execute a media operation."""
import json
import math
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def ffmpeg_path():
    value = os.environ.get('FFMPEG_PATH') or shutil.which('ffmpeg')
    config = ROOT / 'local_config.json'
    if not value and config.exists():
        value = json.loads(config.read_text()).get('ffmpeg')
    return value if value and Path(value).is_file() else None


def probe(path, ffmpeg=None):
    ffmpeg = ffmpeg or ffmpeg_path()
    if not ffmpeg:
        raise ValueError('FFmpeg is unavailable. Configure it to import or export media.')
    p = subprocess.run([ffmpeg, '-hide_banner', '-i', str(path)], capture_output=True, timeout=15)
    text = p.stderr.decode('utf-8', 'replace')
    match = re.search(r'Duration: (\d+):(\d+):([\d.]+)', text)
    if not match or not re.search(r'Stream.*Video:', text):
        raise ValueError('This file could not be read as a finite video. Try an MP4, MOV or WebM file.')
    duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('The video duration could not be read.')
    return {'duration': duration, 'audio': bool(re.search(r'Stream.*Audio:', text))}


def checked_cuts(cuts, duration):
    if not isinstance(cuts, list) or len(cuts) > 80:
        raise ValueError('Use a list containing at most 80 local cuts in this prototype.')
    values = []
    for cut in cuts:
        if not isinstance(cut, dict) or set(cut) != {'start', 'end'}:
            raise ValueError('Each cut needs only a start and end time.')
        a, b = cut['start'], cut['end']
        if any(type(t) not in (int, float) or not math.isfinite(t) for t in (a, b)):
            raise ValueError('Cut times must be finite numbers.')
        if not 0 <= a < b <= duration or b - a < .1:
            raise ValueError('A cut must be at least 0.1 seconds and stay inside the original video.')
        values.append((a, b))
    merged = []
    for a, b in sorted(values):
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(b, merged[-1][1]))
        else:
            merged.append((a, b))
    if duration - sum(b-a for a, b in merged) < .1:
        raise ValueError('Keep at least 0.1 seconds of footage. Nothing has been exported.')
    return merged


def kept_ranges(cuts, duration):
    cuts = checked_cuts(cuts, duration)
    kept, cursor = [], 0
    for a, b in cuts:
        if a > cursor:
            kept.append((cursor, a))
        cursor = b
    if cursor < duration:
        kept.append((cursor, duration))
    return kept


def export_video(source, destination, cuts, info, ffmpeg=None):
    ffmpeg = ffmpeg or ffmpeg_path()
    if not ffmpeg:
        raise ValueError('FFmpeg is unavailable. The edit decisions and original are unchanged.')
    kept = kept_ranges(cuts, info['duration'])
    filters, inputs = [], []
    for i, (a, b) in enumerate(kept):
        filters.append(f'[0:v:0]trim=start={a:.6f}:end={b:.6f},setpts=PTS-STARTPTS[v{i}]')
        inputs.append(f'[v{i}]')
        if info['audio']:
            filters.append(f'[0:a:0]atrim=start={a:.6f}:end={b:.6f},asetpts=PTS-STARTPTS[a{i}]')
            inputs.append(f'[a{i}]')
    filters.append(''.join(inputs) + f'concat=n={len(kept)}:v=1:a={int(info["audio"])}[v]' + ('[a]' if info['audio'] else ''))
    command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', str(source),
               '-filter_complex', ';'.join(filters), '-map', '[v]']
    if info['audio']:
        command += ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k']
    command += ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart', str(destination)]
    try:
        result = subprocess.run(command, capture_output=True, timeout=180)
        if result.returncode != 0:
            raise ValueError('The video could not be rendered. The original and edit decisions are unchanged.')
        output = probe(destination, ffmpeg)
        expected = sum(b-a for a, b in kept)
        if abs(output['duration'] - expected) > .25 or output['audio'] != info['audio']:
            raise ValueError('The exported video failed its duration/audio check. No download was offered.')
        return {**output, 'kept_intervals': kept, 'expected_duration': expected}
    except subprocess.TimeoutExpired:
        raise ValueError('Rendering took too long. Try a smaller source or fewer cuts; your decisions are retained.') from None
    except Exception:
        if Path(destination).exists():
            Path(destination).unlink()
        raise
