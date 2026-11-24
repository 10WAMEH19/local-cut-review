"""Install the Mac analysis runtime in work/runtime using official downloads."""
from pathlib import Path
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import time
from urllib.error import URLError
from urllib.request import urlopen

import local_analysis as analysis


OLLAMA_VERSION = '0.40.18'
OLLAMA_URL = f'https://github.com/ollama/ollama/releases/download/v{OLLAMA_VERSION}/ollama-darwin.tgz'
WHISPER_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'


def download(url, target):
    if target.is_file():
        return
    print(f'Downloading {target.name}', flush=True)
    temporary = target.with_suffix(target.suffix + '.part')
    with urlopen(url, timeout=60) as source, temporary.open('wb') as destination:
        shutil.copyfileobj(source, destination)
    temporary.replace(target)


def install_models():
    models = analysis.RUNTIME / 'models'
    models.mkdir(exist_ok=True)
    environment = {**os.environ, 'OLLAMA_HOST': analysis.HOST, 'OLLAMA_MODELS': str(models),
                   'OLLAMA_NO_CLOUD': '1', 'OLLAMA_MAX_LOADED_MODELS': '1'}
    with (analysis.RUNTIME / 'setup-engine.log').open('ab') as log:
        engine = subprocess.Popen([str(analysis.OLLAMA), 'serve'], env=environment, stdout=log, stderr=log)
        try:
            for _ in range(60):
                if engine.poll() is not None:
                    raise RuntimeError('Ollama did not start. Stop the editor and check work/runtime/setup-engine.log.')
                try:
                    analysis.ollama_request('/api/tags', timeout=1)
                    break
                except (OSError, URLError):
                    time.sleep(.25)
            else:
                raise RuntimeError('Ollama did not become ready.')
            for model in (analysis.MODEL, analysis.EDITOR):
                subprocess.run([str(analysis.OLLAMA), 'pull', model], env=environment, check=True)
        finally:
            if engine.poll() is None:
                engine.terminate()
                engine.wait(timeout=15)


def main():
    if sys.version_info < (3, 12) or (platform.system(), platform.machine()) != ('Darwin', 'arm64'):
        raise SystemExit('Use Python 3.12 or newer on an Apple silicon Mac for this setup.')
    if analysis.configured():
        print('Local AI is ready. Start the editor with python3 app.py.')
        return
    runtime = analysis.RUNTIME
    runtime.mkdir(parents=True, exist_ok=True)
    if not analysis.OLLAMA.is_file():
        archive = runtime / 'ollama-darwin.tgz'
        download(OLLAMA_URL, archive)
        with tarfile.open(archive) as source:
            source.extractall(analysis.OLLAMA.parent, filter='data')
    if not analysis.SPEECH.is_file():
        subprocess.run([sys.executable, '-m', 'venv', str(runtime / 'python')], check=True)
    subprocess.run([str(analysis.SPEECH), '-m', 'pip', 'install', '--only-binary=:all:',
                    'pywhispercpp==1.5.1'], check=True)
    download(WHISPER_URL, analysis.WEIGHTS)
    install_models()
    if not analysis.configured():
        raise RuntimeError('The model setup did not finish.')
    print('Local AI is ready. Start the editor with python3 app.py.')


if __name__ == '__main__':
    main()
