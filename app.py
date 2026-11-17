"""Run with python3 app.py. Serves this prototype only on the local computer."""
import argparse
import hashlib
import json
import mimetypes
import re
import secrets
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import media

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
TOKEN = secrets.token_urlsafe(32)
EXPORT_LOCK = threading.Lock()
MAX_UPLOAD = 512 * 1024 * 1024


def media_record(identifier):
    if not re.fullmatch(r'[a-f0-9]{32}', identifier):
        raise ValueError('This local video does not exist.')
    path = DATA / (identifier + '.json')
    if not path.exists():
        raise ValueError('This local video is no longer available. Import the original again.')
    return DATA / (identifier + '.mp4'), json.loads(path.read_text())


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def send_json(self, value, code=200):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def serve_file(self, path, mime=None, download=False):
        if not path.is_file():
            self.send_json({'error': 'File unavailable.'}, 404)
            return
        size = path.stat().st_size
        start, end, partial = 0, size-1, False
        header = self.headers.get('Range', '')
        if header:
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', header)
            if not match or (not match[1] and not match[2]):
                self.send_json({'error': 'Unsupported range.'}, 416)
                return
            if match[1]:
                start = int(match[1]); end = min(int(match[2]) if match[2] else end, end)
            else:
                start = max(0, size-int(match[2]))
            if not 0 <= start <= end < size:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{size}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            partial = True
        self.send_response(206 if partial else 200)
        self.send_header('Content-Type', mime or mimetypes.guess_type(path.name)[0] or 'application/octet-stream')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end-start+1))
        self.send_header('Cache-Control', 'no-store' if path.is_relative_to(DATA) else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if partial:
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        if download:
            self.send_header('Content-Disposition', 'attachment; filename="local-cut-review.mp4"')
        self.end_headers()
        if self.command == 'HEAD':
            return
        try:
            with path.open('rb') as f:
                f.seek(start)
                remaining = end-start+1
                while remaining:
                    chunk = f.read(min(256*1024, remaining))
                    if not chunk: break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlparse(self.path).path
        try:
            if path == '/api/bootstrap':
                self.send_json({'token': TOKEN, 'export_available': bool(media.ffmpeg_path())})
            elif path.startswith('/media/'):
                self.serve_file(media_record(path[7:])[0], 'video/mp4')
            elif re.fullmatch(r'/exports/[a-f0-9]{32}\.mp4', path):
                self.serve_file(DATA / path.split('/')[-1], 'video/mp4', True)
            elif path in ['/', '/app.js', '/style.css', '/cuts.mjs']:
                name = 'index.html' if path == '/' else path[1:]
                self.serve_file(ROOT / 'web' / name, 'text/javascript' if name.endswith(('.js', '.mjs')) else None)
            else:
                self.send_json({'error': 'Not found.'}, 404)
        except (ValueError, FileNotFoundError):
            self.send_json({'error': 'This source is unavailable. Import it again.'}, 404)

    def do_POST(self):
        # A remote page cannot obtain the per-run token through browser CORS.
        if not secrets.compare_digest(self.headers.get('X-App-Token', ''), TOKEN):
            self.send_json({'error': 'Reload this local application before continuing.'}, 403)
            self.close_connection = True
            return
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if path == '/api/upload':
                if not 0 < length <= MAX_UPLOAD:
                    raise ValueError('Choose a video smaller than 512 MB for this local prototype.')
                identifier = uuid.uuid4().hex
                file = DATA / (identifier + '.mp4')
                remaining, digest = length, hashlib.sha256()
                try:
                    with file.open('wb') as out:
                        while remaining:
                            chunk = self.rfile.read(min(256*1024, remaining))
                            if not chunk: raise ValueError('The upload was interrupted. Import the source again.')
                            out.write(chunk); digest.update(chunk); remaining -= len(chunk)
                    info = media.probe(file)
                    info.update(id=identifier, name=unquote(self.headers.get('X-Filename', 'Imported video'))[:160],
                                sha256=digest.hexdigest(), url='/media/' + identifier)
                    (DATA / (identifier + '.json')).write_text(json.dumps(info))
                    self.send_json(info)
                except Exception:
                    file.unlink(missing_ok=True)
                    raise
            elif path == '/api/export':
                if not 0 < length <= 30000:
                    raise ValueError('The edit request is too large or empty.')
                value = json.loads(self.rfile.read(length))
                if not isinstance(value, dict) or value.get('confirmed') is not True:
                    raise ValueError('Review and confirm the export first.')
                source, info = media_record(str(value.get('source', '')))
                if value.get('source_hash') != info['sha256']:
                    raise ValueError('The source changed. Review this video again before exporting.')
                media.checked_cuts(value.get('cuts'), info['duration'])
                if not EXPORT_LOCK.acquire(blocking=False):
                    self.send_json({'error': 'Another export is running. Wait for it to finish.'}, 409)
                    return
                try:
                    identifier = uuid.uuid4().hex
                    result = media.export_video(source, DATA / (identifier + '.mp4'), value['cuts'], info)
                    self.send_json({**result, 'url': '/exports/' + identifier + '.mp4', 'original_preserved': True})
                finally:
                    EXPORT_LOCK.release()
            else:
                self.send_json({'error': 'Not found.'}, 404)
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
            self.send_json({'error': str(exc)}, 400)
            self.close_connection = True
        except Exception:
            self.send_json({'error': 'The local media operation failed. The original has not been changed.'}, 500)

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8766)
    args = parser.parse_args()
    DATA.mkdir(exist_ok=True)
    print(f'Local Cut Review: http://127.0.0.1:{args.port}', flush=True)
    print('Stop with Ctrl+C. Imported media stays in data/ on this computer.', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
