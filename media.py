"""Local media operations. Model suggestions never execute a media operation."""
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
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
    video = next((line for line in text.splitlines() if 'Stream #' in line and 'Video:' in line and 'attached pic' not in line), '')
    if not match or not video:
        raise ValueError('This file could not be read as a finite video. Try an MP4, MOV or WebM file.')
    duration = int(match[1]) * 3600 + int(match[2]) * 60 + float(match[3])
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('The video duration could not be read.')
    dimensions = re.search(r'\b(\d{2,5})x(\d{2,5})\b', video)
    rotation = re.search(r'rotation of (-?[\d.]+) degrees', text)
    width, height = map(int, dimensions.groups()) if dimensions else (1920, 1080)
    if rotation and round(float(rotation[1])) % 180 == 90:
        width, height = height, width
    rate = re.search(r'([\d.]+) fps', video)
    return {'duration': duration, 'audio': bool(re.search(r'Stream.*Audio:', text)),
            'width': width, 'height': height, 'fps': float(rate[1]) if rate else None,
            'hdr': 'arib-std-b67' in video or 'smpte2084' in video,
            'codec': video.split('Video:', 1)[1].strip().split()[0]}


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


def run_media(arguments, timeout=600):
    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        raise ValueError('FFmpeg is required to prepare this video.')
    try:
        result = subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin',
                                 *arguments], capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise ValueError('This media operation timed out.') from exc
    if result.returncode:
        detail = result.stderr.decode(errors='replace').strip().splitlines()
        raise ValueError('FFmpeg could not process this video. ' + (detail[-1][:240] if detail else ''))
    return result.stdout


def canvas_for(info, height):
    if info['height'] > info['width']:
        return height, round(height * 16 / 9 / 2) * 2
    return round(height * 16 / 9 / 2) * 2, height


def encode_segment(source, target, info, width, height, start=0, end=None, crf=22):
    duration = (info['duration'] if end is None else end) - start
    filters = (f'fps=30,scale={width}:{height}:force_original_aspect_ratio=decrease:'
               'force_divisible_by=2:flags=bilinear,setsar=1')
    if info.get('hdr'):
        filters += (',zscale=t=linear:npl=100,format=gbrpf32le,tonemap=mobius:desat=2,'
                    'zscale=p=bt709:t=bt709:m=bt709:r=tv')
    filters += f',format=yuv420p,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,tpad=stop_mode=clone:stop_duration=0.15'
    args = ['-filter_threads', '2', '-threads', '4', '-ss', f'{start:.6f}',
            '-i', str(source)]
    if not info['audio']:
        args += ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    args += ['-map', '0:V:0', '-map', '0:a:0' if info['audio'] else '1:a:0',
             '-vf', filters, '-af', 'aresample=48000:async=1:first_pts=0,apad',
             '-t', f'{duration:.6f}', '-ac', '2', '-c:a', 'aac', '-b:a', '160k',
             '-c:v', 'libx264', '-threads:v', '4', '-preset', 'veryfast', '-crf', str(crf),
             '-g', '30', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries',
             'bt709', '-color_trc', 'bt709', '-map_metadata', '-1', '-map_chapters', '-1',
             '-movflags', '+faststart', '-y', str(target)]
    run_media(args)


def make_proxy(source, target, info):
    width, height = canvas_for(info, 540)
    with tempfile.TemporaryDirectory(prefix='source-preview-', dir=target.parent) as folder:
        temporary = Path(folder) / 'preview.mp4'
        encode_segment(source, temporary, info, width, height, crf=24)
        result = probe(temporary)
        if abs(result['duration'] - info['duration']) > .2:
            raise ValueError('The preview timing did not match the original.')
        temporary.replace(target)


def render_sequence(entries, target, height, progress):
    width, height = canvas_for(entries[0]['info'], height)
    expected = sum(row['end'] - row['start'] for row in entries)
    timeline = []
    offset = 0.0
    with tempfile.TemporaryDirectory(prefix='sequence-', dir=target.parent) as folder:
        folder = Path(folder)
        for index, row in enumerate(entries):
            progress(f'Rendering segment {index + 1} of {len(entries)}')
            part = folder / f'{index:04}.mp4'
            encode_segment(row['path'], part, row['info'], width, height, row['start'], row['end'])
            duration = probe(part)['duration']
            timeline.append({'source': row['info']['id'], 'start': row['start'], 'end': row['end'],
                             'offset': offset, 'duration': duration})
            offset += duration
        listing = folder / 'segments.txt'
        listing.write_text(''.join(f"file '{i:04}.mp4'\n" for i in range(len(entries))))
        artifact = folder / 'complete.mp4'
        run_media(['-f', 'concat', '-safe', '1', '-i', str(listing), '-map', '0:v:0',
                   '-map', '0:a:0', '-c', 'copy', '-movflags', '+faststart', '-y', str(artifact)])
        result = probe(artifact)
        if abs(result['duration'] - expected) > max(.25, .07 * len(entries)) or not result['audio']:
            raise ValueError('The rendered timeline did not match the expected duration.')
        artifact.replace(target)
    return {**result, 'timeline': timeline}
